import csv
import datetime
import json
import os
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

        self.stdout.write(self.style.SUCCESS("Reading themes."))
        hakkadbapp.read_themes_corpus.read_themes("../e_reo_json/themeCorpus.json")

        reference_word_path = Path("../e_reo_json/wordCorpus.json")
        reference_expression_path = Path("../e_reo_json/expressionCorpus.json")

        reference_words = self.load_reference_corpus(reference_word_path)
        reference_expressions = self.load_reference_corpus(reference_expression_path)
        reference_words_by_target = self.index_reference_by_target(reference_words)
        reference_expressions_by_target = self.index_reference_by_target(reference_expressions)

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

        expressions = Expression.objects.prefetch_related(
            models.Prefetch(
                "expressionword_set",
                queryset=ExpressionWord.objects.only("expression_id", "position", "word_id").order_by("position"),
                to_attr="ews",
            )
        )
        self.stdout.write(self.style.SUCCESS(f"Fetched {expressions.count()} expressions."))

        words = (
            Word.objects.only("id", "french", "tahitian", "category", "status")
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

        word_pinyin = {}
        word_hanzi = {}
        word_json_by_db_id = {}

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
            ty = (word.tahitian or "").lower()

            # Expected audio filename from pronunciation.
            expected_audio = f"{pinyin.translate(trans)}.wav"
            audio_filename = self.find_audio_filename(expected_audio, audio_index)

            ref = reference_words_by_target.get(target)
            ref_data = deepcopy(ref["data"]) if ref else {}

            json_word = jsonm.Word(
                target=target,
                primary=fr,
                secondary=ty,
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

            word_pinyin[word.id] = pinyin
            word_hanzi[word.id] = hanzi
            word_json_by_db_id[word.id] = json_word

            rows.append([
                "x",
                "",
                target,
                fr,
                ty,
                self.render_theme_names(json_word.themes),
                json_word.audio,
                json_word.image,
            ])
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

            components = {}
            pinyin_parts = []

            for ew in getattr(expr, "ews", []):
                wid = ew.word_id
                if not wid:
                    pinyin_parts.append("*")
                    continue

                pinyin = word_pinyin.get(wid, "*")
                hanzi = word_hanzi.get(wid, "*")
                pinyin_parts.append(pinyin)

                json_word = word_json_by_db_id.get(wid)
                if json_word and pinyin != "*":
                    components[f"{pinyin} {hanzi}".strip()] = json_word.id
                    if json_expr.id not in json_word.in_expression:
                        json_word.in_expression.append(json_expr.id)


            expected_audio = f"{rendering.split(' ')[-1]}.wav"
            audio_filename = self.find_audio_filename(expected_audio, audio_index)
            if not audio_filename:
                no_audio_key += 1

            json_expr.components = dict(sorted(components.items()))

            rows.append([
                "",
                "x",
                rendering,
                expr.french or "",
                expr.english or "",
                self.render_theme_names(json_expr.themes),
                audio_filename,
                "",
            ])
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

        diff_payload = {
            "words": self.compute_diff(reference_words, current_word_payloads),
            "expressions": self.compute_diff(reference_expressions, current_expression_payloads),
        }
        diff_payload["summary"] = {
            "words": self.summarize_diff(diff_payload["words"]),
            "expressions": self.summarize_diff(diff_payload["expressions"]),
        }

        # CSV export.
        with open(export_csv_file, mode="w", newline="", encoding="utf-8") as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow([
                "word",
                "expression",
                "target",
                "pivot",
                "alternate",
                "themes",
                "audio",
                "image",
            ])
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

        self.stdout.write(self.style.SUCCESS("Successfully exported."))

        zip_name = export_dir / "expressionCorpus.zip"
        with zipfile.ZipFile(zip_name, "w", compression=zipfile.ZIP_DEFLATED) as zipf:
            zipf.write(export_json_dir / "expressionCorpus.json", arcname="expressionCorpus.json")

    @staticmethod
    def load_reference_corpus(path):
        if not path.exists():
            return {}
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def index_reference_by_target(corpus):
        return {
            payload.get("translations", {}).get("target", ""): {"id": obj_id, "data": payload}
            for obj_id, payload in corpus.items()
        }

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
            "components": dict(sorted(expr_obj.components.items())),
            "level": expr_obj.level,
            "themes": list(expr_obj.themes),
            "translations": expr_obj.translations.to_dict(),
        }

    @staticmethod
    def normalize_for_diff(payload):
        return json.loads(json.dumps(payload, ensure_ascii=False, sort_keys=True))

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
            if reference_payload != current_payload:
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
        index = {"by_name": {}, "by_stem": {}, "count": 0}
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

        headers = [
            "word",
            "expression",
            "target",
            "pivot",
            "alternate",
            "themes",
            "audio",
            "image",
        ]
        sheet.append(headers)
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
