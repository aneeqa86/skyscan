from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("detection", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="building",
            name="ndvi",
            field=models.FloatField(blank=True, help_text="mean NDVI from aerial imagery, if available", null=True),
        ),
    ]
