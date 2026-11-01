"""Readings of a character in the external dictionaries (Bao'an, McIver),
compared with its Wenfa readings from the lexicon.

The dictionaries are the compact files written by `manage.py
build_dict_index` (static/hakkadbapp/data/*.json, deployed with the app);
each is spelled in a system of romanization.json, whose mapping says which
Wenfa readings a dictionary reading stands for (romanization.source_to_stored).

Statuses, per Wenfa reading and per source:
    ok      a reading of the source stands for this Wenfa syllable and tone
    tone    ... for this syllable, but with another tone
    diff    no reading of the source stands for this syllable
    absent  the source doesn't have the character
"""
import json
from pathlib import Path

from opencc import OpenCC

from . import romanization

DATA_DIR = Path(__file__).with_name("static") / "hakkadbapp" / "data"

# Same dictionaries as the converter's buttons (converter.html).
SOURCES = [
    {"id": "baoan", "label": "Bao'an", "title": "客家話大辭典（寶安腔）, 陳志明",
     "file": "hakka_dict_prons.json", "system": "baoan"},
    {"id": "mciver", "label": "McIver", "title": "McIver, A Chinese-English Dictionary, Hakka-Dialect (Hakka Index)",
     "file": "mciver_prons.json", "system": "mciver"},
]

STATUS_LABELS = {"ok": "concorde", "tone": "ton différent", "diff": "différent", "absent": "absent"}
# Worst first: a character's status for a source is its worst reading's.
_SEVERITY = ["diff", "tone", "ok"]

_SUPERSCRIPT = str.maketrans("12345678", "¹²³⁴⁵⁶⁷⁸")
_s2t = OpenCC("s2t")
_t2s = OpenCC("t2s")
_cache = {}


def _readings_by_char(source):
    """{hanzi: [(syllable, tone)]} for one dictionary, keyed by both its
    traditional and simplified forms; reloaded when the file changes."""
    path = DATA_DIR / source["file"]
    if not path.exists():
        return {}
    mtime = path.stat().st_mtime_ns
    cached = _cache.get(source["id"])
    if cached and cached[0] == mtime:
        return cached[1]
    by_char = {}
    for row in json.loads(path.read_text(encoding="utf-8"))["prons"]:
        reading = (row[1], str(row[2]))
        for char in {row[0], row[3] if len(row) > 3 else row[0]}:
            readings = by_char.setdefault(char, [])
            if reading not in readings:
                readings.append(reading)
    _cache[source["id"]] = (mtime, by_char)
    return by_char


def source_readings(source, char):
    by_char = _readings_by_char(source)
    for form in (char, _s2t.convert(char), _t2s.convert(char)):
        if form in by_char:
            return by_char[form]
    return []


def wenfa_text(initial, final, tone):
    return f"{initial}{final}{str(tone or '').translate(_SUPERSCRIPT)}"


def compare_char(char, wenfa_readings):
    """Comparison of one character: `wenfa_readings` is [(initial, final,
    tone)] from the lexicon. Returns {"wenfa": [...], "sources": [...]} ready
    for components/source_comparison.html."""
    wenfa_readings = sorted(set((i or "", f or "", str(t or "")) for i, f, t in wenfa_readings))
    result = {
        "char": char,
        "wenfa": [{"text": wenfa_text(*w), "stored": "".join(w)} for w in wenfa_readings],
        "sources": [],
    }
    for source in SOURCES:
        readings = source_readings(source, char)
        entry = {**source, "readings": [], "per_wenfa": [], "expected": []}
        # What the mapping predicts for each Wenfa reading, in the source's spelling.
        for i, f, t in wenfa_readings:
            entry["expected"].append(romanization.romanize(i, f, t, source["system"]))
        if not readings:
            entry["status"] = "absent"
            entry["per_wenfa"] = ["absent"] * len(wenfa_readings)
            result["sources"].append(entry)
            continue
        matched = {}  # source reading index -> best status it reaches
        for i, f, t in wenfa_readings:
            best = "diff"
            for k, (syllable, tone) in enumerate(readings):
                for ci, cf, tones in romanization.source_to_stored(syllable, tone, source["system"], attested=False):
                    if (ci, cf) != (i, f):
                        continue
                    status = "ok" if tones is None or not t or t in tones else "tone"
                    if _SEVERITY.index(status) > _SEVERITY.index(matched.get(k, "diff")):
                        matched[k] = status
                    if _SEVERITY.index(status) > _SEVERITY.index(best):
                        best = status
            entry["per_wenfa"].append(best)
        entry["readings"] = [
            {"text": syllable + tone.translate(_SUPERSCRIPT), "match": matched.get(k)}
            for k, (syllable, tone) in enumerate(readings)
        ]
        entry["status"] = min(entry["per_wenfa"], key=_SEVERITY.index) if entry["per_wenfa"] else "diff"
        entry["status_label"] = STATUS_LABELS[entry["status"]]
        result["sources"].append(entry)
    for entry in result["sources"]:
        entry.setdefault("status_label", STATUS_LABELS[entry["status"]])
        entry["per_wenfa_labels"] = [STATUS_LABELS[s] for s in entry["per_wenfa"]]
    return result


def compare_pronunciations(char, pronunciations):
    """compare_char() for Pronunciation model instances."""
    return compare_char(char, [
        (p.initial.initial if p.initial else "", p.final.final if p.final else "", p.tone.tone_number if p.tone else "")
        for p in pronunciations
    ])
