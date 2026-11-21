"""Showcase definitions and precomputation over a grid of AOI chunks.

A showcase is one City with one precomputed "parent" Job (is_showcase=True)
holding the merged results of several chunk jobs, so the demo opens instantly.
"""
from __future__ import annotations

import logging
import math
import time
from pathlib import Path

import numpy as np
from django.contrib.gis.geos import Point, Polygon
from django.db import transaction
from django.utils import timezone
from shapely import wkb as shp_wkb
from shapely.ops import transform as shp_transform

from apps.change.models import ChangeFeature
from apps.detection.models import Building, Job
from apps.lidar.pipeline import pointcloud
from apps.lidar.pipeline.aoi import aoi_utm_epsg, area_km2
from apps.lidar.pipeline.measure import summarize, transformers

from .models import City, Dataset

log = logging.getLogger(__name__)

SHOWCASES = {
    "midtown-manhattan": {
        "name": "Midtown Manhattan",
        "country": "United States",
        "mode": "measure",
        "bbox": (-73.9900, 40.7525, -73.9765, 40.7615),
        "zoom": 15.2,
        "blurb": "Towers, setbacks and shared walls around Times Square and Bryant Park, measured from the "
        "2014 USGS survey of New York City.",
    },
    "denver-union-station": {
        "name": "Denver, Union Station",
        "country": "United States",
        "mode": "change",
        "bbox": (-105.0065, 39.7500, -104.9955, 39.7585),
        "zoom": 15.3,
        "blurb": "The Railyards build-out around Union Station between the 2013 and 2020 USGS surveys: "
        "new towers north-west of the station, an unchanged historic core.",
        "before": "USGS_LPC_CO_SoPlatteRiver_Lot5_2013_LAS_2015",
        "after": "CO_DRCOG_2_2020",
    },
}


def ensure_city(slug: str) -> City:
    spec = SHOWCASES[slug]
    w, s, e, n = spec["bbox"]
    bbox = Polygon.from_bbox(spec["bbox"])
    bbox.srid = 4326
    city, _ = City.objects.update_or_create(
        slug=slug,
        defaults=dict(
            name=spec["name"],
            country=spec["country"],
            center=Point((w + e) / 2, (s + n) / 2, srid=4326),
            default_zoom=spec["zoom"],
            bbox=bbox,
            blurb=spec["blurb"],
            is_showcase=True,
            showcase_mode=spec["mode"],
        ),
    )
    return city


def chunks(bbox, max_km2: float) -> list[Polygon]:
    """Split a bbox into a grid of equal cells, each under max_km2."""
    poly = Polygon.from_bbox(bbox)
    poly.srid = 4326
    total = area_km2(poly)
    k = max(1, math.ceil(math.sqrt(total / max_km2)))
    while total / (k * k) > max_km2:
        k += 1
    w, s, e, n = bbox
    dx, dy = (e - w) / k, (n - s) / k
    out = []
    for i in range(k):
        for j in range(k):
            c = Polygon.from_bbox((w + i * dx, s + j * dy, w + (i + 1) * dx, s + (j + 1) * dy))
            c.srid = 4326
            out.append(c)
    return out


def _merge_pointclouds(paths: list[Path], center_lonlat, epsg: int) -> bytes:
    """Re-centre chunk point clouds on the showcase centre and decimate to the budget."""
    fwd, _ = transformers(epsg)
    cx, cy = fwd.transform(*center_lonlat)
    xs, ys, zs, hag, cls, inten, datums = [], [], [], [], [], [], []
    for p in paths:
        if not p.exists():
            continue
        h, a = pointcloud.decode(p.read_bytes())
        ox, oy = h["center_projected"]
        xs.append(a["xyz"][:, 0] + ox)
        ys.append(a["xyz"][:, 1] + oy)
        zs.append(a["xyz"][:, 2] + h["datum_z"])
        hag.append(a["hag_cm"] / 100.0)
        cls.append(a["classification"])
        inten.append(a["intensity"])
        datums.append(h["datum_z"])
    if not xs:
        return b""
    x, y, z = np.concatenate(xs), np.concatenate(ys), np.concatenate(zs)
    idx = pointcloud.decimate(x.size)
    return pointcloud.encode(
        x[idx], y[idx], z[idx], np.concatenate(hag)[idx], np.concatenate(cls)[idx], np.concatenate(inten)[idx],
        center_lonlat=center_lonlat, center_xy=(cx, cy), datum_z=float(np.median(datums)), epsg=epsg,
        extra={"merged_chunks": len(xs)},
    )


