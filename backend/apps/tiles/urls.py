from django.urls import path

from . import views

urlpatterns = [
    path("coverage/<int:z>/<int:x>/<int:y>.mvt", views.coverage_tile, name="tile-coverage"),
    path("<slug:city_slug>/<str:layer>/<int:z>/<int:x>/<int:y>.mvt", views.city_tile, name="tile-city"),
]
