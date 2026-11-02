"""Builds the compact pronunciation files used by the converter's dictionary
modes ("Dictionnaire Bao'an", "McIver" -- static/hakkadbapp/js/converter.js).

    python manage.py build_dict_index              # every source
    python manage.py build_dict_index mciver       # one source

Sources live in hakkadbapp/data/pronunciation/ (git/vercel-ignored, so the
page can't load them in production). This writes only what the converter
needs -- readable (hanzi, syllable, tone) triples -- to static files that do
get deployed: hakkadbapp/static/hakkadbapp/data/<name>.json, rows of
[trad, syllable, tone, simp?], plus "pages" (the pages of each row, same
order: dictionary pages for Bao'an and McIver, PDF pages for the books) and
"low" (indexes of the rows the source marks confidence="low").

Bao'an and McIver feed the converter. The books (Chappell & Lamarre, Hakka
Made Easy, Sung Him Tong) feed only the Dictionnaire des caractères and the
correspondences, with their own tone numbers.

Tones are numbered like the Bao'an dictionary (traditional 8-tone order):
1 yinping, 2 yangping, 3 shangsheng, 5 qusheng, 7 yinru, 8 yangru -- so every
source shares one tone scale, and romanization.json's systems map Wenfa
tones onto it.

Rerun after every edit of a source file, then collectstatic (deploy.bat), then
`manage.py derive_source_mapping <source> --write` if the mapping should follow.
"""
import json
import re
import unicodedata
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from opencc import OpenCC

APP_DIR = Path(__file__).resolve().parents[2]
SOURCE_DIR = APP_DIR / "data" / "pronunciation"
TARGET_DIR = APP_DIR / "static" / "hakkadbapp" / "data"


# -- Bao'an: 客家話大辭典（寶安腔）, 陳志明 ------------------------------------
def baoan_readings(entry):
    """One reading per entry, syllable and tone already separated."""
    if entry.get("syllable") and entry.get("tone") is not None:
        yield entry["syllable"], int(entry["tone"])


# -- McIver: A Chinese-English Dictionary, Hakka-Dialect (Hakka index) -------
# Tones are diacritics on the vowel. Checked against the Bao'an dictionary on
# shared characters (see the converter's history): no mark = yinping (1),
# circumflex = yangping (2), acute = shangsheng (3), grave = qusheng (5); on
# -p/-t/-k syllables no mark = yinru (7) and acute (or grave) = yangru (8) --
# the opposite of the usual "dot for the upper entering tone" description,
# which the scan transcription doesn't carry anyway.
_MCIVER_TONE_MARKS = {"̂": 2, "́": 3, "̀": 5}
_MCIVER_STRIP = re.compile("[̀́̂̌]")  # tone marks (and a stray caron); ṳ's mark stays


def mciver_readings(entry):
    """Every reading of an entry. The raw strings sometimes hold several
    readings or editorial notes ("thò c. thùi", "fù: kú", "=neu", "sap (sa"):
    split on separators, drop abbreviations ("c.", "s.") and anything that
    isn't a plain syllable afterwards."""
    for detail in entry.get("readingsDetail") or [{"reading": r} for r in entry.get("readings", [])]:
        for token in re.split(r"[\s:;,=()]+", detail.get("reading") or ""):
            if not token or token.endswith("."):
                continue
            decomposed = unicodedata.normalize("NFD", token.lower())
            marks = [m for m in decomposed if m in _MCIVER_TONE_MARKS]
            syllable = unicodedata.normalize("NFC", _MCIVER_STRIP.sub("", decomposed))
            if not re.fullmatch(r"[a-zṳ]+", syllable):
                continue
            if syllable[-1] in "ptk":
                tone = 8 if marks else 7
            else:
                tone = _MCIVER_TONE_MARKS[marks[0]] if marks else 1
            yield syllable, tone


def book_readings(entry):
    """The book indexes (Chappell & Lamarre, Hakka Made Easy, Sung Him Tong):
    syllable and tone as the book writes them."""
    if entry.get("syllable") and entry.get("tone") is not None:
        yield entry["syllable"], int(entry["tone"])


SOURCES = {
    "chappell": {
        "file": "chappellLamarreIndex.json",
        "target": "chappell_lamarre_prons.json",
        "readings": book_readings,
    },
    "hme": {
        "file": "hakkaMadeEasyIndex.json",
        "target": "hakka_made_easy_prons.json",
        "readings": book_readings,
    },
    "sht": {
        "file": "sungHimTongIndex.json",
        "target": "sung_him_tong_prons.json",
        "readings": book_readings,
    },
    "baoan": {
        "file": "hakkaDictIndex.json",
        "target": "hakka_dict_prons.json",
        "readings": baoan_readings,
    },
    "mciver": {
        "file": "mciverIndex.json",
        "target": "mciver_prons.json",
        "readings": mciver_readings,
    },
}


class Command(BaseCommand):
    help = "Compact the dictionary indexes of data/pronunciation/ into the converter's static files."

    def add_arguments(self, parser):
        parser.add_argument("sources", nargs="*", help=f"Among {', '.join(SOURCES)} (default: all).")

    def handle(self, *args, sources, **options):
        unknown = set(sources) - set(SOURCES)
        if unknown:
            raise CommandError(f"Source(s) inconnue(s) : {', '.join(sorted(unknown))}")
        t2s = OpenCC("t2s")
        for name in sources or SOURCES:
            self.build(name, SOURCES[name], t2s)

    def build(self, name, spec, t2s):
        source = SOURCE_DIR / spec["file"]
        if not source.exists():
            raise CommandError(f"Fichier introuvable : {source}")
        data = json.loads(source.read_text(encoding="utf-8"))

        seen = {}
        prons, pages, low = [], [], []
        skipped = 0
        for entry in sorted(data["entries"].values(), key=lambda e: e.get("order", 0)):
            hanzi = entry.get("hanzi")
            readings = list(spec["readings"](entry)) if hanzi and entry.get("readable") else []
            if not readings:
                skipped += 1
                continue
            simp = t2s.convert(hanzi)
            entry_pages = [p for p in (entry.get("pages") or [entry.get("page")]) if p is not None]
            for syllable, tone in readings:
                key = (hanzi, syllable, tone)
                if key in seen:
                    k = seen[key]
                    pages[k] += [p for p in entry_pages if p not in pages[k]]
                    continue
                seen[key] = len(prons)
                if entry.get("confidence") == "low":
                    low.append(len(prons))
                # [trad, syllable, tone] or [trad, syllable, tone, simp] when they differ.
                prons.append([hanzi, syllable, tone] + ([simp] if simp != hanzi else []))
                pages.append(list(entry_pages))

        meta = data.get("meta", {})
        payload = {
            "meta": {
                "source": name,
                "title": meta.get("title", ""),
                "author": meta.get("author", ""),
                "tones": meta.get("tones", {}),
                "romanization": meta.get("romanization", ""),
                "count": len(prons),
            },
            "prons": prons,
            "pages": pages,
            "low": low,
        }
        target = TARGET_DIR / spec["target"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        size_kb = target.stat().st_size // 1024
        self.stdout.write(self.style.SUCCESS(
            f"[{name}] {len(prons)} prononciations écrites dans {target} ({size_kb} Ko) ; "
            f"{skipped} entrées illisibles ou sans lecture ignorées."
        ))
