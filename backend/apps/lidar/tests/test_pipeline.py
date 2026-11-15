"""Unit tests for the measure pipeline on synthetic data (no network, no PDAL)."""
import numpy as np
from django.contrib.gis.geos import Polygon as GPolygon
from django.test import SimpleTestCase, override_settings
from shapely.geometry import Polygon, box

from apps.lidar.pipeline import pointcloud
from apps.lidar.pipeline.aoi import AoiError, area_km2, utm_epsg, validate_aoi
from apps.lidar.pipeline.fetch import DTYPE
from apps.lidar.pipeline.mask import MaskParams, building_mask
from apps.lidar.pipeline.raster import Grid, build_surfaces, grid_reduce, local_roughness
from apps.lidar.pipeline.vectorize import estimate_floors, regularize, vectorize


def square(lon, lat, half_deg):
    return GPolygon.from_bbox((lon - half_deg, lat - half_deg, lon + half_deg, lat + half_deg))


class AoiTests(SimpleTestCase):
    def test_valid_area(self):
        geom, km2 = validate_aoi(square(-73.99, 40.75, 0.002))
        self.assertAlmostEqual(km2, area_km2(geom))
        self.assertTrue(0.1 < km2 < 0.2)

    def test_accepts_geojson_feature(self):
        gj = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[-74, 40.75], [-73.998, 40.75], [-73.998, 40.752], [-74, 40.752], [-74, 40.75]]],
            },
        }
        geom, _ = validate_aoi(gj)
        self.assertEqual(geom.srid, 4326)

    @override_settings(MAX_AOI_KM2_MEASURE=1.0, MAX_AOI_KM2_CHANGE=0.5)
    def test_rejects_large_areas_per_mode(self):
        big = square(-73.99, 40.75, 0.004)  # about 0.6 km²
        validate_aoi(big, "measure")
        with self.assertRaisesRegex(AoiError, "above the 0.5 km² limit"):
            validate_aoi(big, "change")

    def test_rejects_tiny_and_bad_geometry(self):
        with self.assertRaises(AoiError):
            validate_aoi(square(-73.99, 40.75, 0.00005))
        with self.assertRaises(AoiError):
            validate_aoi({"type": "Point", "coordinates": [0, 0]})
        with self.assertRaises(AoiError):
            validate_aoi("not a geometry")

    def test_repairs_self_intersection_or_rejects(self):
        bowtie = {
            "type": "Polygon",
            "coordinates": [[[-74, 40.75], [-73.997, 40.753], [-73.997, 40.75], [-74, 40.753], [-74, 40.75]]],
        }
        with self.assertRaises(AoiError):
            validate_aoi(bowtie)


class UtmTests(SimpleTestCase):
    def test_zones(self):
        self.assertEqual(utm_epsg(-73.99, 40.75), 32618)  # Manhattan
        self.assertEqual(utm_epsg(-122.42, 37.77), 32610)  # San Francisco
        self.assertEqual(utm_epsg(4.9, 52.37), 32631)  # Amsterdam
        self.assertEqual(utm_epsg(151.2, -33.87), 32756)  # Sydney, southern hemisphere

    def test_norway_and_svalbard_exceptions(self):
        self.assertEqual(utm_epsg(5.3, 60.4), 32632)  # Bergen
        self.assertEqual(utm_epsg(15.6, 78.2), 32633)  # Longyearbyen

    def test_out_of_range(self):
        with self.assertRaises(AoiError):
            utm_epsg(0, 85)


def synthetic_grid(n=120, res=0.5):
    return Grid(x0=500000.0, y0=4500000.0 + n * res, res=res, nx=n, ny=n, epsg=32618)


