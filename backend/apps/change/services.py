"""Run change jobs and persist their results."""
from __future__ import annotations

import logging
import time
import traceback

from django.db import transaction
from django.utils import timezone

from apps.detection.models import Building, Job
from apps.detection.services import (
    JobError,
    _fail,
    _to_geos,
    datasets_covering,
    make_progress,
    pointcloud_path,
    save_buildings,
)
from apps.lidar.pipeline.aoi import AoiError
from apps.lidar.pipeline.change import MIN_YEARS_APART, default_pair, run_change, survey_pairs
from apps.lidar.pipeline.fetch import NoPointsError
from apps.lidar.pipeline.measure import footprints_to_wgs84
from apps.lidar.sources import get_source

from .models import ChangeFeature

log = logging.getLogger(__name__)


def surveys_for(aoi) -> dict:
    """What the frontend needs to set up Change mode at a location."""
    covering = list(datasets_covering(aoi).order_by("-acquisition_year"))
    full = [d for d in covering if d.coverage_polygon.contains(aoi)]
    pairs = survey_pairs(full)
    years = sorted({d.acquisition_year for d in full if d.acquisition_year})
    if pairs:
        reason = ""
    elif len(full) < 2:
        reason = (
            "Only one LiDAR survey covers this whole area, so there is nothing to compare."
            if full
            else "No LiDAR survey covers this whole area."
        )
    else:
        reason = f"The surveys covering this area are less than {MIN_YEARS_APART} years apart."
    default = default_pair(full)
    return {
        "datasets": covering,
        "full_coverage_ids": [d.id for d in full],
        "years": years,
        "change_possible": bool(pairs),
        "reason": reason,
        "default_pair": [default[0].id, default[1].id] if default else None,
        "min_years_apart": MIN_YEARS_APART,
    }


def choose_pair(job: Job):
    if job.dataset_id and job.dataset_before_id:
        b, a = job.dataset_before, job.dataset
        if not (b.acquisition_year and a.acquisition_year):
            raise JobError("Both surveys need a known acquisition year.")
        if a.acquisition_year - b.acquisition_year < MIN_YEARS_APART:
            raise JobError(f"Pick surveys at least {MIN_YEARS_APART} years apart, the earlier one as 'before'.")
        for d in (a, b):
            if not d.coverage_polygon.contains(job.aoi):
                raise JobError(f"The {d.acquisition_year} survey does not cover the whole area.")
        return b, a
    info = surveys_for(job.aoi)
    if not info["change_possible"]:
        raise JobError(info["reason"])
    full = {d.id: d for d in info["datasets"]}
    b_id, a_id = info["default_pair"]
    return full[b_id], full[a_id]


def run_change_job(job_id) -> Job:
    job = Job.objects.get(pk=job_id)
    progress = make_progress(job)
    t0 = time.monotonic()
    try:
        progress("fetching", 2, "Choosing two LiDAR surveys")
        before, after = choose_pair(job)
        job.dataset_before, job.dataset = before, after
        job.save(update_fields=["dataset_before", "dataset"])
        result = run_change(
            get_source(before.provider), before, get_source(after.provider), after, job.aoi, job.params, progress
        )
        progress("comparing", 90, "Saving changes")
        epsg = result.stats["epsg"]
        with transaction.atomic():
            Building.objects.filter(job=job).delete()
            ChangeFeature.objects.filter(job=job).delete()
            save_buildings(job, footprints_to_wgs84(result.before.footprints, epsg), Building.Epoch.BEFORE, job.city)
            save_buildings(job, footprints_to_wgs84(result.after.footprints, epsg), Building.Epoch.AFTER, job.city)
            objs = []
            for poly, r in result.regions_wgs84:
                try:
                    geom = _to_geos(poly)
                except ValueError:
                    log.warning("job %s: skipped a change region that is not a polygon", job.pk)
                    continue
                objs.append(
                    ChangeFeature(
                        job=job,
                        city=job.city,
                        geometry=geom,
                        change_type=r.change_type,
                        height_before_m=r.height_before_m,
                        height_after_m=r.height_after_m,
                        delta_height_m=r.delta_height_m,
                        area_m2=r.area_m2,
                        volume_delta_m3=r.volume_delta_m3,
                        confidence=r.confidence,
                    )
                )
            ChangeFeature.objects.bulk_create(objs, batch_size=1000)
        for epoch, data in (("before", result.pointcloud_before), ("after", result.pointcloud_after)):
            path = pointcloud_path(job, epoch)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        stats = dict(result.stats)
        stats["pointcloud_bytes"] = {"before": len(result.pointcloud_before), "after": len(result.pointcloud_after)}
        stats["processing_seconds"] = round(time.monotonic() - t0, 1)
        Job.objects.filter(pk=job.pk).update(
            status=Job.Status.DONE, progress=100, stage_message="Done", stats=stats, finished_at=timezone.now()
        )
    except (JobError, AoiError, NoPointsError) as exc:
        _fail(job, str(exc))
    except MemoryError:
        _fail(job, "The area holds too many points for this server. Draw a smaller area.")
    except Exception as exc:
        log.error("change job %s failed: %s\n%s", job.pk, exc, traceback.format_exc())
        _fail(job, f"Processing failed: {exc.__class__.__name__}: {exc}")
    job.refresh_from_db()
    return job
