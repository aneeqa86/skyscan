"""Write the tiny synthetic LAZ used by the API tests.

A 60 m x 60 m scene in Manhattan's UTM zone (EPSG:32618): flat ground, one
flat-roofed building (20 m x 15 m, 12 m tall) and one tree.
"""
import json
from pathlib import Path

import numpy as np
from django.core.management.base import BaseCommand

FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "tiny.laz"
ORIGIN = (585000.0, 4511000.0)  # UTM 18N, Midtown Manhattan


def synthetic(seed=0, density=6):
    rng = np.random.default_rng(seed)
    n = 60 * 60 * density
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
    z[tree] = 10 + rng.uniform(3, 14, tree.sum())
    cls[tree] = 1
    nret[tree] = 3
    rnum[tree] = rng.integers(1, 3, tree.sum())
    dt = np.dtype(
        [("X", "f8"), ("Y", "f8"), ("Z", "f8"), ("Intensity", "u2"), ("ReturnNumber", "u1"),
         ("NumberOfReturns", "u1"), ("Classification", "u1")]
    )
    a = np.empty(n, dtype=dt)
    a["X"], a["Y"], a["Z"] = x + ORIGIN[0], y + ORIGIN[1], z
    a["Intensity"] = rng.integers(50, 400, n)
    a["ReturnNumber"], a["NumberOfReturns"], a["Classification"] = rnum, nret, cls
    return a


class Command(BaseCommand):
    help = "Regenerate apps/lidar/tests/fixtures/tiny.laz"

    def handle(self, *args, **opts):
        import pdal

        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        spec = [{"type": "writers.las", "filename": str(FIXTURE), "compression": "laszip",
                 "a_srs": "EPSG:32618", "scale_x": 0.01, "scale_y": 0.01, "scale_z": 0.01}]
        p = pdal.Pipeline(json.dumps(spec), arrays=[synthetic()])
        p.execute()
        self.stdout.write(self.style.SUCCESS(f"wrote {FIXTURE} ({FIXTURE.stat().st_size:,} bytes)"))
