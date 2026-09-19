import csv
import datetime
import json
import os
import shutil
import zipfile
from copy import deepcopy
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import models
from openpyxl import Workbook

from hakkadbapp.models import Expression, ExpressionWord, Word, WordPronunciation
import hakkadbapp.json_model as jsonm
import hakkadbapp.read_themes_corpus

superscript_map = {"1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶"}
reverse_superscript_map = {v: k for k, v in superscript_map.items()}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".flac", ".webm"}
DATE_FOLDER_FORMAT = "%d_%m_%Y"
ROW_HEADERS = ["word", "expression", "target", "pivot", "alternate", "themes", "audio", "image"]


def find_latest_dated_corpus_dir(base_dir):
    """Find the base_dir/<dd_mm_yyyy>/ subfolder with the most recent date.

    The platform reference corpus used to live flat in base_dir; it's now
    snapshotted into dated subfolders (e.g. 02_09_2026/) each time it's
    pulled from the platform, so "the current online corpus" means whichever
    such folder has the latest date. Returns None if base_dir has no dated
    subfolder (e.g. only the old flat files are present).
    """
    if not base_dir.is_dir():
        return None

    dated = []
    for child in base_dir.iterdir():
        if not child.is_dir():
            continue
        try:
            date = datetime.datetime.strptime(child.name, DATE_FOLDER_FORMAT).date()
        except ValueError:
            continue
        dated.append((date, child))

    if not dated:
        return None

    dated.sort(key=lambda pair: pair[0])
    return dated[-1][1]


