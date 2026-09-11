import datetime
import json
from pathlib import Path

import pandas as pd
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from openpyxl import Workbook

from hakkadbapp.management.commands.export import find_latest_dated_corpus_dir
from hakkadbapp.management.commands.import_expressions_v2 import import_expressions_from_df
from hakkadbapp.management.commands.import_words_v2 import import_words_from_df

# Headers read directly off the live GONG HAKKA sheet (the doc `import_v2`
# rebuilds the DB from) -- keep these byte-for-byte in sync with
# analytics.html's MOTS_HEADERS/EXPRESSIONS_HEADERS if the sheet ever
# changes, including the trailing space in "OBSERVATIONS ".
MOTS_HEADERS = [
    "FRANCAIS", "PINYIN (manuel)", "PINYIN (auto)", "SINOGRAMME",
    "CW", "JFW", "GM", "DS", "TA", "THEMES", "OBSERVATIONS ", "STATUT", "ANGLAIS",
]
EXPRESSIONS_HEADERS = [
    "FRANCAIS", "SINOGRAMME", "PINYIN (AUTO)", "NOUVEAUX MOTS",
    "CW", "JFW", "GM", "DS", "TA", "THEMES", "OBSERVATIONS ", "STATUT", "ANGLAIS", "MOTS INCONNUS",
]

SUP_TO_DIGIT = str.maketrans({"¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6"})


def to_digit_pinyin(pinyin):
    return (pinyin or "").translate(SUP_TO_DIGIT)


def split_target(target):
    """target is "<space-separated pinyin words> <concatenated hanzi>" -- the
    hanzi block has no internal spaces, so it's always the trailing token."""
    target = target or ""
    idx = target.rfind(" ")
    if idx == -1:
        return target, ""
    return target[:idx], target[idx + 1:]


def theme_names(theme_ids, theme_map):
    """Comma-joined theme names -- matches the DB's own convention for
    expressions, where category is already treated as comma-separated
    (see export.py's `expr.category.split(",")`)."""
    return ", ".join(theme_map.get(tid, tid) for tid in (theme_ids or []))


def primary_theme_name(theme_ids, theme_map, max_length):
    """Word.category is a single CharField(max_length=20) with no
    comma-splitting convention anywhere (unlike Expression.category) -- a
    platform word can carry several theme ids, but only the first one fits
    here. Truncated defensively; the longest real theme name is exactly 20
    chars, so this shouldn't normally bite."""
    ids = theme_ids or []
    if not ids:
        return ""
    return theme_map.get(ids[0], ids[0])[:max_length]


def word_row(payload, theme_map):
    tr = payload.get("translations", {}) or {}
    pinyin, hanzi = split_target(tr.get("target"))
    return {
        "FRANCAIS": tr.get("primary", ""),
        "PINYIN (manuel)": to_digit_pinyin(pinyin),
        "PINYIN (auto)": pinyin,
        "SINOGRAMME": hanzi,
        "CW": "", "JFW": "", "GM": "", "DS": "", "TA": "",
        "THEMES": primary_theme_name(payload.get("themes"), theme_map, max_length=20),
        "OBSERVATIONS ": "",
        "STATUT": "OK",
        "ANGLAIS": tr.get("secondary", ""),
    }


TONE_CHARS = set("¹²³⁴⁵⁶")


def syllable_count(pinyin_word):
    """Number of hanzi characters this pinyin "word" occupies. A real
    syllable always carries exactly one tone mark, so counting tone marks
    gives the syllable (= character) count directly -- e.g. "ngin²ga¹" has 2,
    so it's a 2-character word. A token with no tone mark at all isn't
    pinyin -- it's a punctuation/symbol token (",", "?", "...") carried
    through verbatim on the hanzi side, so it occupies exactly as many
    characters as its own text (handles multi-char runs like "..." too)."""
    tone_count = sum(1 for ch in pinyin_word if ch in TONE_CHARS)
    return tone_count or max(len(pinyin_word), 1)


