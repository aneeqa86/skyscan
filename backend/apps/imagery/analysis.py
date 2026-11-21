"""Compare footprints across yearly aerial imagery.

Imagery cannot measure height, so it is used for what it is good at:

1. Corroboration. For each LiDAR change, did the imagery inside the footprint
   change between the image years nearest the two surveys?
2. Timing. Between those years, from which image on does the footprint differ
   from its "before" state? That narrows when the change happened, which the
   two LiDAR surveys alone cannot.
3. Vegetation. Near-infrared shows whether a footprint is mostly vegetation,
   which flags trees that the LiDAR classified as buildings.

Two images of the same unchanged building still differ: sun angle and shadows,
season, sensor, colour balance, pixel size, and above all building lean, since
aerial photos are not true orthophotos and tall roofs shift with the camera
position. So a change is never judged on its own. Its imagery change is ranked
against the unchanged buildings of similar height in the same area and the same
pair of years: a rank of 0.9 means it changed more than 90 % of them.

The change measure is per pixel: each year's bands are standardised over the
scene, both images are smoothed to about 2 m (which absorbs small shifts,
resolution differences and shadow edges but keeps a lot turning into a roof),
and the footprint's score is the mean change magnitude inside it.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .grid import ImageGrid
from .providers import YearScene

MIN_PIXELS = 6  # fewer usable pixels than this and a footprint is too small to judge
VEG_FRACTION = 0.5  # share of vegetation pixels that makes a footprint "mostly vegetation"
VEG_MAX_HEIGHT_M = 30.0  # taller objects are not trees
MIN_CONTROLS = 8  # unchanged buildings needed to rank against
BLUR_M = 2.0  # smoothing before per-pixel comparison
HEIGHT_EDGES = (15.0, 40.0)  # controls are matched by height: low-rise, mid-rise, towers
CONFIRMED_RANK = 0.90
LIKELY_RANK = 0.75


def _scene_scale(x: np.ndarray) -> tuple[float, float]:
    """Centre and spread used to standardise a band. The 5-95 % range, unlike the
    MAD, measures the scene's contrast even where one surface (asphalt, a uniform
    roofscape) covers most pixels, so a pure exposure change between years
    cancels out instead of being amplified for bright or green surfaces."""
    lo, med, hi = np.percentile(x, [5, 50, 95])
    return float(med), max(float(hi - lo) / 3.29, 1e-6)


@dataclass
class StdScene:
    """One year's imagery, standardised: rows are R, G, B and, if present, NIR and NDVI."""

    year: int
    z: np.ndarray  # (k, h, w) float32
    names: list[str]
    valid: np.ndarray
    ndvi: np.ndarray | None  # raw NDVI, for the vegetation test
    veg: np.ndarray | None  # vegetation pixels
    veg_threshold: float | None


def vegetation_threshold(ndvi_valid: np.ndarray) -> float:
    """NDVI cut between the scene's typical (urban) value and its vegetation peak.

    NAIP and PDOK pixels are digital numbers, not reflectance, and their
    near-infrared calibration varies a lot between years (a Denver lawn reads
    0.06 in 2013 and 0.47 in 2021), so no fixed value works. Halfway between the
    median and the 99th percentile separates lawns and tree crowns from bright
    roofs, which reflect near-infrared about as strongly as red and sit near 0."""
    if ndvi_valid.size < 100:
        return 0.2
    med, p99 = np.percentile(ndvi_valid, [50, 99])
    return float(max((med + p99) / 2, med + 0.1))


def standardize(scene: YearScene) -> StdScene:
    valid = scene.valid
    rows, names = [], []
    rgb = scene.rgb.astype(np.float32)
    for i, n in enumerate(("red", "green", "blue")):
        med, scale = _scene_scale(rgb[i][valid]) if valid.any() else (0.0, 1.0)
        rows.append((rgb[i] - med) / scale)
        names.append(n)
    ndvi = veg = thr = None
    if scene.nir is not None and valid.any():
        nir = scene.nir.astype(np.float32)
        med, scale = _scene_scale(nir[valid])
        rows.append((nir - med) / scale)
        names.append("nir")
        ndvi = (nir - rgb[0]) / np.maximum(nir + rgb[0], 1.0)
        med, scale = _scene_scale(ndvi[valid])
        rows.append((ndvi - med) / scale)
        names.append("ndvi")
        thr = vegetation_threshold(ndvi[valid])
        veg = (ndvi > thr) & valid
    return StdScene(year=scene.year, z=np.stack(rows).astype(np.float32), names=names, valid=valid, ndvi=ndvi,
                    veg=veg, veg_threshold=thr)


