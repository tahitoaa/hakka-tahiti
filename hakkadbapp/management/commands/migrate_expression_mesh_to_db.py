"""One-time migration: the old expression_mesh.csv (platform_id,
excel_format), keyed by a plain_hanzi(excel_format) match against
Expression.text, into the ExpressionNote DB table (see models.py /
expression_mesh.py), keyed by Expression.platform_id -- the real e_reo
platform id, only reliably available in the DB since platform_to_vercel
started carrying it through verbatim (see models.Expression.platform_id).

The CSV's own "platform_id" column is NOT trusted here: some of those
values were only ever a locally-minted uuid4 stand-in (from the old
expression_mesh.resolve_platform_id_for_expression, before this field
existed), not the platform's real id, so copying them across would
silently attach a note to the wrong (or a nonexistent) platform_id.
Instead every row is re-matched to its Expression the same way the old
code did (plain hanzi, disambiguation annotations stripped), and the
*Expression's own* platform_id field is used as the new key.

Run `manage.py platform_to_vercel --yes` FIRST so every Expression has its
platform_id populated -- otherwise every row here will fail to match.
"""
import csv
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from hakkadbapp.models import Expression, ExpressionNote
from hakkadbapp.text_to_words import resolve_hanzi

OLD_CSV_PATH = Path(settings.BASE_DIR) / "hakkadbapp" / "data" / "expression_mesh.csv"


def plain_hanzi(text):
    return "".join(resolve_hanzi(tok) for tok in (text or "").split())


class Command(BaseCommand):
    help = (
        "One-time migration of the old expression_mesh.csv into the ExpressionNote "
        "DB table, re-keyed by Expression.platform_id instead of the CSV's own "
        "(sometimes locally-minted) platform_id column. Run `platform_to_vercel "
        "--yes` first."
    )

    def handle(self, *args, **options):
        if not OLD_CSV_PATH.exists():
            self.stdout.write(self.style.WARNING(f"No {OLD_CSV_PATH} found -- nothing to migrate."))
            return

        with open(OLD_CSV_PATH, newline="", encoding="utf-8-sig") as f:
            old_rows = list(csv.DictReader(f))

        expr_by_hanzi = {}
        for expr in Expression.objects.all():
            expr_by_hanzi.setdefault(plain_hanzi(expr.text), []).append(expr)

        matched = 0
        no_platform_id = []
        unmatched = []

        for row in old_rows:
            excel_format = row.get("excel_format") or ""
            candidates = expr_by_hanzi.get(plain_hanzi(excel_format), [])
            if not candidates:
                unmatched.append(excel_format)
                continue
            expr = candidates[0]
            if not expr.platform_id:
                no_platform_id.append(excel_format)
                continue
            ExpressionNote.objects.update_or_create(
                platform_id=expr.platform_id,
                defaults={"excel_format": excel_format},
            )
            matched += 1

        self.stdout.write(self.style.SUCCESS(
            f"Migrated {matched}/{len(old_rows)} rows into ExpressionNote."
        ))
        if no_platform_id:
            self.stdout.write(self.style.WARNING(
                f"{len(no_platform_id)} row(s) matched an Expression with no platform_id yet "
                "(run `platform_to_vercel --yes` then re-run this command):"
            ))
            for excel_format in no_platform_id:
                self.stdout.write(f"  - {excel_format}")
        if unmatched:
            self.stdout.write(self.style.WARNING(
                f"{len(unmatched)} row(s) matched no current Expression (phrase changed or removed):"
            ))
            for excel_format in unmatched:
                self.stdout.write(f"  - {excel_format}")
