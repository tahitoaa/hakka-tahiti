from hakkadbapp.models import  Word, Expression, ExpressionWord, Pronunciation
import pandas as pd
from django.db import transaction
from itertools import product
from django.core.management.base import BaseCommand

def find_word_by_hanzi(hanzi, all_words):
    """Return the first Word whose char() matches the token."""
    for w in all_words:
        if w.char() == hanzi:
            return w
    return None

def parse_token_pinyin(token):
    if '(' in token:
        sp = token.split('(')
        pinyin = ''
        if len(sp) == 2:
            pinyin = sp[1]
            pinyin = pinyin.split(')')[0]
    else: 
        pinyin = ' ? '
    return pinyin

def all_pinyins_for_token(token, all_prons):
    """
    Return a factorized pinyin string for a token.
    Each character contributes its alternatives joined by '/'.
    Unknown characters → '?'.
    """
    parts = []

    for c in token:
        prons = all_prons.filter(hanzi=c)

        if prons.exists():
            variants = [p.pinyin() for p in prons]
            parts.append('/'.join(sorted(set(variants))))
        else:
            parts.append('?')

    return ''.join(parts)

def import_expressions_from_df(df):
    # Cache tous les mots une seule fois
    all_words = (
        Word.objects
        .prefetch_related("wordpronunciation_set__pronunciation")
        .all()
    )

    all_prons = (
        Pronunciation.objects.all()
    )
    expressions = []
    expression_words = []   

    with transaction.atomic():
        # 1. Construire toutes les Expressions (sans les sauver)
        for _, row in df.iterrows():
            if str(row['phrase']) == "nan":
                continue 
            
            phrase = str(row["phrase"]).strip()
            french = str(row["french"]).strip()

            tokens =  phrase.split()
            hanzi, pinyin = "", ""

            words = []
            expr = Expression(
                french=french,
                text=phrase
            )
            for pos, token in enumerate(tokens):
                word = find_word_by_hanzi(token, all_words)
                hanzi += token
                if word is None:
                    pinyins = all_pinyins_for_token(token, all_prons)

                    # s'il y a au moins un caractère inconnu
                    if '?' in ''.join(pinyins):
                        pinyin += parse_token_pinyin(token)
                    else:
                        pinyin += ''.join(pinyins)
                else:
                    words.append(word)
                    pinyin += word.pinyin() + ' '
                    expression_words.append(
                        ExpressionWord(
                            expression=expr,
                            word=word,   # peut être None
                            position=pos
                        )
                    )
            expr.rendering = pinyin + ' - ' + hanzi
            expressions.append(expr)
            print(expr.rendering)
        Expression.objects.bulk_create(expressions)
        ExpressionWord.objects.bulk_create(expression_words)
    return expressions


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
                sheet_name=sheet_name,
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