def segment_hanzi_by_pinyin(pinyin_words, hanzi_concat, known_word_pinyin=None):
    """Reconstruct the space-separated hanzi phrase text_to_words.py expects
    directly from the authoritative hanzi text in `target`, by walking a
    cursor through it in syllable-count-sized steps -- rather than guessing
    from `components` (keyed "<word pinyin> <word hanzi>", but incomplete
    for words missing from the dictionary, and sometimes entirely empty).
    This always recovers the real hanzi, never a placeholder.

    A segment that comes out as nothing but dashes ("-", "--", ...) means
    the platform knows this word's pinyin but has no real hanzi for it yet
    -- the DB already has many *different* placeholder Words sharing that
    exact same dash-only hanzi (e.g. several unrelated words are all "--"),
    so leaving the segment bare would make text_to_words.py's exact-hanzi
    lookup match this word to whichever one of those happens to sort first,
    silently giving it a random unrelated pronunciation. Appending the
    pinyin inline ("--(pinyin)") uses the "-(pinyin)" placeholder-override
    syntax text_to_words.py's resolve_hanzi/resolve_pinyin already
    understand: since no real word's hanzi ever contains "(", this can't
    collide with an existing dash-only word, and the expression keeps its
    own actual reading.

    A segment can also be real hanzi that simply has no *standalone* Word of
    its own in wordCorpus.json (e.g. it only ever shows up inside larger
    expressions) -- `known_word_pinyin` maps each dictionary word's hanzi to
    the pinyin reading(s) it's imported with. When a segment's hanzi isn't in
    there with this exact reading, there's no Word row for
    convert_phrase_to_word_data to match against, so it would otherwise fall
    back to a global per-character Pronunciation lookup that may be missing
    or ambiguous (multiple homonyms). Appending the same "(pinyin)" override
    used for dashes pins it to the platform's actual reading, e.g.
    "shit⁶ lang⁴ mi³ 食浪米" (浪 missing from the dictionary) renders as
    "食 浪(lang4) 米" -- 食 and 米 are real dictionary words so are left bare."""
    known_word_pinyin = known_word_pinyin or {}
    segments = []
    cursor = 0
    for word in pinyin_words:
        n = syllable_count(word)
        segment = hanzi_concat[cursor:cursor + n]
        if segment and set(segment) == {"-"}:
            segment = f"{segment}({to_digit_pinyin(word)})"
        elif segment and word not in known_word_pinyin.get(segment, ()):
            segment = f"{segment}({to_digit_pinyin(word)})"
        segments.append(segment)
        cursor += n
    if segments and cursor < len(hanzi_concat):
        segments[-1] += hanzi_concat[cursor:]
    return segments


def known_word_pinyin_map(words):
    """Maps each dictionary word's hanzi to the pinyin reading(s) it's
    imported with, so segment_hanzi_by_pinyin can tell a real dictionary
    word apart from hanzi that only ever appears inside expressions."""
    known = {}
    for payload in words.values():
        tr = payload.get("translations", {}) or {}
        w_pinyin, w_hanzi = split_target(tr.get("target"))
        if w_hanzi:
            known.setdefault(w_hanzi, set()).add((w_pinyin or "").replace(" ", ""))
    return known


def expression_row(payload, theme_map, known_word_pinyin=None):
    """Mirrors analytics.html's expressionRowFromPayload() -- keep both in sync."""
    tr = payload.get("translations", {}) or {}
    pinyin, hanzi_concat = split_target(tr.get("target"))
    pinyin_words = pinyin.split(" ") if pinyin else []
    phrase = " ".join(segment_hanzi_by_pinyin(pinyin_words, hanzi_concat, known_word_pinyin))

    return {
        "FRANCAIS": tr.get("primary", ""),
        "SINOGRAMME": phrase,
        "PINYIN (AUTO)": pinyin,
        "NOUVEAUX MOTS": "",
        "CW": "", "JFW": "", "GM": "", "DS": "", "TA": "",
        "THEMES": theme_names(payload.get("themes"), theme_map)[:50],  # Expression.category is CharField(max_length=50)
        "OBSERVATIONS ": "",
        "STATUT": "OK",
        "ANGLAIS": tr.get("secondary", ""),
        "MOTS INCONNUS": "",
    }


def write_sheet(workbook, sheet_name, headers, rows):
    sheet = workbook.create_sheet(sheet_name)
    sheet.append(headers)
    for row in rows:
        sheet.append([row.get(h, "") for h in headers])


