"""Load the AHN sub-tile index and create one Dataset per AHN edition.

  python manage.py load_ahn_index              # download index, probe AHN5, create datasets
  python manage.py load_ahn_index --no-probe   # skip probing AHN5 availability

The GeoTiles sub-unit index (2023) flags AHN1-AHN4 per sub-tile. It predates
AHN5, so AHN5 availability is probed: one HEAD request per map sheet that has
AHN4 data, and a sheet counts as available when its first sub-tile is on the
mirror.
"""
import io
import json
import zipfile
from concurrent.futures import ThreadPoolExecutor

import geopandas as gpd
import requests
from django.contrib.gis.geos import GEOSGeometry, MultiPolygon
from django.core.management.base import BaseCommand
from shapely import union_all
from shapely.geometry import box, mapping
from shapely.ops import transform as shp_transform

from apps.cities.models import Dataset
from apps.lidar.sources import ahn

ORIGINAL_EDITIONS = ("AHN2", "AHN3", "AHN4")


class Command(BaseCommand):
    help = "Download the AHN sub-tile index and create Dataset rows for AHN2-AHN5."

    def add_arguments(self, parser):
        parser.add_argument("--no-probe", action="store_true", help="Do not probe AHN5 availability")

    def handle(self, *args, **o):
        self.stdout.write(f"Downloading {ahn.INDEX_URL}")
        r = requests.get(ahn.INDEX_URL, timeout=300, headers={"User-Agent": ahn.USER_AGENT})
        r.raise_for_status()
        z = zipfile.ZipFile(io.BytesIO(r.content))
        shp = next(n for n in z.namelist() if n.endswith(".shp"))
        tmp = ahn.cache_dir() / "index_src"
        tmp.mkdir(parents=True, exist_ok=True)
        z.extractall(tmp)
        gdf = gpd.read_file(tmp / shp)
        self.stdout.write(f"{len(gdf):,} sub-tiles in the index")

        tiles = []
        for row in gdf.itertuples(index=False):
            xmin, ymin, xmax, ymax = row.geometry.bounds
            flags = {e: bool(getattr(row, e)) for e in ORIGINAL_EDITIONS}
            tiles.append([row.GT_AHNSUB, round(xmin, 3), round(ymin, 3), round(xmax, 3), round(ymax, 3), flags, row.GT_AHN])

        if not o["no_probe"]:
            sheets = {}
            for t in tiles:
                if t[5]["AHN4"]:
                    sheets.setdefault(t[6], t[0])  # first AHN4 sub-tile of each sheet
            self.stdout.write(f"Probing AHN5 on {len(sheets):,} map sheets")
            with ThreadPoolExecutor(max_workers=16) as pool:
                found = dict(zip(sheets, pool.map(lambda c: ahn.tile_exists_remote("AHN5", c), sheets.values()), strict=False))
            for t in tiles:
                t[5]["AHN5"] = bool(found.get(t[6])) and t[5]["AHN4"]
            self.stdout.write(f"AHN5 available on {sum(found.values()):,} sheets")

        ahn.index_path().parent.mkdir(parents=True, exist_ok=True)
        ahn.index_path().write_text(json.dumps({"tiles": [t[:6] for t in tiles], "source": ahn.INDEX_URL}))
        ahn.load_index.cache_clear()
        ahn._by_code.cache_clear()

        to_wgs = ahn.Transformer.from_crs(ahn.RD_EPSG, 4326, always_xy=True)
        for edition, meta in ahn.EDITIONS.items():
            boxes = [box(t[1], t[2], t[3], t[4]) for t in tiles if t[5].get(edition)]
            if not boxes:
                self.stdout.write(f"{edition}: no tiles, skipped")
                continue
            cov_rd = union_all(boxes).simplify(50)
            cov = shp_transform(to_wgs.transform, cov_rd)
            geom = GEOSGeometry(json.dumps(mapping(cov)), srid=4326)
            if geom.geom_type == "Polygon":
                geom = MultiPolygon(geom, srid=4326)
            simplified = geom.simplify(0.002, preserve_topology=True)
            if simplified.geom_type == "Polygon":
                simplified = MultiPolygon(simplified, srid=4326)
            Dataset.objects.update_or_create(
                name=f"{edition} ({meta['window']})",
                defaults=dict(
                    provider=ahn.PROVIDER,
                    country="Netherlands",
                    acquisition_year=meta["year"],
                    point_density_ppm2=meta["density"],
                    crs=f"EPSG:{ahn.RD_EPSG}",
                    access_type=Dataset.AccessType.TILES,
                    source_url=f"{ahn.BASE_URL}/{edition}_T/",
                    license=ahn.LICENSE,
                    attribution=ahn.ATTRIBUTION,
                    coverage_polygon=geom,
                    coverage_simplified=simplified,
                    has_building_class=edition != "AHN2",
                ),
            )
            self.stdout.write(self.style.SUCCESS(f"{edition}: {len(boxes):,} sub-tiles"))
