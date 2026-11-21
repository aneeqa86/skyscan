"""Run measure jobs and persist their results."""
from __future__ import annotations

import logging
import time
import traceback
from pathlib import Path

from django.conf import settings
from django.contrib.gis.geos import GEOSGeometry
from django.db import transaction
from django.utils import timezone
from shapely import wkb as shp_wkb
from shapely.ops import transform as shp_transform

from apps.cities.models import Dataset
from apps.lidar.pipeline.aoi import AoiError
from apps.lidar.pipeline.fetch import NoPointsError
from apps.lidar.pipeline.measure import run_measure, transformers
from apps.lidar.sources import get_source

from . import reference, validation
from .models import Building, Job, ReferenceFootprint

log = logging.getLogger(__name__)


class JobError(RuntimeError):
    """A failure whose message is safe and useful to show users."""


class JobCancelled(RuntimeError):
    """The job was cancelled through the API; stop without touching its status."""


CANCELLED_MESSAGE = "Cancelled."


def job_dir(job: Job) -> Path:
    return Path(settings.MEDIA_ROOT) / "jobs" / str(job.id)


def pointcloud_path(job: Job, epoch: str = "single") -> Path:
    return job_dir(job) / f"pointcloud_{epoch}.bin"


def make_progress(job: Job):
    def progress(status: str, pct: int, message: str):
        # A cancelled job is already marked failed: stop at the next checkpoint.
        updated = (
            Job.objects.filter(pk=job.pk)
            .exclude(status__in=Job.TERMINAL)
            .update(status=status, progress=pct, stage_message=message[:300])
        )
        if not updated:
            raise JobCancelled(str(job.pk))
        log.info("job %s: %s %d%% %s", job.pk, status, pct, message)

    return progress


def datasets_covering(aoi, provider: str | None = None):
    qs = Dataset.objects.filter(is_active=True, coverage_polygon__intersects=aoi)
    if provider:
        qs = qs.filter(provider=provider)
    return qs


def select_dataset(aoi, exclude_ids=()) -> Dataset:
    """Newest survey covering the AOI; full coverage beats partial, then density."""
    qs = list(datasets_covering(aoi).exclude(pk__in=exclude_ids))
    if not qs:
        raise JobError("No LiDAR survey covers this area. Pick an area inside the coverage layer.")

    def key(d):
        full = d.coverage_polygon.contains(aoi)
        return (full, d.acquisition_year or 0, d.point_density_ppm2 or 0)

    return max(qs, key=key)


def _to_geos(poly):
    g = GEOSGeometry(memoryview(poly.wkb), srid=4326)
    if g.geom_type != "Polygon":
        raise ValueError("expected a polygon")
    return g


def save_buildings(job: Job, fps_wgs84, epoch: str, city=None, ndvi=None) -> list[Building]:
    objs = []
    ndvi = ndvi if ndvi is not None else [None] * len(fps_wgs84)
    for (poly, f), nd in zip(fps_wgs84, ndvi, strict=True):
        try:
            geom = _to_geos(poly)
        except ValueError as exc:
            log.warning("job %s: skipped a footprint that is not a polygon (%s)", job.pk, exc)
            continue
        objs.append(
            Building(
                job=job,
                city=city,
                epoch=epoch,
                footprint=geom,
                area_m2=f.area_m2,
                height_m=f.height_m,
                max_height_m=f.max_height_m,
                est_floors=f.est_floors,
                volume_m3=f.volume_m3,
                point_count=f.point_count,
                confidence=f.confidence,
                ndvi=nd,
            )
        )
    return Building.objects.bulk_create(objs, batch_size=1000)


# Drop footprints that aerial imagery shows are mostly vegetation (see apps.imagery).
VEGETATION_FILTER_DEFAULT = True


def apply_vegetation_check(job: Job, result, progress) -> tuple[list, dict]:
    """Run the NDVI check on a measure result in place. Returns (ndvi per kept footprint, info)."""
    from apps.imagery.services import vegetation_check
    from apps.lidar.pipeline.measure import summarize

    progress("vectorizing", 86, "Checking footprints against aerial imagery")
    try:
        keep, ndvi, info = vegetation_check(job, result.footprints_wgs84, job.dataset.acquisition_year)
    except Exception as exc:  # imagery is extra evidence; it never sinks a measurement
        log.exception("vegetation check failed for job %s", job.pk)
        return [None] * len(result.footprints_wgs84), {"available": False, "reason": f"Imagery check failed: {exc}"}
    apply = bool(job.params.get("vegetation_filter", VEGETATION_FILTER_DEFAULT))
    info["applied"] = apply and info.get("available", False)
    if info["applied"] and not keep.all():
        idx = [i for i, k in enumerate(keep) if k]
        result.footprints_wgs84 = [result.footprints_wgs84[i] for i in idx]
        result.epoch.footprints = [result.epoch.footprints[i] for i in idx]
        ndvi = [ndvi[i] for i in idx]
        result.stats.update(summarize(result.epoch.footprints))
        info["removed"] = int(len(keep) - len(idx))
    else:
        info["removed"] = 0
    return ndvi, info


