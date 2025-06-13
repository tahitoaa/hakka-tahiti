# your_app/management/commands/populate.py
import csv
from django.core.management.base import BaseCommand
from hakkadbapp.models import Initial, Final, Tone, Pronunciation

class Command(BaseCommand):
    help = 'Populates the database with initial data'

    def add_arguments(self, parser):
        parser.add_argument('csv_file', type=str, help='Path to CSV file.')

    def handle(self, *args, **options):
            csv_file = options['csv_file']

            # Clear existing data
            self.stdout.write("Clearing existing data...")
            Pronunciation.objects.all().delete()
            Initial.objects.all().delete()
            Final.objects.all().delete()
            Tone.objects.all().delete()

            # Create tone records (1 to 6)
            for i in range(1, 7):
                Tone.objects.create(tone_number=i)

            tone_map = {str(t.tone_number): t for t in Tone.objects.all()}
            initial_cache = {}
            final_cache = {}

            with open(csv_file, newline='', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                added = 0
                for row in reader:
                    hanzi = row['char'].strip()
                    initial_val = row['initial'].replace(' ', '')
                    final_val = row['final'].replace(' ', '')
                    tone_str = row['tone'].replace(' ', '')

                    # Skip if mandatory fields are missing
                    if not hanzi:
                        self.stdout.write(self.style.WARNING(f"Skipping incomplete row: {row}"))
                        continue

                    # Get or create Initial
                    initial = initial_cache.get(initial_val)
                    if not initial:
                        initial = Initial.objects.create(initial=initial_val)
                        initial_cache[initial_val] = initial

                    # Get or create Final
                    final = final_cache.get(final_val)
                    if not final:
                        final = Final.objects.create(final=final_val)
                        final_cache[final_val] = final

                    # Tone is optional
                    tone = tone_map.get(tone_str) if tone_str in tone_map else None

                    try:
                        Pronunciation.objects.create(
                            hanzi=hanzi,
                            initial=initial,
                            final=final,
                            tone=tone
                        )
                        added += 1
                    except Exception as e:
                        self.stdout.write(self.style.ERROR(f"Failed to add {row}: {e}"))

            self.stdout.write(self.style.SUCCESS(f"Population complete: {added} entries added."))