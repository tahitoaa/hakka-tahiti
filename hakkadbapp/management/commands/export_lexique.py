import csv
from django.core.management.base import BaseCommand
from hakkadbapp.models import Word  # replace with your actual app name
import os
import shutil
from django.conf import settings

class Command(BaseCommand):
    help = 'Export words to CSV'

    def handle(self, *args, **options):
        export_dir = '../export_e_reo/'
        export_audio_dir = export_dir + 'audio/'
        filename = export_dir + 'words_export.csv'

        os.makedirs(export_dir, exist_ok=True)
        os.makedirs(export_audio_dir, exist_ok=True)
        self.stdout.write(self.style.SUCCESS(f'Exporting to {export_dir}'))

        with open(filename, mode='w', newline='', encoding='utf-8') as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow(['word', 'expression', 'target', 'pivot', 'alternate', 'themes', 'audio', 'image'])

            for word in Word.objects.prefetch_related('wordpronunciation_set__pronunciation'):
                char_sequence = word.char()
                french = word.french
                pinyin = word.pinyin()
                hanzi = word.simp()  # or word.trad() depending on your preference
                target = f"{pinyin}{hanzi}"
                theme = word.category or ''
                audio = f"{pinyin}.wav"
                
                theme = word.category or ''
                audio_path = os.path.join(settings.BASE_DIR, "..","lexique", "audio", theme, f"{pinyin}.wav")
                audio = f"{pinyin}.wav" if os.path.isfile(audio_path) else ""
                print(f"Audio path: {audio_path}, Audio file: {audio}")
                # Copier le fichier s'il existe
                if os.path.exists(audio_path):
                    dest_path = os.path.join(export_audio_dir, f"{pinyin}.wav")
                    shutil.copy(audio_path, dest_path)
                else:
                    self.stderr.write(f"Fichier audio non trouvé : {audio_path}")

                writer.writerow([
                    'x',                 # word
                    '',                 # expression
                    target,             # target (e.g., 酒 jiu3)
                    french,             # pivot (French)
                    '',                 # alternate
                    theme,              # themes
                    audio,              # audio
                    ''                  # image
                ])
                self.stdout.write(f'Exported: {char_sequence} - {french} - {pinyin} - {audio} \n')

        self.stdout.write(self.style.SUCCESS(f'Successfully exported to {filename}'))
