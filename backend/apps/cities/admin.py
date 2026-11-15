from django.contrib.gis import admin

from .models import City, Dataset


@admin.register(City)
class CityAdmin(admin.GISModelAdmin):
    list_display = ("name", "country", "slug", "is_showcase", "showcase_mode")
    list_filter = ("is_showcase", "country")
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Dataset)
class DatasetAdmin(admin.GISModelAdmin):
    list_display = (
        "name",
        "provider",
        "country",
        "acquisition_year",
        "point_density_ppm2",
        "has_building_class",
        "is_active",
    )
    list_filter = ("provider", "country", "access_type", "has_building_class", "is_active")
    search_fields = ("name",)
    readonly_fields = ("created_at", "updated_at")
    exclude = ("coverage_simplified",)
