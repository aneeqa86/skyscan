"""Imagery checks on synthetic scenes: corroboration, timing, vegetation (no network)."""
from unittest import mock

import numpy as np
from django.test import SimpleTestCase
from shapely.geometry import box

from apps.imagery import providers
from apps.imagery.analysis import (
    corroborate,
    rasterize,
    reference_years,
    standardize,
    to_rgb_jpeg,
    vegetation_flags,
    vegetation_threshold,
)
from apps.imagery.grid import ImageGrid
from apps.imagery.providers import NaipProvider, PdokProvider, YearScene, nearest_year

# 100 m x 100 m of Web Mercator at 0.5 m pixels, near the equator so metres ~ units.
GRID = ImageGrid(x0=0.0, y1=100.0, res=0.5, width=200, height=200)
RNG = np.random.default_rng(7)

ROOF = (120, 118, 115, 90)  # grey roof: R, G, B, NIR
GRASS = (70, 110, 60, 200)  # bright in near-infrared
SOIL = (150, 125, 95, 120)  # bare construction site
ASPHALT = (60, 60, 62, 55)


def px(x0, y0, x1, y1):
    """Pixel slice for a box in grid units (y up)."""
    return slice(int((100 - y1) / 0.5), int((100 - y0) / 0.5)), slice(int(x0 / 0.5), int(x1 / 0.5))


CONTROLS = [box(5 + 15 * i, 5, 15 + 15 * i, 15) for i in range(6)] + [box(5 + 15 * i, 80, 15 + 15 * i, 92) for i in range(6)]
NEW = box(20, 35, 40, 55)  # grass to 2015, a construction site in 2017, a roof from 2019
SAME = box(55, 35, 75, 55)  # a roof every year: raised in LiDAR, invisible from above
TREE = box(82, 40, 94, 52)  # LiDAR "new building" that is actually a tree


def scene(year: int, tone: float = 0.0) -> YearScene:
    """Asphalt background, roofs on the controls, NEW evolving, a tree. tone shifts colour balance per year.

    Unchanged control roofs still look a little different every year (shadows, lean,
    re-roofing), as in real imagery; that variation is what a change is ranked against."""
    img = np.empty((4, 200, 200), np.float32)
    img[:] = np.array(ASPHALT, np.float32)[:, None, None]
    for i, c in enumerate(CONTROLS):
        jitter = np.random.default_rng(year * 100 + i).normal(0, 10, 4)
        img[(slice(None), *px(*c.bounds))] = (np.array(ROOF, np.float32) + jitter)[:, None, None]
    new_state = GRASS if year < 2017 else SOIL if year < 2019 else ROOF
    img[(slice(None), *px(*NEW.bounds))] = np.array(new_state, np.float32)[:, None, None]
    img[(slice(None), *px(*SAME.bounds))] = np.array(ROOF, np.float32)[:, None, None]
    img[(slice(None), *px(*TREE.bounds))] = np.array(GRASS, np.float32)[:, None, None]
    img = img * (1 + tone) + RNG.normal(0, 4, img.shape)
    img = np.clip(img, 1, 255).astype(np.uint8)
    return YearScene(year=year, rgb=img[:3], nir=img[3], valid=np.ones((200, 200), bool))


class GridTests(SimpleTestCase):
    def test_for_bbox_corners_and_resolution(self):
        g = ImageGrid.for_bbox((-105.0065, 39.75, -104.9955, 39.7585), target_m=0.5, margin_m=0)
        self.assertAlmostEqual(g.ground_res_m, 0.5, places=2)
        tl, tr, br, bl = g.corners_lonlat()
        self.assertAlmostEqual(tl[0], -105.0065, places=4)
        self.assertAlmostEqual(tl[1], 39.7585, places=4)
        self.assertAlmostEqual(br[0], -104.9955, places=4)
        self.assertEqual(tl[0], bl[0])
        self.assertEqual(ImageGrid.from_dict(g.to_dict()), g)

    def test_pixel_cap(self):
        g = ImageGrid.for_bbox((0, 0, 0.1, 0.1), target_m=0.5, max_px=1000)
        self.assertLessEqual(max(g.width, g.height), 1001)


class YearTests(SimpleTestCase):
    def test_reference_years_bracket_the_surveys(self):
        ys = [2011, 2013, 2015, 2017, 2019, 2021, 2023]
        self.assertEqual(reference_years(ys, 2013, 2020), (2013, 2021))
        self.assertEqual(reference_years(ys, 2014, 2019), (2013, 2019))
        self.assertEqual(reference_years([2016, 2018], 2015, 2017), (2016, 2018))  # one year of slack
        self.assertEqual(reference_years([2019], 2013, 2020), (None, None))

    def test_nearest_year(self):
        self.assertEqual(nearest_year([2013, 2015], 2014), 2015)
        self.assertIsNone(nearest_year([2010], 2014))


