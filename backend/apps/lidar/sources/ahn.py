"""Netherlands AHN adapter: LAZ sub-tiles from the GeoTiles mirror, cached locally.

AHN (Actueel Hoogtebestand Nederland) has repeat national surveys. PDOK now
publishes only DSM/DTM rasters, so point clouds come from GeoTiles (TU Delft),
which serves every edition cut into 1 x 1.25 km sub-tiles in RD New
(EPSG:28992), each with 25 m overlap:

  https://geotiles.citg.tudelft.nl/AHN4_T/25BZ1_01.LAZ

Sub-tiles are 50-520 MB, and plain LAZ cannot be range-read over HTTP, so each
tile is downloaded once into SKYSCAN_CACHE_DIR/ahn/ and reused by later jobs.
The tile index (which sub-tiles exist where, per edition) is the GeoTiles
sub-unit sheet index published at fwrite.org/kaartbladen.
"""
from __future__ import annotations

import fcntl
import functools
import json
import logging
import os
from contextlib import contextmanager
from pathlib import Path

import requests
from django.conf import settings
from django.contrib.gis.geos import Polygon
from pyproj import Transformer

from .base import LidarSource, register

log = logging.getLogger(__name__)

PROVIDER = "ahn"
RD_EPSG = 28992
BASE_URL = "https://geotiles.citg.tudelft.nl"
INDEX_URL = "https://static.fwrite.org/2023/01/AHN_subunits_GeoTiles.zip"
LICENSE = "CC0 1.0 (public domain)"
ATTRIBUTION = "Actueel Hoogtebestand Nederland (AHN), via GeoTiles (TU Delft)"
USER_AGENT = "skyscan/0.1 (LiDAR building measurement)"

# Year: a nominal mid-point of each national campaign (acquisition varies by
# region within the window). Density: measured on sub-tile 25BZ1_01 (Amsterdam).
EDITIONS = {
    "AHN2": {"year": 2010, "window": "2007-2012", "density": 11.0},
    "AHN3": {"year": 2017, "window": "2014-2019", "density": 19.0},
    "AHN4": {"year": 2021, "window": "2020-2022", "density": 42.0},
    "AHN5": {"year": 2024, "window": "2023-2025", "density": 29.0},
}


def cache_dir() -> Path:
    return Path(settings.SKYSCAN_CACHE_DIR) / "ahn"


def index_path() -> Path:
    return cache_dir() / "subtiles.json"


@functools.lru_cache(maxsize=1)
def load_index() -> dict:
    """{'tiles': [[code, xmin, ymin, xmax, ymax, {edition: bool}], ...]} in RD New."""
    p = index_path()
    if not p.exists():
        raise RuntimeError("The AHN tile index is missing. Run: python manage.py load_ahn_index")
    return json.loads(p.read_text())


@functools.lru_cache(maxsize=1)
def _by_code() -> dict:
    return {t[0]: t for t in load_index()["tiles"]}


def tile_url(edition: str, code: str) -> str:
    return f"{BASE_URL}/{edition}_T/{code}.LAZ"


def tile_path(edition: str, code: str) -> Path:
    return cache_dir() / f"{edition}_T" / f"{code}.LAZ"


def tiles_for(bounds_rd: tuple[float, float, float, float], edition: str, index: dict | None = None) -> list[str]:
    """Codes of the sub-tiles of an edition that intersect RD New bounds."""
    index = index or load_index()
    w, s, e, n = bounds_rd
    return [
        t[0]
        for t in index["tiles"]
        if t[5].get(edition) and t[1] < e and t[3] > w and t[2] < n and t[4] > s
    ]


def aoi_bounds_rd(aoi: Polygon) -> tuple[float, float, float, float]:
    tr = Transformer.from_crs(4326, RD_EPSG, always_xy=True)
    xs, ys = zip(*(tr.transform(x, y) for x, y in aoi.coords[0]), strict=False)
    return min(xs), min(ys), max(xs), max(ys)


