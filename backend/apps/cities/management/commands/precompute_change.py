"""Precompute a showcase so it opens instantly.

  python manage.py precompute_change <slug>
"""
from django.core.management.base import BaseCommand, CommandError

from apps.cities.showcases import SHOWCASES, precompute


class Command(BaseCommand):
    help = "Run the pipeline over a grid of chunks for a showcase and store the merged result."

    def add_arguments(self, parser):
        slugs = [k for k, v in SHOWCASES.items() if v["mode"] == "change"]
        parser.add_argument("slug", choices=slugs)
        parser.add_argument("--chunk-km2", type=float, default=None, help="Largest chunk (default 0.45 km²)")

    def handle(self, *args, **o):
        try:
            job = precompute(o["slug"], self.stdout, o["chunk_km2"])
        except RuntimeError as exc:
            raise CommandError(str(exc)) from exc
        st = job.stats
        self.stdout.write(self.style.SUCCESS(f"Showcase job {job.id}: {st.get('chunks')} chunks, {st.get('processing_seconds')} s"))
        if job.mode == "measure":
            v = st.get("validation") or {}
            self.stdout.write(f"{st['building_count']} buildings; validation: "
                              + (f"P={v['precision']} R={v['recall']} F1={v['f1']} IoU={v['mean_iou']} height MAE={v['height_mae_m']} m (n={v['height_compared']})"
                                 if v.get("available") else str(v.get("reason"))))
        else:
            self.stdout.write(f"{st['change_count']} changes {st['counts']}; offset {st['vertical_offset_m']} m")