def rasterize(polys_3857, grid: ImageGrid, erode_m: float = 1.0) -> np.ndarray:
    """Label image: pixel value i+1 for polygon i. Polygons shrink by erode_m first,
    which keeps roof edges and neighbours out of the sample; a polygon too small to
    survive that is used as is. Where polygons overlap, the later one wins."""
    from rasterio.features import rasterize as rio_rasterize

    shrink = erode_m * grid.res / max(grid.ground_res_m, 1e-9)
    shapes = []
    for i, p in enumerate(polys_3857):
        if p is None or p.is_empty:
            continue
        g = p.buffer(-shrink) if shrink > 0 else p
        if g.is_empty or g.area < (MIN_PIXELS * grid.res * grid.res):
            g = p
        shapes.append((g, i + 1))
    if not shapes:
        return np.zeros((grid.height, grid.width), np.int32)
    return rio_rasterize(shapes, out_shape=(grid.height, grid.width), transform=grid.transform, fill=0,
                         dtype="int32", all_touched=False)


def footprint_means(img: np.ndarray, labels: np.ndarray, n: int, valid: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Mean of img inside each labelled footprint (NaN where it has too few valid pixels), and pixel counts."""
    sel = (labels > 0) & valid & np.isfinite(img)
    lab = labels[sel]
    cnt = np.bincount(lab, minlength=n + 1)[1:].astype(np.float64)
    tot = np.bincount(lab, weights=img[sel].astype(np.float64), minlength=n + 1)[1:]
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.where(cnt >= MIN_PIXELS, tot / cnt, np.nan)
    return mean, cnt


def change_magnitude(a: StdScene, b: StdScene, grid: ImageGrid) -> tuple[np.ndarray, np.ndarray]:
    """Per-pixel change between two years: RMS over the shared standardised bands
    after smoothing both to about BLUR_M. Returns (magnitude, valid)."""
    from scipy.ndimage import gaussian_filter

    shared = [k for k in a.names if k in b.names]
    sigma = BLUR_M / max(grid.ground_res_m, 1e-9)
    acc = np.zeros(a.valid.shape, np.float32)
    for k in shared:
        za = gaussian_filter(a.z[a.names.index(k)], sigma)
        zb = gaussian_filter(b.z[b.names.index(k)], sigma)
        acc += (za - zb) ** 2
    return np.sqrt(acc / max(len(shared), 1)), a.valid & b.valid


def height_bin(h) -> np.ndarray:
    return np.digitize(np.nan_to_num(np.asarray(h, dtype=float), nan=0.0), HEIGHT_EDGES)


def rank_against(values: np.ndarray, bins: np.ndarray, ctrl_values: np.ndarray, ctrl_bins: np.ndarray) -> np.ndarray:
    """Share of unchanged buildings (same height class, or all of them if the class
    has too few) whose imagery changed less than each value. NaN stays NaN."""
    ok = np.isfinite(ctrl_values)
    pooled = np.sort(ctrl_values[ok])
    out = np.full(values.shape, np.nan)
    for b in np.unique(bins):
        ref = np.sort(ctrl_values[ok & (ctrl_bins == b)])
        if ref.size < MIN_CONTROLS:
            ref = pooled
        m = (bins == b) & np.isfinite(values)
        if ref.size:
            out[m] = np.searchsorted(ref, values[m], side="left") / ref.size
    return out


def reference_years(years: list[int], before_year: int | None, after_year: int | None) -> tuple[int | None, int | None]:
    """Image years standing in for the two LiDAR surveys: the last image at or before
    the first survey, and the first image at or after the second (one year of slack)."""
    ys = sorted(years)
    b = a = None
    if before_year is not None:
        le = [y for y in ys if y <= before_year]
        b = le[-1] if le else next((y for y in ys if y <= before_year + 1), None)
    if after_year is not None:
        ge = [y for y in ys if y >= after_year]
        a = ge[0] if ge else next((y for y in reversed(ys) if y >= after_year - 1), None)
    if b is None or a is None or b >= a:
        return None, None
    return b, a


# Which epoch's imagery shows the building, if there is one, for each change type.
BUILDING_EPOCH = {"new": "after", "raised": "after", "extended": "after",
                  "demolished": "before", "lowered": "before", "reduced": "before"}


@dataclass
class Corroboration:
    status: str  # confirmed | likely | not_visible | vegetation | too_small | no_imagery
    score: float | None = None  # rank among unchanged buildings of similar height, 0..1
    first_year: int | None = None  # first image year in which the change is visible
    window_start: int | None = None  # the image year before that, which still showed the before state


def corroborate(
    std_by_year: dict[int, StdScene],
    grid: ImageGrid,
    change_labels: np.ndarray,
    change_types: list[str],
    change_heights: list[float | None],
    control_labels: np.ndarray,
    control_heights: list[float],
    before_year: int | None,
    after_year: int | None,
) -> tuple[list[Corroboration], dict]:
    n, n_ctrl = len(change_types), len(control_heights)
    ref_b, ref_a = reference_years(list(std_by_year), before_year, after_year)
    if ref_b is None or ref_a is None:
        return [Corroboration("no_imagery") for _ in range(n)], {
            "reference_years": None,
            "reason": "No image years bracket the two surveys.",
        }
    if n_ctrl < MIN_CONTROLS:
        return [Corroboration("no_imagery") for _ in range(n)], {
            "reference_years": [ref_b, ref_a],
            "reason": f"Too few unchanged buildings ({n_ctrl}) to calibrate the imagery check.",
        }
    span = sorted(y for y in std_by_year if ref_b <= y <= ref_a)
    between = [y for y in span if ref_b < y < ref_a]
    c_bins, k_bins = height_bin(change_heights), height_bin(control_heights)

    def ranks(y: int) -> np.ndarray:
        """Each change's imagery change from the before image to year y, ranked."""
        mag, valid = change_magnitude(std_by_year[ref_b], std_by_year[y], grid)
        mc, _ = footprint_means(mag, change_labels, n, valid)
        mk, _ = footprint_means(mag, control_labels, n_ctrl, valid)
        return rank_against(mc, c_bins, mk, k_bins)

    rank = ranks(ref_a)
    timing = {y: ranks(y) for y in between}
    b_std, a_std = std_by_year[ref_b], std_by_year[ref_a]
    veg_b, px_b = footprint_means(b_std.veg.astype(np.float32), change_labels, n, b_std.valid) if b_std.veg is not None else (None, None)
    veg_a, px_a = footprint_means(a_std.veg.astype(np.float32), change_labels, n, a_std.valid) if a_std.veg is not None else (None, None)

    out = []
    for i in range(n):
        r = rank[i]
        if not np.isfinite(r):
            out.append(Corroboration("too_small"))
            continue
        score = round(float(r), 2)
        epoch = BUILDING_EPOCH.get(change_types[i], "after")
        vf = veg_a if epoch == "after" else veg_b
        h = change_heights[i]
        if vf is not None and np.isfinite(vf[i]) and vf[i] >= VEG_FRACTION and (h is None or h < VEG_MAX_HEIGHT_M):
            out.append(Corroboration("vegetation", score=score))
            continue
        if r < LIKELY_RANK:
            out.append(Corroboration("not_visible", score=score))
            continue
        # Timing: the first image year from which every later image already differs
        # from the before image as much as a likely change (construction counts).
        changed = [None if not np.isfinite(timing[y][i]) else bool(timing[y][i] >= LIKELY_RANK) for y in between]
        first = ref_a
        for k in range(len(between) - 1, -1, -1):
            if changed[k] is False:
                break
            if changed[k]:
                first = between[k]
        prev = [y for y in [ref_b, *between] if y < first]
        out.append(Corroboration("confirmed" if r >= CONFIRMED_RANK else "likely", score=score, first_year=first,
                                 window_start=prev[-1] if prev else None))
    summary = {
        "reference_years": [ref_b, ref_a],
        "compared_years": span,
        "controls": n_ctrl,
        "controls_by_height": [int((k_bins == b).sum()) for b in range(len(HEIGHT_EDGES) + 1)],
        "height_edges_m": list(HEIGHT_EDGES),
        "confirmed_rank": CONFIRMED_RANK,
        "likely_rank": LIKELY_RANK,
        "blur_m": BLUR_M,
    }
    return out, summary


def vegetation_flags(std: StdScene, labels: np.ndarray, heights: list[float]) -> tuple[np.ndarray, np.ndarray | None]:
    """True where a footprint is mostly vegetation in this image (and short enough to be a tree).
    Also returns each footprint's mean NDVI (NaN when too small)."""
    n = len(heights)
    if std.veg is None or n == 0:
        return np.zeros(n, bool), None
    vf, _ = footprint_means(std.veg.astype(np.float32), labels, n, std.valid)
    nd, _ = footprint_means(std.ndvi, labels, n, std.valid)
    h = np.asarray(heights, dtype=float)
    flags = np.isfinite(vf) & (np.nan_to_num(vf) >= VEG_FRACTION) & (h < VEG_MAX_HEIGHT_M)
    return flags, nd


def to_rgb_jpeg(scene: YearScene, quality: int = 82) -> bytes:
    """The picture shown on the map, with missing pixels left black."""
    import io

    from PIL import Image

    img = np.moveaxis(scene.rgb, 0, -1).copy()
    img[~scene.valid] = 0
    buf = io.BytesIO()
    Image.fromarray(img, "RGB").save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()