@contextmanager
def _locked(path: Path):
    """Exclusive lock beside a tile so two jobs never download it at once."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(str(path) + ".lock", "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def ensure_tile(edition: str, code: str, progress=None) -> Path:
    """Download a sub-tile into the cache unless it is already there."""
    path = tile_path(edition, code)
    if path.exists():
        return path
    with _locked(path):
        if path.exists():  # another job finished it while we waited
            return path
        url = tile_url(edition, code)
        tmp = path.with_suffix(".part")
        with requests.get(url, stream=True, timeout=60, headers={"User-Agent": USER_AGENT}) as r:
            if r.status_code == 404:
                raise FileNotFoundError(f"{edition} has no tile {code}")
            r.raise_for_status()
            total = int(r.headers.get("Content-Length") or 0)
            done, last = 0, -1
            with open(tmp, "wb") as fh:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    fh.write(chunk)
                    done += len(chunk)
                    pct = int(done * 100 / total) if total else 0
                    if progress and pct // 10 != last:
                        last = pct // 10
                        progress(f"Downloading {edition} tile {code}: {done / 1e6:.0f} of {total / 1e6:.0f} MB")
            if total and done != total:
                tmp.unlink(missing_ok=True)
                raise OSError(f"Incomplete download of {url}")
        os.replace(tmp, path)  # atomic: readers never see a partial tile
    return path


def tile_exists_remote(edition: str, code: str) -> bool:
    try:
        r = requests.head(tile_url(edition, code), timeout=30, headers={"User-Agent": USER_AGENT})
        return r.status_code == 200
    except requests.RequestException:
        return False


class AhnTileSource(LidarSource):
    provider = PROVIDER

    def search(self, aoi: Polygon):
        from apps.cities.models import Dataset

        return Dataset.objects.filter(provider=PROVIDER, is_active=True, coverage_polygon__intersects=aoi)

    def _edition(self, dataset) -> str:
        return dataset.name.split()[0]  # Dataset names start with the edition, e.g. "AHN4 (2020-2022)"

    def _codes(self, aoi: Polygon, dataset) -> tuple[str, list[str]]:
        edition = self._edition(dataset)
        codes = tiles_for(aoi_bounds_rd(aoi), edition)
        if not codes:
            raise FileNotFoundError(f"{edition} has no tiles for this area.")
        return edition, codes

    @staticmethod
    def _core(code: str) -> tuple[float, float, float, float]:
        t = _by_code()[code]
        return t[1], t[2], t[3], t[4]

    def prepare(self, aoi: Polygon, dataset, progress=None) -> None:
        edition, codes = self._codes(aoi, dataset)
        missing = []
        for i, code in enumerate(codes, 1):
            if progress and not tile_path(edition, code).exists():
                progress(f"Downloading {edition} tile {i} of {len(codes)} ({code})")
            try:
                ensure_tile(edition, code, progress)
            except FileNotFoundError:
                # The index can list a tile the mirror does not have (AHN5
                # availability is probed per map sheet); read() skips it.
                missing.append(code)
        if len(missing) == len(codes):
            raise FileNotFoundError(f"{edition} has no point cloud tiles for this area yet.")

    def read(self, aoi: Polygon, dataset) -> list[dict]:
        edition, codes = self._codes(aoi, dataset)
        w, s, e, n = aoi_bounds_rd(aoi)
        # Sub-tiles overlap their neighbours by 25 m. Crop each tile to its own
        # core cell (intersected with the area) before merging, so no point is
        # read twice where tiles meet.
        stages = []
        crops = []
        for i, c in enumerate(codes):
            if not tile_path(edition, c).exists():
                continue  # not on the mirror (see prepare)
            cx0, cy0, cx1, cy1 = self._core(c)
            x0, y0, x1, y1 = max(w, cx0), max(s, cy0), min(e, cx1), min(n, cy1)
            if x0 >= x1 or y0 >= y1:
                continue
            stages.append({
                "type": "readers.las", "filename": str(tile_path(edition, c)),
                "override_srs": f"EPSG:{RD_EPSG}", "tag": f"r{i}",
            })
            # Half-open on the far edges so a point on a shared border is kept once.
            stages.append({
                "type": "filters.crop", "inputs": [f"r{i}"], "tag": f"c{i}",
                "bounds": f"([{x0}, {x1 - 1e-6}], [{y0}, {y1 - 1e-6}])",
            })
            crops.append(f"c{i}")
        if not crops:
            raise FileNotFoundError(f"{edition} has no point cloud tiles for this area yet.")
        if len(crops) > 1:
            stages.append({"type": "filters.merge", "inputs": crops})
        return stages


register(AhnTileSource())
