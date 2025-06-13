# your_app/management/commands/populate.py
import csv
import re
from django.core.management.base import BaseCommand
from hakkadbapp.models import Pronunciation, WordPronunciation, Word, Initial, Tone, Final
import pandas as pd
import string

INITIALS = [
    "b", "p", "m", "f",
    "d", "t", "n", "l",
    "g", "k", "h",
    "j", "q", "x",
    "zh", "ch", "sh", "r",
    "z", "c", "s",
    "y", "w"
]

def split_pinyin(pinyin):
    # Extract tone (last digit)
    match = re.match(r"([a-z]+)(\d)", pinyin)
    if not match:
        return None, None, None  # invalid format
    
    syllable, tone = match.groups()

    # Find matching initial
    initial = ''
    for ini in sorted(INITIALS, key=len, reverse=True):  # Match longer initials first
        if syllable.startswith(ini):
            initial = ini
            break

    final = syllable[len(initial):]
    return initial, final, tone


class Command(BaseCommand):
    help = 'Populate Word and WordPronunciation from a google sheet'

    def handle(self, *args, **options):
        sheet_id = '1-MMXRTQ8_0r7jfqmFf6WIS4FMVNHIqMCFbV6JdMT-SQ'

        log_path = 'logs.html'  # or an absolute path
        with open(log_path, 'w', encoding='utf-8') as f:
            self.stdout = f
            self.stderr = f 
            self.parse_sheet(sheet_id, False)


    def parse_sheet(self, sheet_id, use_db=False):
        Pronunciation.objects.all().delete()
        Initial.objects.all().delete()
        Final.objects.all().delete()
        Tone.objects.all().delete()
        Word.objects.all().delete()
        WordPronunciation.objects.all().delete()

        sheet_url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx'

        # Load into pandas
        excel_file = pd.ExcelFile(sheet_url)

        # Skip the first sheet
        for sheet_name in excel_file.sheet_names[1:]:
            # Read only first 3 columns (A, B, C)
            df = pd.read_excel(excel_file, sheet_name=sheet_name, usecols="A:C")
            
            # Export to CSV
            csv_name = f"./hakkadbapp/data/{sheet_name}.csv"
            df.to_csv(csv_name, index=False)
            self.stdout.write(f"""
                        <h1>{sheet_name}</h1>
                        
                        """)

            added = 0
            skipped = 0
            new_prons = 0

            with open(csv_name, newline='', encoding='utf-8') as f:
                reader = csv.reader(f, delimiter=',')
                # WordPronunciation.objects.all().delete()
                # Word.objects.all().delete()

                next(reader, None)

                for line_num, row in enumerate(reader, start=1):
                    if len(row) < 3 or row[1].strip() == '' or row[2].strip() == '':
                        # self.stdout.write(self.style.WARNING(f"Line {line_num}: Skipped (not enough fields)"))
                        # skipped += 1
                        continue

                    # mandarin = row[0].strip()
                    french = row[0].strip()

                    # Regex pattern to remove all punctuation and whitespace
                    clean_pattern = rf"[{re.escape(string.punctuation)}\s]+"

                    py = re.sub(clean_pattern, '', row[1]).strip()
                    chars = re.sub(clean_pattern, '', row[2]).strip()

                    # if not mandarin or not french:
                    #     self.stdout.write(self.style.WARNING(f"Line {line_num}: Skipped (missing mandarin or french)"))
                    #     skipped += 1
                    #     continue

                    syllabes = [char.strip() for char in re.split(r'(?<=[0-6])', py) if char.strip() not in (')', '', ' ', ' ', '?')]
                    hanzi_chars = [c.strip() for c in chars]


                    if len(syllabes) != len(hanzi_chars):
                        self.stdout.write(f"""
<div class="log error">
  ❌ <strong>Line {line_num+1}</strong> <code>{sheet_name}</code>: 
  <span class="status">Skipped</span> 
  <em>(failed to match pinyin to hanzi)</em><br>
  <span class="details">
    <strong>Pinyin:</strong> {', '.join(syllabes)}<br>
    <strong>Hanzi:</strong> {hanzi_chars}
  </span>
</div>
""")
                        skipped += 1
                        continue

                    # zip ,hanzi and syllaabes
                    pronunciations = []
                    # missing = False

                    for (s,h) in zip(syllabes, hanzi_chars):
                        initial, final, tone = split_pinyin(s)
                        if (initial or final or tone):
                            i, _ = Initial.objects.get_or_create(initial=initial)
                            f, _ = Final.objects.get_or_create(final=final)
                            t, _ = Tone.objects.get_or_create(tone_number=tone)
                            if h:
                                p, exists = Pronunciation.objects.get_or_create(hanzi=h, initial=i, final=f, tone=t)
                                if not exists:
                                    new_prons += 1
                            pronunciations.append(p)
                        pass

                    word = Word.objects.create(
                        french=french,
                        category="?"
                    )
                    nw = ""
                    wp = ""
                    for pos, p in enumerate(pronunciations):
                        nw += p.hanzi
                        wp += p.initial.initial + p.final.final + str(p.tone.tone_number)
                        WordPronunciation.objects.create(
                            word=word,
                            pronunciation=p,
                        position=pos
                        )
#                     self.stdout.write(f"""
# <div class="log ok">
#   ✅ <strong>OK</strong> – <code>{nw}</code> – {french} – <span class="pinyin">{wp}</span>
# </div>
# """)
                    added += 1  

            self.stdout.write(f"""
<div class="log summary">
  ✅ <strong>Done</strong>: 
  <span class="prons">{new_prons} pronunciations added</span>, 
  <span class="words">{added} words added</span>, 
  <span class="skipped">{skipped} skipped</span>.
</div>
""")


