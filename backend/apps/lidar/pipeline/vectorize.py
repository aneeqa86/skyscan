"""Mask -> footprint polygons, and per-footprint attributes."""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from rasterio import features
from scipy import ndimage
from shapely import affinity
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import unary_union

from .raster import Grid

FLOOR_HEIGHT_M = 3.0


@dataclass
class Footprint:
    label: int
    polygon: Polygon  # in the grid CRS (UTM)
    area_m2: float
    height_m: float
    max_height_m: float
    est_floors: int
    volume_m3: float
    point_count: int
    confidence: float


def label_mask(mask: np.ndarray) -> tuple[np.ndarray, int]:
    # 8-connectivity so buildings touching at a corner stay one footprint only
    # if they truly share cells; 4-connectivity would split diagonal roofs.
    return ndimage.label(mask, structure=np.ones((3, 3), dtype=bool))


def split_by_height(
    mask: np.ndarray, ndsm: np.ndarray, step: float, min_seed_m2: float = 12.5, cell_area: float = 0.25
) -> tuple[np.ndarray, int]:
    """Split a building mask into separate buildings at roof-height jumps.

    In dense cities neighbouring buildings share walls, so the mask joins a
    whole block into one region. Cells whose 3x3 neighbourhood spans more than
    `step` metres sit on a wall between roofs of different heights; removing
    them leaves one seed per roof. A watershed on the height gradient then
    grows the seeds back over the full mask, so no building area is lost.
    Buildings of the same height that share a wall stay joined: nothing in the
    LiDAR separates them."""
    from skimage.segmentation import watershed

    span = ndimage.maximum_filter(ndsm, size=3) - ndimage.minimum_filter(ndsm, size=3)
    seeds = mask & (span <= step)
    seed_labels, n = ndimage.label(seeds)
    if n == 0:
        return label_mask(mask)
    # Drop slivers that would become fragments (edges, antennas, roof clutter).
    sizes = ndimage.sum(np.ones_like(ndsm), seed_labels, np.arange(1, n + 1)) * cell_area
    small = np.flatnonzero(sizes < min_seed_m2) + 1
    if small.size:
        seed_labels[np.isin(seed_labels, small)] = 0
    seed_labels, n = ndimage.label(seed_labels > 0)
    gradient = np.hypot(ndimage.sobel(ndsm, axis=0), ndimage.sobel(ndsm, axis=1))
    labels = watershed(gradient, markers=seed_labels, mask=mask)
    # Mask regions that held no seed at all (thin structures) keep their own label.
    orphan = mask & (labels == 0)
    if orphan.any():
        extra, m = ndimage.label(orphan, structure=np.ones((3, 3), dtype=bool))
        labels = np.where(extra > 0, extra + labels.max(), labels)
    # Merging can create new enclosures (two merged pieces now surround a
    # third), so repeat until the region count stops changing.
    for _ in range(4):
        before = len(np.unique(labels))
        labels = merge_regions(labels, ndsm, step, min_area_cells=max(1, int(2 * min_seed_m2 / cell_area)))
        if len(np.unique(labels)) == before:
            break
    labels, _, _ = _relabel(labels)
    return labels, int(labels.max())


def _boundary_pairs(labels: np.ndarray, ndsm: np.ndarray):
    """Per pair of 4-adjacent labels: shared edge count and median height step across it."""
    pairs = []
    diffs = []
    for a, b, ha, hb in (
        (labels[:, :-1], labels[:, 1:], ndsm[:, :-1], ndsm[:, 1:]),
        (labels[:-1, :], labels[1:, :], ndsm[:-1, :], ndsm[1:, :]),
    ):
        sel = (a != b) & (a > 0) & (b > 0)
        lo = np.minimum(a[sel], b[sel])
        hi = np.maximum(a[sel], b[sel])
        pairs.append(np.stack([lo, hi], axis=1))
        diffs.append(np.abs(ha[sel] - hb[sel]))
    pairs = np.concatenate(pairs) if pairs else np.empty((0, 2), int)
    diffs = np.concatenate(diffs) if diffs else np.empty(0)
    out = {}
    if pairs.size == 0:
        return out
    key = pairs[:, 0].astype(np.int64) * (int(labels.max()) + 1) + pairs[:, 1]
    order = np.argsort(key, kind="stable")
    key, diffs, pairs = key[order], diffs[order], pairs[order]
    starts = np.flatnonzero(np.r_[True, key[1:] != key[:-1]])
    ends = np.r_[starts[1:], key.size]
    for s, e in zip(starts, ends):
        out[(int(pairs[s, 0]), int(pairs[s, 1]))] = (int(e - s), float(np.median(diffs[s:e])))
    return out


