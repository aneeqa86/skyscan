"""Job lifecycle through the API on a tiny fixture LAZ (no network)."""
import csv
import io
import json
import shutil
import tempfile
from pathlib import Path
from unittest import mock

from django.contrib.gis.geos import MultiPolygon, Point, Polygon
from django.test import TestCase, override_settings
from pyproj import Transformer
from rest_framework.test import APIClient
from shapely.geometry import box

from apps.cities.models import City, Dataset
from apps.detection import tasks
from apps.detection.models import Building, Job
from apps.detection.reference import RefFootprint
from apps.lidar.pipeline import pointcloud
from apps.lidar.sources.local import PROVIDER

FIXTURE = Path(__file__).resolve().parents[2] / "lidar" / "tests" / "fixtures" / "tiny.laz"
ORIGIN = (585000.0, 4511000.0)
TO_LL = Transformer.from_crs(32618, 4326, always_xy=True)


def ll_box(x0, y0, x1, y1) -> Polygon:
    (a, b), (c, d) = TO_LL.transform(ORIGIN[0] + x0, ORIGIN[1] + y0), TO_LL.transform(ORIGIN[0] + x1, ORIGIN[1] + y1)
    p = Polygon.from_bbox((a, b, c, d))
    p.srid = 4326
    return p


def fake_reference(aoi):
    """The fixture building as Overture would map it (with a height)."""
    (a, b), (c, d) = TO_LL.transform(ORIGIN[0] + 10, ORIGIN[1] + 10), TO_LL.transform(ORIGIN[0] + 30, ORIGIN[1] + 25)
    return [RefFootprint(box(a, b, c, d), 12.5, "overture", "fixture-1")], "overture", []


def run_inline(args=None, task_id=None, **_):
    """Stand-in for run_job.apply_async: run the task in-process."""
    return tasks.run_job(*args)


