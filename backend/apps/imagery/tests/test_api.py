import shutil
import tempfile

from django.contrib.gis.geos import Polygon
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.detection.models import Job
from apps.imagery.services import image_path


class ImageryEndpointTests(TestCase):
    def setUp(self):
        self.media = tempfile.mkdtemp()
        self._media = override_settings(MEDIA_ROOT=self.media)
        self._media.enable()
        aoi = Polygon.from_bbox((-105.0, 39.75, -104.99, 39.76))
        aoi.srid = 4326
        self.job = Job.objects.create(mode="change", aoi=aoi, status=Job.Status.DONE, stats={"imagery": {}})

    def tearDown(self):
        self._media.disable()
        shutil.rmtree(self.media, ignore_errors=True)

    def test_serves_a_year_and_404s_otherwise(self):
        path = image_path(self.job, 2019)
        path.parent.mkdir(parents=True)
        path.write_bytes(b"\xff\xd8fakejpeg")
        c = APIClient()
        r = c.get(f"/api/jobs/{self.job.id}/imagery/2019/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "image/jpeg")
        self.assertEqual(b"".join(r.streaming_content), b"\xff\xd8fakejpeg")
        self.assertEqual(c.get(f"/api/jobs/{self.job.id}/imagery/2017/").status_code, 404)
