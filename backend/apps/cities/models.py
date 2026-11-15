from django.contrib.gis.db import models

from apps.common.models import TimeStampedModel


class City(TimeStampedModel):
    """A place with precomputed showcase results (or simply a search shortcut)."""

    name = models.CharField(max_length=120)
    country = models.CharField(max_length=80, default="United States")
    slug = models.SlugField(unique=True)
    center = models.PointField(srid=4326)
    default_zoom = models.FloatField(default=14)
    bbox = models.PolygonField(srid=4326, null=True, blank=True)
    blurb = models.TextField(blank=True)
    is_showcase = models.BooleanField(default=False)
    # "measure" or "change": which showcase this city backs (blank if none).
    showcase_mode = models.CharField(max_length=10, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "cities"

    def __str__(self):
        return self.name


class Dataset(TimeStampedModel):
    """One LiDAR survey (a 3DEP project, an AHN edition, ...)."""

    class AccessType(models.TextChoices):
        EPT = "ept", "Entwine Point Tiles"
        TILES = "tiles", "Tile downloads"

    name = models.CharField(max_length=200, unique=True)
    provider = models.CharField(max_length=80)  # e.g. "usgs_3dep", "ahn"
    country = models.CharField(max_length=80)
    acquisition_year = models.PositiveSmallIntegerField(null=True, blank=True, db_index=True)
    point_count = models.BigIntegerField(null=True, blank=True)
    point_density_ppm2 = models.FloatField(null=True, blank=True)
    crs = models.CharField(max_length=40, blank=True)
    access_type = models.CharField(max_length=10, choices=AccessType.choices)
    source_url = models.URLField(max_length=500)
    license = models.CharField(max_length=200)
    attribution = models.CharField(max_length=300)
    coverage_polygon = models.MultiPolygonField(srid=4326, spatial_index=True)
    coverage_simplified = models.MultiPolygonField(srid=4326, null=True, blank=True)
    # None = not yet sampled. Set by the pipeline after it first reads the data.
    has_building_class = models.BooleanField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-acquisition_year", "name"]

    def __str__(self):
        return f"{self.name} ({self.acquisition_year or 'year unknown'})"
