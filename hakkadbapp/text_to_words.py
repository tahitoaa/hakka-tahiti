import locale
import re
from typing import Any

from django.db.models import Prefetch

from hakkadbapp.models import Pronunciation, Word, WordPronunciation


# Optional: improves French collation if available on the system
try:
    locale.setlocale(locale.LC_COLLATE, "fr_FR.UTF-8")
except locale.Error:
    pass


REVERSE_PUNCT_MAP = str.maketrans({
    "，": ",",
    "。": ".",
    "；": ";",
    "：": ":",
    "？": "?",
    "！": "!",
    "（": "(",
    "）": ")",
    "【": "[",
    "】": "]",
    "｛": "{",
    "｝": "}",
    "’": "'",
    "”": '"',
    "—": "-",
})

_CJK_RE = re.compile(r"[\u3400-\u4DBF\u4E00-\u9FFF]")
_PAREN_PINYIN_RE = re.compile(r"\(([^()]*)\)")

_SUPERSCRIPT = str.maketrans({
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
})


def build_all_words_for_tokens(tokens):
    """
    Return only the relevant words for the given tokens,
    with pronunciations prefetched in the correct order.
    """
    used_chars = set()

    for token in tokens:
        base = str(token).split(":", 1)[0]
        used_chars.update(_CJK_RE.findall(base))

    if not used_chars:
        return Word.objects.none()

    wps_qs = (
        WordPronunciation.objects
        .select_related("pronunciation__initial", "pronunciation__final", "pronunciation__tone")
        .order_by("position")
    )

    return (
        Word.objects
        .filter(wordpronunciation__pronunciation__hanzi__in=used_chars)
        .distinct()
        .prefetch_related(Prefetch("wordpronunciation_set", queryset=wps_qs))
    )


def find_words_by_hanzi_with_disambiguation(token, all_words):
    """
    token format:
      - "漢字"
      - "漢字:constraint1,constraint2"
    """
    parts = str(token).split(":", 1)
    hanzi = parts[0]

    constraints = None
    if len(parts) == 2 and parts[1].strip():
        constraints = [c.strip().lower() for c in parts[1].split(",") if c.strip()]

    matches = []

    for word in all_words:
        simp = word.char()
        trad = getattr(word, "trad", lambda: None)()

        if simp != hanzi and trad != hanzi:
            continue

        french = (word.french or "").lower()
        pinyin = (word.pinyin() or "").lower()

        if (not constraints) or any(c in french or c in pinyin for c in constraints):
            matches.append(word)

    if len(matches) == 1:
        return matches

    def sort_key(word):
        fr = (word.french or "").lower()
        py = (word.pinyin() or "").lower()
        return (
            len(fr),
            locale.strxfrm(fr),
            locale.strxfrm(py),
        )

    matches.sort(key=sort_key)

    return matches or [None]


def _tone_to_exponent(py: str) -> str:
    py = (py or "").strip()
    if py and py[-1].isdigit():
        return py[:-1] + py[-1].translate(_SUPERSCRIPT)
    return py


def _is_cjk(hanzi_char: str) -> bool:
    if not hanzi_char or len(hanzi_char) != 1:
        return False

    code = ord(hanzi_char)
    return (
        0x4E00 <= code <= 0x9FFF or
        0x3400 <= code <= 0x4DBF or
        0x20000 <= code <= 0x2A6DF or
        0x2A700 <= code <= 0x2B73F or
        0x2B740 <= code <= 0x2B81F or
        0x2B820 <= code <= 0x2CEAF or
        0xF900 <= code <= 0xFAFF
    )


def _lookup_first_pron(hanzi: str, all_prons: Any) -> str:
    qs = all_prons.filter(hanzi=hanzi)
    if not qs.exists():
        return "~"
    pron = qs.first()
    return pron.pinyin() if pron else "?"


def resolve_pinyin(token: str, all_prons: Any) -> str:
    """
    Resolve one pinyin string for a token, including:
    - inline override: 陳(chin2)
    - placeholder: -(hak6)
    - raw latin/punctuation passthrough
    """
    if token is None:
        return ""

    token = str(token)
    if not token:
        return ""

    out = []
    last_hanzi_out_index = None

    i = 0
    n = len(token)

    while i < n:
        ch = token[i]

        if ch == "(":
            match = _PAREN_PINYIN_RE.match(token, i)
            if match:
                inline_py = match.group(1).strip()
                if last_hanzi_out_index is not None:
                    out[last_hanzi_out_index] = _tone_to_exponent(inline_py) if inline_py else "*"
                i = match.end()
                continue

            out.append(ch)
            i += 1
            continue

        if ch.isspace():
            out.append(ch)
            i += 1
            continue

        if ch == "-":
            out.append("*")
            last_hanzi_out_index = len(out) - 1
            i += 1
            continue

        if _is_cjk(ch):
            py = _lookup_first_pron(ch, all_prons)
            out.append(_tone_to_exponent(py))
            last_hanzi_out_index = len(out) - 1
            i += 1
            continue

        out.append(ch)
        i += 1

    return "".join(out)


def resolve_hanzi(token: str) -> str:
    """
    Examples:
      想:souhaiter -> 想
      陈(chin2)    -> 陈
      -(hak6)      -> (hak⁶)
      -            -> *
    """
    if token is None:
        return ""

    text = str(token).strip()
    if not text:
        return ""

    text = text.split(":", 1)[0].strip()

    match = _PAREN_PINYIN_RE.search(text)
    inline = match.group(1).strip() if match else ""
    base = _PAREN_PINYIN_RE.sub("", text).strip()

    if base == "-":
        return f"({_tone_to_exponent(inline)})" if inline else "*"

    return base


def collect_tokens_from_df(df):
    """
    Extract all phrase tokens from the dataframe.
    """
    tokens = []
    for _, row in df.iterrows():
        if getattr(row, "phrase", None) is None:
            continue
        try:
            import pandas as pd
            if pd.isna(row.phrase):
                continue
        except Exception:
            pass
        tokens.extend(str(row.phrase).strip().split())
    return tokens


def build_phrase_conversion_context(df):
    """
    Build the reusable lookup context for one dataframe import.
    """
    all_tokens = collect_tokens_from_df(df)
    return {
        "all_words": build_all_words_for_tokens(all_tokens),
        "all_prons": Pronunciation.objects.all(),
    }


def convert_token_to_word_data(token: str, all_words, all_prons) -> dict:
    """
    Convert one token into a normalized structure.
    """
    matches = find_words_by_hanzi_with_disambiguation(token, all_words)
    word = matches[0]

    if word is None:
        hanzi = resolve_hanzi(token)
        pinyin = resolve_pinyin(token, all_prons)
        return {
            "word": None,
            "hanzi": hanzi,
            "pinyin": pinyin,
            "matched": False,
        }

    return {
        "word": word,
        "hanzi": token.split(":", 1)[0],
        "pinyin": word.pinyin(),
        "matched": True,
    }


def convert_phrase_to_word_data(phrase: str, all_words, all_prons) -> list[dict]:
    """
    Convert one full phrase into ordered token data.
    """
    tokens = str(phrase).strip().split()
    return [
        convert_token_to_word_data(token, all_words, all_prons)
        for token in tokens
    ]


def render_expression_from_token_data(token_data: list[dict]) -> str:
    """
    Build the final rendering string:
      '<pinyin> <hanzi>'
    """
    pinyin = "".join(f"{item['pinyin']} " for item in token_data).translate(REVERSE_PUNCT_MAP).strip()
    hanzi = "".join(item["hanzi"] for item in token_data).strip()
    return f"{pinyin} {hanzi}".strip()