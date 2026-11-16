# PostGIS on the official multi-arch postgres image. postgis/postgis is
# amd64-only, so production on ARM hosts (e.g. Ampere VMs) builds this instead.
FROM postgres:16-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-postgis-3 \
    && rm -rf /var/lib/apt/lists/*
