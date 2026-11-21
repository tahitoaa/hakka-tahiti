"""Réglages pour les tests qui ont besoin d'une base : SQLite en mémoire,
jamais la base de production (.env). Lancer :
    python manage.py test hakkadbapp --settings=hakkadbapp.settings_test
"""
from .settings import *  # noqa: F401,F403

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
