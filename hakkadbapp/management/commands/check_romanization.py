"""Validates hakkadbapp/romanization.json against the pronunciations in the DB.

    python manage.py check_romanization                 # validate + report gaps
    python manage.py check_romanization --csv out.csv   # + full comparison table
    python manage.py check_romanization --strict        # exit 1 on any gap (CI)
    python manage.py check_romanization --fixture       # refresh the JS parity fixture

A gap is a stored initial/final that some system has no explicit entry for:
it still renders (copied verbatim) but probably shouldn't.
"""
import csv
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from hakkadbapp import romanization
from hakkadbapp.models import Pronunciation

# Python's output for every stored syllable, which tests/romanization.test.js
# replays through Romanization.js to prove both engines agree.
FIXTURE_PATH = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "romanization_expected.json"


class Command(BaseCommand):
    help = "Validate romanization.json and report syllables lacking an explicit mapping."

    def add_arguments(self, parser):
        parser.add_argument("--csv", dest="csv_path", help="Write every stored syllable in every system to this CSV file.")
        parser.add_argument("--strict", action="store_true", help="Fail if any system has a gap.")
        parser.add_argument("--fixture", action="store_true", help=f"Rewrite {FIXTURE_PATH.name} for the JS parity test.")

    def handle(self, *args, csv_path=None, strict=False, fixture=False, **options):
        romanization.load_config.cache_clear()
        try:
            config = romanization.load_config()
        except romanization.RomanizationConfigError as exc:
            raise CommandError(str(exc))

        ids = [s["id"] for s in config["systems"]]
        self.stdout.write(f"romanization.json OK (version {config['_version']}) : {', '.join(ids)}")

        inventory = sorted(set(
            Pronunciation.objects.values_list("initial__initial", "final__final")
        ))
        inventory = [(i or "", f or "") for i, f in inventory]
        self.stdout.write(f"{len(inventory)} syllabes (initiale+finale) distinctes en base.")

        gaps = romanization.missing_entries(inventory)
        for sid, missing in gaps.items():
            if missing["initials"]:
                self.stdout.write(self.style.WARNING(
                    f"  [{sid}] initiales sans correspondance : {', '.join(repr(i) for i in missing['initials'])}"))
            if missing["finals"]:
                self.stdout.write(self.style.WARNING(
                    f"  [{sid}] finales sans correspondance : {', '.join(repr(f) for f in missing['finals'])}"))
        if not gaps:
            self.stdout.write(self.style.SUCCESS("Toutes les initiales/finales en base ont une correspondance explicite."))

        if csv_path:
            self._write_csv(csv_path, inventory, ids)
            self.stdout.write(f"Tableau écrit dans {csv_path}")

        if fixture:
            self._write_fixture(config, inventory, ids)
            self.stdout.write(f"Fixture écrite dans {FIXTURE_PATH}")

        if strict and gaps:
            raise CommandError("Correspondances manquantes (voir ci-dessus).")

    def _write_csv(self, path, inventory, ids):
        with open(path, "w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(["initial", "final", *ids])
            for i, f in inventory:
                writer.writerow([i, f, *(romanization.romanize(i, f, "", sid) for sid in ids)])

    def _write_fixture(self, config, inventory, ids):
        cases = [
            [i, f, t, sid, romanization.romanize(i, f, t, sid)]
            for i, f in inventory
            for t in ("", "1", "5")
            for sid in ids
        ]
        FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
        # One case per line: readable diffs when a mapping changes.
        lines = ",\n".join(json.dumps(c, ensure_ascii=False) for c in cases)
        FIXTURE_PATH.write_text(
            f'{{"version": "{config["_version"]}", "cases": [\n{lines}\n]}}\n', encoding="utf-8"
        )
