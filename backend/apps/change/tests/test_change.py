"""Change detection on synthetic before/after rasters: one case per change type."""
import numpy as np
from django.test import SimpleTestCase

from apps.lidar.pipeline.change import (
    DEMOLISHED,
    EXTENDED,
    LOWERED,
    NEW,
    RAISED,
    REDUCED,
    change_stats,
    classify_changes,
    default_pair,
    survey_pairs,
    vertical_offset,
)
from apps.lidar.pipeline.measure import EpochResult
from apps.lidar.pipeline.raster import Grid, Surfaces
from apps.lidar.pipeline.vectorize import label_mask

N = 100  # 50 m x 50 m at 0.5 m
GRID = Grid(x0=500000.0, y0=4500050.0, res=0.5, nx=N, ny=N, epsg=32618)


def epoch(ndsm: np.ndarray, veg: np.ndarray | None = None) -> EpochResult:
    mask = ndsm >= 2.5
    if veg is None:
        veg = np.zeros_like(ndsm)
    else:
        mask &= veg < 0.42
    labels, _ = label_mask(mask)
    z = np.zeros_like(ndsm)
    s = Surfaces(
        grid=GRID,
        dsm=ndsm + 10,
        dtm=np.full_like(ndsm, 10.0),
        ndsm=ndsm,
        count=np.full_like(ndsm, 4.0),
        ground=ndsm < 0.5,
        multi_return=z,
        z_std=z,
        building_share=z,
        roughness=z,
    )
    return EpochResult(GRID, s, mask, labels, veg, "ndsm", "class2", [], np.empty(0), np.empty(0, bool), 0)


def run(before, after, veg_after=None, **params):
    return classify_changes(epoch(before), epoch(after, veg_after), GRID, params)


def blank():
    return np.zeros((N, N))


class ChangeTypeTests(SimpleTestCase):
    def test_new(self):
        a = blank()
        a[20:40, 20:40] = 9.0
        (r,) = run(blank(), a)
        self.assertEqual(r.change_type, NEW)
        self.assertAlmostEqual(r.area_m2, 100, delta=1)
        self.assertIsNone(r.height_before_m)
        self.assertAlmostEqual(r.height_after_m, 9.0)
        self.assertAlmostEqual(r.delta_height_m, 9.0)
        self.assertAlmostEqual(r.volume_delta_m3, 900, delta=10)

    def test_demolished(self):
        b = blank()
        b[20:40, 20:40] = 12.0
        (r,) = run(b, blank())
        self.assertEqual(r.change_type, DEMOLISHED)
        self.assertAlmostEqual(r.height_before_m, 12.0)
        self.assertIsNone(r.height_after_m)
        self.assertLess(r.volume_delta_m3, 0)

    def test_raised(self):
        b, a = blank(), blank()
        b[20:40, 20:40] = 6.0
        a[20:40, 20:40] = 12.0  # two floors added
        (r,) = run(b, a)
        self.assertEqual(r.change_type, RAISED)
        self.assertAlmostEqual(r.delta_height_m, 6.0)

    def test_lowered(self):
        b, a = blank(), blank()
        b[20:40, 20:40] = 15.0
        a[20:40, 20:40] = 9.0
        (r,) = run(b, a)
        self.assertEqual(r.change_type, LOWERED)
        self.assertAlmostEqual(r.delta_height_m, -6.0)

    def test_extended(self):
        b, a = blank(), blank()
        b[20:40, 20:40] = 8.0
        a[20:40, 20:60] = 8.0  # same building, twice as long
        (r,) = run(b, a)
        self.assertEqual(r.change_type, EXTENDED)
        self.assertAlmostEqual(r.area_m2, 100, delta=1)

    def test_reduced(self):
        b, a = blank(), blank()
        b[20:40, 20:60] = 8.0
        a[20:40, 20:40] = 8.0  # half of it pulled down
        (r,) = run(b, a)
        self.assertEqual(r.change_type, REDUCED)

    def test_small_and_subthreshold_changes_ignored(self):
        b, a = blank(), blank()
        b[20:40, 20:40] = 8.0
        a[20:40, 20:40] = 9.5  # 1.5 m: below the 2.5 m threshold
        a[60:66, 60:66] = 9.0  # 9 m²: below the 20 m² minimum
        self.assertEqual(run(b, a), [])

    def test_vegetation_only_change_ignored(self):
        b, a = blank(), blank()
        b[20:40, 20:40] = 8.0
        a[20:40, 20:40] = 8.0
        # A crown grows over the roof edge after: tall and tree-like.
        a[20:40, 40:50] = 10.0
        veg = blank()
        veg[20:40, 40:50] = 0.9
        self.assertEqual(run(b, a, veg_after=veg), [])

    def test_stats(self):
        b, a = blank(), blank()
        b[10:30, 10:30] = 10.0  # demolished
        a[60:80, 60:80] = 10.0  # new
        regions = run(b, a)
        st = change_stats(regions)
        self.assertEqual(st["counts"][NEW], 1)
        self.assertEqual(st["counts"][DEMOLISHED], 1)
        self.assertAlmostEqual(st["net_footprint_change_m2"], 0, delta=1)
        self.assertAlmostEqual(st["net_volume_change_m3"], 0, delta=20)


class CoRegistrationTests(SimpleTestCase):
    def test_offset_recovered(self):
        rng = np.random.default_rng(0)
        before = 10 + rng.normal(0, 0.05, (N, N))
        after = before + 0.35 + rng.normal(0, 0.05, (N, N))
        after[10:30, 10:30] += 9  # a new building must not bias the estimate
        stable = np.ones((N, N), bool)
        stable[10:30, 10:30] = False
        off, noise, n = vertical_offset(before, after, stable)
        self.assertAlmostEqual(off, 0.35, delta=0.01)
        self.assertLess(noise, 0.1)
        self.assertEqual(n, N * N - 400)

    def test_too_few_cells(self):
        off, noise, n = vertical_offset(np.zeros((5, 5)), np.ones((5, 5)), np.ones((5, 5), bool))
        self.assertEqual(off, 0.0)
        self.assertTrue(np.isnan(noise))


class Survey:
    def __init__(self, year):
        self.acquisition_year = year


class SurveyPairTests(SimpleTestCase):
    def test_pairs_need_three_years(self):
        s = [Survey(2014), Survey(2016), Survey(2018), Survey(2023), Survey(None)]
        pairs = [(b.acquisition_year, a.acquisition_year) for b, a in survey_pairs(s)]
        self.assertIn((2014, 2018), pairs)
        self.assertNotIn((2014, 2016), pairs)
        self.assertNotIn((2016, 2018), pairs)
        b, a = default_pair(s)
        self.assertEqual((b.acquisition_year, a.acquisition_year), (2018, 2023))

    def test_no_pair(self):
        self.assertIsNone(default_pair([Survey(2018), Survey(2020)]))
