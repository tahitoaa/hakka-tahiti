from hakkadbapp.models import  Word, Expression, ExpressionWord
import pandas as pd
from django.db import transaction

from django.core.management.base import BaseCommand

def find_word_by_hanzi(hanzi, all_words):
    """Return the first Word whose char() matches the token."""
    for w in all_words:
        if w.char() == hanzi:
            return w
    return None


def import_expressions_from_df(df):
    # Prefetch all words once (much faster)
    all_words = (
        Word.objects
        .prefetch_related("wordpronunciation_set__pronunciation")
        .all()
    )

    created = []

    for _, row in df.iterrows():
        french = str(row["french"]).strip()
        phrase = str(row["phrase"]).strip()

        if not phrase:
            continue
        
        tokens = phrase.split()
        print(tokens)

        # Create expression
        expr = Expression.objects.create(french=french, text=phrase)

        with transaction.atomic():
            for pos, token in enumerate(tokens):
                word = find_word_by_hanzi(token, all_words)

                ExpressionWord.objects.create(
                    expression=expr,
                    word=word,   # may be None if no match
                    position=pos
                )

        created.append(expr)

    return created


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

    def parse_expressions(self, sheet_id):
        sheet_url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx'

        # Use a local file path instead of downloading from Google Sheets
        excel_file = pd.ExcelFile(sheet_url)

        for sheet_name in excel_file.sheet_names:
            df = pd.read_excel(
                excel_file,
                usecols="A:B",     # only columns A and B
                skiprows=2         # skip the header row → start at line 2
            )
            df.columns = ["french", "phrase"]
            expressions = import_expressions_from_df(df)
        pass

    def handle(self, *args, **options):
        log_path = 'logs.html'  # or an absolute path
        # with open(log_path, 'w', encoding='utf-8') as f:
        #     self.stdout = f
        #     self.stderr = f 

        ExpressionWord.objects.all().delete()
        Expression.objects.all().delete()

        self.parse_expressions("1Zq5jZ7D8qfRu_P75iSNPrl1roO3OCroeXOKuj088i14")

