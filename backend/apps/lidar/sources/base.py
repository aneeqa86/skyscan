"""LidarSource: the adapter interface every point cloud provider implements."""
from __future__ import annotations

from abc import ABC, abstractmethod

from django.contrib.gis.geos import Polygon


class LidarSource(ABC):
    provider: str = ""

    @abstractmethod
    def search(self, aoi: Polygon):
        """Return a queryset/list of Dataset rows whose coverage intersects the AOI (EPSG:4326)."""

    @abstractmethod
    def read(self, aoi: Polygon, dataset) -> dict | list[dict]:
        """Return the PDAL reader stage (a dict) that streams points for the AOI only.

        Tile-based sources may return a list of stages instead (several
        readers, a merge and a crop) that together produce the AOI's points."""

    def prepare(self, aoi: Polygon, dataset, progress=None) -> None:
        """Optional: fetch or cache anything read() needs (e.g. tile downloads).

        progress(message) may be called to report what is happening."""
        return None


_REGISTRY: dict[str, LidarSource] = {}


def register(source: LidarSource) -> LidarSource:
    _REGISTRY[source.provider] = source
    return source


def get_source(provider: str) -> LidarSource:
    try:
        return _REGISTRY[provider]
    except KeyError as exc:
        raise ValueError(f"No LiDAR adapter registered for provider '{provider}'") from exc