class Command(BaseCommand):
    help = "Export words/expressions to XLSX/CSV/JSON with diff against reference corpora"

    def handle(self, *args, **options):
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

        export_dir = Path(f"../export_e_reo_{timestamp}")
        export_audio_dir = export_dir / "audio"
        export_image_dir = export_dir / "images"
        export_json_dir = export_dir / "json"
        export_csv_file = export_dir / "export.csv"
        export_xlsx_file = export_dir / "export.xlsx"

        export_dir.mkdir(parents=True, exist_ok=True)
        export_audio_dir.mkdir(parents=True, exist_ok=True)
        export_image_dir.mkdir(parents=True, exist_ok=True)
        export_json_dir.mkdir(parents=True, exist_ok=True)

        self.stdout.write(self.style.SUCCESS(f"Exporting to {export_dir}/"))

        # Reset in-memory registries before loading corpora.
        jsonm.Theme.reset()
        jsonm.Word.reset()
        jsonm.Expression.reset()

        base_corpus_dir = Path("../e_reo_json")
        corpus_dir = find_latest_dated_corpus_dir(base_corpus_dir) or base_corpus_dir
        self.stdout.write(self.style.SUCCESS(f"Using platform reference corpus: {corpus_dir}/"))

        self.stdout.write(self.style.SUCCESS("Reading themes."))
        hakkadbapp.read_themes_corpus.read_themes(str(corpus_dir / "themeCorpus.json"))

        reference_word_path = corpus_dir / "wordCorpus.json"
        reference_expression_path = corpus_dir / "expressionCorpus.json"

        reference_words = self.load_reference_corpus(reference_word_path)
        reference_expressions = self.load_reference_corpus(reference_expression_path)
        reference_words_by_target, reference_word_duplicates = self.index_reference_by_target(reference_words)
        reference_expressions_by_target, reference_expression_duplicates = self.index_reference_by_target(
            reference_expressions
        )

        if reference_words:
            self.stdout.write(self.style.SUCCESS(f"Loaded {len(reference_words)} reference words."))
        if reference_expressions:
            self.stdout.write(self.style.SUCCESS(f"Loaded {len(reference_expressions)} reference expressions."))

        audio_source_dir = self.resolve_audio_source_dir()
        audio_index = self.build_audio_index(audio_source_dir)
        if audio_source_dir:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Indexed {audio_index['count']} audio files from {audio_source_dir}"
                )
            )
        else:
            self.stdout.write(self.style.WARNING("No source audio directory found; audio column will stay empty when missing."))

        state = self.build_current_state(
            reference_words_by_target, reference_expressions_by_target, audio_index, export_audio_dir
        )
        rows = state["rows"]
        word_target_occurrences = state["word_target_occurrences"]
        expression_target_occurrences = state["expression_target_occurrences"]
        current_word_payloads = state["current_word_payloads"]
        current_expression_payloads = state["current_expression_payloads"]

        diff_payload = {
            "words": self.compute_diff(reference_words, current_word_payloads),
            "expressions": self.compute_diff(reference_expressions, current_expression_payloads),
        }
        diff_payload["summary"] = {
            "words": self.summarize_diff(diff_payload["words"]),
            "expressions": self.summarize_diff(diff_payload["expressions"]),
        }
        diff_payload["duplicates"] = {
            "reference_words": self.dedupe_reference(reference_word_duplicates),
            "reference_expressions": self.dedupe_reference(reference_expression_duplicates),
            "current_words": self.dedupe_current(word_target_occurrences),
            "current_expressions": self.dedupe_current(expression_target_occurrences),
        }
        diff_payload["themes"] = {
            theme_id: theme_obj.translations.primary
            for theme_id, theme_obj in jsonm.Theme.instances.items()
        }
        diff_payload["generated_at"] = timestamp

        # CSV export.
        with open(export_csv_file, mode="w", newline="", encoding="utf-8") as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow(ROW_HEADERS)
            writer.writerows(rows)

        # XLSX export.
        self.write_xlsx(export_xlsx_file, rows)

        with open(export_json_dir / "expressionCorpus.json", "w", encoding="utf-8") as f:
            f.write(jsonm.Expression.export())

        with open(export_json_dir / "wordCorpus.json", "w", encoding="utf-8") as f:
            f.write(jsonm.Word.export())

        with open(export_json_dir / "themeCorpus.json", "w", encoding="utf-8") as f:
            f.write(jsonm.Theme.export())

        with open(export_json_dir / "corpusDiff.json", "w", encoding="utf-8") as f:
            json.dump(diff_payload, f, ensure_ascii=False, indent=2, sort_keys=True)

        dashboard_file = export_dir / "corpusDiffDashboard.html"
        with open(dashboard_file, "w", encoding="utf-8") as f:
            f.write(self.render_diff_dashboard(diff_payload))
        self.stdout.write(self.style.SUCCESS(f"Wrote diff dashboard to {dashboard_file}"))

        self.stdout.write(self.style.SUCCESS("Successfully exported."))

        zip_name = export_dir / "e_reo_corpus.zip"
        with zipfile.ZipFile(zip_name, "w", compression=zipfile.ZIP_DEFLATED) as zipf:
            zipf.write(export_json_dir / "wordCorpus.json", arcname="wordCorpus.json")
            zipf.write(export_json_dir / "expressionCorpus.json", arcname="expressionCorpus.json")
            for audio_file in sorted(export_audio_dir.glob("*")):
                if audio_file.is_file():
                    zipf.write(audio_file, arcname=f"audio/{audio_file.name}")
        self.stdout.write(self.style.SUCCESS(f"Wrote {zip_name}"))

    def build_current_state(
        self, reference_words_by_target, reference_expressions_by_target, audio_index, export_audio_dir
    ):
        """Scan the personal DB, matching each word/expression to the reference
        corpus by target text (reusing the reference's id when matched, else
        minting a fresh one) and building the jsonm registries + CSV/XLSX rows.

        Returns a dict shared by the full export (handle()) and by any command
        that only needs a subset of the current state (e.g. a missing-only
        export), so this matching logic exists in exactly one place.
        """
        expressions = Expression.objects.prefetch_related(
            models.Prefetch(
                "expressionword_set",
                queryset=ExpressionWord.objects.only("expression_id", "position", "word_id").order_by("position"),
                to_attr="ews",
            )
        )
        self.stdout.write(self.style.SUCCESS(f"Fetched {expressions.count()} expressions."))

        words = (
            Word.objects.only("id", "french", "english", "category", "status")
            .prefetch_related(
                models.Prefetch(
                    "wordpronunciation_set",
                    queryset=(
                        WordPronunciation.objects.select_related(
                            "pronunciation__initial",
                            "pronunciation__final",
                            "pronunciation__tone",
                        )
                        .only(
                            "word_id",
                            "position",
                            "pronunciation__hanzi",
                            "pronunciation__initial__initial",
                            "pronunciation__final__final",
                            "pronunciation__tone__tone_number",
                        )
                        .order_by("position")
                    ),
                    to_attr="wps",
                )
            )
        )
        self.stdout.write(self.style.SUCCESS("Fetched words and pronunciations."))

        trans = str.maketrans(reverse_superscript_map)
        get_theme = self.get_theme_factory()

        # Keep workbook and CSV rows aligned.
        rows = []
        word_row_by_id = {}
        expression_row_by_id = {}

        word_pinyin = {}
        word_hanzi = {}
        word_json_by_db_id = {}
        word_target_occurrences = {}

        written_words = 0
        skipped_status = skipped_cat = skipped_theme = skipped_pinyin = no_audio_key = 0

        for word in words.iterator(chunk_size=1000):
            if word.status not in {"OK"}:
                skipped_status += 1
                continue

            if not word.category:
                skipped_cat += 1
                continue

            theme = get_theme(word.category)
            if not theme:
                skipped_theme += 1
                continue

            pinyin = "".join(wp.pronunciation.pinyin() for wp in getattr(word, "wps", []))
            if not pinyin:
                skipped_pinyin += 1
                continue

            audio_lookup_key = "".join(reverse_superscript_map.get(ch, ch) for ch in pinyin).strip()
            if not self.find_audio_filename(audio_lookup_key, audio_index):
                no_audio_key += 1

            hanzi = "".join(wp.pronunciation.hanzi for wp in getattr(word, "wps", []))
            target = f"{pinyin} {hanzi}".strip()
            fr = (word.french or "").lower()
            en = (word.english or "").lower()

            # Expected audio filename from pronunciation.
            expected_audio = f"{pinyin.translate(trans)}.wav"
            audio_filename = self.find_audio_filename(expected_audio, audio_index)
            if audio_filename:
                source_path = audio_index["path_by_name"].get(audio_filename)
                if source_path:
                    shutil.copy2(source_path, export_audio_dir / audio_filename)

            ref = reference_words_by_target.get(target)
            ref_data = deepcopy(ref["data"]) if ref else {}

            json_word = jsonm.Word(
                target=target,
                primary=fr,
                secondary=en,
                id=ref["id"] if ref else None,
                themes=deepcopy(ref_data.get("themes", [])),
                # Prefer the real filename found in the source dir; fall back to reference audio.
                # If neither exists, store an empty string rather than a guessed filename.
                audio=audio_filename or ref_data.get("audio", ""),
                image=ref_data.get("image", ""),
                level=ref_data.get("level", 0),
                in_expression=[],
                part_of_speech=ref_data.get("part_of_speech", "n"),
                gloss_code=deepcopy(ref_data.get("gloss_code", [])),
                variants=deepcopy(ref_data.get("variants", {})),
            )

            if theme.id not in json_word.themes:
                json_word.themes.append(theme.id)

            word_target_occurrences.setdefault(target, []).append({
                "db_id": word.id,
                "french": fr,
                "english": en,
                "resulting_id": json_word.id,
                "matched_reference_id": ref["id"] if ref else None,
            })

            word_pinyin[word.id] = pinyin
            word_hanzi[word.id] = hanzi
            word_json_by_db_id[word.id] = json_word

            row = [
                "x",
                "",
                target,
                fr,
                en,
                self.render_theme_names(json_word.themes),
                json_word.audio,
                json_word.image,
            ]
            rows.append(row)
            word_row_by_id[json_word.id] = row
            written_words += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Words exported={written_words} (no_audio={no_audio_key}, status={skipped_status}, no_category={skipped_cat}, "
                f"no_theme={skipped_theme}, no_pinyin={skipped_pinyin})"
            )
        )

        written_expr = 0
        skipped_missing_pinyin = 0
        skipped_ko = 0
        no_audio_key = 0
        expression_target_occurrences = {}

        for expr in expressions.iterator(chunk_size=1000):
            rendering = expr.rendering or ""
            status = expr.status or ""

            if "~" in rendering:
                skipped_missing_pinyin += 1
                continue
            if "KO" in status:
                skipped_ko += 1
                continue

            theme_ids = []
            if expr.category:
                for raw_theme in expr.category.split(","):
                    theme = get_theme(raw_theme)
                    if theme and theme.id not in theme_ids:
                        theme_ids.append(theme.id)

            ref = reference_expressions_by_target.get(rendering)
            ref_data = deepcopy(ref["data"]) if ref else {}
            merged_theme_ids = deepcopy(ref_data.get("themes", []))
            for theme_id in theme_ids:
                if theme_id not in merged_theme_ids:
                    merged_theme_ids.append(theme_id)

            json_expr = jsonm.Expression(
                target=rendering,
                primary=expr.french or "",
                secondary=expr.english or "",
                id=ref["id"] if ref else None,
                themes=merged_theme_ids,
                level=ref_data.get("level", 0),
                components={},
            )

            expression_target_occurrences.setdefault(rendering, []).append({
                "db_id": expr.id,
                "french": expr.french or "",
                "english": expr.english or "",
                "resulting_id": json_expr.id,
                "matched_reference_id": ref["id"] if ref else None,
            })

            components = {}
            pinyin_parts = []
            hanzi_parts = []

            for ew in getattr(expr, "ews", []):
                wid = ew.word_id
                if not wid:
                    pinyin_parts.append("*")
                    hanzi_parts.append("*")
                    continue

                pinyin = word_pinyin.get(wid, "*")
                hanzi = word_hanzi.get(wid, "*")
                pinyin_parts.append(pinyin)
                hanzi_parts.append(hanzi)

                json_word = word_json_by_db_id.get(wid)
                if json_word and pinyin != "*":
                    components[f"{pinyin} {hanzi}".strip()] = json_word.id
                    if json_expr.id not in json_word.in_expression:
                        json_word.in_expression.append(json_expr.id)


            # Expression audio files are named after the expression's hanzi
            # (concatenated, no separators) rather than its pinyin: unlike
            # single words, pinyin for a whole expression isn't a stable or
            # human-friendly filename (spaces, tone marks, homophones), while
            # the hanzi rendering is exactly what a recording is made from.
            expression_hanzi = "".join(part for part in hanzi_parts if part and part != "*")
            expected_audio = f"{expression_hanzi}.wav" if expression_hanzi else ""
            audio_filename = self.find_audio_filename(expected_audio, audio_index) if expected_audio else ""
            if not audio_filename:
                no_audio_key += 1
            else:
                source_path = audio_index["path_by_name"].get(audio_filename)
                if source_path:
                    shutil.copy2(source_path, export_audio_dir / audio_filename)

            json_expr.audio = audio_filename
            json_expr.components = dict(sorted(components.items()))

            row = [
                "",
                "x",
                rendering,
                expr.french or "",
                expr.english or "",
                self.render_theme_names(json_expr.themes),
                audio_filename,
                "",
            ]
            rows.append(row)
            expression_row_by_id[json_expr.id] = row
            written_expr += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Expressions exported={written_expr} "
                f"(skipped missing_pinyin={skipped_missing_pinyin}, skipped KO={skipped_ko}, "
                f"skipped no_audio_key={no_audio_key})"
            )
        )

        # Build payloads only after expressions are processed so word.in_expression is complete.
        current_word_payloads = {
            obj_id: self.build_word_payload(word_obj)
            for obj_id, word_obj in jsonm.Word.instances.items()
        }
        current_expression_payloads = {
            obj_id: self.build_expression_payload(expr_obj)
            for obj_id, expr_obj in jsonm.Expression.instances.items()
        }

        return {
            "rows": rows,
            "word_row_by_id": word_row_by_id,
            "expression_row_by_id": expression_row_by_id,
            "word_pinyin": word_pinyin,
            "word_hanzi": word_hanzi,
            "word_json_by_db_id": word_json_by_db_id,
            "word_target_occurrences": word_target_occurrences,
            "expression_target_occurrences": expression_target_occurrences,
            "current_word_payloads": current_word_payloads,
            "current_expression_payloads": current_expression_payloads,
        }

    @staticmethod
    def load_reference_corpus(path):
        if not path.exists():
            return {}
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def index_reference_by_target(corpus):
        """Index a reference corpus by target text.

        When two reference ids share the same target, only the last one indexed
        stays reachable via target lookup; the shadowed id can never be matched
        to current data again and will permanently show up as "deleted". Such
        collisions are returned separately so callers can surface them.
        """
        index = {}
        duplicates = {}
        for obj_id, payload in corpus.items():
            target = payload.get("translations", {}).get("target", "")
            existing = index.get(target)
            if existing is not None:
                duplicates.setdefault(target, [existing["id"]]).append(obj_id)
            index[target] = {"id": obj_id, "data": payload}
        return index, duplicates

    @staticmethod
    def build_word_payload(word_obj):
        return {
            "audio": word_obj.audio,
            "gloss_code": list(word_obj.gloss_code),
            "image": word_obj.image,
            "in_expression": sorted(word_obj.in_expression),
            "level": word_obj.level,
            "part_of_speech": word_obj.part_of_speech,
            "themes": list(word_obj.themes),
            "translations": word_obj.translations.to_dict(),
            "variants": deepcopy(word_obj.variants),
        }

    @staticmethod
    def build_expression_payload(expr_obj):
        return {
            "audio": expr_obj.audio,
            "components": dict(sorted(expr_obj.components.items())),
            "level": expr_obj.level,
            "themes": list(expr_obj.themes),
            "translations": expr_obj.translations.to_dict(),
        }

    # These keys depend on local/environment state rather than actual word or
    # expression content, so they're excluded from the diff entirely (not
    # just presence-normalized): whether an audio file happens to sit in the
    # local audio source dir at export time, or whether a word has an image,
    # isn't a meaningful content edit either way. The exclusion has to be a
    # full drop rather than a bool cast on the existing value, because one
    # side can omit the key altogether rather than storing a falsy value —
    # e.g. an older reference snapshot predating expression audio support
    # won't have the key at all, while the current side always builds one
    # (possibly empty), so a bool cast would still flag nearly every
    # expression as "modified" purely for that asymmetry. Dropping the key
    # sidesteps the presence mismatch entirely. The actual values are still
    # kept in the stored payloads for display.
    DIFF_IGNORED_KEYS = ("audio", "image")

    @staticmethod
    def normalize_for_diff(payload):
        return json.loads(json.dumps(payload, ensure_ascii=False, sort_keys=True))

    @classmethod
    def diff_comparable(cls, payload):
        if not isinstance(payload, dict):
            return payload
        comparable = dict(payload)
        for key in cls.DIFF_IGNORED_KEYS:
            comparable.pop(key, None)
        return comparable

    def compute_diff(self, reference_map, current_map):
        added = []
        modified = []
        deleted = []

        reference_ids = set(reference_map.keys())
        current_ids = set(current_map.keys())

        for obj_id in sorted(current_ids - reference_ids):
            added.append({"id": obj_id, "current": self.normalize_for_diff(current_map[obj_id])})

        for obj_id in sorted(reference_ids - current_ids):
            deleted.append({"id": obj_id, "reference": self.normalize_for_diff(reference_map[obj_id])})

        for obj_id in sorted(reference_ids & current_ids):
            reference_payload = self.normalize_for_diff(reference_map[obj_id])
            current_payload = self.normalize_for_diff(current_map[obj_id])
            if self.diff_comparable(reference_payload) != self.diff_comparable(current_payload):
                modified.append(
                    {
                        "id": obj_id,
                        "reference": reference_payload,
                        "current": current_payload,
                    }
                )

        return {"added": added, "modified": modified, "deleted": deleted}

    @staticmethod
    def summarize_diff(diff_section):
        return {
            "added": len(diff_section["added"]),
            "modified": len(diff_section["modified"]),
            "deleted": len(diff_section["deleted"]),
        }

    @staticmethod
    def dedupe_reference(duplicate_map):
        return [
            {"target": target, "ids": ids}
            for target, ids in sorted(duplicate_map.items())
        ]

    @staticmethod
    def dedupe_current(occurrences):
        return [
            {"target": target, "entries": entries}
            for target, entries in sorted(occurrences.items())
            if len(entries) > 1
        ]

    @staticmethod
    def render_diff_dashboard(diff_payload):
        """Render the standalone interactive dashboard, with diff data inlined.

        The JSON is embedded in a <script type="application/json"> tag; every
        "<" is escaped to "\\u003c" so a value containing "</script" can't
        terminate the tag early (valid inside both JSON and HTML text).
        """
        template_path = Path(__file__).resolve().parent / "corpus_diff_dashboard_template.html"
        template = template_path.read_text(encoding="utf-8")
        payload_json = json.dumps(diff_payload, ensure_ascii=False, sort_keys=True).replace("<", "\\u003c")
        return template.replace("__DIFF_DATA_JSON__", payload_json)

    def get_theme_factory(self):
        theme_cache = {}

        def get_theme(cat):
            key = (cat or "").strip().lower()
            if not key:
                return None
            if key not in theme_cache:
                theme_cache[key] = jsonm.Theme.get(key)
            return theme_cache[key]

        return get_theme

    @staticmethod
    def render_theme_names(theme_ids):
        names = []
        for theme_id in theme_ids:
            theme = jsonm.Theme.get_id(theme_id)
            if theme:
                names.append(theme.translations.primary)
        return ",".join(names)

    def resolve_audio_source_dir(self):
        candidates = [
            "../e_reo_data/audio"
        ]
        for candidate in candidates:
            if candidate and Path(candidate).is_dir():
                return Path(candidate)
        return None

    def build_audio_index(self, audio_dir):
        index = {"by_name": {}, "by_stem": {}, "path_by_name": {}, "count": 0}
        if not audio_dir:
            return index

        for root, _, files in os.walk(audio_dir):
            for filename in sorted(files):
                path = Path(root) / filename
                if path.suffix.lower() not in AUDIO_EXTENSIONS:
                    continue

                index["count"] += 1
                lower_name = filename.lower()
                lower_stem = path.stem.lower()

                # Store the first match to keep the export deterministic.
                index["by_name"].setdefault(lower_name, filename)
                index["by_stem"].setdefault(lower_stem, filename)
                # Keyed by the original-case filename (as returned by
                # find_audio_filename via by_name/by_stem), so callers that
                # need the actual file on disk -- e.g. to copy out unmatched
                # audio -- don't have to re-walk the directory themselves.
                index["path_by_name"].setdefault(filename, str(path))

        return index

    @staticmethod
    def find_audio_filename(expected_filename, audio_index):
        if not expected_filename:
            return ""

        exact = audio_index["by_name"].get(expected_filename.lower())
        if exact:
            return exact

        stem = Path(expected_filename).stem.lower()
        return audio_index["by_stem"].get(stem, "")

    @staticmethod
    def write_xlsx(path, rows):
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Export"

        sheet.append(ROW_HEADERS)
        for row in rows:
            sheet.append(row)

        # Keep widths readable without adding styling dependencies.
        widths = {
            "A": 8,
            "B": 12,
            "C": 48,
            "D": 28,
            "E": 28,
            "F": 24,
            "G": 32,
            "H": 24,
        }
        for col, width in widths.items():
            sheet.column_dimensions[col].width = width

        workbook.save(path)
