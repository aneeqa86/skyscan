"""Building mask from surfaces.

Two methods:
- class6: the survey already labels building points (class 6) at a usable rate.
- ndsm:   everything taller than min_height, minus vegetation. Most 3DEP data
          has no building class, so this is the method that usually runs.

Vegetation is told apart from roofs with three per-cell cues, each normalised
to 0..1 and combined into a vegetation score:
- multi-return share: laser pulses partly pass through crowns and come back as
  several returns; roofs mostly give a single return.
- vertical dispersion: the spread of point heights inside a 0.5 m cell. Roof
  points sit on one surface, canopy points spread through the crown.
- roughness: deviation of the DSM from a local plane. Roofs are planar
  (flat or pitched), crowns are bumpy.
Region-level checks then drop components that are, on average, vegetation-like.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

from .raster import Surfaces


@dataclass
class MaskParams:
    method: str = "auto"  # auto | class6 | ndsm
    min_height: float = 2.5
    # Vegetation score weights and threshold (tuned in docs/METHOD.md).
    w_multi: float = 0.45
    w_disp: float = 0.30
    w_rough: float = 0.25
    multi_full: float = 0.6  # multi-return share mapped to score 1
    disp_full: float = 1.5  # metres of in-cell height spread mapped to score 1
    rough_full: float = 0.6  # metres of RMS roughness mapped to score 1
    veg_threshold: float = 0.42
    region_veg_max: float = 0.38  # mean vegetation score allowed for a building region
    region_multi_max: float = 0.35
    open_iters: int = 1
    close_iters: int = 0  # closing bridges the 1-2 m gaps between houses
    grow_iters: int = 2  # cells each building regrows at its edges after vegetation removal
    grow_veg_max: float = 0.65
    # Share of tall cells that must carry class 6 before the survey's own
    # building class is trusted. Cook County 2017 labels only part of its
    # roofs as 6 and scored F1 0.31 that way against 0.42 with the nDSM method.
    min_class6_share: float = 0.6
    extra: dict = field(default_factory=dict)

    @classmethod
    def from_params(cls, params: dict | None) -> MaskParams:
        p = cls()
        for k, v in (params or {}).items():
            if hasattr(p, k) and k != "extra":
                setattr(p, k, type(getattr(p, k))(v))
        return p


def vegetation_score(s: Surfaces, p: MaskParams) -> np.ndarray:
    disp = np.clip(s.z_std / p.disp_full, 0, 1)
    rough = np.clip(s.roughness / p.rough_full, 0, 1)
    if s.has_returns:
        multi = np.clip(s.multi_return / p.multi_full, 0, 1)
        score = p.w_multi * multi + p.w_disp * disp + p.w_rough * rough
    else:
        # No return information: spread the multi-return weight over the
        # two geometric cues so the score keeps the same 0..1 scale.
        total = p.w_disp + p.w_rough
        score = (p.w_disp * disp + p.w_rough * rough) / total
    # Smooth over a 3x3 window: single noisy cells should not flip the decision.
    return ndimage.uniform_filter(score, size=3, mode="nearest")


def choose_method(s: Surfaces, p: MaskParams) -> str:
    if p.method in ("class6", "ndsm"):
        return p.method
    tall = s.ndsm >= p.min_height
    if not tall.any():
        return "ndsm"
    has6 = np.nan_to_num(s.building_share, nan=0.0) > 0.3
    share = (has6 & tall).sum() / tall.sum()
    return "class6" if share >= p.min_class6_share else "ndsm"


def _clean(mask: np.ndarray, p: MaskParams) -> np.ndarray:
    st = ndimage.generate_binary_structure(2, 1)
    if p.open_iters:
        mask = ndimage.binary_opening(mask, structure=st, iterations=p.open_iters)
    if p.close_iters:
        mask = ndimage.binary_closing(mask, structure=st, iterations=p.close_iters, border_value=0)
    return ndimage.binary_fill_holes(mask)


def building_mask(s: Surfaces, p: MaskParams) -> tuple[np.ndarray, str, np.ndarray]:
    """Return (mask, method_used, vegetation_score)."""
    method = choose_method(s, p)
    tall = s.ndsm >= p.min_height
    veg = vegetation_score(s, p)
    if method == "class6":
        b6 = np.nan_to_num(s.building_share, nan=0.0) > 0.3
        # Fill single-cell gaps in classified roofs before cleaning.
        b6 = ndimage.binary_closing(b6, iterations=1)
        return _clean(b6 & tall, p), method, veg

    cand = tall & (veg < p.veg_threshold)
    mask = _clean(cand, p)

    # Region-level vegetation rejection.
    labels, n = ndimage.label(mask)
    if n:
        idx = np.arange(1, n + 1)
        mean_veg = ndimage.mean(veg, labels, idx)
        mean_multi = ndimage.mean(s.multi_return, labels, idx)
        drop = mean_veg > p.region_veg_max
        if s.has_returns:
            drop |= mean_multi > p.region_multi_max
        if drop.any():
            mask[np.isin(labels, idx[drop])] = False

    # Roof edges score high (eaves and facade points raise dispersion and
    # roughness), so the vegetation test eats into every building. Grow the
    # kept regions back over neighbouring tall cells unless those cells look
    # strongly like vegetation.
    # Each building grows on its own (expand_labels never lets two labels
    # merge), and a one-cell gap is kept wherever two grown buildings meet,
    # so neighbouring houses stay separate.
    if p.grow_iters:
        from skimage.segmentation import expand_labels

        allowed = tall & (veg < p.grow_veg_max)
        labels, _ = ndimage.label(mask)
        grown = expand_labels(labels, distance=p.grow_iters) * allowed
        meet = np.zeros_like(mask)
        for a, b in ((grown[:, :-1], grown[:, 1:]), (grown[:-1, :], grown[1:, :])):
            touch = (a > 0) & (b > 0) & (a != b)
            if a.shape[1] != grown.shape[1]:
                meet[:, 1:] |= touch
            else:
                meet[1:, :] |= touch
        mask = (grown > 0) & ~meet
    return mask, method, veg
