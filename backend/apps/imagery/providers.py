"""Where yearly aerial imagery comes from.

- USDA NAIP (United States) through Microsoft Planetary Computer: a free STAC
  search API and cloud-optimised GeoTIFFs, read with an anonymous SAS token.
  Public domain. Usually 4 bands (red, green, blue, near-infrared).
- PDOK luchtfoto (Netherlands): yearly national orthophotos over WMS, RGB plus
  a colour-infrared (CIR) layer for the near-infrared band. Open data, CC BY 4.0.

Both return a YearScene resampled onto the job's ImageGrid, so the analysis
and the map overlay do not care which provider made it.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

import numpy as np
import requests

from .grid import ImageGrid

log = logging.getLogger(__name__)

TIMEOUT = 30
USER_AGENT = "SKYSCAN (urban LiDAR research tool)"


@dataclass
class YearInfo:
    year: int
    gsd_m: float | None
    dates: list[str]
    payload: object = None  # provider-specific (STAC items, WMS layer names)


@dataclass
class YearScene:
    year: int
    rgb: np.ndarray  # (3, h, w) uint8
    nir: np.ndarray | None  # (h, w) uint8, or None when the year has no near-infrared
    valid: np.ndarray  # (h, w) bool
    dates: list[str] = field(default_factory=list)
    gsd_m: float | None = None

    @property
    def coverage(self) -> float:
        return float(self.valid.mean()) if self.valid.size else 0.0


class ImageryError(RuntimeError):
    pass


class ImageryProvider:
    key = ""
    name = ""
    attribution = ""
    license = ""

    def years(self, bbox4326) -> dict[int, YearInfo]:
        raise NotImplementedError

    def read(self, info: YearInfo, grid: ImageGrid) -> YearScene:
        raise NotImplementedError

    def describe(self) -> dict:
        return {"key": self.key, "name": self.name, "attribution": self.attribution, "license": self.license}


# --- NAIP via Planetary Computer -------------------------------------------------

STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SAS_TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/naip"


class NaipProvider(ImageryProvider):
    key = "naip"
    name = "USDA NAIP"
    attribution = "Imagery: USDA NAIP via Microsoft Planetary Computer"
    license = "Public domain"

    _token: tuple[str, float] | None = None
    _lock = threading.Lock()

    def years(self, bbox4326) -> dict[int, YearInfo]:
        body = {"collections": ["naip"], "bbox": list(bbox4326), "limit": 250}
        r = requests.post(STAC_SEARCH, json=body, timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        out: dict[int, YearInfo] = {}
        for item in r.json().get("features", []):
            p = item.get("properties", {})
            try:
                year = int(p.get("naip:year") or p["datetime"][:4])
            except (KeyError, ValueError, TypeError):
                continue
            info = out.setdefault(year, YearInfo(year=year, gsd_m=p.get("gsd"), dates=[], payload=[]))
            info.payload.append(item)
            day = (p.get("datetime") or "")[:10]
            if day and day not in info.dates:
                info.dates.append(day)
            if p.get("gsd") is not None:
                info.gsd_m = min(info.gsd_m or p["gsd"], p["gsd"])
        for info in out.values():
            info.dates.sort()
        return out

    def _sas(self) -> str:
        with self._lock:
            if self._token and self._token[1] - time.time() > 120:
                return self._token[0]
            r = requests.get(SAS_TOKEN, timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})
            r.raise_for_status()
            d = r.json()
            try:
                exp = datetime.fromisoformat(d["msft:expiry"].replace("Z", "+00:00")).timestamp()
            except (KeyError, ValueError):
                exp = time.time() + 600
            NaipProvider._token = (d["token"], exp)
            return d["token"]

    def read(self, info: YearInfo, grid: ImageGrid) -> YearScene:
        import rasterio
        from rasterio.enums import Resampling
        from rasterio.vrt import WarpedVRT

        token = self._sas()
        bands = np.zeros((4, grid.height, grid.width), np.uint8)
        valid = np.zeros((grid.height, grid.width), bool)
        n_bands = 4
        env = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
               "GDAL_HTTP_TIMEOUT": str(TIMEOUT)}
        for item in info.payload:
            href = item["assets"]["image"]["href"]
            href = f"{href}{'&' if '?' in href else '?'}{token}"
            with rasterio.Env(**env), rasterio.open(href) as src:
                n_bands = min(n_bands, src.count)
                with WarpedVRT(src, crs="EPSG:3857", transform=grid.transform, width=grid.width, height=grid.height,
                               resampling=Resampling.bilinear, nodata=0) as vrt:
                    a = vrt.read(indexes=list(range(1, min(src.count, 4) + 1)))
            got = a[:3].max(axis=0) > 0
            fill = got & ~valid
            bands[: a.shape[0], fill] = a[:, fill]
            valid |= got
        nir = bands[3] if n_bands >= 4 else None
        return YearScene(year=info.year, rgb=bands[:3], nir=nir, valid=valid, dates=info.dates, gsd_m=info.gsd_m)


# --- PDOK luchtfoto (Netherlands) ------------------------------------------------

PDOK_RGB = "https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0"
PDOK_CIR = "https://service.pdok.nl/hwh/luchtfotocir/wms/v1_0"
PDOK_MAX_PX = 2500
_LAYER = re.compile(r"<Name>((\d{4})_(ortho25|orthoHR)(IR)?)</Name>")


class PdokProvider(ImageryProvider):
    key = "pdok"
    name = "PDOK luchtfoto"
    attribution = "Imagery: Beeldmateriaal Nederland via PDOK"
    license = "CC BY 4.0"

    _layers: tuple[dict, float] | None = None

    def _capabilities(self) -> dict[int, dict]:
        """{year: {"rgb": layer, "cir": layer}}, cached for a day."""
        if self._layers and time.time() - self._layers[1] < 86400:
            return self._layers[0]
        out: dict[int, dict] = {}
        for url, kind in ((PDOK_RGB, "rgb"), (PDOK_CIR, "cir")):
            r = requests.get(url, params={"service": "WMS", "request": "GetCapabilities"}, timeout=TIMEOUT,
                             headers={"User-Agent": USER_AGENT})
            r.raise_for_status()
            for name, year, quality, _ in _LAYER.findall(r.text):
                slot = out.setdefault(int(year), {})
                # Prefer the 25 cm product: the 8 cm one is heavier and not flown everywhere.
                if kind not in slot or quality == "ortho25":
                    slot[kind] = name
        PdokProvider._layers = (out, time.time())
        return out

    def years(self, bbox4326) -> dict[int, YearInfo]:
        return {
            y: YearInfo(year=y, gsd_m=0.25, dates=[str(y)], payload=layers)
            for y, layers in self._capabilities().items()
            if "rgb" in layers
        }

    @staticmethod
    def _getmap(url: str, layer: str, grid: ImageGrid) -> np.ndarray:
        from rasterio.io import MemoryFile

        if grid.width > PDOK_MAX_PX or grid.height > PDOK_MAX_PX:
            raise ImageryError("Area too large for one PDOK request.")
        xmin, ymin, xmax, ymax = grid.bounds
        params = {
            "service": "WMS", "version": "1.3.0", "request": "GetMap", "layers": layer, "styles": "",
            "crs": "EPSG:3857", "bbox": f"{xmin},{ymin},{xmax},{ymax}", "width": grid.width, "height": grid.height,
            "format": "image/png",
        }
        r = requests.get(url, params=params, timeout=TIMEOUT * 2, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        if not r.headers.get("Content-Type", "").startswith("image/"):
            raise ImageryError(f"PDOK returned {r.headers.get('Content-Type')} for {layer}")
        import warnings

        from rasterio.errors import NotGeoreferencedWarning

        # A plain PNG: placement comes from the request's bbox, not the file.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", NotGeoreferencedWarning)
            with MemoryFile(r.content) as mem, mem.open() as ds:
                return ds.read()

    def read(self, info: YearInfo, grid: ImageGrid) -> YearScene:
        layers = info.payload
        rgb = self._getmap(PDOK_RGB, layers["rgb"], grid)
        alpha = rgb[3] > 0 if rgb.shape[0] >= 4 else np.ones(rgb.shape[1:], bool)
        valid = alpha & (rgb[:3].max(axis=0) > 0)
        nir = None
        if "cir" in layers:
            try:
                cir = self._getmap(PDOK_CIR, layers["cir"], grid)
                nir = cir[0]  # CIR is false colour: near-infrared, red, green
            except (requests.RequestException, ImageryError) as exc:
                log.warning("PDOK CIR %s unavailable: %s", info.year, exc)
        return YearScene(year=info.year, rgb=rgb[:3].astype(np.uint8), nir=nir, valid=valid, dates=info.dates,
                         gsd_m=info.gsd_m)


PROVIDERS = {"usgs_3dep": NaipProvider, "ahn": PdokProvider}


def provider_for(lidar_provider: str | None) -> ImageryProvider | None:
    cls = PROVIDERS.get(lidar_provider or "")
    return cls() if cls else None


def nearest_year(years, target: int | None, max_gap: int = 2) -> int | None:
    if target is None or not years:
        return None
    best = min(years, key=lambda y: (abs(y - target), -y))
    return best if abs(best - target) <= max_gap else None


def now_year() -> int:
    return datetime.now(UTC).year
