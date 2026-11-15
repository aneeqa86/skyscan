"""Change detection between two LiDAR surveys of the same area.

Both epochs are processed on one grid (same origin, cell size and CRS), so
cells line up exactly. Steps:
1. measure each epoch (surfaces, building mask, footprints),
2. co-register vertically on stable ground,
3. difference the height models and keep building-related change,
4. classify each change region against both sets of buildings.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np
from rasterio import features
from scipy import ndimage
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import transform as shp_transform
from shapely.ops import unary_union

from .aoi import aoi_utm_epsg
from .mask import MaskParams
from .measure import (
    EpochResult,
    _noop,
    aoi_to_utm,
    export_pointcloud,
    fetch_epoch,
    grid_for,
    merged_params,
    process_epoch,
    resolve_resolution,
    summarize,
    transformers,
)
from .raster import Grid

MIN_YEARS_APART = 3

CHANGE_DEFAULTS = {
    "change_threshold": 2.5,
    "min_change_area": 20.0,
    "change_open_iters": 2,
    # A change region is "partial" (extended/reduced rather than new/demolished)
    # when the building it belongs to was already a building, in the other
    # epoch, over at least this share of its own area.
    "partial_overlap": 0.25,
}

NEW, DEMOLISHED, RAISED, LOWERED, EXTENDED, REDUCED = (
    "new", "demolished", "raised", "lowered", "extended", "reduced"
)


@dataclass
class ChangeRegion:
    label: int
    change_type: str
    polygon: Polygon  # grid CRS
    area_m2: float
    height_before_m: float | None
    height_after_m: float | None
    delta_height_m: float
    volume_delta_m3: float
    confidence: float


@dataclass
class ChangeResult:
    before: EpochResult
    after: EpochResult
    regions: list[ChangeRegion]
    regions_wgs84: list[tuple[Polygon, ChangeRegion]]
    stats: dict
    pointcloud_before: bytes = b""
    pointcloud_after: bytes = b""
    extra: dict = field(default_factory=dict)


# ---------------------------------------------------------------- survey pairs


def survey_pairs(datasets, min_years: int = MIN_YEARS_APART) -> list[tuple]:
    """All (before, after) pairs of surveys at least min_years apart, newest first."""
    dated = sorted((d for d in datasets if d.acquisition_year), key=lambda d: d.acquisition_year)
    pairs = [
        (b, a)
        for i, b in enumerate(dated)
        for a in dated[i + 1 :]
        if a.acquisition_year - b.acquisition_year >= min_years
    ]
    return sorted(pairs, key=lambda p: (p[1].acquisition_year, p[0].acquisition_year), reverse=True)


def default_pair(datasets, min_years: int = MIN_YEARS_APART):
    """Newest survey, compared with the most recent one at least min_years older."""
    pairs = survey_pairs(datasets, min_years)
    return pairs[0] if pairs else None


# ---------------------------------------------------------------- co-registration


def stable_ground(before: EpochResult, after: EpochResult, buffer_cells: int = 4) -> np.ndarray:
    """Cells that are ground in both epochs, away from buildings and trees."""
    sb, sa = before.surfaces, after.surfaces
    occupied = before.mask | after.mask | (sb.ndsm > 0.5) | (sa.ndsm > 0.5)
    occupied = ndimage.binary_dilation(occupied, iterations=buffer_cells)
    return sb.ground & sa.ground & ~occupied


def vertical_offset(dsm_before: np.ndarray, dsm_after: np.ndarray, stable: np.ndarray) -> tuple[float, float, int]:
    """Median and robust spread (1.4826 * MAD) of after - before over stable cells."""
    d = (dsm_after - dsm_before)[stable]
    d = d[np.isfinite(d)]
    if d.size < 50:
        return 0.0, float("nan"), int(d.size)
    med = float(np.median(d))
    mad = float(1.4826 * np.median(np.abs(d - med)))
    return med, mad, int(d.size)


# ---------------------------------------------------------------- differencing


def change_mask(
    ndsm_before, ndsm_after, mask_before, mask_after, veg_before, veg_after, threshold: float,
    veg_threshold: float, min_height: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Candidate change cells and the height difference (after - before)."""
    d = ndsm_after - ndsm_before
    cand = (np.abs(d) >= threshold) & (mask_before | mask_after)
    # Vegetation-only change: the epoch without a building has a tree there
    # (a crown grew over a roof edge, or leaf-on vs leaf-off). Skip those cells.
    tree_after = (~mask_after) & (ndsm_after >= min_height) & (veg_after >= veg_threshold)
    tree_before = (~mask_before) & (ndsm_before >= min_height) & (veg_before >= veg_threshold)
    cand &= ~((mask_before & tree_after) | (mask_after & tree_before))
    return cand, d