def merge_regions(labels: np.ndarray, ndsm: np.ndarray, step: float, min_area_cells: int = 100,
                  enclosure: float = 0.6) -> np.ndarray:
    """Merge watershed regions that belong to one building.

    Two touching regions merge when
    - the median height step along their shared edge is below `step` (one roof
      cut apart by clutter such as water tanks or HVAC), or
    - one region is mostly surrounded by the other (`enclosure` of its
      perimeter): a tower on its own podium, a penthouse on its roof, or
    - a region is smaller than min_area_cells: fragments join the neighbour
      they share most edge with.
    Neighbouring buildings usually share only one side, so they stay apart."""
    n = int(labels.max())
    if n < 2:
        return labels
    idx = np.arange(1, n + 1)
    size = np.zeros(n + 1, dtype=np.int64)
    size[1:] = ndimage.sum(np.ones_like(labels, dtype=np.int64), labels, idx)
    # Perimeter in cell edges (outer edges plus edges to other labels).
    padded = np.pad(labels, 1)
    perim = np.zeros(n + 1, dtype=np.int64)
    for sh in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        nb = np.roll(padded, sh, axis=(0, 1))
        edge = (padded > 0) & (nb != padded)
        perim += np.bincount(padded[edge], minlength=n + 1)
    parent = np.arange(n + 1)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    pairs = _boundary_pairs(labels, ndsm)
    shared_total = {}
    for (a, b), (cnt, _) in pairs.items():
        shared_total.setdefault(a, []).append((cnt, b))
        shared_total.setdefault(b, []).append((cnt, a))

    for (a, b), (cnt, med) in sorted(pairs.items(), key=lambda kv: kv[1][1]):
        enclosed = cnt >= enclosure * perim[a] or cnt >= enclosure * perim[b]
        if med < step or enclosed:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[max(ra, rb)] = min(ra, rb)

    # Fragments: attach to the neighbour with the longest shared edge.
    root_size = np.zeros(n + 1, dtype=np.int64)
    for i in idx:
        root_size[find(i)] += size[i]
    for i in idx:
        r = find(i)
        if root_size[r] >= min_area_cells or i not in shared_total:
            continue
        cnt, nb = max(shared_total[i])
        rn = find(nb)
        if rn != r:
            parent[r] = rn
            root_size[rn] += root_size[r]

    lut = np.array([find(i) for i in range(n + 1)])
    return lut[labels]


def _relabel(labels: np.ndarray):
    from skimage.segmentation import relabel_sequential

    return relabel_sequential(labels)


def polygons_from_labels(labels: np.ndarray, grid: Grid) -> dict[int, Polygon]:
    """Polygonize each label; keep the largest part if a label yields several."""
    out: dict[int, list] = {}
    for geom, value in features.shapes(
        labels.astype(np.int32), mask=labels > 0, connectivity=8, transform=grid.transform
    ):
        out.setdefault(int(value), []).append(shape(geom))
    polys = {}
    for lab, parts in out.items():
        g = unary_union(parts)
        if isinstance(g, MultiPolygon):
            g = max(g.geoms, key=lambda q: q.area)
        polys[lab] = g
    return polys


def _dominant_angle(poly: Polygon) -> float:
    """Orientation (radians) of the longest side of the minimum rotated rectangle."""
    rect = poly.minimum_rotated_rectangle
    if not isinstance(rect, Polygon):
        return 0.0
    c = list(rect.exterior.coords)
    edges = [(c[i], c[i + 1]) for i in range(4)]
    (x0, y0), (x1, y1) = max(edges, key=lambda e: math.dist(e[0], e[1]))
    return math.atan2(y1 - y0, x1 - x0)


