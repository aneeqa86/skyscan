from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from apps.cities.api import CityViewSet, DatasetViewSet
from apps.detection.api import JobViewSet


def health(_request):
    return JsonResponse({"status": "ok"})


router = DefaultRouter()
router.register("cities", CityViewSet, basename="city")
router.register("datasets", DatasetViewSet, basename="dataset")
router.register("jobs", JobViewSet, basename="job")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/tiles/", include("apps.tiles.urls")),
    path("api/", include(router.urls)),
    # Auto-generated API docs
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
