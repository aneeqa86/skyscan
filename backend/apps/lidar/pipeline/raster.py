"""Gridding: points -> DSM, DTM, nDSM and per-cell features on a shared grid.

All arrays are row-major with row 0 at the top (north), matching GeoTIFF and
rasterio.features conventions. Coordinates are in the job's UTM CRS (metres).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from scipy import ndimage
from scipy.interpolate import griddata

GROUND = 2
BUILDING = 6
NOISE = (7, 18)


@dataclass(frozen=True)
class Grid:
    x0: float  # west edge
    y0: float  # north edge
    res: float
    nx: int
    ny: int
    epsg: int

    @classmethod
    def from_bounds(cls, xmin, ymin, xmax, ymax, res: float, epsg: int) -> Grid:
        """Snap bounds outward to multiples of res so two epochs share an identical grid."""
        x0 = np.floor(xmin / res) * res
        y0 = np.ceil(ymax / res) * res
        x1 = np.ceil(xmax / res) * res
        y1 = np.floor(ymin / res) * res
        return cls(float(x0), float(y0), float(res), int(round((x1 - x0) / res)), int(round((y0 - y1) / res)), epsg)

    @property
    def shape(self):
        return (self.ny, self.nx)

    @property
    def cell_area(self):
        return self.res * self.res

    @property
    def transform(self):
        from affine import Affine

        return Affine(self.res, 0, self.x0, 0, -self.res, self.y0)

    def bounds(self):
        return (self.x0, self.y0 - self.ny * self.res, self.x0 + self.nx * self.res, self.y0)

    def cell_of(self, x, y):
        col = np.floor((np.asarray(x) - self.x0) / self.res).astype(np.int64)
        row = np.floor((self.y0 - np.asarray(y)) / self.res).astype(np.int64)
        ok = (col >= 0) & (col < self.nx) & (row >= 0) & (row < self.ny)
        return row, col, ok

    def to_dict(self):
        return asdict(self)


def _linear_index(grid: Grid, x, y):
    row, col, ok = grid.cell_of(x, y)
    return row * grid.nx + col, ok


def grid_reduce(grid: Grid, x, y, values, how: str = "max", fill=np.nan) -> np.ndarray:
    """Reduce point values per cell ('max', 'min', 'mean'). Cells with no points get fill."""
    lin, ok = _linear_index(grid, x, y)
    lin, values = lin[ok], np.asarray(values, dtype=np.float64)[ok]
    out = np.full(grid.nx * grid.ny, fill, dtype=np.float64)
    if lin.size == 0:
        return out.reshape(grid.shape)
    if how == "mean":
        s = np.bincount(lin, weights=values, minlength=out.size)
        n = np.bincount(lin, minlength=out.size)
        has = n > 0
        out[has] = s[has] / n[has]
        return out.reshape(grid.shape)
    order = np.argsort(lin, kind="stable")
    lin_s, v_s = lin[order], values[order]
    starts = np.flatnonzero(np.r_[True, lin_s[1:] != lin_s[:-1]])
    ufunc = np.maximum if how == "max" else np.minimum
    out[lin_s[starts]] = ufunc.reduceat(v_s, starts)
    return out.reshape(grid.shape)


def grid_count(grid: Grid, x, y, weights=None) -> np.ndarray:
    lin, ok = _linear_index(grid, x, y)
    w = None if weights is None else np.asarray(weights, dtype=np.float64)[ok]
    return np.bincount(lin[ok], weights=w, minlength=grid.nx * grid.ny).reshape(grid.shape)


def fill_nearest(arr: np.ndarray, max_dist_cells: float | None = None) -> np.ndarray:
    """Fill NaNs with the nearest valid value (optionally only within a distance)."""
    invalid = np.isnan(arr)
    if not invalid.any():
        return arr
    if invalid.all():
        raise ValueError("Raster has no valid cells")
    dist, (ri, ci) = ndimage.distance_transform_edt(invalid, return_indices=True)
    filled = arr[ri, ci]
    if max_dist_cells is not None:
        filled = np.where(dist > max_dist_cells, np.nan, filled)
    return filled


def make_dtm(grid: Grid, gx, gy, gz, coarse_res: float = 2.0) -> np.ndarray:
    """Ground surface: per-cell minimum of ground points on a coarse grid, gaps
    (under buildings, water) filled by linear interpolation, then resampled
    bilinearly to the fine grid. Ground is smooth, so 2 m is plenty and keeps
    the triangulation fast."""
    if len(gz) < 3:
        raise ValueError("Too few ground points to build a terrain model")
    factor = max(1, int(round(coarse_res / grid.res)))
    coarse = Grid(grid.x0, grid.y0, grid.res * factor, -(-grid.nx // factor), -(-grid.ny // factor), grid.epsg)
    zc = grid_reduce(coarse, gx, gy, gz, "min")
    rr, cc = np.nonzero(~np.isnan(zc))
    if rr.size < 3:
        raise ValueError("Too few ground cells to build a terrain model")
    gr, gc = np.mgrid[0 : coarse.ny, 0 : coarse.nx]
    pts = np.column_stack([rr, cc]).astype(np.float64)
    filled = griddata(pts, zc[rr, cc], (gr, gc), method="linear")
    if np.isnan(filled).any():
        nearest = griddata(pts, zc[rr, cc], (gr, gc), method="nearest")
        filled = np.where(np.isnan(filled), nearest, filled)
    # Fine cell centres expressed in coarse cell coordinates.
    fr = (np.arange(grid.ny) + 0.5) / factor - 0.5
    fc = (np.arange(grid.nx) + 0.5) / factor - 0.5
    FR, FC = np.meshgrid(fr, fc, indexing="ij")
    return ndimage.map_coordinates(filled, [FR, FC], order=1, mode="nearest")


def sample_raster(grid: Grid, raster: np.ndarray, x, y) -> np.ndarray:
    """Bilinear sample of a raster at point coordinates."""
    c = (np.asarray(x) - grid.x0) / grid.res - 0.5
    r = (grid.y0 - np.asarray(y)) / grid.res - 0.5
    return ndimage.map_coordinates(raster, [r, c], order=1, mode="nearest")


@dataclass
class Surfaces:
    grid: Grid
    dsm: np.ndarray
    dtm: np.ndarray
    ndsm: np.ndarray
    count: np.ndarray  # all non-noise points per cell
    ground: np.ndarray  # bool: cell holds ground points
    multi_return: np.ndarray  # share of points in cell that are not the last of several returns
    z_std: np.ndarray  # std of non-ground point heights in cell
    building_share: np.ndarray  # share of points classified 6 (NaN where no points)
    roughness: np.ndarray
    # False when the survey carries no multi-return information (some EPT
    # projects store every point as return 1 of 1).
    has_returns: bool = True


def local_roughness(dsm: np.ndarray, size: int = 5) -> np.ndarray:
    """RMS deviation of the DSM from a local plane.

    A 3x3 mean preserves any plane exactly, so z - mean3(z) is zero on flat or
    sloped roofs and large on tree crowns; averaging its square over a window
    gives a stable texture measure. Roof ridges and edges score on thin lines
    only, which morphology later ignores."""
    resid = dsm - ndimage.uniform_filter(dsm, size=3, mode="nearest")
    # Clip: the filtered square can come out a hair below zero in floating point.
    return np.sqrt(np.clip(ndimage.uniform_filter(resid * resid, size=size, mode="nearest"), 0, None))


MIN_POINTS_PER_WINDOW = 3.0


def feature_window(res: float, density_ppm2: float) -> int:
    """Smallest odd window (in cells) expected to hold MIN_POINTS_PER_WINDOW points.

    Dense surveys keep per-cell cues (sharp roof edges); sparse ones pool a
    3x3 or 5x5 neighbourhood so spreads and shares have points to work with."""
    for w in (1, 3, 5):
        if density_ppm2 * (w * res) ** 2 >= MIN_POINTS_PER_WINDOW:
            return w
    return 5


def window_sum(a: np.ndarray, w: int) -> np.ndarray:
    if w <= 1:
        return a.astype(np.float64)
    return ndimage.uniform_filter(a.astype(np.float64), size=w, mode="constant") * (w * w)


def build_surfaces(grid: Grid, pts: np.ndarray, ground_mask: np.ndarray) -> Surfaces:
    """pts: structured array with X, Y, Z, Classification, ReturnNumber, NumberOfReturns."""
    x, y, z = pts["X"], pts["Y"], pts["Z"]
    dtm = make_dtm(grid, x[ground_mask], y[ground_mask], z[ground_mask])
    top = grid_reduce(grid, x, y, z, "max")
    # Small gaps (between scan lines) take the nearest value; large gaps
    # (water, no returns) fall back to the terrain so nDSM is 0 there.
    dsm = fill_nearest(top, max_dist_cells=3)
    dsm = np.where(np.isnan(dsm), dtm, dsm)
    ndsm = np.clip(dsm - dtm, 0, None)

    count = grid_count(grid, x, y)
    ground_cells = grid_count(grid, x[ground_mask], y[ground_mask]) > 0
    nret = pts["NumberOfReturns"].astype(np.int16)
    rnum = pts["ReturnNumber"].astype(np.int16)
    multi = (nret > 1) & (rnum < nret)

    # Point cues are summed over a feature window: at 4-6 pts/m² a 0.5 m cell
    # holds one point or none, and a spread or a share computed from one point
    # is always zero, so sparse surveys pool neighbouring cells.
    w = feature_window(grid.res, len(pts) / (grid.nx * grid.ny * grid.cell_area))
    ng = ~ground_mask
    row, col, ok = grid.cell_of(x[ng], y[ng])
    # Depth of each non-ground point below the highest point of its cell:
    # zero on any roof, flat or pitched; large inside tree crowns.
    depth = np.zeros(int(ng.sum()))
    depth[ok] = top[row[ok], col[ok]] - z[ng][ok]
    with np.errstate(invalid="ignore", divide="ignore"):
        n_all = window_sum(count, w)
        multi_share = window_sum(grid_count(grid, x, y, multi.astype(np.float64)), w) / n_all
        n_ng = window_sum(grid_count(grid, x[ng], y[ng]), w)
        d2 = window_sum(grid_count(grid, x[ng], y[ng], depth**2), w)
        z_std = np.sqrt(d2 / n_ng)
        bshare = grid_count(grid, x, y, (pts["Classification"] == BUILDING).astype(np.float64)) / count
    multi_share = np.nan_to_num(multi_share, nan=0.0)
    z_std = np.nan_to_num(z_std, nan=0.0)
    return Surfaces(
        grid=grid,
        dsm=dsm,
        dtm=dtm,
        ndsm=ndsm,
        count=count,
        ground=ground_cells,
        multi_return=multi_share,
        z_std=z_std,
        building_share=bshare,
        roughness=local_roughness(dsm),
        has_returns=bool((nret > 1).mean() > 0.02),
    )
