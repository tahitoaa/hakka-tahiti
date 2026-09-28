import locale
import re
from typing import Any

from django.db.models import Prefetch

from hakkadbapp.models import Pronunciation, Word, WordPronunciation
from hakkadbapp.management.commands.import_utils_v2 import split_compact_pinyin_into_syllables


# Optional: improves French collation if available on the system
try:
    locale.setlocale(locale.LC_COLLATE, "fr_FR.UTF-8")
except locale.Error:
    pass


# Canonical punctuation scheme for a Split (ExpressionNote.excel_format)
# token that's punctuation and nothing else: the hanzi side keeps whatever
# full-width/Chinese form was typed; the pinyin side always gets its plain-
# Latin equivalent (see render_expression_from_token_data, REVERSE_PUNCT_MAP's
# only caller). One dict is the single source for both directions --
# REVERSE_PUNCT_MAP here, FORWARD_PUNCT_MAP below (normalize_punctuation) --
# so they can't drift apart.
_PUNCT_FULLWIDTH_TO_LATIN = {
    "，": ",",
    "、": ",",   # Chinese enumeration comma -- no distinct Latin mark
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
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
    "—": "-",
    "…": "...",
}
REVERSE_PUNCT_MAP = str.maketrans(_PUNCT_FULLWIDTH_TO_LATIN)

_CJK_RE = re.compile(r"[\u3400-\u4DBF\u4E00-\u9FFF]")
_PAREN_PINYIN_RE = re.compile(r"\(([^()]*)\)")

# Opposite direction from REVERSE_PUNCT_MAP: whichever ASCII shorthand
# someone actually types for a punctuation-only Split token, normalize_
# punctuation() below canonicalizes it to ONE full-width form on save, so
# the hanzi side always reads as real Chinese punctuation no matter which
# form was typed. Built from _PUNCT_FULLWIDTH_TO_LATIN's *values* (keeping
# the first full-width source per Latin mark), minus two marks handled
# separately in normalize_punctuation itself:
#   - "\u2026" -> "..." is 3 Latin characters, and str.maketrans only accepts
#     single-character keys -- normalize_punctuation replaces the "..."
#     *substring* before ever touching this per-character table.
#   - "-"/"--" is deliberately never mapped from ASCII at all: a lone or
#     doubled hyphen is the reserved unresolved-hanzi placeholder syntax
#     (resolve_hanzi's "-(hak6)", "--(but5xin1)", bare "-") and must never
#     be rewritten into an em dash here. An em dash is typed as "\u2014" (the
#     full-width mark itself) directly -- there's no ASCII shorthand for it
#     on purpose.
_forward_punct_source = dict(_PUNCT_FULLWIDTH_TO_LATIN)
_forward_punct_source.pop("\u2014", None)
_forward_punct_source.pop("\u2026", None)
FORWARD_PUNCT_MAP = str.maketrans({
    latin: fullwidth for fullwidth, latin in reversed(list(_forward_punct_source.items()))
})

# A whole Split token made up of nothing but punctuation (either form) --
# never a real word. normalize_punctuation() only ever rewrites *these*
# tokens wholesale: the same "punctuation-only token" test expressions.js's
# isPunctuationToken()/PUNCTUATION_ONLY_RE use to exclude punctuation from
# the Vercel/platform decomposition comparison. Deliberately excludes "-"
# (see FORWARD_PUNCT_MAP's note above) so a placeholder token is never
# mistaken for punctuation and rewritten.
_PUNCT_ONLY_TOKEN_RE = re.compile(r"^[\uFF0C\u3002\u3001\uFF1B\uFF1A\uFF1F\uFF01\uFF08\uFF09\u3010\u3011\uFF5B\uFF5D\u2018\u2019\u201C\u201D\u2014\u2026,.;:?!()\[\]{}'\"]+$")