class VectorizeTests(SimpleTestCase):
    def setUp(self):
        self.grid = synthetic_grid()
        self.ndsm = np.zeros(self.grid.shape)
        # Building A: 20 m x 10 m, 12 m tall (rows/cols in 0.5 m cells).
        self.ndsm[20:60, 20:40] = 12.0
        # Building B: 8 m x 8 m, 30 m tall with a 33 m spike (max).
        self.ndsm[70:86, 70:86] = 30.0
        self.ndsm[78, 78] = 33.0
        # Tiny shed: 2 m x 2 m (below min_area).
        self.ndsm[100:104, 10:14] = 3.0
        self.mask = self.ndsm >= 2.5
        self.count = np.full(self.grid.shape, 3.0)
        self.veg = np.zeros(self.grid.shape)

    def test_polygons_and_attributes(self):
        fps, labels = vectorize(self.mask, self.ndsm, self.count, self.veg, self.grid, min_area=25)
        self.assertEqual(len(fps), 2)
        a, b = sorted(fps, key=lambda f: f.height_m)
        self.assertAlmostEqual(a.area_m2, 200.0, delta=2)
        self.assertAlmostEqual(a.height_m, 12.0)
        self.assertAlmostEqual(a.volume_m3, 200 * 12.0, delta=1)
        self.assertEqual(a.est_floors, 4)
        self.assertEqual(a.point_count, 800 * 3)
        self.assertAlmostEqual(b.area_m2, 64.0, delta=1)
        self.assertAlmostEqual(b.height_m, 30.0)  # p90 ignores the single spike
        self.assertAlmostEqual(b.max_height_m, 33.0)
        self.assertEqual(b.est_floors, 10)
        for f in fps:
            self.assertTrue(0 < f.confidence <= 1)
            self.assertTrue(f.polygon.is_valid)
        # Footprint A sits where we drew it (UTM coordinates).
        xmin, ymin, xmax, ymax = a.polygon.bounds
        self.assertAlmostEqual(xmin, 500010.0, delta=0.6)
        self.assertAlmostEqual(xmax, 500020.0, delta=0.6)

    def test_keep_within_drops_outside(self):
        inside = box(500000, 4500000 + 60 - 30, 500030, 4500060)  # covers A only
        fps, _ = vectorize(self.mask, self.ndsm, self.count, self.veg, self.grid, keep_within=inside)
        self.assertEqual(len(fps), 1)

    def test_border_lowers_confidence(self):
        ndsm = np.zeros(self.grid.shape)
        ndsm[0:20, 50:70] = 10.0
        ndsm[40:60, 50:70] = 10.0
        fps, _ = vectorize(ndsm > 2.5, ndsm, self.count, self.veg, self.grid)
        top, mid = sorted(fps, key=lambda f: -f.polygon.centroid.y)
        self.assertLess(top.confidence, mid.confidence)

    def test_floors(self):
        self.assertEqual(estimate_floors(1.0), 1)
        self.assertEqual(estimate_floors(4.4), 1)
        self.assertEqual(estimate_floors(4.6), 2)
        self.assertEqual(estimate_floors(100), 33)

    def test_regularize_squares_a_noisy_rectangle(self):
        noisy = Polygon([(0, 0), (20.3, 0.4), (20, 10.2), (10, 10.4), (-0.2, 9.9)])
        out = regularize(noisy)
        self.assertTrue(out.is_valid)
        self.assertAlmostEqual(out.area, noisy.area, delta=noisy.area * 0.15)
        self.assertLessEqual(len(out.exterior.coords), len(noisy.exterior.coords))


