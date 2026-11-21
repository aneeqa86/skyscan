from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("change", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="changefeature",
            name="imagery_status",
            field=models.CharField(
                blank=True,
                choices=[
                    ("confirmed", "Confirmed"),
                    ("likely", "Likely"),
                    ("not_visible", "Not Visible"),
                    ("vegetation", "Vegetation"),
                    ("too_small", "Too Small"),
                    ("no_imagery", "No Imagery"),
                ],
                db_index=True,
                max_length=12,
            ),
        ),
        migrations.AddField(
            model_name="changefeature",
            name="imagery_score",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="changefeature",
            name="imagery_first_year",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="changefeature",
            name="imagery_window_start",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
    ]