class Command(BaseCommand):
    help = (
        "Read a platform reference corpus (../e_reo_json/<dd_mm_yyyy>/ -- "
        "wordCorpus.json, expressionCorpus.json, themeCorpus.json), convert "
        "it into the GONG HAKKA sheet's MOTS/EXPRESSIONS layout, and import "
        "it into the personal Vercel DB using the exact same import logic "
        "as `manage.py import_v2` (import_words_from_df / "
        "import_expressions_from_df). Without --yes, only the .xlsx is "
        "written -- pass --yes to actually run the import, which WIPES and "
        "rebuilds Word/Expression/Pronunciation and related tables, same as "
        "import_v2 already does from the Google Sheet."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--corpus-dir",
            type=str,
            default="",
            help="Explicit ../e_reo_json/<dd_mm_yyyy> folder, instead of auto-detecting the most recent date.",
        )
        parser.add_argument(
            "--output",
            type=str,
            default="",
            help="Output .xlsx path. Default: ../platform_sheet_<timestamp>.xlsx",
        )
        parser.add_argument(
            "--yes",
            action="store_true",
            help=(
                "Actually import into the Vercel DB. Without this flag the command "
                "only generates the spreadsheet, so you can review it first -- this "
                "matches how destructive `manage.py import_v2` already is, just not "
                "silently so."
            ),
        )

    def handle(self, *args, **options):
        base_corpus_dir = Path("../e_reo_json")
        if options.get("corpus_dir"):
            corpus_dir = Path(options["corpus_dir"])
        else:
            corpus_dir = find_latest_dated_corpus_dir(base_corpus_dir)

        if not corpus_dir or not corpus_dir.is_dir():
            raise CommandError(
                f"No dated platform corpus folder found under {base_corpus_dir} "
                "(expected e.g. ../e_reo_json/02_09_2026/ containing "
                "wordCorpus.json, expressionCorpus.json and themeCorpus.json). "
                "Pass --corpus-dir to point at one explicitly."
            )

        self.stdout.write(self.style.SUCCESS(f"Reading platform reference corpus: {corpus_dir}/"))

        words = self.load_json(corpus_dir / "wordCorpus.json")
        expressions = self.load_json(corpus_dir / "expressionCorpus.json")
        themes = self.load_json(corpus_dir / "themeCorpus.json")

        theme_map = {
            theme_id: (payload.get("translations", {}) or {}).get("primary", theme_id)
            for theme_id, payload in themes.items()
        }

        word_rows = [word_row(payload, theme_map) for payload in words.values()]
        word_rows.sort(key=lambda r: r["SINOGRAMME"])

        known_word_pinyin = known_word_pinyin_map(words)
        expression_rows = [
            expression_row(payload, theme_map, known_word_pinyin) for payload in expressions.values()
        ]
        expression_rows.sort(key=lambda r: r["SINOGRAMME"])

        # Written unconditionally: an audit trail of exactly what will be (or
        # would have been) imported, in the same shape a human reviewing the
        # real Google Sheet would see.
        workbook = Workbook()
        workbook.remove(workbook.active)
        write_sheet(workbook, "MOTS", MOTS_HEADERS, word_rows)
        write_sheet(workbook, "EXPRESSIONS", EXPRESSIONS_HEADERS, expression_rows)

        if options.get("output"):
            output_path = Path(options["output"])
        else:
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = Path(f"../platform_sheet_{timestamp}.xlsx")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        workbook.save(output_path)

        self.stdout.write(self.style.SUCCESS(
            f"Wrote {len(word_rows)} words and {len(expression_rows)} expressions to {output_path}"
        ))

        if not options.get("yes"):
            self.stdout.write(self.style.WARNING(
                "Dry run: the Vercel DB was NOT touched. Re-run with --yes to actually "
                "import this into the DB (Word/Expression/Pronunciation tables get wiped "
                "and rebuilt from this data, exactly like `manage.py import_v2` does)."
            ))
            return

        # Feed the in-memory rows straight into the same DataFrame-shaped
        # import functions import_v2 uses for the Google Sheet, rather than
        # re-reading the .xlsx just written -- same columns, same dtypes
        # (plain strings throughout, never NaN), so behaves identically.
        words_df = pd.DataFrame(word_rows, columns=MOTS_HEADERS)
        expressions_df = pd.DataFrame(expression_rows, columns=EXPRESSIONS_HEADERS)

        self.stdout.write(self.style.WARNING(
            "Importing into the Vercel DB -- Word/Expression/Pronunciation tables will be wiped and rebuilt."
        ))
        # Stashed on the Traces row created below so any deployed view can
        # query the exact platform snapshot this import ran against -- e_reo_json/
        # itself only exists on a developer's machine, never on Vercel.
        platform_data = {
            "corpus_dir": str(corpus_dir),
            "words": words,
            "expressions": expressions,
            "themes": themes,
        }

        with transaction.atomic():
            word_result = import_words_from_df(
                words_df, reset=True, traces_details=f"Source: platform_to_vercel ({corpus_dir})",
                platform_data=platform_data,
            )
            expression_result = import_expressions_from_df(expressions_df, reset=True)

        self.stdout.write(self.style.SUCCESS(
            f"Words imported: {word_result['rows_imported']} | Pronunciations: {word_result['pronunciations']}"
        ))
        self.stdout.write(self.style.SUCCESS(f"Expressions imported: {expression_result['rows_imported']}"))

        if word_result["logs"]:
            self.stdout.write(self.style.WARNING("Word import errors/skips:"))
            for line in word_result["logs"]:
                self.stdout.write(line)

        if expression_result["unknown_tokens"]:
            self.stdout.write(self.style.WARNING("Unknown tokens in expressions:"))
            for line in expression_result["unknown_tokens"]:
                self.stdout.write(line)

    @staticmethod
    def load_json(path):
        if not path.exists():
            return {}
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