@override_settings(MAX_AOI_KM2_MEASURE=1.0, MAX_AOI_KM2_CHANGE=0.5, MAX_CONCURRENT_JOBS=4)
class JobLifecycleTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.media = tempfile.mkdtemp()
        cls._media = override_settings(MEDIA_ROOT=cls.media)
        cls._media.enable()

    @classmethod
    def tearDownClass(cls):
        cls._media.disable()
        shutil.rmtree(cls.media, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        from django.core.cache import cache

        cache.clear()  # job-creation throttle counts live in the cache
        self.client = APIClient()
        coverage = MultiPolygon(ll_box(-5, -5, 65, 65), srid=4326)
        common = dict(
            provider=PROVIDER, country="Test", access_type=Dataset.AccessType.TILES, source_url=f"file://{FIXTURE}",
            license="test", attribution="Synthetic fixture", coverage_polygon=coverage, point_density_ppm2=6.0,
        )
        self.ds_old = Dataset.objects.create(name="fixture_2015", acquisition_year=2015, **common)
        self.ds_new = Dataset.objects.create(name="fixture_2020", acquisition_year=2020, **common)
        self.aoi = ll_box(2, 2, 58, 58)
        self.aoi_json = json.loads(self.aoi.geojson)

    def post_job(self, **body):
        with mock.patch.object(tasks.run_job, "apply_async", side_effect=run_inline), \
                mock.patch("apps.detection.reference.fetch_reference", side_effect=fake_reference), \
                self.captureOnCommitCallbacks(execute=True):
            return self.client.post("/api/jobs/", body, format="json")

    def test_measure_job_lifecycle(self):
        r = self.post_job(mode="measure", aoi=self.aoi_json, dataset=self.ds_new.id, params={"min_area": 25})
        self.assertEqual(r.status_code, 202, r.content)
        job_id = r.json()["id"]

        job = self.client.get(f"/api/jobs/{job_id}/").json()
        self.assertEqual(job["status"], "done", job.get("error"))
        self.assertEqual(job["progress"], 100)
        st = job["stats"]
        self.assertEqual(st["building_count"], 1)
        self.assertEqual(st["method"], "ndsm")  # the tree was rejected, the building kept
        v = st["validation"]
        self.assertTrue(v["available"])
        self.assertEqual((v["precision"], v["recall"]), (1.0, 1.0))
        self.assertEqual(v["height_compared"], 1)
        self.assertLess(v["height_mae_m"], 1.0)

        fc = self.client.get(f"/api/jobs/{job_id}/buildings/").json()
        self.assertEqual(fc["type"], "FeatureCollection")
        (feat,) = fc["features"]
        self.assertAlmostEqual(feat["properties"]["height_m"], 12.0, delta=0.5)
        self.assertAlmostEqual(feat["properties"]["area_m2"], 300, delta=40)
        self.assertEqual(feat["properties"]["est_floors"], 4)

        ref = self.client.get(f"/api/jobs/{job_id}/reference/").json()
        self.assertEqual(len(ref["features"]), 1)
        self.assertTrue(ref["features"][0]["properties"]["matched"])

        pc = self.client.get(f"/api/jobs/{job_id}/pointcloud/")
        self.assertEqual(pc.status_code, 200)
        header, arrays = pointcloud.decode(b"".join(pc.streaming_content))
        self.assertGreater(header["count"], 1000)
        self.assertEqual(len(arrays["classification"]), header["count"])

        gj = self.client.get(f"/api/jobs/{job_id}/export/?format=geojson")
        self.assertIn("attachment", gj["Content-Disposition"])
        self.assertEqual(json.loads(gj.content)["attribution"], "Synthetic fixture")
        rows = list(csv.reader(io.StringIO(self.client.get(f"/api/jobs/{job_id}/export/?format=csv").content.decode())))
        self.assertEqual(rows[0][:3], ["id", "epoch", "area_m2"])
        self.assertEqual(len(rows), 2)

    def test_change_job_lifecycle(self):
        r = self.post_job(mode="change", aoi=self.aoi_json, dataset=self.ds_new.id, dataset_before=self.ds_old.id)
        self.assertEqual(r.status_code, 202, r.content)
        job = self.client.get(f"/api/jobs/{r.json()['id']}/").json()
        self.assertEqual(job["status"], "done", job.get("error"))
        # The same scene in both epochs: nothing changed and the surveys align exactly.
        self.assertEqual(job["stats"]["change_count"], 0)
        self.assertEqual(job["stats"]["vertical_offset_m"], 0.0)
        self.assertEqual(Building.objects.filter(job_id=job["id"], epoch="before").count(), 1)
        self.assertEqual(Building.objects.filter(job_id=job["id"], epoch="after").count(), 1)
        self.assertEqual(self.client.get(f"/api/jobs/{job['id']}/changes/").json()["features"], [])
        for epoch in ("before", "after"):
            self.assertEqual(self.client.get(f"/api/jobs/{job['id']}/pointcloud/?epoch={epoch}").status_code, 200)

    def test_change_needs_surveys_three_years_apart(self):
        self.ds_old.acquisition_year = 2019
        self.ds_old.save()
        r = self.post_job(mode="change", aoi=self.aoi_json)
        job = self.client.get(f"/api/jobs/{r.json()['id']}/").json()
        self.assertEqual(job["status"], "failed")
        self.assertIn("less than 3 years apart", job["error"])

    def test_validation_errors(self):
        r = self.client.post("/api/jobs/", {"mode": "measure", "aoi": {"type": "Point", "coordinates": [0, 0]}}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("aoi", r.json())
        big = Polygon.from_bbox((-74.0, 40.70, -73.97, 40.73))
        r = self.client.post("/api/jobs/", {"mode": "measure", "aoi": json.loads(big.geojson)}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("limit", r.json()["aoi"][0])
        r = self.client.post(
            "/api/jobs/", {"mode": "measure", "aoi": self.aoi_json, "params": {"min_height": 99}}, format="json"
        )
        self.assertEqual(r.status_code, 400)

    def test_creation_is_throttled_per_ip(self):
        from rest_framework.throttling import ScopedRateThrottle

        # Rates are read into a class attribute at import, so patch that.
        with mock.patch.object(ScopedRateThrottle, "THROTTLE_RATES", {"job_create": "2/hour"}):
            codes = [self.post_job(mode="measure", aoi={"type": "Point", "coordinates": [0, 0]}).status_code for _ in range(3)]
        self.assertEqual(codes, [400, 400, 429])

    def test_concurrency_cap(self):
        for _ in range(4):
            Job.objects.create(mode="measure", aoi=self.aoi, status=Job.Status.FETCHING)
        r = self.client.post("/api/jobs/", {"mode": "measure", "aoi": self.aoi_json}, format="json")
        self.assertEqual(r.status_code, 429)

    def test_no_survey_fails_cleanly(self):
        far = Polygon.from_bbox((10.0, 10.0, 10.003, 10.003))
        r = self.post_job(mode="measure", aoi=json.loads(far.geojson))
        job = self.client.get(f"/api/jobs/{r.json()['id']}/").json()
        self.assertEqual(job["status"], "failed")
        self.assertIn("No LiDAR survey covers this area", job["error"])

    def test_datasets_at_location(self):
        r = self.client.get("/api/datasets/", {"aoi": json.dumps(self.aoi_json)}).json()
        self.assertEqual(r["count"], 2)
        self.assertTrue(r["change_possible"])
        self.assertEqual(r["years"], [2015, 2020])
        self.assertTrue(all(d["covers_whole_area"] for d in r["results"]))
        c = self.client.get(f"/api/datasets/?lon={self.aoi.centroid.x}&lat={self.aoi.centroid.y}").json()
        self.assertEqual(c["years"], [2015, 2020])

    def test_city_tiles_and_schema(self):
        city = City.objects.create(name="Fixture", slug="fixture", center=Point(self.aoi.centroid.x, self.aoi.centroid.y, srid=4326))
        Building.objects.create(
            city=city, footprint=self.aoi, area_m2=1, height_m=10, max_height_m=11, est_floors=3, volume_m3=10, confidence=0.9
        )
        import math

        lon, lat, z = self.aoi.centroid.x, self.aoi.centroid.y, 16
        x = int((lon + 180) / 360 * 2**z)
        y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2**z)
        t = type("Tile", (), {"x": x, "y": y, "z": z})
        r = self.client.get(f"/api/tiles/fixture/buildings/{t.z}/{t.x}/{t.y}.mvt")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "application/vnd.mapbox-vector-tile")
        self.assertGreater(len(r.content), 0)
        self.assertEqual(self.client.get("/api/tiles/fixture/nope/1/0/0.mvt").status_code, 404)
        self.assertEqual(self.client.get(f"/api/tiles/coverage/{t.z}/{t.x}/{t.y}.mvt").status_code, 200)
        self.assertEqual(self.client.get("/api/schema/").status_code, 200)


class CancelTests(TestCase):
    def setUp(self):
        from django.core.cache import cache

        cache.clear()
        self.client = APIClient()
        self.aoi = ll_box(2, 2, 58, 58)

    def test_cancel_queued_job_then_conflict(self):
        job = Job.objects.create(mode="measure", aoi=self.aoi)
        with mock.patch("skyscan.celery.app.control.revoke") as revoke:
            r = self.client.post(f"/api/jobs/{job.id}/cancel/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json()["status"], r.json()["error"]), ("failed", "Cancelled."))
        revoke.assert_called_once_with(str(job.id))
        self.assertEqual(self.client.post(f"/api/jobs/{job.id}/cancel/").status_code, 409)

    def test_worker_stops_at_next_checkpoint(self):
        from apps.detection.services import cancel_job, run_measure_job

        job = Job.objects.create(mode="measure", aoi=self.aoi)
        with mock.patch("skyscan.celery.app.control.revoke"):
            cancel_job(job)
        run_measure_job(job.id)  # a worker picking it up anyway
        job.refresh_from_db()
        self.assertEqual(job.status, "failed")
        self.assertEqual(job.error, "Cancelled.")  # not overwritten by a later failure or "done"
