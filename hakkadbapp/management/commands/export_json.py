from django.core.management.base import BaseCommand
from django.db import models
from hakkadbapp.models import Word, WordPronunciation, Expression, ExpressionWord  # replace with your actual app name
import os
import shutil
from django.conf import settings
import datetime
import pandas as pd
import hakkadbapp.json_model as jsonm
import hakkadbapp.generate_images as gen_img
import zipfile
import hakkadbapp.read_themes_corpus 
import json
import os

superscript_map = {"1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "":""}
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

        os.makedirs(export_json_dir, exist_ok=True)
        os.makedirs(export_dir, exist_ok=True)
        os.makedirs(export_audio_dir, exist_ok=True)
        os.makedirs(export_image_dir, exist_ok=True)

        self.stdout.write(self.style.SUCCESS(f'Exporting to {export_dir}'))

        self.stdout.write(self.style.SUCCESS(f'Reading themes.'))
        hakkadbapp.read_themes_corpus.read_themes('../e_reo_json/themeCorpus.json')

        # read_themes('1kWOkXIUfxj6q-TjzT-2CQygI1KfPJOfr0d6npHdfc6A', export_image_dir)
        # read_themes('1Dxjb849-AJCQL0e9p_9Zvl7bafbz9mJwGNmHubgnGyU', export_image_dir)

        self.stdout.write(self.style.SUCCESS(f'Fetching words from DB.'))
        words = (
            Word.objects
                .prefetch_related(
                    models.Prefetch(
                        "wordpronunciation_set",
                        queryset=WordPronunciation.objects
                            .select_related(
                                "pronunciation__initial",
                                "pronunciation__final",
                                "pronunciation__tone",
                            )
                            .order_by("position")
                    )
                )
        )
        self.stdout.write(self.style.SUCCESS(f'Fetched words.'))
        export = []
        for word in words:
            char_sequence = word.char()
            french = word.french.lower()
            pinyin = word.pinyin()
            hanzi = word.simp()  # or word.trad() depending on your preference
            target = f"{pinyin} {hanzi}"
            english = word.tahitian
            theme = jsonm.Theme.get(word.category.lower())
            if not (theme):
                continue
        
            # Reverse map all chars of pinyin using superscript_map
            pinyin_sup = ''.join(reverse_superscript_map.get(ch, ch) for ch in pinyin)
            if pinyin_sup == '':
                continue
            audio = f"{pinyin_sup}.wav"
                
            image = ""
            # image = generate_img(pinyin_sup, target, french, size, font_big, font_py, export_image_dir)
            audio_path = os.path.join(settings.BASE_DIR, '..','export_e_reo', "audio", audio)

            # Export json

            new_word = jsonm.Word(target, french, english)
            new_word.themes = [theme.id]

            # if os.path.isfile(audio_path):
            #     dest_path = os.path.join(export_audio_dir, audio)
            #     shutil.copy(audio_path, dest_path)
            #     # new_word.audio = audio

            # if ("Hakka validé" in word.status or "Validé" in word.status):
            #     self.stdout.write(f'Exported: {char_sequence} - {french} - {pinyin} - {audio} \n')
            # else:
            #     self.stdout.write(f'Filtered ({word.status}): {char_sequence} - {french} - {pinyin} - {audio} \n')

       
        expressions = (
            Expression.objects
            .only("id", "text")
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
        self.stdout.write(self.style.SUCCESS(f'Fetched expressions.'))

        words = (
            Word.objects
            .prefetch_related(
                models.Prefetch(
                    "wordpronunciation_set",
                    queryset=WordPronunciation.objects
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
                        .order_by("position"),
                    to_attr="wps"
                )
            )
        )
        self.stdout.write(self.style.SUCCESS(f'Fetched words pronunciations.'))

        export = []
        word_pinyin = {}

        for word in words:
            parts = []
            for wp in word.wps:
                p = wp.pronunciation
                parts.append(p.pinyin())
            word_pinyin[word.id] = "".join(parts)

        self.stdout.write(self.style.SUCCESS(f'Fetched words pinyins.'))

        i = 0
        for expr in expressions.iterator(chunk_size=3):
            i += 1
            if i > 3:
                continue
            pinyin_parts = []
            new_expr = jsonm.Expression(
                target="",
                primary=expr.french,
                secondary=''
            )
            components = {}
            for ew in expr.ews:
                if ew.word_id:
                    p = word_pinyin.get(ew.word_id, "*")
                    pinyin_parts.append(p)
                    word = words.get(id=ew.word_id)
                    word_str =  p + " " + word.simp()
                    first_match = jsonm.Word.find_first(**{'translations.target':word_str})
                    if first_match:
                        components[word_str] = first_match
                        jsonm.Word.get_id(first_match).in_expression.append(new_expr.id)
                else:
                    pinyin_parts.append("*")

            pinyin = " ".join(pinyin_parts)

            # --- Hanzi
            hanzi = expr.simp
            target = f"{pinyin} {hanzi}"
            print(target)

            # --- Superscript inverse pour audio
            pinyin_sup = "".join(
                reverse_superscript_map.get(ch, ch)
                for ch in pinyin
            )
            if not pinyin_sup.strip():
                continue

            audio = f"{pinyin_sup}.wav"
            audio_path = ""

            # --- Export JSON

            new_expr.translations.target=target
            new_expr.translations.primary=expr.french
            new_expr.themes = []
            new_expr.components = components

            # --- Audio (optionnel)
            # if os.path.isfile(audio_path):
            #     dest_path = os.path.join(export_audio_dir, audio)
            #     shutil.copy(audio_path, dest_path)
            #     new_expr.audio = audio

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
        files_to_zip = [export_json_dir]
        # Name of the output ZIP
        zip_name = os.path.join(export_dir, "corpus.zip")
        with zipfile.ZipFile(zip_name, "w", compression=zipfile.ZIP_DEFLATED) as zipf:
            for file in files_to_zip:
                zipf.write(file)
