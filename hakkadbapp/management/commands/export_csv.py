import csv
from django.core.management.base import BaseCommand
from hakkadbapp.models import Word  # replace with your actual app name
import os
import shutil
from django.conf import settings
import datetime
import os
import csv, os

superscript_map = {"1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "":""}
reverse_superscript_map = {v: k for k, v in superscript_map.items()}

# generate_cards('../words_export.csv','C:\WINDOWS\FONTS\KAIU.TTF','C:\WINDOWS\FONTS\ARLRDBD.TTF')

class Command(BaseCommand):
    help = 'Export words to CSV'

    def handle(self, *args, **options):

        # Current timestamp: YYYYMMDD_HHMMSS
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

        # Build the directory path with the timestamp
        export_dir = f"../export_e_reo_{timestamp}/"
        export_audio_dir = export_dir + 'audio/'
        export_image_dir = export_dir + 'images/'
        filename = export_dir + 'words_export.csv'

        os.makedirs(export_dir, exist_ok=True)
        os.makedirs(export_audio_dir, exist_ok=True)
        os.makedirs(export_image_dir, exist_ok=True)
        self.stdout.write(self.style.SUCCESS(f'Exporting to {export_dir}'))

        with open(filename, mode='w', newline='', encoding='utf-8') as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow(['word', 'expression', 'target', 'pivot', 'alternate', 'themes', 'audio', 'image'])

            for word in Word.objects.prefetch_related('wordpronunciation_set__pronunciation'):
                char_sequence = word.char()
                french = word.french.lower()
                pinyin = word.pinyin()
                hanzi = word.simp()  # or word.trad() depending on your preference
                target = f"{pinyin} {hanzi}"
                theme = word.category or ''
                # Reverse map all chars of pinyin using superscript_map
                pinyin_sup = ''.join(reverse_superscript_map.get(ch, ch) for ch in pinyin)
                if pinyin_sup == '':
                    continue
                audio = f"{pinyin_sup}"
                    
                image = ""
                # image = generate_img(pinyin_sup, target, french, size, font_big, font_py, export_image_dir)
                
                theme = word.category or ''
                # audio_path = os.path.join(settings.BASE_DIR, "..","lexique", "audio", theme, audio)
                audio_path = os.path.join(settings.BASE_DIR, '..','export_e_reo', "audio", audio)
                audio = audio if os.path.isfile(audio_path) else ""
                print(f"Audio path: {audio_path}, Audio file: {audio}")
                # Copier le fichier s'il existe
                if os.path.exists(audio_path):
                    audio =  f"{audio}.wav"
                    dest_path = os.path.join(export_audio_dir, audio)
                    shutil.copy(audio_path, dest_path)
                else:
                    audio = ""
                    self.stderr.write(f"Fichier audio non trouvé : {audio_path}")

                if ("Hakka validé" in word.status or "Validé" in word.status):
                    writer.writerow([
                        'x',                 # word
                        '',                 # expression
                        target,             # target (e.g., 酒 jiu3)
                        french,             # pivot (French)
                        '',                 # alternate
                        theme,              # themes
                        audio,              # audio
                        image                  # image
                    ])
                    self.stdout.write(f'Exported: {char_sequence} - {french} - {pinyin} - {audio} \n')
                else:
                    self.stdout.write(f'Filtered ({word.status}): {char_sequence} - {french} - {pinyin} - {audio} \n')

        self.stdout.write(self.style.SUCCESS(f'Successfully exported to {filename}'))
