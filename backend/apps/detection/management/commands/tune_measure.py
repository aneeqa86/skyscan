"""Score measure parameters against reference footprints without saving anything.

Points and reference footprints are fetched once per area and cached under
SKYSCAN_CACHE_DIR/tuning, so each parameter set only re-runs gridding,
masking and vectorizing.

  python manage.py tune_measure --bbox -73.9866,40.7570,-73.9806,40.7610 \
      --grid '[{}, {"split_step": 0}, {"veg_threshold": 0.35}]'
"""
import hashlib
import json
import pickle
import time
from pathlib import Path

from django.conf import settings
from django.contrib.gis.geos import Polygon as GPolygon
from django.core.management.base import BaseCommand, CommandError
from shapely import wkb as shp_wkb
from shapely.ops import transform as shp_transform

from apps.cities.models import Dataset
from apps.detection import reference, validation
from apps.detection.services import select_dataset
from apps.lidar.pipeline.aoi import aoi_utm_epsg, validate_aoi
from apps.lidar.pipeline.measure import (
    aoi_to_utm,
    fetch_epoch,
    grid_for,
    merged_params,
    process_epoch,
    resolve_resolution,
    transformers,
)
from apps.lidar.sources import get_source


def _cache_dir() -> Path:
    d = Path(settings.SKYSCAN_CACHE_DIR) / "tuning"
    d.mkdir(parents=True, exist_ok=True)
    return d


class Command(BaseCommand):
    help = "Evaluate measure parameter sets on one area against Overture/OSM footprints."

    def add_arguments(self, parser):
        parser.add_argument("--bbox", required=True)
        parser.add_argument("--dataset")
        parser.add_argument("--grid", default="[{}]", help="JSON list of parameter overrides")
        parser.add_argument("--label", default="")
        parser.add_argument("--refresh", action="store_true", help="Re-fetch points and reference footprints")

    def handle(self, *args, **o):
        w, s, e, n = (float(v) for v in o["bbox"].split(","))
        aoi, km2 = validate_aoi(GPolygon.from_bbox((w, s, e, n)), "measure")
        dataset = Dataset.objects.get(name=o["dataset"]) if o.get("dataset") else select_dataset(aoi)
        source = get_source(dataset.provider)
        epsg = aoi_utm_epsg(aoi)
        aoi_utm = aoi_to_utm(aoi, epsg)
        key = hashlib.sha1(f"{o['bbox']}|{dataset.name}".encode()).hexdigest()[:12]
        cache = _cache_dir() / f"{key}.pkl"
        base_res = resolve_resolution("auto", dataset.point_density_ppm2)

        if cache.exists() and not o["refresh"]:
            pts, ground, gmethod, refs = pickle.loads(cache.read_bytes())
        else:
            # Fetch on the finest grid we might test; the grid only sets the crop.
            grid = grid_for(aoi_utm, base_res, 15.0, epsg)
            t = time.monotonic()
            pts, ground, gmethod = fetch_epoch(source, dataset, aoi, aoi_utm, grid)
            self.stdout.write(f"fetched {pts.size:,} points in {time.monotonic() - t:.0f}s ({gmethod})")
            aoi_shp = shp_wkb.loads(bytes(aoi.wkb))
            refs, src, notes = reference.fetch_reference(aoi_shp)
            if not refs:
                raise CommandError(f"No reference footprints: {notes}")
            self.stdout.write(f"{len(refs)} reference footprints from {src}")
            cache.write_bytes(pickle.dumps((pts, ground, gmethod, refs)))

        fwd, _ = transformers(epsg)
        ref_utm, ref_h = [], []
        for r in refs:
            g = shp_transform(fwd.transform, r.polygon)
            if not g.is_valid:
                g = g.buffer(0)
            if g.is_empty or g.area < 25 or not aoi_utm.contains(g.centroid):
                continue
            ref_utm.append(g)
            ref_h.append(r.height_m)

        rows = []
        for overrides in json.loads(o["grid"]):
            params = merged_params(overrides)
            res = resolve_resolution(params["resolution"], dataset.point_density_ppm2)
            params["resolution"] = res
            grid = grid_for(aoi_utm, res, float(params["margin_m"]), epsg)
            t = time.monotonic()
            ep = process_epoch(pts, ground, gmethod, grid, aoi_utm, params)
            fps = ep.footprints
            m = validation.metrics([f.polygon for f in fps], ref_utm, [f.height_m for f in fps], ref_h)
            m.pop("matches")
            row = {
                "label": o["label"],
                "dataset": dataset.name,
                "overrides": overrides,
                "method": ep.method,
                "secs": round(time.monotonic() - t, 1),
                **{k: m[k] for k in ("detected", "reference", "precision", "recall", "f1", "mean_iou", "height_mae_m", "height_compared")},
            }
            rows.append(row)
            self.stdout.write(json.dumps(row))
        best = max(rows, key=lambda r: r["f1"] or 0)
        self.stdout.write(self.style.SUCCESS(f"best F1 {best['f1']} with {best['overrides']}"))
