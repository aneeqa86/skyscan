"""Reference building footprints for validation: Overture Maps first, OSM fallback."""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path

import requests
from django.conf import settings
from shapely import wkb as shp_wkb
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import polygonize, unary_union

log = logging.getLogger(__name__)

OVERTURE_BUCKET = "overturemaps-us-west-2"
OVERTURE_REGION = "us-west-2"
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
USER_AGENT = "skyscan/0.1 (building footprint validation)"


@dataclass
class RefFootprint:
    polygon: Polygon  # EPSG:4326
    height_m: float | None
    source: str
    source_id: str


class ReferenceUnavailable(RuntimeError):
    pass


# --------------------------------------------------------------------------- Overture


def _s3():
    from pyarrow import fs

    return fs.S3FileSystem(anonymous=True, region=OVERTURE_REGION)


def latest_overture_release() -> str:
    configured = getattr(settings, "OVERTURE_RELEASE", "")
    if configured:
        return configured
    from pyarrow import fs

    infos = _s3().get_file_info(fs.FileSelector(f"{OVERTURE_BUCKET}/release/", recursive=False))
    releases = sorted(i.base_name for i in infos if i.type == fs.FileType.Directory)
    if not releases:
        raise ReferenceUnavailable("No Overture releases found")
    return releases[-1]


def _index_path(release: str) -> Path:
    return Path(settings.SKYSCAN_CACHE_DIR) / "overture" / f"buildings-{release}-rowgroups.json"


def overture_rowgroup_index(release: str) -> list[dict]:
    """Bounding box of every row group in the buildings theme, cached on disk.

    Building the index reads only Parquet footers (a few MB in total) once per
    release; afterwards an AOI lookup touches just the row groups it overlaps."""
    path = _index_path(release)
    if path.exists():
        return json.loads(path.read_text())
    import pyarrow.parquet as pq
    from pyarrow import fs

    from concurrent.futures import ThreadPoolExecutor

    s3 = _s3()
    base = f"{OVERTURE_BUCKET}/release/{release}/theme=buildings/type=building/"
    files = [
        i.path
        for i in s3.get_file_info(fs.FileSelector(base, recursive=True))
        if i.type == fs.FileType.File and i.path.endswith(".parquet")
    ]

    def footer_rows(f):
        md = pq.ParquetFile(f, filesystem=s3).metadata
        names = [md.schema.column(i).path for i in range(md.num_columns)]
        cols = {n: names.index(n) for n in ("bbox.xmin", "bbox.xmax", "bbox.ymin", "bbox.ymax") if n in names}
        if len(cols) < 4:
            return []
        out = []
        for rg in range(md.num_row_groups):
            g = md.row_group(rg)
            st = {k: g.column(i).statistics for k, i in cols.items()}
            if any(s is None or not s.has_min_max for s in st.values()):
                continue
            out.append(
                {
                    "file": f,
                    "rg": rg,
                    "xmin": float(st["bbox.xmin"].min),
                    "xmax": float(st["bbox.xmax"].max),
                    "ymin": float(st["bbox.ymin"].min),
                    "ymax": float(st["bbox.ymax"].max),
                }
            )
        return out

    # About 500 files: footers are tiny, so fetch them concurrently.
    with ThreadPoolExecutor(max_workers=32) as pool:
        rows = [r for chunk in pool.map(footer_rows, files) for r in chunk]
    if not rows:
        raise ReferenceUnavailable(f"Overture release {release} has no readable building files")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows))
    return rows