def validate_job(job: Job, footprints_utm, heights, epsg: int, min_area: float) -> dict:
    """Fetch reference footprints for the AOI, store them, and return validation stats."""
    aoi = shp_wkb.loads(bytes(job.aoi.wkb))
    refs, source, notes = reference.fetch_reference(aoi)
    if not refs:
        return {
            "available": False,
            "reason": "No reference footprints are available for this area.",
            "notes": notes,
        }
    fwd, _ = transformers(epsg)
    aoi_utm = shp_transform(fwd.transform, aoi)
    kept = []
    for r in refs:
        g = shp_transform(fwd.transform, r.polygon)
        if not g.is_valid:
            g = g.buffer(0)
        if g.is_empty or g.area < min_area:
            continue
        # Count a reference building only if most of it lies inside the AOI,
        # the same rule that decides which detections are kept.
        if not aoi_utm.contains(g.centroid):
            continue
        kept.append((r, g))
    ref_polys = [g for _, g in kept]
    ref_heights = [r.height_m for r, _ in kept]
    m = validation.metrics(footprints_utm, ref_polys, heights, ref_heights)
    matched = {j: iou for _, j, iou in m.pop("matches")}
    ReferenceFootprint.objects.filter(job=job).delete()
    ReferenceFootprint.objects.bulk_create(
        [
            ReferenceFootprint(
                job=job,
                source=r.source,
                source_id=r.source_id[:80],
                footprint=_to_geos(r.polygon),
                height_m=r.height_m,
                matched=j in matched,
                iou=matched.get(j),
            )
            for j, (r, _) in enumerate(kept)
            if r.polygon.geom_type == "Polygon"
        ],
        batch_size=1000,
    )
    m.update({"available": True, "source": source, "notes": notes})
    return m


def run_measure_job(job_id, overlays: bool = True) -> Job:
    """overlays=False skips the map imagery (showcase chunks; the merged job gets its own)."""
    job = Job.objects.get(pk=job_id)
    progress = make_progress(job)
    t0 = time.monotonic()
    try:
        progress("fetching", 2, "Choosing a LiDAR survey")
        if job.dataset_id is None:
            job.dataset = select_dataset(job.aoi)
            job.save(update_fields=["dataset"])
        source = get_source(job.dataset.provider)
        result = run_measure(source, job.dataset, job.aoi, job.params, progress)
        ndvi, veg_info = apply_vegetation_check(job, result, progress)

        progress("vectorizing", 88, "Saving footprints")
        with transaction.atomic():
            Building.objects.filter(job=job).delete()
            save_buildings(job, result.footprints_wgs84, Building.Epoch.SINGLE, city=job.city, ndvi=ndvi)
        pc = pointcloud_path(job)
        pc.parent.mkdir(parents=True, exist_ok=True)
        pc.write_bytes(result.pointcloud)

        if job.dataset.has_building_class is None:
            Dataset.objects.filter(pk=job.dataset_id).update(
                has_building_class=result.stats["has_building_class"]
            )

        progress("validating", 92, "Comparing with reference footprints")
        fps = result.epoch.footprints
        try:
            val = validate_job(
                job,
                [f.polygon for f in fps],
                [f.height_m for f in fps],
                result.stats["epsg"],
                float(result.stats["params"]["min_area"]),
            )
        except Exception as exc:  # validation must never sink a good measurement
            log.exception("validation failed for job %s", job.pk)
            val = {"available": False, "reason": f"Validation could not run: {exc}"}

        stats = dict(result.stats)
        stats["validation"] = val
        imagery = {"vegetation": veg_info}
        if overlays:
            progress("validating", 96, "Preparing aerial imagery")
            try:
                from apps.imagery.services import run_display_imagery

                imagery.update(run_display_imagery(job))
            except Exception as exc:
                log.exception("imagery overlays failed for job %s", job.pk)
                imagery.update({"available": False, "reason": f"Imagery could not be prepared: {exc}"})
        stats["imagery"] = imagery
        stats["pointcloud_bytes"] = len(result.pointcloud)
        stats["processing_seconds"] = round(time.monotonic() - t0, 1)
        Job.objects.filter(pk=job.pk).exclude(status__in=Job.TERMINAL).update(
            status=Job.Status.DONE,
            progress=100,
            stage_message="Done",
            stats=stats,
            finished_at=timezone.now(),
        )
    except JobCancelled:
        log.info("job %s cancelled", job.pk)
    except (JobError, AoiError, NoPointsError) as exc:
        _fail(job, str(exc))
    except MemoryError:
        _fail(job, "The area holds too many points for this server. Draw a smaller area.")
    except Exception as exc:
        log.error("job %s failed: %s\n%s", job.pk, exc, traceback.format_exc())
        _fail(job, f"Processing failed: {exc.__class__.__name__}: {exc}")
    job.refresh_from_db()
    return job


def _fail(job: Job, message: str):
    Job.objects.filter(pk=job.pk).exclude(status__in=Job.TERMINAL).update(
        status=Job.Status.FAILED, error=message[:2000], stage_message="Failed", finished_at=timezone.now()
    )


__all__ = ["run_measure_job", "select_dataset", "JobError", "JobCancelled", "cancel_job"]


def cancel_job(job: Job) -> bool:
    """Mark an unfinished job cancelled. Returns False if it had already finished."""
    updated = Job.objects.filter(pk=job.pk).exclude(status__in=Job.TERMINAL).update(
        status=Job.Status.FAILED, error=CANCELLED_MESSAGE, stage_message="Cancelled", finished_at=timezone.now()
    )
    if updated:
        try:
            from skyscan.celery import app

            app.control.revoke(str(job.pk))  # drops it if still queued; running jobs stop cooperatively
        except Exception:  # broker unreachable: the cooperative check still stops it
            log.warning("could not revoke task for job %s", job.pk)
    return bool(updated)
