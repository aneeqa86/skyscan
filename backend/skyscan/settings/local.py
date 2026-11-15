"""
Local development settings — never commit secrets here.
Copy .env.example → .env and fill in values.
"""
from .base import *  # noqa: F401, F403

DEBUG = True

INSTALLED_APPS += [  # noqa: F405
    "django_extensions",
]

# Relax security for local dev
CORS_ALLOW_ALL_ORIGINS = True

# Quieter logging in dev
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django.db.backends": {"level": "INFO"},
        "rasterio": {"level": "WARNING"},
        "urllib3": {"level": "WARNING"},
        "botocore": {"level": "WARNING"},
    },
}
