from django.contrib.gis.geos import Point, Polygon
from django.db.models import Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.common.geojson import feature_collection, geojson_response
from apps.detection.models import Job
from apps.lidar.pipeline.aoi import AoiError, parse_aoi

from .models import City, Dataset


def _coords(geom):
    return None if geom is None else geom.coords


class CitySerializer(serializers.ModelSerializer):
    center = serializers.SerializerMethodField()
    bbox = serializers.SerializerMethodField()
    showcase_job = serializers.SerializerMethodField()

    class Meta:
        model = City
        fields = [
            "slug", "name", "country", "center", "default_zoom", "bbox", "blurb",
            "is_showcase", "showcase_mode", "showcase_job",
        ]

    def get_center(self, obj) -> list[float]:
        return [obj.center.x, obj.center.y]

    def get_bbox(self, obj) -> list[float] | None:
        return list(obj.bbox.extent) if obj.bbox else None

    def get_showcase_job(self, obj) -> dict | None:
        """The precomputed job behind this showcase, with its headline numbers."""
        if not obj.is_showcase:
            return None
        job = (
            Job.objects.filter(city=obj, is_showcase=True, status=Job.Status.DONE)
            .order_by("-finished_at")
            .first()
        )
        if not job:
            return None
        st = job.stats or {}
        out = {"id": str(job.id), "mode": job.mode, "aoi": job.aoi.coords, "finished_at": job.finished_at}
        if job.mode == Job.Mode.MEASURE:
            out["summary"] = {k: st.get(k) for k in ("building_count", "median_height_m", "total_volume_m3")}
            v = st.get("validation") or {}
            out["validation"] = (
                {k: v.get(k) for k in ("source", "precision", "recall", "f1", "mean_iou", "height_mae_m", "height_compared")}
                if v.get("available")
                else None
            )
        else:
            out["summary"] = {
                "counts": st.get("counts"),
                "years": [st.get("before", {}).get("year"), st.get("after", {}).get("year")],
                "net_volume_change_m3": st.get("net_volume_change_m3"),
            }
        return out


class CityViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = City.objects.all()
    serializer_class = CitySerializer
    lookup_field = "slug"
    search_fields = ["name", "country"]
    filterset_fields = ["is_showcase", "showcase_mode"]


class DatasetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Dataset
        fields = [
            "id", "name", "provider", "country", "acquisition_year", "point_density_ppm2", "point_count",
            "crs", "access_type", "source_url", "license", "attribution", "has_building_class",
        ]


def _aoi_from_request(request):
    """?aoi=<GeoJSON polygon> or ?bbox=w,s,e,n or ?lon=&lat= (a point)."""
    p = request.query_params
    try:
        if p.get("aoi"):
            return parse_aoi(p["aoi"])
        if p.get("bbox"):
            w, s, e, n = (float(v) for v in p["bbox"].split(","))
            g = Polygon.from_bbox((w, s, e, n))
            g.srid = 4326
            return g
        if p.get("lon") and p.get("lat"):
            return Point(float(p["lon"]), float(p["lat"]), srid=4326)
    except (AoiError, ValueError) as exc:
        raise ValidationError({"aoi": str(exc) or "Could not read the location."}) from exc
    return None


LOCATION_PARAMS = [
    OpenApiParameter("aoi", OpenApiTypes.STR, description="GeoJSON polygon (EPSG:4326)"),
    OpenApiParameter("bbox", OpenApiTypes.STR, description="west,south,east,north"),
    OpenApiParameter("lon", OpenApiTypes.NUMBER),
    OpenApiParameter("lat", OpenApiTypes.NUMBER),
]


class DatasetViewSet(viewsets.ReadOnlyModelViewSet):
    """LiDAR surveys. Filter by location to see what covers it and whether Change mode works there."""

    serializer_class = DatasetSerializer
    search_fields = ["name"]
    filterset_fields = ["provider", "acquisition_year", "has_building_class"]

    def get_queryset(self):
        qs = Dataset.objects.filter(is_active=True).defer("coverage_polygon", "coverage_simplified")
        loc = _aoi_from_request(self.request)
        if loc is not None:
            qs = qs.filter(coverage_polygon__intersects=loc)
        return qs.order_by("-acquisition_year", "name")

    @extend_schema(parameters=LOCATION_PARAMS)
    def list(self, request, *args, **kwargs):
        loc = _aoi_from_request(request)
        if loc is None or loc.geom_type == "Point":
            response = super().list(request, *args, **kwargs)
            if loc is not None:
                # A point: report which years exist; full-area checks need a polygon.
                years = sorted({d["acquisition_year"] for d in response.data["results"] if d["acquisition_year"]})
                response.data["years"] = years
            return response
        from apps.change.services import surveys_for

        info = surveys_for(loc)
        full = set(info["full_coverage_ids"])
        data = DatasetSerializer(info["datasets"], many=True).data
        for d in data:
            d["covers_whole_area"] = d["id"] in full
        return Response(
            {
                "count": len(data),
                "results": data,
                "years": info["years"],
                "change_possible": info["change_possible"],
                "change_reason": info["reason"],
                "default_pair": info["default_pair"],
                "min_years_apart": info["min_years_apart"],
            }
        )

    @extend_schema(parameters=[OpenApiParameter("bbox", OpenApiTypes.STR)], responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["get"])
    def coverage(self, request):
        """Simplified survey boundaries as GeoJSON (use ?bbox= to limit)."""
        qs = Dataset.objects.filter(is_active=True, coverage_simplified__isnull=False)
        loc = _aoi_from_request(request)
        if loc is not None:
            qs = qs.filter(Q(coverage_simplified__intersects=loc))
        data = feature_collection(
            qs, "coverage_simplified", ["name", "acquisition_year", "point_density_ppm2", "provider"]
        )
        resp = geojson_response(data)
        resp["Cache-Control"] = "public, max-age=86400"
        return resp
