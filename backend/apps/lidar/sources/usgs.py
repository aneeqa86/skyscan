"""USGS 3DEP adapter: streams Entwine Point Tiles from the usgs-lidar-public bucket."""
from __future__ import annotations

import re

from django.conf import settings
from django.contrib.gis.geos import Polygon

from .base import LidarSource, register

PROVIDER = "usgs_3dep"
LICENSE = "Public domain (U.S. Government work)"
ATTRIBUTION = "USGS 3D Elevation Program (3DEP), via the AWS Open Data usgs-lidar-public bucket"
EPT_SRS = "EPSG:3857"

_FULL_YEAR = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
# Work-unit suffixes such as NY_Hudson_1_D22 -> 2022.
_SHORT_YEAR = re.compile(r"_[A-Z](\d{2})(?:_|$)")
_LAS_DELIVERY = re.compile(r"_LAS_(?:19|20)\d{2}$")


def parse_year(name: str) -> int | None:
    """Acquisition year from a 3DEP project name; None when the name has none.

    'USGS_LPC_TX_Central_B1_2017_LAS_2019' ends with the year the LAS files
    were delivered, not flown, so that suffix is ignored. If a name still holds
    several years (e.g. 'CA_X_2018_2019'), the last one wins because it is the
    end of the collection window.
    """
    name = _LAS_DELIVERY.sub("", name)
    full = _FULL_YEAR.findall(name)
    if full:
        return int(full[-1])
    short = _SHORT_YEAR.search(name)
    if short:
        return 2000 + int(short.group(1))
    return None


class UsgsEptSource(LidarSource):
    provider = PROVIDER

    def search(self, aoi: Polygon):
        from apps.cities.models import Dataset

        return Dataset.objects.filter(
            provider=PROVIDER, is_active=True, coverage_polygon__intersects=aoi
        ).order_by("-acquisition_year", "-point_density_ppm2")

    def read(self, aoi: Polygon, dataset) -> dict:
        # EPT is stored in Web Mercator; crop with the AOI bounds in that CRS so
        # PDAL only fetches the octree nodes it needs (streaming, no full download).
        merc = aoi.transform(3857, clone=True)
        xmin, ymin, xmax, ymax = merc.extent
        return {
            "type": "readers.ept",
            "filename": dataset.source_url,
            "bounds": f"([{xmin}, {xmax}], [{ymin}, {ymax}])",
            "polygon": merc.wkt + " / EPSG:3857",
            "threads": 8,
        }


def ept_url(project_name: str) -> str:
    return f"{settings.USGS_EPT_BASE_URL.rstrip('/')}/{project_name}/ept.json"


register(UsgsEptSource())
