"""Mapbox Vector Tiles straight from PostGIS (ST_AsMVT)."""
from django.db import connection
from django.http import Http404, HttpResponse
from django.views.decorators.cache import cache_control
from django.views.decorators.http import require_GET

from apps.cities.models import City

MVT = "application/vnd.mapbox-vector-tile"

LAYERS = {
    "buildings": {
        "table": "detection_building",
        "geom": "footprint",
        "props": "t.id, t.epoch, t.height_m, t.max_height_m, t.est_floors, t.area_m2, t.volume_m3, t.confidence",
    },
    "changes": {
        "table": "change_changefeature",
        "geom": "geometry",
        "props": "t.id, t.change_type, t.height_before_m, t.height_after_m, t.delta_height_m, t.area_m2, "
        "t.volume_delta_m3, t.confidence",
    },
}


def _check_tile(z, x, y):
    if not (0 <= z <= 22 and 0 <= x < 2**z and 0 <= y < 2**z):
        raise Http404("Tile out of range")


def _mvt(sql: str, params: list) -> HttpResponse:
    with connection.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
    data = bytes(row[0]) if row and row[0] else b""
    return HttpResponse(data, content_type=MVT)


@require_GET
@cache_control(public=True, max_age=3600)
def city_tile(request, city_slug: str, layer: str, z: int, x: int, y: int):
    """Precomputed showcase buildings or changes for one city."""
    _check_tile(z, x, y)
    spec = LAYERS.get(layer)
    if spec is None:
        raise Http404("Unknown layer")
    city = City.objects.filter(slug=city_slug).only("id").first()
    if city is None:
        raise Http404("Unknown city")
    sql = f"""
        WITH b AS (SELECT ST_TileEnvelope(%s, %s, %s) AS env),
        m AS (
            SELECT ST_AsMVTGeom(ST_Transform(t.{spec['geom']}, 3857), b.env, 4096, 64, true) AS geom, {spec['props']}
            FROM {spec['table']} t, b
            WHERE t.city_id = %s
              AND t.{spec['geom']} && ST_Transform(b.env, 4326)
        )
        SELECT ST_AsMVT(m.*, %s, 4096, 'geom') FROM m WHERE m.geom IS NOT NULL
    """
    return _mvt(sql, [z, x, y, city.id, layer])


@require_GET
@cache_control(public=True, max_age=86400)
def coverage_tile(request, z: int, x: int, y: int):
    """LiDAR survey boundaries (simplified) for the coverage layer."""
    _check_tile(z, x, y)
    # Coarser geometry at low zooms keeps national-scale tiles small.
    tolerance = 0.0 if z >= 9 else 4000.0 / (2**z)
    sql = """
        WITH b AS (SELECT ST_TileEnvelope(%s, %s, %s) AS env),
        m AS (
            SELECT ST_AsMVTGeom(
                       ST_SimplifyPreserveTopology(ST_Transform(d.coverage_simplified, 3857), %s),
                       b.env, 4096, 64, true) AS geom,
                   d.id, d.name, d.acquisition_year AS year, d.point_density_ppm2 AS density, d.provider
            FROM cities_dataset d, b
            WHERE d.is_active AND d.coverage_simplified && ST_Transform(b.env, 4326)
        )
        SELECT ST_AsMVT(m.*, 'coverage', 4096, 'geom') FROM m WHERE m.geom IS NOT NULL
    """
    return _mvt(sql, [z, x, y, tolerance])
