"""
base.py — Abstract base model every concrete model should inherit from.
"""
from django.db import models


class TimeStampedModel(models.Model):
    """Adds created_at / updated_at to every model that inherits it."""

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ["-created_at"]
