"""Measure pipeline: points -> surfaces -> building mask -> footprints with heights.

Framework-free: takes a PDAL reader stage and an AOI, reports progress through a
callback, and returns plain Python/numpy results. Django persistence lives in
apps.detection.services.
"""
from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np
from pyproj import Transformer
from shapely import wkb as shp_wkb
from shapely.geometry import Polygon
from shapely.ops import transform as shp_transform

from . import pointcloud
from .aoi import aoi_utm_epsg
from .fetch import ensure_ground, fetch_points
from .mask import MaskParams, building_mask
from .raster import Grid, Surfaces, build_surfaces, sample_raster, sky_noise_mask
from .vectorize import Footprint, vectorize

Progress = Callable[[str, int, str], None]

DEFAULTS = {
    "resolution": "auto",
    "min_height": 2.5,
    "min_area": 25.0,
    "simplify": 0.3,
    "regularize": True,
    "method": "auto",
    "margin_m": 15.0,
    "split_step": 4.0,
}

HEIGHT_BINS = [2.5, 5, 10, 15, 20, 30, 50, 100, 1000]


def _noop(*_a):
    pass


@dataclass
class EpochResult:
    grid: Grid
    surfaces: Surfaces
    mask: np.ndarray
    labels: np.ndarray
    veg: np.ndarray
    method: str
    ground_method: str
    footprints: list[Footprint]
    points: np.ndarray
    ground_mask: np.ndarray
    n_points: int


@dataclass
class MeasureResult:
    epoch: EpochResult
    footprints_wgs84: list[tuple[Polygon, Footprint]]
    stats: dict
    pointcloud: bytes = b""
    extra: dict = field(default_factory=dict)


def merged_params(params: dict | None) -> dict:
    out = dict(DEFAULTS)
    out.update({k: v for k, v in (params or {}).items() if v is not None})
    return out


def resolve_resolution(value, density_ppm2: float | None) -> float:
    """Raster cell size. 'auto' keeps 0.5 m where surveys average at least
    6 pts/m² (about 1.5 points per cell) and uses 1.0 m for sparser surveys,
    so per-cell vegetation cues still see several points."""
    if value not in (None, "", "auto"):
        return float(value)
    if density_ppm2 is not None and density_ppm2 < 6:
        return 1.0
    return 0.5


def transformers(epsg: int):
    fwd = Transformer.from_crs(4326, epsg, always_xy=True)
    inv = Transformer.from_crs(epsg, 4326, always_xy=True)
    return fwd, inv


def aoi_to_utm(aoi4326, epsg: int) -> Polygon:
    fwd, _ = transformers(epsg)
    shp = shp_wkb.loads(bytes(aoi4326.wkb)) if not isinstance(aoi4326, Polygon) else aoi4326
    return shp_transform(fwd.transform, shp)


def grid_for(aoi_utm: Polygon, res: float, margin: float, epsg: int) -> Grid:
    xmin, ymin, xmax, ymax = aoi_utm.buffer(margin).bounds
    return Grid.from_bounds(xmin, ymin, xmax, ymax, res, epsg)


def process_epoch(
    points: np.ndarray,
    ground_mask: np.ndarray,
    ground_method: str,
    grid: Grid,
    aoi_utm: Polygon,
    params: dict,
    progress: Progress = _noop,
    pct: tuple[int, int, int] = (40, 60, 75),
) -> EpochResult:
    """Steps 4-7 on already fetched points (shared by measure and change)."""
    progress("rasterizing", pct[0], "Building terrain and surface models")
    keep = sky_noise_mask(grid, points)
    if not keep.all():
        points, ground_mask = points[keep], ground_mask[keep]
    surfaces = build_surfaces(grid, points, ground_mask)
    progress("classifying", pct[1], "Separating buildings from trees")
    mp = MaskParams.from_params(params)
    mask, method, veg = building_mask(surfaces, mp)
    progress("vectorizing", pct[2], "Tracing footprints")
    fps, labels = vectorize(
        mask,
        surfaces.ndsm,
        surfaces.count,
        veg,
        grid,
        min_area=float(params["min_area"]),
        simplify_tol=float(params["simplify"]),
        regularize_shapes=bool(params["regularize"]),
        veg_threshold=mp.veg_threshold,
        keep_within=aoi_utm,
        split_step=float(params["split_step"]) if params.get("split_step") else None,
    )
    return EpochResult(
        grid=grid,
        surfaces=surfaces,
        mask=mask,
        labels=labels,
        veg=veg,
        method=method,
        ground_method=ground_method,
        footprints=fps,
        points=points,
        ground_mask=ground_mask,
        n_points=int(points.size),
    )