def precompute(slug: str, stdout=None, max_chunk_km2: float | None = None) -> Job:
    """Run all chunks for a showcase and replace its parent job."""
    from apps.change.services import run_change_job
    from apps.detection.services import pointcloud_path, run_measure_job, validate_job

    say = (lambda m: stdout.write(m)) if stdout else log.info
    spec = SHOWCASES[slug]
    mode = spec["mode"]
    city = ensure_city(slug)
    limit = max_chunk_km2 or 0.45  # keeps each chunk well inside worker memory
    parts = chunks(spec["bbox"], limit)
    say(f"{spec['name']}: {len(parts)} chunks of <= {limit} km² ({mode})")

    kwargs = {}
    if mode == "change":
        kwargs = {
            "dataset_before": Dataset.objects.get(name=spec["before"]),
            "dataset": Dataset.objects.get(name=spec["after"]),
        }
    t0 = time.monotonic()
    done = []
    for i, c in enumerate(parts, 1):
        job = Job.objects.create(mode=mode, aoi=c, area_km2=area_km2(c), params={}, **kwargs)
        job = run_change_job(job.id, imagery=False) if mode == "change" else run_measure_job(job.id, overlays=False)
        if job.status != Job.Status.DONE:
            raise RuntimeError(f"chunk {i} failed: {job.error}")
        say(f"  chunk {i}/{len(parts)} done in {job.stats.get('processing_seconds')} s")
        done.append(job)

    bbox_poly = city.bbox
    epsg = aoi_utm_epsg(bbox_poly)
    with transaction.atomic():
        Job.objects.filter(city=city, is_showcase=True).delete()
        Building.objects.filter(city=city, job__isnull=True).delete()
        parent = Job.objects.create(
            mode=mode, aoi=bbox_poly, area_km2=area_km2(bbox_poly), city=city, is_showcase=True,
            status=Job.Status.VALIDATING, progress=95, dataset=done[0].dataset, dataset_before=done[0].dataset_before,
        )
        ids = [j.id for j in done]
        Building.objects.filter(job_id__in=ids).update(job=parent, city=city)
        ChangeFeature.objects.filter(job_id__in=ids).update(job=parent, city=city)

    stats = _merge_stats(parent, done, epsg)
    if mode == "measure":
        fwd, _ = transformers(epsg)
        blds = list(Building.objects.filter(job=parent))
        polys = [shp_transform(fwd.transform, shp_wkb.loads(bytes(b.footprint.wkb))) for b in blds]
        try:
            stats["validation"] = validate_job(parent, polys, [b.height_m for b in blds], epsg, 25.0)
        except Exception as exc:
            stats["validation"] = {"available": False, "reason": f"Validation could not run: {exc}"}
        epochs = ["single"]
        stats["imagery"] = _measure_imagery(parent, done)
    else:
        from apps.change.services import imagery_stats

        epochs = ["before", "after"]
        stats["imagery"] = imagery_stats(parent)
    center = (bbox_poly.centroid.x, bbox_poly.centroid.y)
    for ep in epochs:
        data = _merge_pointclouds([pointcloud_path(j, ep) for j in done], center, epsg)
        path = pointcloud_path(parent, ep)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    stats["chunks"] = len(done)
    stats["processing_seconds"] = round(time.monotonic() - t0, 1)
    Job.objects.filter(pk=parent.pk).update(
        status=Job.Status.DONE, progress=100, stage_message="Done", stats=stats, finished_at=timezone.now()
    )
    # Chunk jobs are now empty shells; keep the database tidy.
    Job.objects.filter(id__in=[j.id for j in done]).delete()
    parent.refresh_from_db()
    return parent


def _measure_imagery(parent: Job, done: list[Job]) -> dict:
    """Overlays for the merged area plus the chunks' vegetation checks added up."""
    from apps.imagery.services import run_display_imagery

    vegs = [j.stats.get("imagery", {}).get("vegetation") or {} for j in done]
    ok = [v for v in vegs if v.get("available")]
    veg = {
        "available": bool(ok),
        "applied": any(v.get("applied") for v in ok),
        "year": ok[0].get("year") if ok else None,
        "flagged": sum(v.get("flagged", 0) for v in ok),
        "removed": sum(v.get("removed", 0) for v in ok),
    }
    if not ok:
        veg["reason"] = next((v.get("reason") for v in vegs if v.get("reason")), "No imagery check ran.")
    try:
        out = run_display_imagery(parent)
    except Exception as exc:
        log.exception("imagery overlays failed for showcase %s", parent.pk)
        out = {"available": False, "reason": f"Imagery could not be prepared: {exc}"}
    out["vegetation"] = veg
    return out


def _merge_stats(parent: Job, done: list[Job], epsg: int) -> dict:
    first = done[0].stats
    if parent.mode == "measure":
        from apps.lidar.pipeline.vectorize import Footprint

        fps = [
            Footprint(0, None, b.area_m2, b.height_m, b.max_height_m, b.est_floors, b.volume_m3, b.point_count, b.confidence)
            for b in Building.objects.filter(job=parent)
        ]
        st = summarize(fps)
        st.update({k: first.get(k) for k in ("method", "ground_method", "resolution_m", "epsg", "dataset", "dataset_year", "params")})
        st["points_fetched"] = sum(j.stats.get("points_fetched", 0) for j in done)
        return st
    from apps.lidar.pipeline.change import ChangeRegion, change_stats

    regions = [
        ChangeRegion(0, f.change_type, None, f.area_m2, f.height_before_m, f.height_after_m, f.delta_height_m, f.volume_delta_m3, f.confidence)
        for f in ChangeFeature.objects.filter(job=parent)
    ]
    st = change_stats(regions)
    weights = [j.stats.get("stable_cells", 0) for j in done]
    offsets = [j.stats.get("vertical_offset_m", 0.0) for j in done]
    noises = [j.stats.get("vertical_noise_m") for j in done]
    st["vertical_offset_m"] = round(float(np.average(offsets, weights=weights)) if sum(weights) else 0.0, 3)
    valid = [x for x in noises if x is not None]
    st["vertical_noise_m"] = round(float(np.median(valid)), 3) if valid else None
    for side in ("before", "after"):
        s = dict(first[side])
        for k in ("building_count", "total_footprint_m2", "total_volume_m3"):
            s[k] = round(sum((j.stats[side].get(k) or 0) for j in done), 1)
        s["observed_density_ppm2"] = round(float(np.mean([j.stats[side]["observed_density_ppm2"] for j in done])), 2)
        st[side] = s
    st["density_ratio"] = round(float(np.mean([j.stats.get("density_ratio", 0) for j in done])), 3)
    st.update({k: first.get(k) for k in ("resolution_m", "epsg", "params")})
    return st
