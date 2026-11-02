"""Builds static/hakkadbapp/data/chappell_prons.json, the per-character
readings found in Chappell & Lamarre's grammar of the Basel Mission Hakka
texts (Sin-on dialect, Basel romanization), from the word list extracted
from the PDF (doc/extraction/Chappell_Lamarre_mots.tsv: Caractères,
Lecture (document), Sens (anglais), Type, Pages).

Each word's reading has one syllable per character, so each character gets
the syllable at its place. Cantonese examples quoted by the book (Jyutping:
"aa", "oe", "eo", initials j/z/c) are left out.

    python manage.py build_chappell_index ../doc/extraction/Chappell_Lamarre_mots.tsv
"""
import json
import re
from collections import defaultdict
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

DATA = Path(__file__).resolve().parents[2] / "static" / "hakkadbapp" / "data" / "chappell_prons.json"
SYLLABLE = re.compile(r"^(.*?)([0-9]?)$")
CANTONESE = re.compile(r"aa|oe|eo|^[jzc](?!h)")


class Command(BaseCommand):
    help = "Per-character readings from the Chappell & Lamarre word list (TSV)."

    def add_arguments(self, parser):
        parser.add_argument("tsv")

    def handle(self, *args, **options):
        path = Path(options["tsv"])
        if not path.exists():
            raise CommandError(f"Fichier introuvable : {path}")
        readings = defaultdict(list)     # char -> [(syllable, tone)]
        examples = defaultdict(list)     # char -> [[word, reading, gloss]]
        skipped = 0
        for line in path.read_text(encoding="utf-8").splitlines()[1:]:
            cells = line.split("\t")
            if len(cells) < 3:
                continue
            hanzi, reading, gloss = cells[0], cells[1].split(), cells[2]
            if len(hanzi) != len(reading) or any(CANTONESE.search(s) for s in reading):
                skipped += 1
                continue
            for char, syl in zip(hanzi, reading):
                syllable, tone = SYLLABLE.match(syl).groups()
                if (syllable, tone) not in readings[char]:
                    readings[char].append((syllable, tone))
                if len(examples[char]) < 3 and hanzi not in [e[0] for e in examples[char]]:
                    examples[char].append([hanzi, " ".join(reading), gloss])
        prons = [[char, syl, int(tone) if tone else None] for char, rs in readings.items() for syl, tone in rs]
        out = {
            "meta": {
                "source": "chappell", "title": "Chappell & Lamarre, A Grammar and Lexicon of Hakka (Basel Mission texts)",
                "author": "Hilary Chappell, Christine Lamarre", "romanization": "Basel Mission (Sin-on)",
                "count": len(prons), "words": sum(len(e) for e in examples.values()),
            },
            "prons": prons,
            "examples": examples,
        }
        DATA.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(
            f"{len(readings)} caractères, {len(prons)} lectures ({skipped} entrées écartées) → {DATA.name}"))
