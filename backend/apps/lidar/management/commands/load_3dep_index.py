"""Load the USGS 3DEP EPT project index into Dataset rows.

Source: resources.geojson in the hobuinc/usgs-lidar repository, one feature per
EPT project with its name, point count, ept.json URL and boundary.
"""
import json
from pathlib import Path

import requests
from django.conf import settings
from django.contrib.gis.geos import GEOSGeometry, MultiPolygon
from django.core.management.base import BaseCommand
from django.db import transaction
from pyproj import Geod

from apps.cities.models import Dataset
from apps.lidar.sources import usgs

# Projects whose names carry no year. Values were checked against the GPS time
# of sampled points (see docs/DATA_SOURCES.md); unknown ones stay None and are
# then excluded from Change mode.
YEAR_OVERRIDES: dict[str, int] = {
    # Median GPS time of points sampled in Midtown Manhattan: 2014-03-27
    # (post-Hurricane Sandy collection). Checked 2026-11-15.
    "NY_NewYorkCity": 2014,
}

_GEOD = Geod(ellps="WGS84")


def geodesic_area_m2(geom) -> float:
    from shapely import wkb

    shp = wkb.loads(bytes(geom.wkb))
    area, _ = _GEOD.geometry_area_perimeter(shp)
    return abs(area)


def to_multipolygon(geojson_geom) -> MultiPolygon:
    geom = GEOSGeometry(json.dumps(geojson_geom), srid=4326)
    if not geom.valid:
        geom = geom.buffer(0)
    if geom.geom_type == "Polygon":
        geom = MultiPolygon(geom, srid=4326)
    return geom


class Command(BaseCommand):
    help = "Load (or refresh) the USGS 3DEP EPT project index into Dataset rows."

    def add_arguments(self, parser):
        parser.add_argument("--file", help="Use a local resources.geojson instead of downloading it")

    def handle(self, *args, **opts):
        if opts.get("file"):
            data = json.loads(Path(opts["file"]).read_text())
        else:
            self.stdout.write(f"Downloading {settings.USGS_INDEX_URL}")
            resp = requests.get(settings.USGS_INDEX_URL, timeout=120)
            resp.raise_for_status()
            data = resp.json()

        features = data["features"]
        created = updated = 0
        with transaction.atomic():
            for feat in features:
                props = feat["properties"]
                name = props["name"]
                coverage = to_multipolygon(feat["geometry"])
                area = geodesic_area_m2(coverage)
                count = props.get("count")
                density = round(count / area, 2) if count and area > 0 else None
                simplified = coverage.simplify(0.002, preserve_topology=True)
                if simplified.geom_type == "Polygon":
                    simplified = MultiPolygon(simplified, srid=4326)
                year = YEAR_OVERRIDES.get(name) or usgs.parse_year(name)
                _, was_created = Dataset.objects.update_or_create(
                    name=name,
                    defaults=dict(
                        provider=usgs.PROVIDER,
                        country="United States",
                        acquisition_year=year,
                        point_count=count,
                        point_density_ppm2=density,
                        crs=usgs.EPT_SRS,
                        access_type=Dataset.AccessType.EPT,
                        source_url=props.get("url") or usgs.ept_url(name),
                        license=usgs.LICENSE,
                        attribution=usgs.ATTRIBUTION,
                        coverage_polygon=coverage,
                        coverage_simplified=simplified,
                    ),
                )
                created += was_created
                updated += not was_created

        self.stdout.write(
            self.style.SUCCESS(f"3DEP index: {created} created, {updated} updated ({len(features)} projects)")
        )