def clean_change(cand: np.ndarray, min_cells: int, open_iters: int = 2) -> np.ndarray:
    """Opening removes strips narrower than about 2 * open_iters cells: roof
    edges that land half a cell apart in surveys of different density.
    It is an opening by reconstruction: regions that survive the opening get
    their full original outline back, so areas are not trimmed."""
    st = ndimage.generate_binary_structure(2, 1)
    seed = ndimage.binary_opening(cand, structure=st, iterations=open_iters)
    m = ndimage.binary_propagation(seed, structure=st, mask=cand)
    m = ndimage.binary_closing(m, structure=st, iterations=1, border_value=0)
    labels, n = ndimage.label(m)
    if n:
        sizes = ndimage.sum(np.ones_like(labels), labels, np.arange(1, n + 1))
        small = np.flatnonzero(sizes < min_cells) + 1
        if small.size:
            m[np.isin(labels, small)] = False
    return m


def _p90(values: np.ndarray) -> float:
    return float(np.percentile(values, 90)) if values.size else 0.0


def classify_region(
    region: np.ndarray,
    d: np.ndarray,
    ndsm_before: np.ndarray,
    ndsm_after: np.ndarray,
    mask_before: np.ndarray,
    mask_after: np.ndarray,
    labels_before: np.ndarray,
    labels_after: np.ndarray,
    partial_overlap: float = 0.25,
) -> str:
    """Change type for one region (boolean raster) of candidate change cells."""
    frac_b = mask_before[region].mean()
    frac_a = mask_after[region].mean()
    if frac_b >= 0.5 and frac_a >= 0.5:
        return RAISED if np.median(d[region]) > 0 else LOWERED
    if frac_a >= frac_b:
        # Building after, not before: a new building, or an extension of one
        # that already stood (partly) here before.
        ids = np.unique(labels_after[region & (labels_after > 0)])
        if ids.size:
            bld = np.isin(labels_after, ids)
            existing = (bld & mask_before & ~region).sum() / max(bld.sum(), 1)
            if existing >= partial_overlap:
                return EXTENDED
        return NEW
    ids = np.unique(labels_before[region & (labels_before > 0)])
    if ids.size:
        bld = np.isin(labels_before, ids)
        remaining = (bld & mask_after & ~region).sum() / max(bld.sum(), 1)
        if remaining >= partial_overlap:
            return REDUCED
    return DEMOLISHED


def region_confidence(area_m2: float, delta: float, threshold: float, density_ratio: float, noise_m: float) -> float:
    """0..1: larger regions, clear height changes, similar densities and a
    well-aligned ground all raise confidence."""
    size = min(area_m2 / 100.0, 1.0)
    clarity = min(abs(delta) / (2 * threshold), 1.0)
    dens = 0.5 + 0.5 * min(max(density_ratio, 0.0), 1.0)
    noise = 1.0 if not np.isfinite(noise_m) else max(0.4, 1.0 - noise_m / threshold)
    return round(float((0.5 * size + 0.5 * clarity) * dens * noise), 3)


