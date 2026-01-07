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
            .only("id", "text", "rendering")
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
            word_pinyin = {}
            word_char = {}

            for word in words.iterator(chunk_size=500):
                parts = []
                chars = []
                for wp in word.wps:
                    p = wp.pronunciation
                    parts.append(p.pinyin())
                    chars.append(p.hanzi)
                # ---- skip early (cheap checks first)
                if word.status not in {"Hakka validé", "Validé"}:
                    continue

                if not word.category:
                    continue

                theme = jsonm.Theme.get(word.category.lower())
                if not theme:
                    continue

                # ---- build pinyin + hanzi ONCE
                pinyin_parts = []
                hanzi_parts = []

                for wp in word.wps:
                    p = wp.pronunciation
                    pinyin_parts.append(p.pinyin())
                    hanzi_parts.append(p.hanzi)

                pinyin = "".join(pinyin_parts)
                hanzi = "".join(hanzi_parts)

                if not pinyin:
                    continue

                target = f"{pinyin} {hanzi}"

                # ---- audio name
                pinyin_sup = pinyin.translate(trans)
                audio = f"{pinyin_sup}.wav"

                json_word = jsonm.Word(target, word.french.lower(), word.tahitian.lower())
                json_word.themes.append(theme.id)
                
                word_pinyin[word.id] = "".join(parts)
                word_char[word.id] = "".join(chars)

                writer.writerow([
                    "x",
                    "",
                    target,
                    word.french.lower(),
                    word.tahitian.lower(),
                    theme.translations.primary,
                    audio,
                    "",
                ])

                self.stdout.write(self.style.HTTP_INFO(f'Wrote word {target} {word.french.lower()} to csv and json.'))
            self.stdout.write(self.style.SUCCESS(f'Exported all words. '))

            i = 0
            for expr in expressions.iterator(chunk_size=1):
                pinyin_parts = []
                if "?" in expr.rendering:
                    self.stderr.write(f'Skipping {expr.rendering} because of missing pinyin.')
                    continue

                if len(expr.ews) < 2:
                    self.stderr.write(f'Skipping {expr.rendering} because it only one word.')
                    continue
                writer.writerow([
                    "",
                    "x",
                    expr.rendering,
                    expr.french,
                    " ",
                    "",
                    "",
                    "",
                ])
                new_expr = jsonm.Expression(
                    target=expr.rendering,
                    primary=expr.french,
                    secondary=''
                )
                components = {}
                for ew in expr.ews:
                    if ew.word_id:
                        p = word_pinyin.get(ew.word_id, "*")
                        pinyin_parts.append(p)
                        if '?' in p:
                            continue
                        word = words.get(id=ew.word_id)
                        word_str =  p + " " + word_char.get(ew.word_id, "*")
                        first_match = jsonm.Word.find_first(**{'translations.target':word_str})
                        # print(ew, first_match)
                        if first_match:
                            components[word_str] = first_match
                            jsonm.Word.get_id(first_match).in_expression.append(new_expr.id)
                    else:  
                        pinyin_parts.append("*")

                pinyin = " ".join(pinyin_parts)

                # --- Hanzi
                hanzi = expr.simp
                target = f"{pinyin} {hanzi}"
                self.stdout.write(self.style.HTTP_INFO(f'Processing {expr.rendering}'))
                # --- Superscript inverse pour audio
                pinyin_sup = "".join(
                    reverse_superscript_map.get(ch, ch)
                    for ch in pinyin
                )
                if not pinyin_sup.strip():
                    continue
                new_expr.themes = []
                new_expr.components = components
                export.append(new_expr)

        self.stdout.write(self.style.SUCCESS(f"Exported {len(export)} expressions."))

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
