
from __future__ import annotations

import re
import string
from dataclasses import dataclass


INITIALS = [
    "zh", "ch", "sh",
    "ng",
    "b", "p", "m", "f",
    "d", "t", "n", "l",
    "g", "k", "h",
    "j", "q", "x",
    "r", "z", "c", "s",
    "y", "w",
    "",
]


@dataclass(frozen=True)
class ParsedSyllable:
    hanzi: str
    initial: str
    final: str
    tone: int


def clean_cell(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() == "nan":
        return ""
    return text


def normalize_status(value) -> str:
    return clean_cell(value)


def normalize_theme(value) -> str:
    return clean_cell(value)


def clean_compact_pinyin(value) -> str:
    text = clean_cell(value).lower()
    # keep latin letters, ü and tone digits only
    text = re.sub(r"[^a-zü0-9]", "", text)
    return text


def clean_hanzi(value) -> str:
    text = clean_cell(value)

    # remove punctuation EXCEPT '-'
    punctuation = string.punctuation.replace("-", "")

    text = re.sub(rf"[{re.escape(punctuation)}\s]+", "", text)

    return text


def split_compact_pinyin_into_syllables(pinyin: str) -> list[str]:
    return [s for s in re.split(r"(?<=[0-6])", pinyin) if s.strip()]


def split_pinyin_syllable(pinyin: str) -> tuple[str, str, int] | tuple[None, None, None]:
    match = re.fullmatch(r"([a-zü]+)([0-6])", clean_cell(pinyin).lower())
    if not match:
        return None, None, None

    syllable, tone_text = match.groups()

    initial = ""
    for candidate in INITIALS:
        if syllable.startswith(candidate):
            initial = candidate
            break

    final = syllable[len(initial):]
    return initial, final, int(tone_text)


def build_placeholder_hanzi(raw_hanzi: str, syllable_count: int) -> tuple[str, str]:
    lowered = clean_cell(raw_hanzi).lower()
    notes = {
        "phonétique": "transcription phonétique sans caractères",
        "archaïsme": "caractères inconnus ou archaïques",
        "anglicisme": "anglicisme",
    }
    if lowered in notes:
        return "-" * syllable_count, notes[lowered]
    return clean_cell(raw_hanzi), ""


def validate_entering_tone(final: str, tone: int) -> bool:
    if tone not in {5, 6}:
        return True
    return bool(final) and final[-1] in {"t", "k", "p"}
