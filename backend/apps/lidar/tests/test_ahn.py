"""AHN adapter: tile selection, per-tile cropping and the download cache (no network)."""
import json
import shutil
import tempfile
from pathlib import Path
from unittest import mock

from django.contrib.gis.geos import Polygon
from django.test import SimpleTestCase, override_settings

from apps.lidar.sources import ahn

# Two neighbouring 1 x 1.25 km sub-tiles in Amsterdam, plus one far away.
INDEX = {
    "tiles": [
        ["25DN2_20", 119000.0, 482500.0, 120000.0, 483750.0, {"AHN3": True, "AHN5": True}],
        ["25GN1_16", 120000.0, 482500.0, 121000.0, 483750.0, {"AHN3": True, "AHN5": False}],
        ["01AZ1_01", 10000.0, 600000.0, 11000.0, 601250.0, {"AHN3": True, "AHN5": True}],
    ]
}


class Dataset:
    def __init__(self, name):
        self.name = name


class AhnTests(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.override = override_settings(SKYSCAN_CACHE_DIR=self.tmp)
        self.override.enable()
        ahn.index_path().parent.mkdir(parents=True, exist_ok=True)
        ahn.index_path().write_text(json.dumps(INDEX))
        ahn.load_index.cache_clear()
        ahn._by_code.cache_clear()

    def tearDown(self):
        self.override.disable()
        ahn.load_index.cache_clear()
        ahn._by_code.cache_clear()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_tiles_for_bounds_and_edition(self):
        across = (119500.0, 483000.0, 120500.0, 483500.0)  # straddles both Amsterdam tiles
        self.assertEqual(ahn.tiles_for(across, "AHN3"), ["25DN2_20", "25GN1_16"])
        self.assertEqual(ahn.tiles_for(across, "AHN5"), ["25DN2_20"])  # 25GN1_16 has no AHN5
        self.assertEqual(ahn.tiles_for((0, 0, 1, 1), "AHN3"), [])

    def test_read_crops_each_tile_to_its_core_and_merges(self):
        for code in ("25DN2_20", "25GN1_16"):
            p = ahn.tile_path("AHN3", code)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b"laz")
        # An AOI around the shared border at x = 120000 (RD New).
        aoi = Polygon.from_bbox((4.8720, 52.3350, 4.8755, 52.3370))
        aoi.srid = 4326
        stages = ahn.AhnTileSource().read(aoi, Dataset("AHN3 (2014-2019)"))
        readers = [s for s in stages if s["type"] == "readers.las"]
        crops = [s for s in stages if s["type"] == "filters.crop"]
        self.assertEqual(len(readers), 2)
        self.assertTrue(all(r["override_srs"] == "EPSG:28992" for r in readers))
        self.assertEqual(stages[-1], {"type": "filters.merge", "inputs": ["c0", "c1"]})
        # Crops meet at the tile border and do not overlap (no doubled points).
        west, east = sorted(crops, key=lambda c: c["bounds"])
        self.assertIn("119999.999999", west["bounds"].replace(" ", ""))
        self.assertIn("[120000.0,", east["bounds"].replace(" ", ""))

    def test_read_skips_tiles_missing_on_the_mirror(self):
        p = ahn.tile_path("AHN3", "25DN2_20")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"laz")
        aoi = Polygon.from_bbox((4.8720, 52.3350, 4.8755, 52.3370))
        aoi.srid = 4326
        stages = ahn.AhnTileSource().read(aoi, Dataset("AHN3 (2014-2019)"))
        self.assertEqual(len([s for s in stages if s["type"] == "readers.las"]), 1)
        self.assertNotIn("filters.merge", [s["type"] for s in stages])

    def test_ensure_tile_downloads_once_and_reports_progress(self):
        body = b"x" * (3 << 20)
        resp = mock.MagicMock(status_code=200, headers={"Content-Length": str(len(body))})
        resp.iter_content.return_value = [body[i : i + (1 << 20)] for i in range(0, len(body), 1 << 20)]
        resp.__enter__.return_value = resp
        messages = []
        with mock.patch("apps.lidar.sources.ahn.requests.get", return_value=resp) as get:
            path = ahn.ensure_tile("AHN5", "25DN2_20", messages.append)
            again = ahn.ensure_tile("AHN5", "25DN2_20", messages.append)
        self.assertEqual(get.call_count, 1)  # second call served from the cache
        self.assertEqual(path, again)
        self.assertEqual(path.read_bytes(), body)
        self.assertFalse(path.with_suffix(".part").exists())
        self.assertTrue(any("Downloading AHN5 tile 25DN2_20" in m for m in messages))

    def test_incomplete_download_is_discarded(self):
        resp = mock.MagicMock(status_code=200, headers={"Content-Length": "1000"})
        resp.iter_content.return_value = [b"short"]
        resp.__enter__.return_value = resp
        with mock.patch("apps.lidar.sources.ahn.requests.get", return_value=resp):
            with self.assertRaises(OSError):
                ahn.ensure_tile("AHN5", "25DN2_20")
        self.assertFalse(ahn.tile_path("AHN5", "25DN2_20").exists())

    def test_missing_tile_raises_not_found(self):
        resp = mock.MagicMock(status_code=404, headers={})
        resp.__enter__.return_value = resp
        with mock.patch("apps.lidar.sources.ahn.requests.get", return_value=resp):
            with self.assertRaises(FileNotFoundError):
                ahn.ensure_tile("AHN5", "25GN1_16")

    def test_index_missing_message(self):
        Path(ahn.index_path()).unlink()
        ahn.load_index.cache_clear()
        with self.assertRaisesRegex(RuntimeError, "load_ahn_index"):
            ahn.load_index()
