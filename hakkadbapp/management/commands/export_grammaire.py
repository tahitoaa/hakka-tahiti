"""Exporte la grammaire (étiquettes, règles, phrases, analyses) au format
d'échange commun tumu-kin : voir hakkadbapp/grammar_exchange.py.

    python manage.py export_grammaire grammaire-hakka.json
"""
import json

from django.core.management.base import BaseCommand

from hakkadbapp.grammar_exchange import export_grammar


class Command(BaseCommand):
    help = "Exporte la grammaire au format d'échange tumu-kin (JSON)."

    def add_arguments(self, parser):
        parser.add_argument("path", help="le fichier JSON à écrire")

    def handle(self, *args, **options):
        data = export_grammar()
        with open(options["path"], "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        self.stdout.write(f"{len(data['tags'])} étiquettes, {len(data['rules'])} règles, "
                          f"{len(data['sentences'])} phrases, {len(data['analyses'])} analyses -> {options['path']}")
