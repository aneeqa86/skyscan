"""Footprint matching metrics: precision, recall, F1, IoU and height error.

Each detected footprint is matched to at most one reference footprint and vice
versa (greedy, highest IoU first). A pair counts as a true positive when its
IoU is at least `iou_threshold` (0.5 by default, the usual building-extraction
convention). All geometry must be in a metric CRS.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from shapely.geometry import Polygon
from shapely.strtree import STRtree


@dataclass
class Match:
    pred: int
    ref: int
    iou: float


def iou(a: Polygon, b: Polygon) -> float:
    inter = a.intersection(b).area
    if inter <= 0:
        return 0.0
    return inter / (a.area + b.area - inter)


def match_footprints(pred: list[Polygon], ref: list[Polygon], iou_threshold: float = 0.5) -> list[Match]:
    if not pred or not ref:
        return []
    tree = STRtree(ref)
    candidates = []
    for i, p in enumerate(pred):
        for j in tree.query(p, predicate="intersects"):
            v = iou(p, ref[int(j)])
            if v >= iou_threshold:
                candidates.append((v, i, int(j)))
    candidates.sort(reverse=True)
    used_p, used_r, out = set(), set(), []
    for v, i, j in candidates:
        if i in used_p or j in used_r:
            continue
        used_p.add(i)
        used_r.add(j)
        out.append(Match(i, j, v))
    return out


def metrics(
    pred: list[Polygon],
    ref: list[Polygon],
    pred_heights: list[float] | None = None,
    ref_heights: list[float | None] | None = None,
    iou_threshold: float = 0.5,
) -> dict:
    matches = match_footprints(pred, ref, iou_threshold)
    tp = len(matches)
    precision = tp / len(pred) if pred else None
    recall = tp / len(ref) if ref else None
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision is not None and recall is not None and (precision + recall) > 0
        else (0.0 if precision is not None and recall is not None else None)
    )
    out = {
        "iou_threshold": iou_threshold,
        "detected": len(pred),
        "reference": len(ref),
        "true_positives": tp,
        "precision": _r(precision),
        "recall": _r(recall),
        "f1": _r(f1),
        "mean_iou": _r(float(np.mean([m.iou for m in matches]))) if matches else None,
        "height_compared": 0,
        "height_mae_m": None,
        "height_median_abs_error_m": None,
        "height_bias_m": None,
    }
    if pred_heights is not None and ref_heights is not None:
        diffs = [
            pred_heights[m.pred] - ref_heights[m.ref]
            for m in matches
            if ref_heights[m.ref] is not None and ref_heights[m.ref] > 0
        ]
        if diffs:
            d = np.array(diffs)
            out.update(
                height_compared=int(d.size),
                height_mae_m=_r(float(np.abs(d).mean()), 2),
                height_median_abs_error_m=_r(float(np.median(np.abs(d))), 2),
                height_bias_m=_r(float(d.mean()), 2),
            )
    out["matches"] = [(m.pred, m.ref, round(m.iou, 4)) for m in matches]
    return out


def _r(v, nd=4):
    return None if v is None else round(float(v), nd)