def fetch_overture(aoi: Polygon) -> list[RefFootprint]:
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    release = latest_overture_release()
    xmin, ymin, xmax, ymax = aoi.bounds
    groups = [
        r
        for r in overture_rowgroup_index(release)
        if r["xmax"] >= xmin and r["xmin"] <= xmax and r["ymax"] >= ymin and r["ymin"] <= ymax
    ]
    s3 = _s3()
    out: list[RefFootprint] = []
    by_file: dict[str, list[int]] = {}
    for r in groups:
        by_file.setdefault(r["file"], []).append(r["rg"])
    for f, rgs in by_file.items():
        pf = pq.ParquetFile(f, filesystem=s3)
        names = set(pf.schema_arrow.names)
        cols = [c for c in ("id", "geometry", "bbox", "height") if c in names]
        t = pf.read_row_groups(rgs, columns=cols)
        bb = t.column("bbox")
        sel = pc.and_(
            pc.and_(pc.greater_equal(pc.struct_field(bb, "xmax"), xmin), pc.less_equal(pc.struct_field(bb, "xmin"), xmax)),
            pc.and_(pc.greater_equal(pc.struct_field(bb, "ymax"), ymin), pc.less_equal(pc.struct_field(bb, "ymin"), ymax)),
        )
        t = t.filter(sel)
        heights = t.column("height").to_pylist() if "height" in cols else [None] * t.num_rows
        for oid, g, h in zip(t.column("id").to_pylist(), t.column("geometry").to_pylist(), heights):
            geom = shp_wkb.loads(g)
            for poly in _polygons(geom):
                if poly.intersects(aoi):
                    out.append(RefFootprint(poly, float(h) if h else None, "overture", str(oid)))
    return out


# --------------------------------------------------------------------------- OSM


def _parse_height(tags: dict) -> float | None:
    v = tags.get("height")
    if not v:
        return None
    m = re.match(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*(m|ft|')?\s*$", v)
    if not m:
        return None
    h = float(m.group(1))
    return h * 0.3048 if m.group(2) in ("ft", "'") else h


def fetch_osm(aoi: Polygon) -> list[RefFootprint]:
    w, s, e, n = aoi.bounds
    q = (
        f"[out:json][timeout:90];("
        f'way["building"]({s},{w},{n},{e});'
        f'relation["building"]["type"="multipolygon"]({s},{w},{n},{e});'
        f");out geom;"
    )
    last = None
    for url in OVERPASS_URLS:
        try:
            r = requests.post(url, data={"data": q}, timeout=120, headers={"User-Agent": USER_AGENT})
            if r.status_code == 200:
                data = r.json()
                break
            last = f"HTTP {r.status_code}"
        except requests.RequestException as exc:
            last = str(exc)
        time.sleep(1)
    else:
        raise ReferenceUnavailable(f"OpenStreetMap (Overpass) unavailable: {last}")

    out = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        h = _parse_height(tags)
        if el["type"] == "way" and "geometry" in el:
            coords = [(p["lon"], p["lat"]) for p in el["geometry"]]
            if len(coords) >= 4 and coords[0] == coords[-1]:
                poly = Polygon(coords)
                if not poly.is_valid:
                    poly = poly.buffer(0)
                for p in _polygons(poly):
                    out.append(RefFootprint(p, h, "osm", f"way/{el['id']}"))
        elif el["type"] == "relation":
            lines = [
                LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
                for m in el.get("members", [])
                if m.get("role") == "outer" and m.get("geometry")
            ]
            for p in _polygons(unary_union(list(polygonize(unary_union(lines))))):
                out.append(RefFootprint(p, h, "osm", f"relation/{el['id']}"))
    return [f for f in out if f.polygon.intersects(aoi)]


def _polygons(geom):
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]


# --------------------------------------------------------------------------- entry point


def fetch_reference(aoi: Polygon) -> tuple[list[RefFootprint], str | None, list[str]]:
    """Return (footprints, source_used, notes). Overture first, OSM fallback."""
    notes = []
    for name, fn in (("overture", fetch_overture), ("osm", fetch_osm)):
        try:
            refs = fn(aoi)
        except Exception as exc:  # network, S3, parsing: try the next source
            log.warning("reference source %s failed: %s", name, exc)
            notes.append(f"{name}: {exc}")
            continue
        if refs:
            return refs, name, notes
        notes.append(f"{name}: no buildings in this area")
    return [], None, notes


