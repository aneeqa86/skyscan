# SKYSCAN backend

Django 5.2 + Django REST Framework + GeoDjango + Celery, with PDAL and GDAL from conda-forge.
Runs in Docker Compose from the repository root (`docker compose up`). See the root README.

```
backend/
├── skyscan/            Django project (settings/base|local|production, celery, urls)
├── apps/
│   ├── common/         shared abstract models
│   ├── cities/         showcase cities, datasets, coverage
│   ├── lidar/          source adapters, tile cache, shared pipeline steps
│   ├── detection/      measure jobs, buildings, validation, export
│   ├── change/         change jobs, change features
│   └── tiles/          MVT endpoint
├── environment.yml     conda-forge geospatial stack
├── requirements.txt    pip packages on top of it
└── Dockerfile
```

API docs once running: http://localhost:8000/api/docs/
