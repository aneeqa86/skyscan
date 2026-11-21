import uuid

from django.contrib.gis.db import models


class Job(models.Model):
    class Mode(models.TextChoices):
        MEASURE = "measure", "Measure"
        CHANGE = "change", "Change"

    class Status(models.TextChoices):
        QUEUED = "queued"
        FETCHING = "fetching"
        CLASSIFYING = "classifying"
        RASTERIZING = "rasterizing"
        VECTORIZING = "vectorizing"
        COMPARING = "comparing"
        VALIDATING = "validating"
        DONE = "done"
        FAILED = "failed"

    TERMINAL = (Status.DONE, Status.FAILED)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    mode = models.CharField(max_length=10, choices=Mode.choices)
    aoi = models.PolygonField(srid=4326)
    dataset = models.ForeignKey(
        "cities.Dataset", on_delete=models.PROTECT, related_name="jobs", null=True, blank=True
    )
    dataset_before = models.ForeignKey(
        "cities.Dataset", on_delete=models.PROTECT, related_name="jobs_before", null=True, blank=True
    )
    city = models.ForeignKey(
        "cities.City", on_delete=models.SET_NULL, related_name="jobs", null=True, blank=True
    )
    status = models.CharField(
        max_length=15, choices=Status.choices, default=Status.QUEUED, db_index=True
    )
    progress = models.PositiveSmallIntegerField(default=0)
    stage_message = models.CharField(max_length=300, blank=True)
    params = models.JSONField(default=dict, blank=True)
    stats = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)
    area_km2 = models.FloatField(default=0)
    client_ip = models.GenericIPAddressField(null=True, blank=True)
    is_showcase = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.mode} {self.id} [{self.status}]"

    @property
    def is_finished(self):
        return self.status in self.TERMINAL


class Building(models.Model):
    class Epoch(models.TextChoices):
        SINGLE = "single"
        BEFORE = "before"
        AFTER = "after"

    job = models.ForeignKey(
        Job, on_delete=models.CASCADE, related_name="buildings", null=True, blank=True
    )
    city = models.ForeignKey(
        "cities.City", on_delete=models.CASCADE, related_name="buildings", null=True, blank=True
    )
    epoch = models.CharField(
        max_length=8, choices=Epoch.choices, default=Epoch.SINGLE, db_index=True
    )
    footprint = models.PolygonField(srid=4326, spatial_index=True)
    area_m2 = models.FloatField()
    height_m = models.FloatField(help_text="p90 height above ground")
    max_height_m = models.FloatField()
    est_floors = models.PositiveSmallIntegerField()
    volume_m3 = models.FloatField()
    point_count = models.PositiveIntegerField(default=0)
    confidence = models.FloatField()
    ndvi = models.FloatField(null=True, blank=True, help_text="mean NDVI from aerial imagery, if available")

    class Meta:
        indexes = [models.Index(fields=["job", "epoch"])]


class ReferenceFootprint(models.Model):
    """Third-party footprints (Overture / OSM) fetched to validate a measure job."""

    job = models.ForeignKey(Job, on_delete=models.CASCADE, related_name="reference_footprints")
    source = models.CharField(max_length=20)  # "overture" | "osm"
    source_id = models.CharField(max_length=80, blank=True)
    footprint = models.PolygonField(srid=4326)
    height_m = models.FloatField(null=True, blank=True)
    matched = models.BooleanField(default=False)
    iou = models.FloatField(null=True, blank=True)
