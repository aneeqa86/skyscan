"""A north-up Web Mercator pixel grid over an area.

Imagery is resampled onto one grid per job so every year lines up pixel for
pixel, and the same picture can be placed on the Mapbox map by its four
corners without any further warping.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from affine import Affine
from pyproj import Transformer

_FWD = Transformer.from_crs(4326, 3857, always_xy=True)
_INV = Transformer.from_crs(3857, 4326, always_xy=True)


@dataclass(frozen=True)
class ImageGrid:
    x0: float  # west edge, EPSG:3857 metres
    y1: float  # north edge
    res: float  # pixel size in EPSG:3857 units
    width: int
    height: int

    @classmethod
    def for_bbox(cls, bbox4326, target_m: float = 0.5, margin_m: float = 20.0, max_px: int = 2400) -> ImageGrid:
        """Grid covering a lon/lat bbox (plus a margin) at about target_m ground metres per pixel."""
        w, s, e, n = bbox4326
        scale = 1.0 / math.cos(math.radians((s + n) / 2))  # Web Mercator stretch at this latitude
        x0, y0 = _FWD.transform(w, s)
        x1, y1 = _FWD.transform(e, n)
        pad = margin_m * scale
        x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
        res = target_m * scale
        res = max(res, (x1 - x0) / max_px, (y1 - y0) / max_px)
        width = max(1, math.ceil((x1 - x0) / res))
        height = max(1, math.ceil((y1 - y0) / res))
        return cls(x0=x0, y1=y1, res=res, width=width, height=height)

    @property
    def transform(self) -> Affine:
        return Affine(self.res, 0.0, self.x0, 0.0, -self.res, self.y1)

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        return (self.x0, self.y1 - self.height * self.res, self.x0 + self.width * self.res, self.y1)

    @property
    def ground_res_m(self) -> float:
        _, lat = _INV.transform(self.x0, self.y1 - self.height * self.res / 2)
        return self.res * math.cos(math.radians(lat))

    def corners_lonlat(self) -> list[list[float]]:
        """Top-left, top-right, bottom-right, bottom-left, as Mapbox image sources expect."""
        xmin, ymin, xmax, ymax = self.bounds
        pts = [(xmin, ymax), (xmax, ymax), (xmax, ymin), (xmin, ymin)]
        return [[round(c, 7) for c in _INV.transform(x, y)] for x, y in pts]

    def to_dict(self) -> dict:
        return {"x0": self.x0, "y1": self.y1, "res": self.res, "width": self.width, "height": self.height}

    @classmethod
    def from_dict(cls, d: dict) -> ImageGrid:
        return cls(**{k: d[k] for k in ("x0", "y1", "res", "width", "height")})


def to_3857(geom):
    """Shapely geometry from lon/lat to Web Mercator."""
    from shapely.ops import transform

    return transform(_FWD.transform, geom)