def normalize_punctuation(excel_format):
    """Canonicalize every punctuation-only token of a Split phrase to its
    full-width form (see _PUNCT_FULLWIDTH_TO_LATIN/FORWARD_PUNCT_MAP above),
    leaving every other token -- words, ":gloss" hints, "(pinyin)" overrides,
    bare "-"/"--" placeholders -- untouched. Applied on save
    (expression_mesh_entry) so typing plain ASCII punctuation (a comma, a
    question mark, "...") is always as valid as typing the full-width form:
    whichever was typed, the stored Split ends up with one consistent
    convention, and render_expression_from_token_data's REVERSE_PUNCT_MAP
    can always turn it back into the right Latin mark for the pinyin side."""
    if not excel_format:
        return excel_format

    def normalize_token(tok):
        if not _PUNCT_ONLY_TOKEN_RE.match(tok):
            return tok
        # Substring replace first ("..." is 3 Latin characters, not a single
        # translate-table entry -- see FORWARD_PUNCT_MAP's note), then the
        # remaining single-character marks.
        return tok.replace("...", "…").translate(FORWARD_PUNCT_MAP)

    return " ".join(normalize_token(tok) for tok in excel_format.split())

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
    - inline override on real hanzi: 浪(lang4) -- forces this reading instead
      of whatever _lookup_first_pron guesses from the (possibly ambiguous,
      possibly absent) global Pronunciation table; used for hanzi that are
      real but missing their own dictionary Word entry, so there's no
      authoritative word.pinyin() to fall back on.
    - placeholder: -(hak6)
    - multi-syllable placeholder/override: --(but5xin1) / 浪米(lang4mi3) -- a
      run of several dashes, or several consecutive real hanzi, sharing one
      inline override is split back into one syllable per character (in
      order) via split_compact_pinyin_into_syllables, same as the MOTS sheet
      import already does for compact pinyin cells.
    - raw latin/punctuation passthrough
    """
    if token is None:
        return ""

    token = str(token)
    if not token:
        return ""

    out = []
    # Indices in `out` of the current unbroken run of "-" placeholders or
    # real hanzi -- reset on any other character (including a switch between
    # the two), so only a run immediately followed by "(...)" gets the
    # override (matching resolve_hanzi's `base` grouping).
    pending_indices = []

    i = 0
    n = len(token)

    while i < n:
        ch = token[i]

        if ch == "(":
            match = _PAREN_PINYIN_RE.match(token, i)
            if match:
                inline_py = match.group(1).strip()
                if pending_indices:
                    syllables = split_compact_pinyin_into_syllables(inline_py) if inline_py else []
                    if not syllables and inline_py:
                        syllables = [inline_py]
                    for pos, idx in enumerate(pending_indices):
                        out[idx] = _tone_to_exponent(syllables[pos]) if pos < len(syllables) else "*"
                    pending_indices = []
                i = match.end()
                continue

            out.append(ch)
            i += 1
            continue

        if ch.isspace():
            out.append(ch)
            pending_indices = []
            i += 1
            continue

        if ch == "-":
            out.append("*")
            pending_indices.append(len(out) - 1)
            i += 1
            continue

        if _is_cjk(ch):
            py = _lookup_first_pron(ch, all_prons)
            out.append(_tone_to_exponent(py))
            pending_indices.append(len(out) - 1)
            i += 1
            continue

        out.append(ch)
        pending_indices = []
        i += 1

    return "".join(out)


def resolve_hanzi(token: str) -> str:
    """
    Examples:
      想:souhaiter    -> 想
      陈(chin2)       -> 陈
      浪(lang4)       -> 浪  (pinyin override resolved separately, see resolve_pinyin)
      -(hak6)         -> (hak⁶)
      --(but5xin1)    -> (but⁵ xin¹)
      -               -> *
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

    if base and set(base) == {"-"}:
        if not inline:
            return "*"
        syllables = split_compact_pinyin_into_syllables(inline) or [inline]
        return "(" + " ".join(_tone_to_exponent(s) for s in syllables) + ")"

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