def regularize(poly: Polygon, angle_tol_deg: float = 20.0, max_area_change: float = 0.15) -> Polygon:
    """Snap near-orthogonal edges to the building's dominant axes.

    Rotate the outline so the dominant axis is horizontal, force each edge that
    is within angle_tol of horizontal or vertical to be exactly so (at the
    edge's mean position), rebuild vertices as intersections of consecutive
    edge lines, then rotate back. Diagonal edges are kept. If the result is
    invalid or changes the area too much, the input is returned."""
    if poly.is_empty or len(poly.exterior.coords) < 5:
        return poly
    ang = _dominant_angle(poly)
    origin = poly.centroid
    rot = affinity.rotate(poly, -ang, origin=origin, use_radians=True)
    coords = list(rot.exterior.coords)[:-1]
    n = len(coords)
    tol = math.radians(angle_tol_deg)

    # Classify edges: 'h', 'v' or 'd' with a representative line.
    edges = []
    for i in range(n):
        (x0, y0), (x1, y1) = coords[i], coords[(i + 1) % n]
        a = math.atan2(y1 - y0, x1 - x0) % math.pi
        if min(a, math.pi - a) <= tol:
            edges.append(("h", (y0 + y1) / 2, (x0, y0), (x1, y1)))
        elif abs(a - math.pi / 2) <= tol:
            edges.append(("v", (x0 + x1) / 2, (x0, y0), (x1, y1)))
        else:
            edges.append(("d", None, (x0, y0), (x1, y1)))

    # Merge runs of consecutive edges with the same axis orientation.
    merged = []
    for e in edges:
        if merged and e[0] != "d" and merged[-1][0] == e[0]:
            k, v, p0, _ = merged[-1]
            merged[-1] = (k, (v + e[1]) / 2, p0, e[3])
        else:
            merged.append(e)
    if len(merged) > 1 and merged[0][0] != "d" and merged[0][0] == merged[-1][0]:
        k, v, _, p1 = merged[0]
        kl, vl, p0, _ = merged.pop()
        merged[0] = (k, (v + vl) / 2, p0, p1)
    if len(merged) < 3:
        return poly

    def line(e):
        k, v, p0, p1 = e
        if k == "h":
            return (0.0, 1.0, v)  # y = v  ->  0*x + 1*y = v
        if k == "v":
            return (1.0, 0.0, v)
        (x0, y0), (x1, y1) = p0, p1
        a, b = y1 - y0, x0 - x1
        return (a, b, a * x0 + b * y0)

    verts = []
    m = len(merged)
    for i in range(m):
        a1, b1, c1 = line(merged[i - 1])
        a2, b2, c2 = line(merged[i])
        det = a1 * b2 - a2 * b1
        if abs(det) < 1e-9:
            verts.append(merged[i][2])  # parallel: keep the original corner
        else:
            verts.append(((c1 * b2 - c2 * b1) / det, (a1 * c2 - a2 * c1) / det))
    try:
        out = Polygon(verts)
    except ValueError:
        return poly
    if not out.is_valid or out.is_empty:
        return poly
    out = affinity.rotate(out, ang, origin=origin, use_radians=True)
    if abs(out.area - poly.area) / poly.area > max_area_change:
        return poly
    return out


def compactness(poly: Polygon) -> float:
    if poly.length == 0:
        return 0.0
    return float(4 * math.pi * poly.area / poly.length**2)


