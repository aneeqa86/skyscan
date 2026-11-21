from django.contrib.gis.db import models


class ChangeFeature(models.Model):
    class ChangeType(models.TextChoices):
        NEW = "new"
        DEMOLISHED = "demolished"
        RAISED = "raised"
        LOWERED = "lowered"
        EXTENDED = "extended"
        REDUCED = "reduced"

    job = models.ForeignKey("detection.Job", on_delete=models.CASCADE, related_name="changes")
    city = models.ForeignKey(
        "cities.City", on_delete=models.CASCADE, related_name="changes", null=True, blank=True
    )
    geometry = models.PolygonField(srid=4326, spatial_index=True)
    change_type = models.CharField(max_length=12, choices=ChangeType.choices, db_index=True)
    height_before_m = models.FloatField(null=True, blank=True)
    height_after_m = models.FloatField(null=True, blank=True)
    delta_height_m = models.FloatField()
    area_m2 = models.FloatField()
    volume_delta_m3 = models.FloatField()
    confidence = models.FloatField()

    # Aerial imagery check (apps.imagery): does the imagery agree, and when did it change?
    class ImageryStatus(models.TextChoices):
        CONFIRMED = "confirmed"
        LIKELY = "likely"
        NOT_VISIBLE = "not_visible"
        VEGETATION = "vegetation"
        TOO_SMALL = "too_small"
        NO_IMAGERY = "no_imagery"

    imagery_status = models.CharField(max_length=12, choices=ImageryStatus.choices, blank=True, db_index=True)
    imagery_score = models.FloatField(null=True, blank=True)
    imagery_first_year = models.PositiveSmallIntegerField(null=True, blank=True)
    imagery_window_start = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-area_m2"]
