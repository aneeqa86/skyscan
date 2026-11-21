"""Fetch yearly imagery for a job, store map overlays, and run the imagery checks.

Everything here is best effort: imagery adds evidence to a LiDAR result, so a
provider outage or a missing year is recorded in the job stats and never fails
the job.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
from shapely import STRtree
from shapely import wkb as shp_wkb

from .analysis import (
    corroborate,
    rasterize,
    standardize,
    to_rgb_jpeg,
    vegetation_flags,
)
from .grid import ImageGrid, to_3857
from .providers import ImageryProvider, YearInfo, nearest_year, provider_for

log = logging.getLogger(__name__)

MIN_COVERAGE = 0.6  # an image year must cover this share of the area to be used
YEARS_AROUND = 2  # change jobs: image years this far outside the survey pair are still fetched
MAX_CONTROLS = 600


def imagery_dir(job) -> Path:
    from apps.detection.services import job_dir

    return job_dir(job) / "imagery"


def image_path(job, year: int) -> Path:
    return imagery_dir(job) / f"{int(year)}.jpg"


def _shapely(geom):
    return shp_wkb.loads(bytes(geom.wkb))


def _bbox(job) -> tuple[float, float, float, float]:
    return tuple(job.aoi.extent)


def _unavailable(reason: str, provider: ImageryProvider | None = None) -> dict:
    out = {"available": False, "reason": reason}
    if provider:
        out["provider"] = provider.describe()
    return out


def fetch_years(job, provider: ImageryProvider, infos: dict[int, YearInfo], years: list[int], grid: ImageGrid,
                write: bool = True):
    """Read the given years onto the grid; returns ({year: scene}, [year metadata], [skipped notes])."""
    scenes, meta, notes = {}, [], []
    if write:
        imagery_dir(job).mkdir(parents=True, exist_ok=True)
    for y in years:
        try:
            scene = provider.read(infos[y], grid)
        except Exception as exc:  # one bad year must not stop the others
            log.warning("job %s: %s %s unreadable: %s", job.pk, provider.key, y, exc)
            notes.append(f"{y}: could not be read")
            continue
        if scene.coverage < MIN_COVERAGE:
            notes.append(f"{y}: covers only {scene.coverage:.0%} of the area")
            continue
        scenes[y] = scene
        if write:
            image_path(job, y).write_bytes(to_rgb_jpeg(scene))
        meta.append({
            "year": y,
            "dates": scene.dates,
            "gsd_m": scene.gsd_m,
            "coverage": round(scene.coverage, 3),
            "near_infrared": scene.nir is not None,
        })
    return scenes, meta, notes


def _base(provider: ImageryProvider, grid: ImageGrid, meta: list[dict], notes: list[str]) -> dict:
    return {
        "available": bool(meta),
        "provider": provider.describe(),
        "corners": grid.corners_lonlat(),
        "ground_res_m": round(grid.ground_res_m, 2),
        "years": meta,
        "notes": notes,
        **({} if meta else {"reason": "No usable aerial imagery covers this area."}),
    }


# --- Change jobs ----------------------------------------------------------------

def _controls(job, changes_3857) -> tuple[list, list[float]]:
    """Unchanged buildings: after-survey footprints that touch no change region, with
    their heights. Their year-to-year imagery differences are what a change is ranked against."""
    from apps.detection.models import Building

    tree = STRtree([c.buffer(3.0) for c in changes_3857]) if changes_3857 else None
    out = []
    for b in Building.objects.filter(job=job, epoch=Building.Epoch.AFTER, area_m2__gte=60).order_by("id"):
        g = to_3857(_shapely(b.footprint))
        if tree is not None and len(tree.query(g, predicate="intersects")):
            continue
        out.append((g, b.height_m))
    if len(out) > MAX_CONTROLS:
        idx = np.linspace(0, len(out) - 1, MAX_CONTROLS).round().astype(int)
        out = [out[i] for i in idx]
    return [g for g, _ in out], [h for _, h in out]


def run_change_imagery(job) -> dict:
    """Fetch imagery across the survey pair, store overlays, and corroborate every change."""
    from apps.change.models import ChangeFeature

    provider = provider_for(job.dataset.provider if job.dataset_id else None)
    if provider is None:
        return _unavailable("No aerial imagery source is set up for this region.")
    by = job.dataset_before.acquisition_year if job.dataset_before_id else None
    ay = job.dataset.acquisition_year
    try:
        infos = provider.years(_bbox(job))
    except Exception as exc:
        log.warning("job %s: imagery search failed: %s", job.pk, exc)
        return _unavailable(f"{provider.name} could not be reached.", provider)
    lo, hi = (by or ay) - YEARS_AROUND, (ay or by) + YEARS_AROUND
    years = sorted(y for y in infos if lo <= y <= hi)
    if not years:
        return _unavailable(f"{provider.name} has no imagery here between {lo} and {hi}.", provider)

    grid = ImageGrid.for_bbox(_bbox(job))
    scenes, meta, notes = fetch_years(job, provider, infos, years, grid)
    out = _base(provider, grid, meta, notes)
    if not scenes:
        return out
    std = {y: standardize(s) for y, s in scenes.items()}

    changes = list(ChangeFeature.objects.filter(job=job).order_by("id"))
    polys = [to_3857(_shapely(c.geometry)) for c in changes]
    controls, control_heights = _controls(job, polys)
    results, summary = corroborate(
        std,
        grid,
        rasterize(polys, grid),
        [c.change_type for c in changes],
        [max(c.height_after_m or 0.0, c.height_before_m or 0.0) for c in changes],
        rasterize(controls, grid),
        control_heights,
        by,
        ay,
    )
    for c, r in zip(changes, results, strict=True):
        c.imagery_status = r.status
        c.imagery_score = r.score
        c.imagery_first_year = r.first_year
        c.imagery_window_start = r.window_start
    ChangeFeature.objects.bulk_update(
        changes, ["imagery_status", "imagery_score", "imagery_first_year", "imagery_window_start"], batch_size=500
    )
    counts: dict[str, dict[str, int]] = {}
    for c in changes:
        counts.setdefault(c.change_type, {}).setdefault(c.imagery_status, 0)
        counts[c.change_type][c.imagery_status] += 1
    totals = {}
    for c in changes:
        totals[c.imagery_status] = totals.get(c.imagery_status, 0) + 1
    summary.update({"by_type": counts, "totals": totals, "changes": len(changes)})
    out["corroboration"] = summary
    return out


# --- Measure jobs ---------------------------------------------------------------

def vegetation_check(job, fps_wgs84, survey_year: int | None) -> tuple[np.ndarray, list, dict]:
    """NDVI per footprint from the image year nearest the survey.

    Returns (keep mask, ndvi per footprint, info). Footprints that are mostly
    vegetation and under 30 m are marked for removal: LiDAR alone often calls
    dense tree crowns buildings when a survey has no building class."""
    n = len(fps_wgs84)
    keep, ndvi = np.ones(n, bool), [None] * n
    provider = provider_for(job.dataset.provider if job.dataset_id else None)
    if provider is None or n == 0:
        return keep, ndvi, _unavailable("No aerial imagery source is set up for this region.")
    try:
        infos = provider.years(_bbox(job))
    except Exception as exc:
        log.warning("job %s: imagery search failed: %s", job.pk, exc)
        return keep, ndvi, _unavailable(f"{provider.name} could not be reached.", provider)
    year = nearest_year(sorted(infos), survey_year)
    if year is None:
        return keep, ndvi, _unavailable(f"{provider.name} has no image within 2 years of the survey.", provider)
    grid = ImageGrid.for_bbox(_bbox(job))
    scenes, _, notes = fetch_years(job, provider, infos, [year], grid, write=False)
    if year not in scenes or scenes[year].nir is None:
        return keep, ndvi, {"available": False, "reason": f"The {year} image has no near-infrared band.",
                            "notes": notes}
    std = standardize(scenes[year])
    labels = rasterize([to_3857(p) for p, _ in fps_wgs84], grid)
    flags, nd = vegetation_flags(std, labels, [f.height_m for _, f in fps_wgs84])
    keep = ~flags
    if nd is not None:
        ndvi = [round(float(v), 3) if np.isfinite(v) else None for v in nd]
    return keep, ndvi, {
        "available": True,
        "year": year,
        "ndvi_threshold": round(float(std.veg_threshold), 3),
        "flagged": int(flags.sum()),
    }


def display_years(infos: dict[int, YearInfo], survey_year: int | None) -> list[int]:
    """Measure jobs show the image nearest the survey and the newest image."""
    ys = sorted(infos)
    if not ys:
        return []
    picks = {ys[-1]}
    near = nearest_year(ys, survey_year)
    if near is not None:
        picks.add(near)
    return sorted(picks)


def run_display_imagery(job) -> dict:
    """Overlays only (no analysis): used for measure jobs and merged showcases."""
    provider = provider_for(job.dataset.provider if job.dataset_id else None)
    if provider is None:
        return _unavailable("No aerial imagery source is set up for this region.")
    try:
        infos = provider.years(_bbox(job))
    except Exception as exc:
        log.warning("job %s: imagery search failed: %s", job.pk, exc)
        return _unavailable(f"{provider.name} could not be reached.", provider)
    years = display_years(infos, job.dataset.acquisition_year)
    if not years:
        return _unavailable(f"{provider.name} has no imagery here.", provider)
    grid = ImageGrid.for_bbox(_bbox(job))
    _, meta, notes = fetch_years(job, provider, infos, years, grid)
    return _base(provider, grid, meta, notes)