def compute_attributes(
    labels: np.ndarray,
    n: int,
    ndsm: np.ndarray,
    count: np.ndarray,
    veg: np.ndarray,
    grid: Grid,
) -> dict[int, dict]:
    """Per-label raster statistics. Returns {label: {...}} for labels 1..n."""
    if n == 0:
        return {}
    idx = np.arange(1, n + 1)
    cells = ndimage.sum(np.ones_like(ndsm), labels, idx)
    vol = ndimage.sum(ndsm, labels, idx) * grid.cell_area
    mx = ndimage.maximum(ndsm, labels, idx)
    pts = ndimage.sum(count, labels, idx)
    mveg = ndimage.mean(veg, labels, idx)
    # p90 per label via a single sort instead of n percentile calls.
    flat_l = labels.ravel()
    sel = flat_l > 0
    lv, hv = flat_l[sel], ndsm.ravel()[sel]
    order = np.lexsort((hv, lv))
    lv, hv = lv[order], hv[order]
    starts = np.searchsorted(lv, idx, side="left")
    ends = np.searchsorted(lv, idx, side="right")
    p90 = np.array(
        [hv[s + int(math.floor(0.9 * (e - s - 1)))] if e > s else 0.0 for s, e in zip(starts, ends)]
    )
    # Does the component touch the grid border (possibly cut off)?
    border = np.zeros(n + 1, dtype=bool)
    edge_labels = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
    border[np.unique(edge_labels)] = True
    out = {}
    for i, lab in enumerate(idx):
        area = float(cells[i] * grid.cell_area)
        out[int(lab)] = dict(
            cell_area_m2=area,
            height_m=float(p90[i]),
            max_height_m=float(mx[i]),
            volume_m3=float(vol[i]),
            point_count=int(pts[i]),
            density_ppm2=float(pts[i] / area) if area else 0.0,
            mean_veg=float(mveg[i]),
            touches_border=bool(border[lab]),
        )
    return out


def estimate_floors(height_m: float) -> int:
    return max(1, int(round(height_m / FLOOR_HEIGHT_M)))


def confidence_score(attrs: dict, poly: Polygon, veg_threshold: float) -> float:
    """0..1 heuristic: dense, vegetation-free, compact, reasonably large, not cut by the edge."""
    density = min(attrs["density_ppm2"] / 4.0, 1.0)
    veg_clean = 1.0 - 0.5 * min(attrs["mean_veg"] / max(veg_threshold, 1e-6), 1.0)
    size = min(attrs["cell_area_m2"] / 100.0, 1.0)
    comp = min(max((compactness(poly) - 0.2) / 0.5, 0.0), 1.0)
    score = 0.35 * density + 0.25 * veg_clean + 0.2 * size + 0.2 * comp
    if attrs["touches_border"]:
        score *= 0.6
    return round(float(min(max(score, 0.0), 1.0)), 3)


def vectorize(
    mask: np.ndarray,
    ndsm: np.ndarray,
    count: np.ndarray,
    veg: np.ndarray,
    grid: Grid,
    min_area: float = 25.0,
    simplify_tol: float = 0.3,
    regularize_shapes: bool = True,
    veg_threshold: float = 0.42,
    keep_within=None,
    split_step: float | None = None,
) -> tuple[list[Footprint], np.ndarray]:
    """Return footprints (UTM) and the label raster they came from.

    keep_within: optional shapely geometry (UTM); only footprints whose
    centroid falls inside are kept (the AOI, when the grid has a margin).
    split_step: if set, split touching buildings where the roof height jumps
    by more than this many metres (see split_by_height)."""
    if split_step:
        labels, n = split_by_height(mask, ndsm, split_step, min_seed_m2=min_area / 2, cell_area=grid.cell_area)
    else:
        labels, n = label_mask(mask)
    attrs = compute_attributes(labels, n, ndsm, count, veg, grid)
    polys = polygons_from_labels(labels, grid)
    result = []
    for lab, poly in polys.items():
        a = attrs[lab]
        if a["cell_area_m2"] < min_area:
            continue
        if keep_within is not None and not keep_within.contains(poly.centroid):
            continue
        g = poly.simplify(simplify_tol, preserve_topology=True)
        if regularize_shapes:
            g = regularize(g)
        if not g.is_valid:
            g = g.buffer(0)
        if isinstance(g, MultiPolygon):
            g = max(g.geoms, key=lambda q: q.area)
        if g.is_empty or g.area < min_area * 0.5:
            continue
        result.append(
            Footprint(
                label=lab,
                polygon=g,
                area_m2=round(float(g.area), 2),
                height_m=round(a["height_m"], 2),
                max_height_m=round(a["max_height_m"], 2),
                est_floors=estimate_floors(a["height_m"]),
                volume_m3=round(a["volume_m3"], 1),
                point_count=a["point_count"],
                confidence=confidence_score(a, g, veg_threshold),
            )
        )
    return result, labels


__all__ = ["Footprint", "vectorize", "regularize", "estimate_floors", "compute_attributes"]
