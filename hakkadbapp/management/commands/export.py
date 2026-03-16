from django.core.management.base import BaseCommand
from django.db import models
from hakkadbapp.models import Word, WordPronunciation, Expression, ExpressionWord  # replace with your actual app name
import os
import shutil
from django.conf import settings
import datetime
import pandas as pd
import hakkadbapp.json_model as jsonm
import zipfile
import hakkadbapp.read_themes_corpus 
import hakkadbapp.read_words_corpus 
import csv
import os

superscript_map = {"1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶"}
reverse_superscript_map = {v: k for k, v in superscript_map.items()}

class Command(BaseCommand):
    help = 'Export words to CSV'

    def handle(self, *args, **options):
        # Current timestamp: YYYYMMDD_HHMMSS
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

        # Build the directory path with the timestamp
        export_dir = f"../export_e_reo_{timestamp}/"
        export_audio_dir = export_dir + 'audio/'
        export_image_dir = export_dir + 'images/'
        export_json_dir = export_dir + 'json/'
        export_csv_file = export_dir + 'export.csv'

        os.makedirs(export_json_dir, exist_ok=True)
        os.makedirs(export_dir, exist_ok=True)
        os.makedirs(export_audio_dir, exist_ok=True)
        os.makedirs(export_image_dir, exist_ok=True)

        self.stdout.write(self.style.SUCCESS(f'Exporting to {export_dir}'))

        self.stdout.write(self.style.SUCCESS(f'Reading themes.'))
        hakkadbapp.read_themes_corpus.read_themes('../e_reo_json/themeCorpus.json')
        # hakkadbapp.read_words_corpus.read_words('../e_reo_json/wordCorpus.json')
        # self.stdout.write(self.style.SUCCESS(f'Fetched {len(jsonm.Word.instances) }words.'))
        export = []
        self.stdout.write(self.style.SUCCESS(f'Fetching expressions from DB.'))
        expressions = (
            Expression.objects
            .prefetch_related(
                models.Prefetch(
                    "expressionword_set",
                    queryset=ExpressionWord.objects
                        .only("expression_id", "position", "word_id")
                        .order_by("position"),
                    to_attr="ews"
                )
            )
        )
        self.stdout.write(self.style.SUCCESS(f'Fetched {expressions.count()} expressions.' ))

        self.stdout.write(self.style.SUCCESS(f'Fetching words from DB.'))
        words = (
            Word.objects
            .only("id", "french", "tahitian", "category", "status")
            .prefetch_related(
                models.Prefetch(
                    "wordpronunciation_set",
                    queryset=(
                        WordPronunciation.objects
                        .select_related(
                            "pronunciation__initial",
                            "pronunciation__final",
                            "pronunciation__tone",
                        )
                        .only(
                            "word_id",
                            "pronunciation__hanzi",
                            "pronunciation__initial__initial",
                            "pronunciation__final__final",
                            "pronunciation__tone__tone_number",
                        )
                        .order_by("position")
                    ),
                    to_attr="wps"
                )
            )
        )

        self.stdout.write(self.style.SUCCESS("Fetched words and pronunciations."))

        # Prebuild translation table (faster than dict lookup in loop)
        trans = str.maketrans(reverse_superscript_map)

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

            export = []
            word_pinyin = {}  # wid -> pinyin
            word_char = {}    # wid -> hanzi
            word_by_id = {} # optional
            json_word_by_target = {}
            theme_cache = {}
            def get_theme(cat: str):
                k = (cat or "").strip().lower()
                if not k:
                    return None
                if k not in theme_cache:
                    theme_cache[k] = jsonm.Theme.get(k)
                return theme_cache[k]

            written = 0
            skipped_status = skipped_cat = skipped_theme = skipped_pinyin = 0

            for word in words.iterator(chunk_size=1000):
                # cheap skips first (avoid extra work)
                if word.status not in {"Hakka validé", "Validé"}:
                    skipped_status += 1
                    continue

                if not word.category:
                    skipped_cat += 1
                    continue

                theme = get_theme(word.category)
                if not theme:
                    skipped_theme += 1
                    continue

                # build pinyin+hanzi ONCE from prefetched wps
                pinyin = "".join(wp.pronunciation.pinyin() for wp in word.wps)
                if not pinyin:
                    skipped_pinyin += 1
                    continue
                hanzi = "".join(wp.pronunciation.hanzi for wp in word.wps)

                target = f"{pinyin} {hanzi}"
                audio = f"{pinyin.translate(trans)}.wav"

                fr = (word.french or "").lower()
                ty = (word.tahitian or "").lower()

                json_word = jsonm.Word(target, fr, ty)
                json_word.themes.append(theme.id)
                json_word.audio = audio
                json_word_by_target[target] = json_word

                word_pinyin[word.id] = pinyin
                word_char[word.id] = hanzi
                word_by_id[word.id] = json_word  # only if you need it later

                writer.writerow(["x", "", target, fr, ty, theme.translations.primary, audio, ""])
                written += 1

                # optional: log every 500 instead of every row
                # if written % 500 == 0:
                #     self.stdout.write(self.style.SUCCESS(f"Wrote {written} words..."))

            self.stdout.write(self.style.SUCCESS(
                f"Words exported={written} "
                f"(skipped status={skipped_status}, no_category={skipped_cat}, "
                f"no_theme={skipped_theme}, no_pinyin={skipped_pinyin})"
            ))


            i = 0
            theme_cache = {}
            def get_theme(cat: str):
                k = (cat or "").strip().lower()
                if not k:
                    return None
                if k not in theme_cache:
                    theme_cache[k] = jsonm.Theme.get(k)
                return theme_cache[k]

            written_expr = 0
            skipped_missing_pinyin = 0
            skipped_ko = 0
            skipped_no_audio = 0

            rows = []
            for  expr in expressions.iterator(chunk_size=1000):
                rendering = expr.rendering or ""
                status = expr.status or ""

                if "~" in rendering:
                    self.stderr.write(f'Skipping {expr.rendering} missing pinyin')
                    skipped_missing_pinyin += 1
                    continue
                if "KO" in status:
                    self.stderr.write(f'Skipping KO {expr.rendering}')
                    skipped_ko += 1
                    continue

                self.stdout.write(f'{expr.status} {expr.rendering}')
                rows.append([
                    "", "x", rendering, expr.french, expr.english, expr.category.lower(),
                    rendering.split(" ")[-1], "",
                ])

                # themes (cached)
                themes = []
                if expr.category:
                    for th in expr.category.split(","):
                        t = get_theme(th)
                        if t:
                            themes.append(t)

                new_expr = jsonm.Expression(
                    target=rendering,
                    primary=expr.french,
                    secondary=expr.english,
                    themes=themes,
                )

                components = {}
                pinyin_parts = []

                for ew in expr.ews:
                    wid = ew.word_id
                    if not wid:
                        pinyin_parts.append("*")
                        continue

                    p = word_pinyin.get(wid, "*")
                    pinyin_parts.append(p)

                    if "~" in p:  # word had unresolved pinyin
                        continue

                    h = word_char.get(wid, "*")
                    word_str = f"{p} {h}"

                    # O(1) lookup instead of jsonm.Word.find_first(...)
                    jw = word_by_id.get(wid)
                    if jw:
                        components[word_str] = jw.id
                        word = jsonm.Word.get_id(jw)
                        if word:
                            jsonm.Word.get_id(jw).in_expression.append(new_expr.id)

                pinyin = " ".join(pinyin_parts)

                # audio key: your original logic removes superscripts -> digits/letters
                pinyin_sup = "".join(reverse_superscript_map.get(ch, ch) for ch in pinyin).strip()
                if not pinyin_sup:
                    skipped_no_audio += 1
                    continue

                new_expr.components = components
                export.append(new_expr)
                written_expr += 1

            writer.writerows(rows)
            self.stdout.write(self.style.SUCCESS(
                f"Expressions exported={written_expr} "
                f"(skipped missing_pinyin={skipped_missing_pinyin}, skipped KO={skipped_ko}, skipped no_audio={skipped_no_audio})"
            ))

        with open(os.path.join(export_json_dir, "expressionCorpus.json"), "w", encoding="utf-8") as f:
            f.write(jsonm.Expression.export())

        with open(os.path.join(export_json_dir, "wordCorpus.json"), "w", encoding="utf-8") as f:
            f.write(jsonm.Word.export())

        with open(os.path.join(export_json_dir, "themeCorpus.json"), "w", encoding="utf-8") as f:
            f.write(jsonm.Theme.export())

        self.stdout.write(self.style.SUCCESS(f'Successfully exported'))

        # # List of files to compress
        files_to_zip = [os.path.join(export_json_dir, "expressionCorpus.json")]
        # Name of the output ZIP
        zip_name = os.path.join(export_dir, "expressionCorpus.zip")
        with zipfile.ZipFile(zip_name, "w", compression=zipfile.ZIP_DEFLATED) as zipf:
            for file in files_to_zip:
                zipf.write(file)
