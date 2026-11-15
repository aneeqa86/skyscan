"""Run a measure job from the command line.

  python manage.py measure --bbox -73.9866,40.7570,-73.9806,40.7610
  python manage.py measure --bbox ... --dataset NY_NewYorkCity --params '{"min_height": 3}'
"""
import json

from django.contrib.gis.geos import Polygon
from django.core.management.base import BaseCommand, CommandError

from apps.cities.models import Dataset
from apps.detection.models import Job
from apps.detection.services import run_measure_job
from apps.lidar.pipeline.aoi import AoiError, validate_aoi


class Command(BaseCommand):
    help = "Run the measure pipeline on a bounding box and print the job stats."

    def add_arguments(self, parser):
        parser.add_argument("--bbox", required=True, help="west,south,east,north in degrees")
        parser.add_argument("--dataset", help="Dataset name (default: newest survey covering the area)")
        parser.add_argument("--params", default="{}", help="JSON pipeline parameters")
        parser.add_argument("--json", action="store_true", help="Print full stats as JSON")

    def handle(self, *args, **o):
        try:
            w, s, e, n = (float(v) for v in o["bbox"].split(","))
        except ValueError as exc:
            raise CommandError("--bbox must be west,south,east,north") from exc
        try:
            aoi, km2 = validate_aoi(Polygon.from_bbox((w, s, e, n)), "measure")
        except AoiError as exc:
            raise CommandError(str(exc)) from exc
        dataset = None
        if o.get("dataset"):
            dataset = Dataset.objects.filter(name=o["dataset"]).first()
            if dataset is None:
                raise CommandError(f"Unknown dataset {o['dataset']}")
        job = Job.objects.create(
            mode=Job.Mode.MEASURE, aoi=aoi, area_km2=km2, dataset=dataset, params=json.loads(o["params"])
        )
        self.stdout.write(f"Job {job.id}: {km2:.3f} km²")
        job = run_measure_job(job.id)
        if job.status == Job.Status.FAILED:
            raise CommandError(job.error)
        st = job.stats
        if o["json"]:
            self.stdout.write(json.dumps(st, indent=2, default=str))
            return
        v = st.get("validation", {})
        self.stdout.write(
            self.style.SUCCESS(
                f"{st['building_count']} buildings, median height {st['median_height_m']} m, "
                f"method {st['method']}/{st['ground_method']}, {st['points_fetched']:,} points, "
                f"{st['processing_seconds']} s"
            )
        )
        if v.get("available"):
            self.stdout.write(
                f"Validation vs {v['source']}: P={v['precision']} R={v['recall']} F1={v['f1']} "
                f"IoU={v['mean_iou']} height MAE={v['height_mae_m']} m (n={v['height_compared']})"
            )
        else:
            self.stdout.write(f"Validation: {v.get('reason')}")