class RasterTests(SimpleTestCase):
    def test_grid_snapping_is_shared(self):
        g1 = Grid.from_bounds(100.2, 200.3, 150.7, 260.9, 0.5, 32618)
        g2 = Grid.from_bounds(100.4, 200.1, 150.6, 260.8, 0.5, 32618)
        self.assertEqual((g1.x0, g1.y0), (100.0, 261.0))
        self.assertEqual(g1.x0, g2.x0)

    def test_grid_reduce(self):
        g = Grid(0, 2, 1, 2, 2, 32618)
        v = grid_reduce(g, [0.5, 0.6, 1.5], [1.5, 1.5, 0.5], [1, 5, 3], "max")
        self.assertEqual(v[0, 0], 5)
        self.assertEqual(v[1, 1], 3)
        self.assertTrue(np.isnan(v[0, 1]))

    def test_roughness_zero_on_planes(self):
        yy, xx = np.mgrid[0:30, 0:30]
        plane = 0.3 * xx + 0.1 * yy + 5
        self.assertLess(local_roughness(plane)[5:-5, 5:-5].max(), 1e-9)


def synthetic_points(seed=0):
    """A 60 m x 60 m scene: flat ground at 10 m, a flat-roof building and a tree."""
    rng = np.random.default_rng(seed)
    n = 60 * 60 * 8
    x = rng.uniform(0, 60, n)
    y = rng.uniform(0, 60, n)
    z = np.full(n, 10.0) + rng.normal(0, 0.03, n)
    cls = np.full(n, 2, dtype=np.uint8)
    nret = np.ones(n, dtype=np.uint8)
    rnum = np.ones(n, dtype=np.uint8)
    bld = (x > 10) & (x < 30) & (y > 10) & (y < 25)
    z[bld] = 22.0 + rng.normal(0, 0.03, bld.sum())
    cls[bld] = 1
    tree = (x - 45) ** 2 + (y - 45) ** 2 < 6**2
    # Crown: scattered heights through the canopy, mostly multi-return.
    z[tree] = 10 + rng.uniform(3, 14, tree.sum())
    cls[tree] = 1
    nret[tree] = 3
    rnum[tree] = rng.integers(1, 3, tree.sum())
    pts = np.empty(n, dtype=DTYPE)
    pts["X"], pts["Y"], pts["Z"] = x + 500000, y + 4500000, z
    pts["Classification"], pts["NumberOfReturns"], pts["ReturnNumber"] = cls, nret, rnum
    pts["Intensity"] = 100
    return pts


class MaskTests(SimpleTestCase):
    def test_ndsm_method_keeps_building_drops_tree(self):
        pts = synthetic_points()
        grid = Grid.from_bounds(500000, 4500000, 500060, 4500060, 0.5, 32618)
        s = build_surfaces(grid, pts, pts["Classification"] == 2)
        mask, method, veg = building_mask(s, MaskParams())
        self.assertEqual(method, "ndsm")
        fps, _ = vectorize(mask, s.ndsm, s.count, veg, grid)
        self.assertEqual(len(fps), 1)
        self.assertAlmostEqual(fps[0].area_m2, 300, delta=30)
        self.assertAlmostEqual(fps[0].height_m, 12.0, delta=0.3)


class PointCloudTests(SimpleTestCase):
    def test_round_trip(self):
        n = 1000
        rng = np.random.default_rng(1)
        x, y, z = rng.uniform(0, 100, n) + 500000, rng.uniform(0, 100, n) + 4500000, rng.uniform(10, 40, n)
        hag = z - 10
        buf = pointcloud.encode(
            x, y, z, hag, np.full(n, 2), rng.integers(0, 4000, n),
            center_lonlat=(-73.99, 40.75), center_xy=(500050, 4500050), datum_z=10, epsg=32618,
        )
        header, arrs = pointcloud.decode(buf)
        self.assertEqual(header["count"], n)
        np.testing.assert_allclose(arrs["xyz"][:, 0], x - 500050, atol=1e-3)
        np.testing.assert_allclose(arrs["hag_cm"] / 100, hag, atol=0.006)
        self.assertEqual(arrs["intensity"].max(), 255)

    def test_decimate_caps(self):
        self.assertEqual(len(pointcloud.decimate(10)), 10)
        self.assertEqual(len(pointcloud.decimate(1_000_000)), pointcloud.MAX_POINTS)
