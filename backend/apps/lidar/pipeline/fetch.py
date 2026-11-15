"""Point fetching and cleaning with PDAL."""
from __future__ import annotations

import json
import logging

import numpy as np

from .raster import GROUND, NOISE

log = logging.getLogger(__name__)

FIELDS = ["X", "Y", "Z", "Intensity", "ReturnNumber", "NumberOfReturns", "Classification"]
DTYPE = np.dtype(
    [
        ("X", "f8"),
        ("Y", "f8"),
        ("Z", "f8"),
        ("Intensity", "u2"),
        ("ReturnNumber", "u1"),
        ("NumberOfReturns", "u1"),
        ("Classification", "u1"),
    ]
)
# Below this share of class-2 points we treat the survey as unclassified and run SMRF.
MIN_GROUND_SHARE = 0.03


class NoPointsError(RuntimeError):
    pass


def _compact(arr: np.ndarray) -> np.ndarray:
    out = np.empty(arr.shape[0], dtype=DTYPE)
    for f in FIELDS:
        if f in arr.dtype.names:
            out[f] = arr[f]
        else:
            out[f] = 1 if f in ("ReturnNumber", "NumberOfReturns") else 0
    return out


def fetch_points(
    reader_stage: dict,
    utm_epsg: int,
    lat: float | None = None,
    density_ppm2: float | None = None,
    cap_above_ppm2: float = 20.0,
    cap_spacing_m: float = 0.75,
) -> np.ndarray:
    """Run reader -> noise removal -> reproject -> outlier removal; return compact points.

    Very dense surveys (above cap_above_ppm2) are read at a coarser EPT octree
    level so a 1 km² job stays within worker memory and download time. EPT
    'resolution' is a node spacing in Web Mercator units (stretched by
    1/cos(latitude)) and moves in octree steps: 0.75 ground metres keeps about
    15 pts/m², still several points per 0.5 m cell."""
    import math

    import pdal

    stages = [dict(s) for s in reader_stage] if isinstance(reader_stage, list) else [dict(reader_stage)]
    dense = bool(density_ppm2 and density_ppm2 > cap_above_ppm2)
    reader = stages[0]
    if reader.get("type") == "readers.ept":
        if dense:
            scale = 1 / math.cos(math.radians(lat)) if lat is not None else 1.0
            reader.setdefault("resolution", cap_spacing_m * scale)
    elif dense:
        # Tile files have no octree to read coarser levels from: keep every
        # Nth point instead (about 15 pts/m², the same target as for EPT).
        stages.append({"type": "filters.decimation", "step": max(2, math.ceil(density_ppm2 / 15))})
    # One expression: filters.range ORs comma-separated ranges on one dimension,
    # so "not 7, not 18" written as two ranges would let every point through.
    not_noise = " && ".join(f"Classification != {c}" for c in NOISE)
    spec = [
        *stages,
        {"type": "filters.expression", "expression": not_noise},
        {"type": "filters.reprojection", "out_srs": f"EPSG:{utm_epsg}"},
        {"type": "filters.outlier", "method": "statistical", "mean_k": 8, "multiplier": 2.5},
        {"type": "filters.expression", "expression": "Classification != 7"},
    ]
    p = pdal.Pipeline(json.dumps(spec))
    p.execute()
    arrays = [a for a in p.arrays if a.size]
    if not arrays:
        raise NoPointsError("The survey returned no points for this area.")
    pts = _compact(np.concatenate(arrays))
    log.info("fetched %d points", pts.size)
    return pts


def ensure_ground(pts: np.ndarray) -> tuple[np.ndarray, str]:
    """Return (ground_mask, method). Uses class 2 if the survey has it, else SMRF."""
    ground = pts["Classification"] == GROUND
    if ground.mean() >= MIN_GROUND_SHARE:
        return ground, "class2"
    import pdal

    work = pts.copy()
    work["Classification"] = 1
    spec = [
        {"type": "filters.smrf", "slope": 0.15, "window": 18.0, "threshold": 0.5, "scalar": 1.25},
    ]
    p = pdal.Pipeline(json.dumps(spec), arrays=[work])
    p.execute()
    out = np.concatenate(p.arrays)
    # SMRF keeps point order for in-memory input.
    return out["Classification"] == GROUND, "smrf"