def classify_changes(
    before: EpochResult,
    after: EpochResult,
    grid: Grid,
    params: dict,
    density_ratio: float = 1.0,
    noise_m: float = float("nan"),
    keep_within=None,
) -> list[ChangeRegion]:
    p = {**CHANGE_DEFAULTS, **{k: v for k, v in params.items() if k in CHANGE_DEFAULTS}}
    mp = MaskParams.from_params(params)
    thr = float(p["change_threshold"])
    sb, sa = before.surfaces, after.surfaces
    cand, d = change_mask(
        sb.ndsm, sa.ndsm, before.mask, after.mask, before.veg, after.veg, thr, mp.veg_threshold, mp.min_height
    )
    min_cells = max(1, int(round(float(p["min_change_area"]) / grid.cell_area)))
    m = clean_change(cand, min_cells, int(p["change_open_iters"]))
    labels, n = ndimage.label(m, structure=np.ones((3, 3), dtype=bool))
    if n == 0:
        return []
    shapes: dict[int, list] = {}
    for geom, value in features.shapes(labels.astype(np.int32), mask=labels > 0, connectivity=8, transform=grid.transform):
        shapes.setdefault(int(value), []).append(shape(geom))
    # Something tall that is not a building (a tree) in the epoch where the
    # building is missing means the "change" is a tree classified differently
    # in the two surveys, not construction or demolition.
    other_tall_b = (sb.ndsm >= mp.min_height) & ~before.mask
    other_tall_a = (sa.ndsm >= mp.min_height) & ~after.mask
    out = []
    for lab in range(1, n + 1):
        region = labels == lab
        in_b, in_a = before.mask[region].mean(), after.mask[region].mean()
        if in_a > in_b and other_tall_b[region].mean() >= 0.5:
            continue
        if in_b > in_a and other_tall_a[region].mean() >= 0.5:
            continue
        ctype = classify_region(
            region, d, sb.ndsm, sa.ndsm, before.mask, after.mask, before.labels, after.labels,
            float(p["partial_overlap"]),
        )
        poly = unary_union(shapes.get(lab, []))
        if isinstance(poly, MultiPolygon):
            poly = max(poly.geoms, key=lambda q: q.area)
        if poly.is_empty:
            continue
        if keep_within is not None and not keep_within.contains(poly.centroid):
            continue
        poly = poly.simplify(0.3, preserve_topology=True)
        cells = int(region.sum())
        area = cells * grid.cell_area
        hb = _p90(sb.ndsm[region & before.mask]) if ctype not in (NEW,) else None
        ha = _p90(sa.ndsm[region & after.mask]) if ctype not in (DEMOLISHED,) else None
        if ctype == EXTENDED:
            hb = None
        if ctype == REDUCED:
            ha = None
        delta = (ha or 0.0) - (hb or 0.0)
        vol = float(d[region].sum() * grid.cell_area)
        out.append(
            ChangeRegion(
                label=lab,
                change_type=ctype,
                polygon=poly,
                area_m2=round(area, 1),
                height_before_m=None if hb is None else round(hb, 2),
                height_after_m=None if ha is None else round(ha, 2),
                delta_height_m=round(delta, 2),
                volume_delta_m3=round(vol, 1),
                confidence=region_confidence(area, float(np.median(d[region])), thr, density_ratio, noise_m),
            )
        )
    return out


def change_stats(regions: list[ChangeRegion]) -> dict:
    counts = {t: 0 for t in (NEW, DEMOLISHED, RAISED, LOWERED, EXTENDED, REDUCED)}
    for r in regions:
        counts[r.change_type] += 1
    gained = sum(r.area_m2 for r in regions if r.change_type in (NEW, EXTENDED))
    lost = sum(r.area_m2 for r in regions if r.change_type in (DEMOLISHED, REDUCED))
    return {
        "change_count": len(regions),
        "counts": counts,
        "net_volume_change_m3": round(sum(r.volume_delta_m3 for r in regions), 1),
        "net_footprint_change_m2": round(gained - lost, 1),
        "footprint_gained_m2": round(gained, 1),
        "footprint_lost_m2": round(lost, 1),
    }


# ---------------------------------------------------------------- orchestration


