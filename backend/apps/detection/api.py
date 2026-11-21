import csv
import io

from django.conf import settings
from django.db import transaction
from django.http import FileResponse, Http404, HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import Throttled, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from apps.change.models import ChangeFeature
from apps.cities.models import Dataset
from apps.common.geojson import feature_collection, geojson_response
from apps.lidar.pipeline.aoi import AoiError, validate_aoi

from .models import Building, Job, ReferenceFootprint
from .services import cancel_job, pointcloud_path

BUILDING_PROPS = [
    "epoch", "area_m2", "height_m", "max_height_m", "est_floors", "volume_m3", "point_count", "confidence", "ndvi",
]
CHANGE_PROPS = [
    "change_type", "height_before_m", "height_after_m", "delta_height_m", "area_m2", "volume_delta_m3", "confidence",
    "imagery_status", "imagery_score", "imagery_first_year", "imagery_window_start",
]
REFERENCE_PROPS = ["source", "source_id", "height_m", "matched", "iou"]

# Pipeline parameters users may set, with allowed ranges.
PARAM_RULES = {
    "min_height": (float, 1.0, 10.0),
    "min_area": (float, 5.0, 500.0),
    "simplify": (float, 0.0, 2.0),
    "change_threshold": (float, 1.0, 10.0),
    "min_change_area": (float, 5.0, 500.0),
}


def client_ip(request) -> str | None:
    fwd = request.META.get("HTTP_X_FORWARDED_FOR")
    return fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR")


class DatasetBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Dataset
        fields = ["id", "name", "provider", "acquisition_year", "point_density_ppm2", "license", "attribution"]


class JobSerializer(serializers.ModelSerializer):
    aoi = serializers.SerializerMethodField()
    dataset = DatasetBriefSerializer(read_only=True)
    dataset_before = DatasetBriefSerializer(read_only=True)
    city = serializers.SlugRelatedField(slug_field="slug", read_only=True)

    class Meta:
        model = Job
        fields = [
            "id", "mode", "status", "progress", "stage_message", "error", "aoi", "area_km2", "params", "stats",
            "dataset", "dataset_before", "city", "is_showcase", "created_at", "finished_at",
        ]

    def get_aoi(self, obj) -> dict:
        return {"type": "Polygon", "coordinates": obj.aoi.coords}


class JobCreateSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=Job.Mode.choices)
    aoi = serializers.JSONField(help_text="GeoJSON Polygon in EPSG:4326")
    dataset = serializers.PrimaryKeyRelatedField(queryset=Dataset.objects.filter(is_active=True), required=False, allow_null=True)
    dataset_before = serializers.PrimaryKeyRelatedField(
        queryset=Dataset.objects.filter(is_active=True), required=False, allow_null=True
    )
    params = serializers.DictField(required=False, default=dict)

    def validate_params(self, params):
        clean = {}
        for k, v in params.items():
            if k in ("regularize", "vegetation_filter"):
                clean[k] = bool(v)
            elif k == "method":
                if v not in ("auto", "class6", "ndsm"):
                    raise ValidationError("method must be auto, class6 or ndsm")
                clean[k] = v
            elif k == "resolution":
                if v not in ("auto", 0.5, 1.0, "0.5", "1.0"):
                    raise ValidationError("resolution must be auto, 0.5 or 1.0")
                clean[k] = v if v == "auto" else float(v)
            elif k in PARAM_RULES:
                cast, lo, hi = PARAM_RULES[k]
                try:
                    x = cast(v)
                except (TypeError, ValueError) as exc:
                    raise ValidationError(f"{k} must be a number") from exc
                if not lo <= x <= hi:
                    raise ValidationError(f"{k} must be between {lo:g} and {hi:g}")
                clean[k] = x
            else:
                raise ValidationError(f"Unknown parameter '{k}'")
        return clean

    def validate(self, data):
        try:
            aoi, km2 = validate_aoi(data["aoi"], data["mode"])
        except AoiError as exc:
            raise ValidationError({"aoi": str(exc)}) from exc
        data["aoi"], data["area_km2"] = aoi, km2
        for key in ("dataset", "dataset_before"):
            d = data.get(key)
            if d is not None and not d.coverage_polygon.intersects(aoi):
                raise ValidationError({key: f"{d.name} does not cover this area."})
        if data["mode"] == Job.Mode.MEASURE:
            data.pop("dataset_before", None)
        elif bool(data.get("dataset")) != bool(data.get("dataset_before")):
            raise ValidationError({"dataset_before": "Give both surveys, or neither to use the default pair."})
        return data


