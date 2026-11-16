# Deploying SKYSCAN

Nothing is deployed from this repository automatically. This is how to run the
production stack on one Linux host with Docker (a 4 vCPU / 8 GB VM is enough for
a few concurrent jobs).

## 1. Configure

Create `.env.prod` in the repository root (never commit it):

```
SECRET_KEY=<long random string>
ALLOWED_HOSTS=skyscan.example.com
CORS_ALLOWED_ORIGINS=https://skyscan.example.com
CSRF_TRUSTED_ORIGINS=https://skyscan.example.com
DB_NAME=skyscan
DB_USER=skyscan
DB_PASSWORD=<strong password>
DB_PORT=5432
MEDIA_ROOT=/data/media
SKYSCAN_WORK_DIR=/data/work
SKYSCAN_CACHE_DIR=/data/cache
MAX_CONCURRENT_JOBS=4
JOB_CREATE_RATE=10/hour
VITE_MAPBOX_TOKEN=<Mapbox public token, URL-restricted to your domain>
SENTRY_DSN=
```

## 2. Start

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

This runs PostGIS, Redis, the API under gunicorn, a Celery worker, and nginx on
port 80 serving the built frontend and proxying `/api`.

## 3. Load data and showcases (once)

```bash
docker compose -f docker-compose.prod.yml exec api python manage.py load_3dep_index
docker compose -f docker-compose.prod.yml exec api python manage.py load_ahn_index
docker compose -f docker-compose.prod.yml exec api python manage.py precompute_city midtown-manhattan
docker compose -f docker-compose.prod.yml exec api python manage.py precompute_change denver-union-station
docker compose -f docker-compose.prod.yml exec api python manage.py createsuperuser
```

## 4. HTTPS

Production settings redirect to HTTPS and set secure cookies, so put a TLS
terminator in front that forwards `X-Forwarded-Proto`. The repository includes
a Caddy layer that gets a Let's Encrypt certificate automatically. Add to
`.env.prod`:

```
SITE_HOST=skyscan.example.com   # any name that resolves to the host
HTTP_PORT=127.0.0.1:8080        # nginx stays local; Caddy owns 80 and 443
```

and start with both files:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.caddy.yml --env-file .env.prod up -d --build
```

Without a domain, `<ip-with-dashes>.sslip.io` (for example
`203-0-113-7.sslip.io`) resolves to that IP and works with Let's Encrypt.
Open ports 80 and 443 in the cloud firewall and on the host.

## 5. Frontend on a separate host (optional)

nginx already serves the frontend. To host it elsewhere (for example Vercel,
using `frontend/vercel.json`), set these on that host and add its origin to
`CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS` in `.env.prod`:

```
VITE_API_BASE_URL=https://skyscan.example.com/api
VITE_MAPBOX_TOKEN=<Mapbox public token>
```

## ARM hosts

The stack builds on arm64 (for example Ampere VMs). The database image is built
from `docker/postgis`, because `postgis/postgis` publishes amd64 images only.

## Notes

- Job outputs (point clouds) and caches live in the `skyscan_data` volume.
  Media storage is configurable through `MEDIA_ROOT`; swap Django's default
  storage for S3 if you run more than one API host.
- Scale processing with `WORKER_CONCURRENCY` or more `worker` replicas; each
  1 km² job can use 1-2 GB of memory.
- Refresh the survey index occasionally with `load_3dep_index` (USGS adds
  projects).
