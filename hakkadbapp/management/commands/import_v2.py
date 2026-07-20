
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from .sheet_loader import open_workbook
from .import_words_v2 import import_words_from_df, read_words_sheet
from .import_expressions_v2 import import_expressions_from_df, read_expressions_sheet

SHEET_IDS = [
    "15qOsTs4ma8Vu3oCGXI61Vvu5oyzVdrS0T-NjRIhTsFY", # Déploiement
    # "1Dd6XusiGslhTLrLnqhJI-kvRaFQG4HtOpIDondDXXxc", # Travail
]

class Command(BaseCommand):
    help = "Importe les mots et expressions depuis le Google Sheet GONG HAKKA"

    def handle(self, *args, **options):
        reset = True
        for sheet_id in SHEET_IDS:
            self.stdout.write(f"=== Importing sheet: {sheet_id} ===")
            excel_file = open_workbook(sheet_id)
            words_df = read_words_sheet(excel_file)
            expressions_df = read_expressions_sheet(excel_file)

            with transaction.atomic():
                word_result = import_words_from_df(
                    words_df,
                    reset=reset,
                    traces_details=f"Source import_v2: {sheet_id}",
                )
                expression_result = import_expressions_from_df(
                    expressions_df,
                    reset=reset,
                )

            self.stdout.write(self.style.SUCCESS(
                f"Mots importés: {word_result['rows_imported']} | "
                f"Prononciations: {word_result['pronunciations']}"
            ))
            self.stdout.write(self.style.SUCCESS(
                f"Expressions importées: {expression_result['rows_imported']}"
            ))

            if word_result["logs"]:
                self.stdout.write(self.style.WARNING("Erreurs / lignes ignorées:"))
                for line in word_result["logs"]:
                    self.stdout.write(line)

            if expression_result["unknown_tokens"]:
                self.stdout.write(self.style.WARNING("Tokens inconnus dans les expressions:"))
                for line in expression_result["unknown_tokens"]:
                    self.stdout.write(line)
            reset = False