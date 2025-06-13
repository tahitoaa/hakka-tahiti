# your_app/management/commands/populate.py
import csv
from django.core.management.base import BaseCommand
from hakkadbapp.models import Pronunciation, WordPronunciation, Word, Initial, Tone, Final

class Command(BaseCommand):
    help = 'Populate Word and WordPronunciation from CSV with char|french|tahitian'

    def add_arguments(self, parser):
        parser.add_argument('csv_file', type=str, help='Path to the CSV file')

    def handle(self, *args, **options):
        csv_file = options['csv_file']

        added = 0
        skipped = 0

        with open(csv_file, newline='', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter='|')
            WordPronunciation.objects.all().delete()
            Word.objects.all().delete()

            for line_num, row in enumerate(reader, start=1):
                if len(row) < 2:
                    self.stdout.write(self.style.WARNING(f"Line {line_num}: Skipped (not enough fields)"))
                    skipped += 1
                    continue

                mandarin = row[0].strip()
                french = row[1].strip()
                tahitian = row[2].strip() if len(row) > 2 else ''

                if not mandarin or not french:
                    self.stdout.write(self.style.WARNING(f"Line {line_num}: Skipped (missing mandarin or french)"))
                    skipped += 1
                    continue

                hanzi_chars = list(mandarin)
                pronunciations = []
                missing = False

                for char in hanzi_chars:
                    matches = Pronunciation.objects.filter(hanzi=char)
                    if matches.count() == 1:
                        pronunciations.append(matches.first())
                    elif matches.count() == 0:
                        self.stdout.write(self.style.WARNING(f"Line {line_num}: No pronunciation for '{char}'"))
                        initial, _ = Initial.objects.get_or_create(initial="?")
                        final, _ = Final.objects.get_or_create(final="?")
                        tone, _ = Tone.objects.get_or_create(tone_number=0)
                        p = Pronunciation(hanzi=char, initial=initial, final=final, tone=tone)
                        p.save()
                        
                        pronunciations.append(p)
                        break
                    else:
                        self.stdout.write(self.style.WARNING(f"Line {line_num}: WARNING - Multiple pronunciations for '{char}'"))
                        pronunciations.append(matches.first())
                        break

                if missing:
                    skipped += 1
                    continue

                word = Word.objects.create(
                    french=french,
                    tahitian=tahitian,
                    mandarin=mandarin,
                    category=Word.Category.OTHER
                )

                for pos, pronunciation in enumerate(pronunciations):
                    WordPronunciation.objects.create(
                        word=word,
                        pronunciation=pronunciation,
                        position=pos
                    )

                added += 1

        self.stdout.write(self.style.SUCCESS(f"Done: {added} words added, {skipped} skipped."))