"""Run a change job from the command line.

  python manage.py detect_change --bbox w,s,e,n
  python manage.py detect_change --bbox ... --before NAME --after NAME
  python manage.py detect_change --bbox ... --surveys      # list surveys only
"""
import json

from django.contrib.gis.geos import Polygon
from django.core.management.base import BaseCommand, CommandError

from apps.change.services import run_change_job, surveys_for
from apps.cities.models import Dataset
from apps.detection.models import Job
from apps.lidar.pipeline.aoi import AoiError, validate_aoi


class Command(BaseCommand):
    help = "Compare two LiDAR surveys over a bounding box and print the changes."

    def add_arguments(self, parser):
        parser.add_argument("--bbox", required=True, help="west,south,east,north in degrees")
        parser.add_argument("--before")
        parser.add_argument("--after")
        parser.add_argument("--params", default="{}")
        parser.add_argument("--surveys", action="store_true", help="Only list the surveys and exit")

    def handle(self, *args, **o):
        try:
            w, s, e, n = (float(v) for v in o["bbox"].split(","))
            aoi, km2 = validate_aoi(Polygon.from_bbox((w, s, e, n)), "change")
        except (ValueError, AoiError) as exc:
            raise CommandError(str(exc)) from exc
        info = surveys_for(aoi)
        for d in info["datasets"]:
            full = "full" if d.id in info["full_coverage_ids"] else "partial"
            self.stdout.write(f"  {d.acquisition_year or '----'}  {d.point_density_ppm2 or 0:6.1f} pts/m²  {full:7s}  {d.name}")
        self.stdout.write(f"Change possible: {info['change_possible']} {info['reason']}")
        if o["surveys"]:
            return
        kwargs = {}
        if o.get("before") or o.get("after"):
            if not (o.get("before") and o.get("after")):
                raise CommandError("Give both --before and --after, or neither")
            kwargs = {
                "dataset_before": Dataset.objects.get(name=o["before"]),
                "dataset": Dataset.objects.get(name=o["after"]),
            }
        job = Job.objects.create(mode=Job.Mode.CHANGE, aoi=aoi, area_km2=km2, params=json.loads(o["params"]), **kwargs)
        self.stdout.write(f"Job {job.id}: {km2:.3f} km²")
        job = run_change_job(job.id)
        if job.status == Job.Status.FAILED:
            raise CommandError(job.error)
        st = job.stats
        self.stdout.write(
            self.style.SUCCESS(
                f"{st['before']['year']} -> {st['after']['year']}: {st['change_count']} changes {st['counts']}; "
                f"net volume {st['net_volume_change_m3']:,.0f} m³, net footprint {st['net_footprint_change_m2']:,.0f} m²; "
                f"vertical offset {st['vertical_offset_m']} m (noise {st['vertical_noise_m']} m); "
                f"{st['processing_seconds']} s"
            )
        )