def fetch_epoch(source, dataset, aoi4326, aoi_utm: Polygon, grid: Grid, progress: Progress = _noop, pct=(10, 25)):
    """Step 2-4a: stream points for the grid extent and find the ground."""
    from django.contrib.gis.geos import Polygon as GPolygon

    _, inv = transformers(grid.epsg)
    xmin, ymin, xmax, ymax = grid.bounds()
    ring = [inv.transform(x, y) for x, y in [(xmin, ymin), (xmax, ymin), (xmax, ymax), (xmin, ymax), (xmin, ymin)]]
    fetch_area = GPolygon(ring, srid=4326)
    progress("fetching", pct[0], f"Streaming points from {dataset.name}")
    source.prepare(fetch_area, dataset, lambda msg: progress("fetching", pct[0], msg))
    pts = fetch_points(
        source.read(fetch_area, dataset),
        grid.epsg,
        lat=aoi4326.centroid.y,
        density_ppm2=dataset.point_density_ppm2,
    )
    progress("classifying", pct[1], "Finding the ground")
    ground, ground_method = ensure_ground(pts)
    return pts, ground, ground_method


def footprints_to_wgs84(fps: list[Footprint], epsg: int) -> list[tuple[Polygon, Footprint]]:
    _, inv = transformers(epsg)
    return [(shp_transform(inv.transform, f.polygon), f) for f in fps]


def summarize(fps: list[Footprint]) -> dict:
    heights = np.array([f.height_m for f in fps]) if fps else np.array([])
    counts, _ = np.histogram(heights, bins=HEIGHT_BINS) if fps else (np.zeros(len(HEIGHT_BINS) - 1), None)
    hist = [
        {"from": HEIGHT_BINS[i], "to": HEIGHT_BINS[i + 1] if HEIGHT_BINS[i + 1] < 1000 else None, "count": int(c)}
        for i, c in enumerate(counts)
    ]
    return {
        "building_count": len(fps),
        "total_footprint_m2": round(float(sum(f.area_m2 for f in fps)), 1),
        "total_volume_m3": round(float(sum(f.volume_m3 for f in fps)), 1),
        "mean_height_m": round(float(heights.mean()), 2) if fps else None,
        "median_height_m": round(float(np.median(heights)), 2) if fps else None,
        "max_height_m": round(float(max(f.max_height_m for f in fps)), 2) if fps else None,
        "height_histogram": hist,
    }


def export_pointcloud(ep: EpochResult, aoi4326, aoi_utm: Polygon, extra=None) -> bytes:
    pts = ep.points
    x, y = pts["X"], pts["Y"]
    # Only points inside the AOI (plus a little context) go to the browser.
    xmin, ymin, xmax, ymax = aoi_utm.buffer(5).bounds
    inside = (x >= xmin) & (x <= xmax) & (y >= ymin) & (y <= ymax)
    idx = np.flatnonzero(inside)
    idx = idx[pointcloud.decimate(idx.size)]
    sx, sy, sz = x[idx], y[idx], pts["Z"][idx]
    ground_z = sample_raster(ep.grid, ep.surfaces.dtm, sx, sy)
    hag = np.clip(sz - ground_z, 0, None)
    c = aoi_utm.centroid
    cen = aoi4326.centroid
    datum = float(np.median(ground_z)) if idx.size else 0.0
    return pointcloud.encode(
        sx,
        sy,
        sz,
        hag,
        pts["Classification"][idx],
        pts["Intensity"][idx],
        center_lonlat=(cen.x, cen.y),
        center_xy=(c.x, c.y),
        datum_z=datum,
        epsg=ep.grid.epsg,
        extra=extra,
    )


def run_measure(source, dataset, aoi4326, params: dict | None = None, progress: Progress = _noop) -> MeasureResult:
    t0 = time.monotonic()
    params = merged_params(params)
    epsg = aoi_utm_epsg(aoi4326)
    aoi_utm = aoi_to_utm(aoi4326, epsg)
    res = resolve_resolution(params["resolution"], dataset.point_density_ppm2)
    params["resolution"] = res
    grid = grid_for(aoi_utm, res, float(params["margin_m"]), epsg)
    pts, ground, ground_method = fetch_epoch(source, dataset, aoi4326, aoi_utm, grid, progress)
    ep = process_epoch(pts, ground, ground_method, grid, aoi_utm, params, progress)
    progress("vectorizing", 85, "Packing the point cloud")
    pc = export_pointcloud(ep, aoi4326, aoi_utm, extra={"dataset": dataset.name})
    stats = summarize(ep.footprints)
    observed_density = ep.n_points / max(grid.nx * grid.ny * grid.cell_area, 1)
    stats.update(
        {
            "method": ep.method,
            "ground_method": ep.ground_method,
            "points_fetched": ep.n_points,
            "observed_density_ppm2": round(observed_density, 2),
            "resolution_m": grid.res,
            "epsg": epsg,
            "grid": grid.to_dict(),
            "dataset": dataset.name,
            "dataset_year": dataset.acquisition_year,
            "params": params,
            "has_building_class": bool((pts["Classification"] == 6).mean() > 0.01),
            "processing_seconds": round(time.monotonic() - t0, 1),
        }
    )
    return MeasureResult(
        epoch=ep, footprints_wgs84=footprints_to_wgs84(ep.footprints, epsg), stats=stats, pointcloud=pc
    )