class JobViewSet(mixins.CreateModelMixin, mixins.RetrieveModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """Create a measure or change job, poll it, and fetch its results."""

    queryset = Job.objects.select_related("dataset", "dataset_before", "city").order_by("-created_at")
    serializer_class = JobSerializer
    filterset_fields = ["mode", "status", "is_showcase"]
    throttle_scope = "job_create"

    def get_throttles(self):
        return [ScopedRateThrottle()] if self.action == "create" else []

    def get_serializer_class(self):
        return JobCreateSerializer if self.action == "create" else JobSerializer

    @extend_schema(request=JobCreateSerializer, responses={202: JobSerializer})
    def create(self, request, *args, **kwargs):
        ser = JobCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        active = Job.objects.exclude(status__in=Job.TERMINAL)
        if active.count() >= settings.MAX_CONCURRENT_JOBS:
            raise Throttled(detail="The server is busy with other jobs. Try again in a minute, or load a sample area.")
        ip = client_ip(request)
        if ip and active.filter(client_ip=ip).count() >= 2:
            raise Throttled(detail="You already have jobs running. Wait for one to finish.")
        d = ser.validated_data
        job = Job.objects.create(
            mode=d["mode"],
            aoi=d["aoi"],
            area_km2=d["area_km2"],
            dataset=d.get("dataset"),
            dataset_before=d.get("dataset_before"),
            params=d.get("params") or {},
            client_ip=ip,
        )
        from .tasks import run_job

        # The job id doubles as the Celery task id so a cancel can revoke it.
        transaction.on_commit(lambda: run_job.apply_async(args=[str(job.id)], task_id=str(job.id)))
        return Response(JobSerializer(job).data, status=status.HTTP_202_ACCEPTED)

    @extend_schema(request=None, responses={200: JobSerializer, 409: OpenApiTypes.OBJECT})
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Cancel a queued or running job. It stops at its next progress checkpoint."""
        job = self.get_object()
        if not cancel_job(job):
            return Response({"detail": "The job has already finished."}, status=status.HTTP_409_CONFLICT)
        job.refresh_from_db()
        return Response(JobSerializer(job).data)

    @extend_schema(parameters=[OpenApiParameter("epoch", OpenApiTypes.STR, enum=["single", "before", "after"])],
                   responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"])
    def buildings(self, request, pk=None):
        job = self.get_object()
        qs = Building.objects.filter(job=job)
        if request.query_params.get("epoch"):
            qs = qs.filter(epoch=request.query_params["epoch"])
        return geojson_response(feature_collection(qs.order_by("id"), "footprint", BUILDING_PROPS))

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"])
    def changes(self, request, pk=None):
        job = self.get_object()
        qs = ChangeFeature.objects.filter(job=job).order_by("-area_m2")
        return geojson_response(feature_collection(qs, "geometry", CHANGE_PROPS))

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"])
    def reference(self, request, pk=None):
        job = self.get_object()
        qs = ReferenceFootprint.objects.filter(job=job).order_by("id")
        return geojson_response(feature_collection(qs, "footprint", REFERENCE_PROPS))

    @extend_schema(parameters=[OpenApiParameter("epoch", OpenApiTypes.STR, enum=["single", "before", "after"])],
                   responses={(200, "application/octet-stream"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def pointcloud(self, request, pk=None):
        job = self.get_object()
        epoch = request.query_params.get("epoch") or ("after" if job.mode == Job.Mode.CHANGE else "single")
        if epoch not in ("single", "before", "after"):
            raise ValidationError({"epoch": "single, before or after"})
        path = pointcloud_path(job, epoch)
        if not path.exists():
            raise Http404("No point cloud for this job and epoch.")
        resp = FileResponse(open(path, "rb"), content_type="application/octet-stream")
        resp["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp

    @extend_schema(responses={(200, "image/jpeg"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"], url_path=r"imagery/(?P<year>\d{4})")
    def imagery(self, request, pk=None, year=None):
        """One year's aerial image for the job area (corners in stats.imagery.corners)."""
        from apps.imagery.services import image_path

        job = self.get_object()
        path = image_path(job, int(year))
        if not path.exists():
            raise Http404("No imagery for this job and year.")
        resp = FileResponse(open(path, "rb"), content_type="image/jpeg")
        resp["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp

    @extend_schema(
        parameters=[
            OpenApiParameter("format", OpenApiTypes.STR, enum=["geojson", "csv"]),
            OpenApiParameter("layer", OpenApiTypes.STR, enum=["buildings", "changes"]),
            OpenApiParameter("epoch", OpenApiTypes.STR, enum=["single", "before", "after"]),
        ],
        responses={(200, "application/geo+json"): OpenApiTypes.OBJECT, (200, "text/csv"): OpenApiTypes.STR},
    )
    @action(detail=True, methods=["get"])
    def export(self, request, pk=None):
        job = self.get_object()
        if job.status != Job.Status.DONE:
            raise ValidationError({"job": "The job has not finished."})
        fmt = request.query_params.get("format", "geojson")
        layer = request.query_params.get("layer") or ("changes" if job.mode == Job.Mode.CHANGE else "buildings")
        if fmt not in ("geojson", "csv") or layer not in ("buildings", "changes"):
            raise ValidationError({"format": "format is geojson or csv; layer is buildings or changes"})
        if layer == "changes":
            qs, geom, props = ChangeFeature.objects.filter(job=job).order_by("-area_m2"), "geometry", CHANGE_PROPS
        else:
            qs, geom, props = Building.objects.filter(job=job).order_by("id"), "footprint", BUILDING_PROPS
            if request.query_params.get("epoch"):
                qs = qs.filter(epoch=request.query_params["epoch"])
        name = f"skyscan_{job.mode}_{layer}_{str(job.id)[:8]}"
        sources = {d.attribution for d in (job.dataset, job.dataset_before) if d is not None}
        img = (job.stats or {}).get("imagery") or {}
        if img.get("available") or (img.get("vegetation") or {}).get("available"):
            sources.add((img.get("provider") or {}).get("attribution") or "Aerial imagery")
        attribution = " / ".join(sorted(s for s in sources if s))
        if fmt == "geojson":
            data = feature_collection(qs, geom, props, extra={"attribution": attribution, "job": str(job.id)})
            return geojson_response(data, filename=f"{name}.geojson")
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["id", *props, "centroid_lon", "centroid_lat", "wkt", "source"])
        for obj in qs:
            g = getattr(obj, geom)
            c = g.centroid
            w.writerow([obj.id, *[getattr(obj, p) for p in props], round(c.x, 7), round(c.y, 7), g.wkt, attribution])
        resp = HttpResponse(buf.getvalue(), content_type="text/csv")
        resp["Content-Disposition"] = f'attachment; filename="{name}.csv"'
        return resp
