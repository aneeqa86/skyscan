"""Local LAS/LAZ files: test fixtures and tile caches (e.g. the AHN adapter)."""
from __future__ import annotations

from urllib.parse import urlparse

from django.contrib.gis.geos import Polygon

from .base import LidarSource, register

PROVIDER = "local_las"


def path_of(url: str) -> str:
    p = urlparse(url)
    return p.path if p.scheme == "file" else url


class LocalLasSource(LidarSource):
    provider = PROVIDER

    def search(self, aoi: Polygon):
        from apps.cities.models import Dataset

        return Dataset.objects.filter(provider=PROVIDER, is_active=True, coverage_polygon__intersects=aoi)

    def read(self, aoi: Polygon, dataset) -> dict:
        # readers.las has no spatial filter; points outside the job grid are
        # ignored when they are gridded.
        return {"type": "readers.las", "filename": path_of(dataset.source_url)}


register(LocalLasSource())
