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

    class Meta:
        ordering = ["-area_m2"]
