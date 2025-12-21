# your_app/management/commands/populate.py
import re
from unicodedata import category
from django.core.management.base import BaseCommand
from hakkadbapp.models import Pronunciation, WordPronunciation, Word, Initial, Tone, Final, Traces, Expression, ExpressionWord
import pandas as pd
import string

INITIALS = [
    "b", "p", "m", "f",
    "d", "t", "n", "l",
    "g", "k", "h",
    "j", "q", "x",
    "zh", "ch", "sh", "r",
    "z", "c", "s",
    "y", "w", "ng"
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
    def __init__(self):
        super().__init__()
        self.stdout.reconfigure(encoding='utf-8') 
        self.stderr.reconfigure(encoding='utf-8') 
        self.traces = ''

    def stream(self,  s):
        self.traces += s + '\n'
        pass

    def err_stream(self, s):
        self.stderr.write(s)
        self.stream(s)
        pass

    def log_stream(self, s):
        self.stdout.write(s)
        self.stream(s)
        pass

    def handle(self, *args, **options):
        log_path = 'logs.html'  # or an absolute path
        # with open(log_path, 'w', encoding='utf-8') as f:
        #     self.stdout = f
        #     self.stderr = f 
        self.populate_db()

    def parse_sheet(self, sheet_name, excel_file):
        # Read Excel file directly into memory
        df = pd.read_excel(excel_file, sheet_name=sheet_name)

        if sheet_name[0] == 'x':
            return

        self.log_stream(f"📄 Processing sheet: {sheet_name}")

        added = skipped = new_prons = 0

        # Find the STATUT column if present
        statut_col = None
        for col in df.columns:
            if str(col).strip().upper() == "STATUT":
                statut_col = col
                break

        english_col = None
        for col in df.columns:
            if str(col).strip().upper() == "ANGLAIS":
                english_col = col
                break

        for line_num, row in enumerate(df.itertuples(index=False), start=2):  # header is row 1
            french_raw, pinyin_raw, hanzi_raw = row[0], row[1], row[2]

            english = ""
            if english_col:
                english = row[df.columns.get_loc(english_col)] 
            if statut_col:
                statut_val = row[df.columns.get_loc(statut_col)]

            if pd.isna(french_raw) and pd.isna(pinyin_raw) and pd.isna(hanzi_raw):
                continue
            if pd.isna(statut_col):
                self.err_stream(f"❌ Line {line_num}: Missing status {french_raw, pinyin_raw, hanzi_raw }")
            if pd.isna(pinyin_raw):
                self.err_stream(f"❌ Line {line_num}: Missing pinyin {french_raw, pinyin_raw, hanzi_raw }")
            elif pd.isna(hanzi_raw):
                self.err_stream(f"❌ Line {line_num}: Missing hanzi {french_raw, pinyin_raw, hanzi_raw }")
            if pd.isna(statut_col) or pd.isna(pinyin_raw) or pd.isna(hanzi_raw):
                skipped += 1
                continue

            # Clean inputs
            clean_pattern = rf"[{re.escape(string.punctuation)}\s]+"
            french = str(french_raw).strip() 
            status = f"{statut_val}"
            pinyin = re.sub(clean_pattern, '', str(pinyin_raw).lower()).strip()
            hanzi = re.sub(clean_pattern, '', str(hanzi_raw)).strip()
            
            # Split into syllables and hanzi chars
            syllabes = [s for s in re.split(r'(?<=[0-6])', pinyin) if s.strip()]
            hanzi_chars = list(hanzi)

            if len(syllabes) != len(hanzi_chars):
                self.err_stream(
                    f"❌ Line {line_num}: mismatch between pinyin '{pinyin}' ({len(syllabes)} syll) "
                    f"and hanzi '{hanzi}' ({len(hanzi_chars)} chars).\n"
                )
                skipped += 1
                continue

            # Process each syllable-character pair
            syllable_data = []
            for s, h in zip(syllabes, hanzi_chars):
                initial, final, tone = split_pinyin(s)
                self.initial_set.add(initial)
                self.final_set.add(final)
                self.tone_set.add(tone)

                data = (h, initial, final, tone)
                if data not in self.pron_set:
                    new_prons += 1
                self.pron_set.add(data)
                syllable_data.append(data)

            category = sheet_name
            self.word_data.append((french, syllable_data, category, status, english))
            self.log_stream(f"{hanzi} {syllabes} {french} {english}")
            added += 1

        # Final log
        self.log_stream(
            f"✅ Sheet '{sheet_name}': {added} words, {new_prons} new pronunciations, {skipped} skipped."
        )


    def parse_sheets(self, sheet_id):
        sheet_url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx'

        # Use a local file path instead of downloading from Google Sheets
        excel_file = pd.ExcelFile(sheet_url)

        for sheet_name in excel_file.sheet_names:
            self.log_stream('Parsing sheet '+sheet_name)
            if '*' in sheet_name:
                continue
            self.parse_sheet(sheet_name, excel_file)
        pass

    def populate_db(self):
        Pronunciation.objects.all().delete()
        Initial.objects.all().delete()
        Final.objects.all().delete()
        Tone.objects.all().delete()
        Word.objects.all().delete()
        WordPronunciation.objects.all().delete()


        self.initial_set = set()
        self.final_set = set()
        self.tone_set = set()
        self.pron_set = set()
        self.word_data = []

        # Previous worksheet
        # self.parse_sheets('1-MMXRTQ8_0r7jfqmFf6WIS4FMVNHIqMCFbV6JdMT-SQ') 
        self.parse_sheets('1kWOkXIUfxj6q-TjzT-2CQygI1KfPJOfr0d6npHdfc6A')
        self.parse_sheets('1Dxjb849-AJCQL0e9p_9Zvl7bafbz9mJwGNmHubgnGyU')

        # 1. Bulk insert (ignore existing) and retrieve all relevant Initials
        Initial.objects.bulk_create(
            [Initial(initial=i) for i in self.initial_set],
            ignore_conflicts=True
        )
        initial_objs = {
            i.initial: i for i in Initial.objects.filter(initial__in=self.initial_set)
        }

        # 2. Bulk insert and retrieve Finals
        Final.objects.bulk_create(
            [Final(final=f) for f in self.final_set],
            ignore_conflicts=True
        )
        final_objs = {
            f.final: f for f in Final.objects.filter(final__in=self.final_set)
        }

        # 3. Bulk insert and retrieve Tones
        Tone.objects.bulk_create([Tone(tone_number=t) for t in range(1,7)])
        tone_objs = { t.tone_number: t for t in Tone.objects.all()}

        # Prepare Pronunciations
        pron_map = {}
        pron_objs = []
        for h, i_str, f_str, t_num in self.pron_set:
            i = initial_objs.get(i_str)
            f = final_objs.get(f_str)
            t = tone_objs.get(int(t_num or 0))
            # Ensure all are saved (i.e. have .id)
            if not all([i, f, t]):
                continue  # or raise an error

            key = (h, i.id, f.id, t.id)

            p = Pronunciation(hanzi=h, initial=i or '', final=f or '', tone=t or '')
            pron_objs.append(p)
            pron_map[key] = p

        # Bulk create Pronunciations
        created_prons = Pronunciation.objects.bulk_create(pron_objs)

        # Prepare Words and WordPronunciations
        word_objs = []
        word_pron_objs = []

        for french, syllables, category, status, english in self.word_data:
            word = Word(french=french, category=category, status=status, tahitian=english)
            word_objs.append(word)

        # Create words to get IDs
        Word.objects.bulk_create(word_objs)

        # Now associate pronunciations
        for word, (_, syllables, category, status, english) in zip(word_objs, self.word_data):

            for pos, (h, i_str, f_str, t_num) in enumerate(syllables):
                i = initial_objs.get(i_str)
                f = final_objs.get(f_str)
                t = tone_objs.get(int(t_num or 0))
                if not all([i, f, t]):
                    continue  # or raise an error
                key = (h, i.id, f.id, t.id)
                p = pron_map[key]
                word_pron_objs.append(WordPronunciation(word=word, pronunciation=p, position=pos))

        WordPronunciation.objects.bulk_create(word_pron_objs)
        
        Traces.objects.create(timestamp=pd.Timestamp.now(), 
                              details=self.traces,
                              char_count=Pronunciation.objects.distinct('hanzi').count(),
                              word_count=Word.objects.count(),
                              )
        return 