class CorroborationTests(SimpleTestCase):
    def run_case(self, years=(2013, 2015, 2017, 2019, 2021)):
        tones = {2013: 0.0, 2015: 0.08, 2017: -0.06, 2019: 0.05, 2021: -0.04}
        std = {y: standardize(scene(y, tones[y])) for y in years}
        changes = [NEW, SAME, TREE]
        res, summary = corroborate(
            std, GRID, rasterize(changes, GRID), ["new", "raised", "new"], [18.0, 12.0, 12.0],
            rasterize(CONTROLS, GRID), [10.0] * len(CONTROLS), 2013, 2020,
        )
        return res, summary

    def test_new_building_is_confirmed_and_dated(self):
        res, summary = self.run_case()
        self.assertEqual(summary["reference_years"], [2013, 2021])
        self.assertEqual(summary["controls"], len(CONTROLS))
        new = res[0]
        self.assertEqual(new.status, "confirmed")
        self.assertEqual(new.score, 1.0)  # changed more than every unchanged roof
        self.assertEqual(new.first_year, 2017)  # the construction site already counts
        self.assertEqual(new.window_start, 2015)

    def test_too_few_controls(self):
        std = {y: standardize(scene(y)) for y in (2013, 2021)}
        res, summary = corroborate(std, GRID, rasterize([NEW], GRID), ["new"], [18.0], rasterize(CONTROLS[:3], GRID),
                                   [10.0] * 3, 2013, 2020)
        self.assertEqual(res[0].status, "no_imagery")
        self.assertIn("Too few", summary["reason"])

    def test_height_only_change_is_not_visible(self):
        res, _ = self.run_case()
        self.assertEqual(res[1].status, "not_visible")

    def test_tree_is_flagged_as_vegetation(self):
        res, _ = self.run_case()
        self.assertEqual(res[2].status, "vegetation")

    def test_no_bracketing_years(self):
        res, summary = self.run_case(years=(2019, 2021))
        self.assertTrue(all(r.status == "no_imagery" for r in res))
        self.assertIsNone(summary["reference_years"])

    def test_rgb_only_years_still_compare(self):
        tones = {2013: 0.0, 2021: 0.05}
        std = {}
        for y in (2013, 2021):
            s = scene(y, tones[y])
            s.nir = None
            std[y] = standardize(s)
        res, _ = corroborate(std, GRID, rasterize([NEW], GRID), ["new"], [18.0], rasterize(CONTROLS, GRID),
                             [10.0] * len(CONTROLS), 2013, 2020)
        self.assertEqual(res[0].status, "confirmed")


class VegetationTests(SimpleTestCase):
    def test_flags_trees_not_roofs_or_tall_things(self):
        std = standardize(scene(2013))  # NEW is still grass in 2013
        polys = [TREE, SAME, NEW]
        flags, ndvi = vegetation_flags(std, rasterize(polys, GRID), [12.0, 12.0, 45.0])
        self.assertEqual(flags.tolist(), [True, False, False])
        self.assertGreater(ndvi[0], ndvi[1])

    def test_threshold_has_a_floor_in_all_urban_scenes(self):
        urban = RNG.normal(-0.15, 0.03, 10000)
        self.assertGreaterEqual(vegetation_threshold(urban), np.median(urban) + 0.1 - 1e-9)

    def test_threshold_sits_between_roofs_and_lawns(self):
        # Like Denver 2021: roofs near -0.16, white roofs near 0, lawns near 0.5.
        ndvi = np.concatenate([RNG.normal(-0.16, 0.08, 9000), RNG.normal(0.0, 0.02, 500), RNG.normal(0.5, 0.05, 500)])
        thr = vegetation_threshold(ndvi)
        self.assertGreater(thr, 0.05)
        self.assertLess(thr, 0.4)

    def test_jpeg(self):
        data = to_rgb_jpeg(scene(2013))
        self.assertEqual(data[:2], b"\xff\xd8")


class FakeResponse:
    def __init__(self, payload=None, text=""):
        self._payload, self.text = payload, text

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class ProviderTests(SimpleTestCase):
    def test_naip_groups_items_by_year(self):
        feats = [
            {"properties": {"naip:year": "2019", "datetime": "2019-08-03T16:00:00Z", "gsd": 0.6}, "assets": {}},
            {"properties": {"naip:year": "2019", "datetime": "2019-08-05T16:00:00Z", "gsd": 0.6}, "assets": {}},
            {"properties": {"naip:year": "2013", "datetime": "2013-07-16T16:00:00Z", "gsd": 1.0}, "assets": {}},
        ]
        with mock.patch.object(providers.requests, "post", return_value=FakeResponse({"features": feats})):
            years = NaipProvider().years((0, 0, 1, 1))
        self.assertEqual(sorted(years), [2013, 2019])
        self.assertEqual(len(years[2019].payload), 2)
        self.assertEqual(years[2019].dates, ["2019-08-03", "2019-08-05"])
        self.assertEqual(years[2013].gsd_m, 1.0)

    def test_pdok_prefers_25cm_and_pairs_cir(self):
        rgb = "<Name>2021_orthoHR</Name><Name>2020_ortho25</Name><Name>2020_orthoHR</Name><Name>Actueel_ortho25</Name>"
        cir = "<Name>2020_ortho25IR</Name>"
        PdokProvider._layers = None
        with mock.patch.object(providers.requests, "get",
                               side_effect=[FakeResponse(text=rgb), FakeResponse(text=cir)]):
            years = PdokProvider().years((4.8, 52.3, 4.9, 52.4))
        PdokProvider._layers = None
        self.assertEqual(years[2020].payload, {"rgb": "2020_ortho25", "cir": "2020_ortho25IR"})
        self.assertEqual(years[2021].payload, {"rgb": "2021_orthoHR"})

    def test_provider_for(self):
        self.assertIsInstance(providers.provider_for("usgs_3dep"), NaipProvider)
        self.assertIsInstance(providers.provider_for("ahn"), PdokProvider)
        self.assertIsNone(providers.provider_for("local_las"))
