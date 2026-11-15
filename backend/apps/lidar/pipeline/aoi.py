"""AOI validation and local projection helpers."""
from __future__ import annotations

import json
import math

from django.conf import settings
from django.contrib.gis.geos import GEOSGeometry, MultiPolygon, Polygon
from pyproj import Geod

_GEOD = Geod(ellps="WGS84")


class AoiError(ValueError):
    """Raised when an AOI cannot be processed. The message is shown to users."""


def parse_aoi(value) -> Polygon:
    """Accept GeoJSON (dict or str), WKT or a GEOS geometry; return a valid EPSG:4326 Polygon."""
    if isinstance(value, (Polygon, MultiPolygon)):
        geom = value.clone()
    else:
        if isinstance(value, dict):
            if value.get("type") == "Feature":
                value = value.get("geometry")
            value = json.dumps(value)
        try:
            geom = GEOSGeometry(value)
        except Exception as exc:  # GEOS raises several types
            raise AoiError("The area could not be read. Send a GeoJSON Polygon.") from exc
    if geom.srid is None:
        geom.srid = 4326
    elif geom.srid != 4326:
        geom.transform(4326)
    if geom.geom_type == "MultiPolygon":
        if len(geom) != 1:
            raise AoiError("Draw a single area, not several.")
        geom = geom[0]
    if geom.geom_type != "Polygon":
        raise AoiError("The area must be a polygon.")
    if geom.empty:
        raise AoiError("The area is empty.")
    if not geom.valid:
        # make_valid keeps every part of the drawn area; if that yields more
        # than one polygon (a bow-tie), refuse rather than silently drop a part.
        fixed = geom.make_valid()
        if fixed.geom_type != "Polygon" or fixed.empty:
            raise AoiError("The area outline crosses itself. Redraw it.")
        geom = fixed
    xmin, ymin, xmax, ymax = geom.extent
    if not (-180 <= xmin <= 180 and -180 <= xmax <= 180 and -90 <= ymin <= 90 and -90 <= ymax <= 90):
        raise AoiError("Coordinates must be longitude/latitude in degrees.")
    geom.srid = 4326
    return geom


def area_km2(geom: Polygon) -> float:
    from shapely import wkb

    area, _ = _GEOD.geometry_area_perimeter(wkb.loads(bytes(geom.wkb)))
    return abs(area) / 1e6


def max_area_km2(mode: str) -> float:
    return settings.MAX_AOI_KM2_CHANGE if mode == "change" else settings.MAX_AOI_KM2_MEASURE


def validate_aoi(value, mode: str = "measure") -> tuple[Polygon, float]:
    geom = parse_aoi(value)
    km2 = area_km2(geom)
    limit = max_area_km2(mode)
    if km2 > limit:
        raise AoiError(
            f"The area is {km2:.2f} km², above the {limit:g} km² limit for {mode} mode. Draw a smaller area."
        )
    if km2 < 0.0005:
        raise AoiError("The area is too small (under 500 m²). Draw a larger area.")
    return geom, km2


def utm_epsg(lon: float, lat: float) -> int:
    """EPSG code of the WGS84 UTM zone containing a point, with the Norway/Svalbard exceptions."""
    if not (-80 <= lat <= 84):
        raise AoiError("Latitude is outside the UTM range (80°S to 84°N).")
    zone = int(math.floor((lon + 180) / 6)) + 1
    zone = min(max(zone, 1), 60)
    if 56 <= lat < 64 and 3 <= lon < 12:
        zone = 32
    elif 72 <= lat < 84:
        if 0 <= lon < 9:
            zone = 31
        elif 9 <= lon < 21:
            zone = 33
        elif 21 <= lon < 33:
            zone = 35
        elif 33 <= lon < 42:
            zone = 37
    return (32600 if lat >= 0 else 32700) + zone


def aoi_utm_epsg(geom: Polygon) -> int:
    c = geom.centroid
    return utm_epsg(c.x, c.y)
