from hakkadbapp.models import  Word, Expression, ExpressionWord, Pronunciation
import pandas as pd
from django.db import transaction
from itertools import product
from django.core.management.base import BaseCommand
import re
import locale
import re
from typing import Any


# Optional: improves French collation if available on the system
try:
    locale.setlocale(locale.LC_COLLATE, "fr_FR.UTF-8")
except locale.Error:
    pass

def find_words_by_hanzi_with_disambiguation(token, all_words):
    """
    token: str
        Format: "漢字" or "漢字:constraint1,constraint2"
    all_words: iterable of Word-like objects
        Expected attributes or methods:
            - w.char()          -> hanzi (simp)
            - w.trad() or w.trad -> traditional (optional)
            - w.french          -> French gloss (str or None)
            - w.pinyin()        -> pinyin string (or attribute)

    Returns:
        list of Word or a fallback pseudo-entry if no match
    """

    # --- 1️⃣ Parse token and constraints ---
    parts = token.split(":", 1)
    hanzi = parts[0]

    constraints = None
    if len(parts) == 2 and parts[1].strip():
        constraints = [
            c.strip().lower()
            for c in parts[1].split(",")
            if c.strip()
        ]

    matches = []

    # --- 2️⃣ Filtering ---
    for w in all_words:
        simp = w.char()
        trad = getattr(w, "trad", lambda: None)()
        # Hanzi match is mandatory
        if simp != hanzi and trad != hanzi:
            continue
        french = (w.french or "").lower()
        pinyin = (w.pinyin() or "").lower()

        # No constraints → accept directly
        if not constraints:
            matches.append(w)
            continue

        # At least one constraint must match French OR Pinyin
        if any(c in french or c in pinyin for c in constraints):
            matches.append(w)

    if len(matches) == 1:
        return matches
    
    # --- 3️⃣ Sorting ---
    def sort_key(w):
        fr = (w.french or "").lower()
        py = (w.pinyin() or "").lower()
        return (
            len(fr),                    # shortest French first
            locale.strxfrm(fr),         # French collation
            locale.strxfrm(py),         # Pinyin collation
        )

    matches.sort(key=sort_key)

    # --- 4️⃣ Fallback ---
    if matches:
        return matches

    return [None]

# "(be1)" -> captures "be1"
_PAREN_PINYIN_RE = re.compile(r"\(([^()]*)\)")

_SUPERSCRIPT = str.maketrans({
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶",
})

def _tone_to_exponent(py: str) -> str:
    """'be1' -> 'be¹' (only if trailing digit)."""
    py = (py or "").strip()
    if py and py[-1].isdigit():
        return py[:-1] + py[-1].translate(_SUPERSCRIPT)
    return py

def _is_cjk(hanzi_char: str) -> bool:
    """Heuristic: treat CJK Unified Ideographs blocks as Hanzi."""
    if not hanzi_char or len(hanzi_char) != 1:
        return False
    code = ord(hanzi_char)
    return (
        0x4E00 <= code <= 0x9FFF or   # CJK Unified Ideographs
        0x3400 <= code <= 0x4DBF or   # Extension A
        0x20000 <= code <= 0x2A6DF or # Extension B
        0x2A700 <= code <= 0x2B73F or # Extension C
        0x2B740 <= code <= 0x2B81F or # Extension D
        0x2B820 <= code <= 0x2CEAF or # Extension E/F
        0xF900 <= code <= 0xFAFF     # Compatibility Ideographs
    )

def _lookup_first_pron(hanzi: str, all_prons: Any) -> str:
    """One pinyin for a hanzi; '?' if missing."""
    qs = all_prons.filter(hanzi=hanzi)
    if not qs.exists():
        return "?"
    p = qs.first()
    return p.pinyin() if p else "?"

def resolve_pinyin(token: str, all_prons: Any) -> str:
    """
    Resolve ONE pinyin string for `token`:

    Rules:
    - Token is a string containing Hanzi plus optional inline pinyin precision '(be1)'.
    - '-' represents an unknown Hanzi placeholder -> contributes '?'.
    - Hanzi with no pron in `all_prons` -> contributes '?'.
    - '(pinyin)' overwrites the pron of the *previous Hanzi*.
    - Tone digit is rendered as superscript exponent.
    - Any substring that is NOT Hanzi and NOT inside '(...)' is copied as-is
      into the output (punctuation, latin letters, digits, etc.).
    """
    if token is None:
        return ""
    token = str(token)
    if not token:
        return ""

    out = []
    last_hanzi_out_index = None  # index in out of last hanzi syllable (so we can overwrite)

    i = 0
    n = len(token)

    while i < n:
        ch = token[i]

        # Inline pinyin override "(...)"
        if ch == "(":
            m = _PAREN_PINYIN_RE.match(token, i)
            if m:
                inline_py = m.group(1).strip()
                if last_hanzi_out_index is not None:
                    out[last_hanzi_out_index] = _tone_to_exponent(inline_py) if inline_py else "*"
                # If no previous hanzi, ignore the override (per spec)
                i = m.end()
                continue
            # malformed "(" -> copy as-is
            out.append(ch)
            i += 1
            continue

        # Preserve whitespace (or skip it if you prefer)
        if ch.isspace():
            out.append(ch)
            i += 1
            continue

        # Unknown hanzi placeholder
        if ch == "-":
            out.append("*")
            last_hanzi_out_index = len(out) - 1
            i += 1
            continue

        # Hanzi: resolve from DB
        if _is_cjk(ch):
            py = _lookup_first_pron(ch, all_prons)
            out.append(_tone_to_exponent(py))
            last_hanzi_out_index = len(out) - 1
            i += 1
            continue

        # Any other character outside parentheses: copy as-is
        out.append(ch)
        i += 1

    return "".join(out)

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
            # if _ > 5:
            #     continue

            if str(row['phrase']) == "nan" or str(row['french']) == "nan":
                continue 

            phrase = str(row["phrase"]).strip()
            french = str(row["french"]).strip()

            tokens =  phrase.split()
            hanzi, pinyin = "", ""

            words = []
            expr = Expression(
                french=french,
                text=phrase,
                status=str(row['status']).strip(),
                category=row['themes'].split(',')
            )
            for pos, token in enumerate(tokens):
                matches = find_words_by_hanzi_with_disambiguation(token, all_words)
                word = matches[0]
                print(len(matches), word)
                hanzi += token.split(':')[0]
                if word is None:
                    pinyin += resolve_pinyin(token, all_prons)
                else:
                    words.append(word)
                    pinyin += word.pinyin() + ' '
                    expression_words.append(
                        ExpressionWord(
                            expression=expr,
                            word=word,   # peut être None
                            position=pos,
                        )
                    )
            expr.rendering = pinyin + ' ' + hanzi
            expressions.append(expr)
            print(expr.rendering + ' ' + expr.status )
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
                usecols="A:F",     # only columns A and B
                sheet_name=sheet_name,
                skiprows=1         # skip the header row → start at line 2
            )
            df.columns = ["french", "phrase", "themes", "comments", "english", "status"]
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

