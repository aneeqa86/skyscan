# Conda-forge base: PDAL + GDAL + python bindings without native build pain.
FROM mambaorg/micromamba:1.5.10

USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=$MAMBA_USER:$MAMBA_USER environment.yml /tmp/environment.yml
RUN micromamba install -y -n base -f /tmp/environment.yml && micromamba clean --all --yes

ARG MAMBA_DOCKERFILE_ACTIVATE=1
COPY --chown=$MAMBA_USER:$MAMBA_USER requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

WORKDIR /app
COPY --chown=$MAMBA_USER:$MAMBA_USER . /app
RUN mkdir -p /data/media /data/work /data/cache /app/staticfiles \
    && chown -R $MAMBA_USER:$MAMBA_USER /data /app/staticfiles

USER $MAMBA_USER
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PATH=/opt/conda/bin:$PATH \
    PROJ_DATA=/opt/conda/share/proj GDAL_DATA=/opt/conda/share/gdal
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/_entrypoint.sh"]
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py runserver 0.0.0.0:8000"]
