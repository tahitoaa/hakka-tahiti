from django.core.management.base import BaseCommand
from django.db import models
from hakkadbapp.models import Word, WordPronunciation  # replace with your actual app name
import os
import shutil
from django.conf import settings
import datetime
import pandas as pd
import hakkadbapp.json_model as jsonm
import hakkadbapp.generate_images as gen_img
import zipfile

superscript_map = {"1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "":""}
reverse_superscript_map = {v: k for k, v in superscript_map.items()}

# generate_cards('../words_export.csv','C:\WINDOWS\FONTS\KAIU.TTF','C:\WINDOWS\FONTS\ARLRDBD.TTF')

def read_themes(sheet_id, image_dir):
    sheet_url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx'
    # Use a local file path instead of downloading from Google Sheets
    excel_file = pd.ExcelFile(sheet_url)
    df = pd.read_excel(excel_file, sheet_name="x Synthèse")
    for line_num, row in enumerate(df.itertuples(index=False)):  # header is row 1
        if line_num < 3: 
            continue
        french = str(row[0])
        hakka = str(row[9])
        pinyin = str(row[10])
        english = str(row[8])
        print(french, hakka, english)
        # if len(hakka) > 0 and len(pinyin) > 0:
            # filename = f"{image_dir}/theme_{french}"
            # gen_img.generate_theme_img(filename, french, hakka, pinyin, english, 1024)
        new_theme = jsonm.Theme(french,english,hakka)
        # new_theme.image = f"theme_{french}.png"

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
        read_themes('1kWOkXIUfxj6q-TjzT-2CQygI1KfPJOfr0d6npHdfc6A', export_image_dir)
        read_themes('1Dxjb849-AJCQL0e9p_9Zvl7bafbz9mJwGNmHubgnGyU', export_image_dir)

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
        self.stdout.write(self.style.SUCCESS(f'DB fetched.'))
        export = []
        for word in words:
            char_sequence = word.char()
            french = word.french.lower()
            pinyin = word.pinyin()
            hanzi = word.simp()  # or word.trad() depending on your preference
            target = f"{pinyin} {hanzi}"
            english = word.tahitian
            theme = word.category or ''
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
            new_word.themes = [jsonm.Theme(theme, "","").id]
            if os.path.isfile(audio_path):
                dest_path = os.path.join(export_audio_dir, audio)
                shutil.copy(audio_path, dest_path)
                new_word.audio = audio

            # if ("Hakka validé" in word.status or "Validé" in word.status):
            #     self.stdout.write(f'Exported: {char_sequence} - {french} - {pinyin} - {audio} \n')
            # else:
            #     self.stdout.write(f'Filtered ({word.status}): {char_sequence} - {french} - {pinyin} - {audio} \n')
        # print(export)
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