def run_change(source_before, ds_before, source_after, ds_after, aoi4326, params=None, progress=_noop) -> ChangeResult:
    t0 = time.monotonic()
    params = {**CHANGE_DEFAULTS, **merged_params(params)}
    epsg = aoi_utm_epsg(aoi4326)
    aoi_utm = aoi_to_utm(aoi4326, epsg)
    densities = [d.point_density_ppm2 for d in (ds_before, ds_after) if d.point_density_ppm2]
    res = resolve_resolution(params["resolution"], min(densities) if densities else None)
    params["resolution"] = res
    grid = grid_for(aoi_utm, res, float(params["margin_m"]), epsg)

    pts_b, g_b, gm_b = fetch_epoch(source_before, ds_before, aoi4326, aoi_utm, grid, progress, pct=(5, 15))
    progress("rasterizing", 18, f"Measuring {ds_before.acquisition_year} buildings")
    ep_b = process_epoch(pts_b, g_b, gm_b, grid, aoi_utm, params, progress, pct=(18, 22, 26))
    pts_a, g_a, gm_a = fetch_epoch(source_after, ds_after, aoi4326, aoi_utm, grid, progress, pct=(30, 42))
    progress("rasterizing", 45, f"Measuring {ds_after.acquisition_year} buildings")
    ep_a = process_epoch(pts_a, g_a, gm_a, grid, aoi_utm, params, progress, pct=(45, 50, 55))

    progress("comparing", 62, "Aligning the two surveys vertically")
    stable = stable_ground(ep_b, ep_a)
    offset, noise, n_stable = vertical_offset(ep_b.surfaces.dsm, ep_a.surfaces.dsm, stable)
    # Shift the later epoch onto the earlier one. nDSM is DSM - DTM, so a pure
    # vertical offset cancels there; aligning the absolute surfaces keeps the
    # point clouds and any DSM comparison consistent.
    ep_a.surfaces.dsm -= offset
    ep_a.surfaces.dtm -= offset

    progress("comparing", 70, "Finding and classifying changes")
    area = grid.nx * grid.ny * grid.cell_area
    dens_b, dens_a = ep_b.n_points / area, ep_a.n_points / area
    ratio = min(dens_b, dens_a) / max(dens_b, dens_a) if max(dens_b, dens_a) > 0 else 0.0
    regions = classify_changes(ep_b, ep_a, grid, params, ratio, noise, keep_within=aoi_utm)
    _, inv = transformers(epsg)
    regions_wgs = [(shp_transform(inv.transform, r.polygon), r) for r in regions]

    progress("comparing", 85, "Packing both point clouds")
    pc_b = export_pointcloud(ep_b, aoi4326, aoi_utm, extra={"dataset": ds_before.name, "epoch": "before"})
    # Shift the later points by the same offset so the two clouds line up.
    ep_a.points["Z"] -= offset
    pc_a = export_pointcloud(ep_a, aoi4326, aoi_utm, extra={"dataset": ds_after.name, "epoch": "after"})

    sb, sa = summarize(ep_b.footprints), summarize(ep_a.footprints)
    stats = change_stats(regions)
    stats.update(
        {
            "vertical_offset_m": round(offset, 3),
            "vertical_noise_m": None if not np.isfinite(noise) else round(noise, 3),
            "stable_cells": n_stable,
            "before": {
                "dataset": ds_before.name,
                "year": ds_before.acquisition_year,
                "observed_density_ppm2": round(dens_b, 2),
                "method": ep_b.method,
                "ground_method": ep_b.ground_method,
                **{k: sb[k] for k in ("building_count", "total_footprint_m2", "total_volume_m3", "median_height_m")},
            },
            "after": {
                "dataset": ds_after.name,
                "year": ds_after.acquisition_year,
                "observed_density_ppm2": round(dens_a, 2),
                "method": ep_a.method,
                "ground_method": ep_a.ground_method,
                **{k: sa[k] for k in ("building_count", "total_footprint_m2", "total_volume_m3", "median_height_m")},
            },
            "density_ratio": round(ratio, 3),
            "resolution_m": res,
            "epsg": epsg,
            "grid": grid.to_dict(),
            "params": params,
            "processing_seconds": round(time.monotonic() - t0, 1),
        }
    )
    return ChangeResult(
        before=ep_b,
        after=ep_a,
        regions=regions,
        regions_wgs84=regions_wgs,
        stats=stats,
        pointcloud_before=pc_b,
        pointcloud_after=pc_a,
    )
