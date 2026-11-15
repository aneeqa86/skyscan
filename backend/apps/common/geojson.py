"""Fast GeoJSON FeatureCollections straight from PostGIS."""
import json

from django.contrib.gis.db.models.functions import AsGeoJSON
from django.http import HttpResponse


def feature_collection(queryset, geom_field: str, properties: list[str], extra: dict | None = None) -> dict:
    rows = queryset.annotate(_gj=AsGeoJSON(geom_field, precision=7)).values("id", "_gj", *properties)
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": r["id"],
                "geometry": json.loads(r["_gj"]),
                "properties": {"id": r["id"], **{p: r[p] for p in properties}},
            }
            for r in rows
        ],
        **(extra or {}),
    }


def geojson_response(data: dict, filename: str | None = None) -> HttpResponse:
    resp = HttpResponse(json.dumps(data, separators=(",", ":")), content_type="application/geo+json")
    if filename:
        resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp
