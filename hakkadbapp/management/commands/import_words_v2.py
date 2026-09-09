
from __future__ import annotations

from dataclasses import dataclass, field
import pandas as pd
from django.db import transaction

from hakkadbapp.models import (
    Final,
    Initial,
    Pronunciation,
    Tone,
    Traces,
    Word,
    WordPronunciation,
)
from .import_utils_v2 import (
    build_placeholder_hanzi,
    clean_cell,
    clean_compact_pinyin,
    clean_hanzi,
    normalize_status,
    normalize_theme,
    split_compact_pinyin_into_syllables,
    split_pinyin_syllable,
    validate_entering_tone,
)


@dataclass
class WordImportRow:
    french: str
    english: str
    category: str
    status: str
    syllables: list[tuple[str, str, str, int]]
    details: str = ""


@dataclass
class WordImportParseResult:
    rows: list[WordImportRow] = field(default_factory=list)
    initials: set[str] = field(default_factory=set)
    finals: set[str] = field(default_factory=set)
    pronunciation_keys: set[tuple[str, str, str, int]] = field(default_factory=set)
    logs: list[str] = field(default_factory=list)


WORD_SHEET = "MOTS"


def read_words_sheet(excel_file) -> pd.DataFrame:
    df = pd.read_excel(excel_file, sheet_name=WORD_SHEET)
    df = df.rename(columns=lambda c: str(c).strip())
    return df


def parse_words_df(df: pd.DataFrame) -> WordImportParseResult:
    result = WordImportParseResult()
    for line_num, row in enumerate(df.itertuples(index=False), start=2):
        french = clean_cell(getattr(row, "FRANCAIS", ""))
        raw_pinyin = clean_cell(getattr(row, "_1", ""))
        raw_hanzi = clean_cell(getattr(row, "SINOGRAMME", ""))
        theme = normalize_theme(getattr(row, "THEMES", ""))
        status = normalize_status(getattr(row, "STATUT", ""))
        english = clean_cell(getattr(row, "ANGLAIS", ""))
        if not any([french, raw_pinyin, raw_hanzi]):
            continue

        if not status:
            result.logs.append(f"❌ Ligne {line_num}: statut manquant pour {french or raw_hanzi}")
            continue
        if not raw_pinyin:
            result.logs.append(f"❌ Ligne {line_num}: pinyin manquant pour {french or raw_hanzi}")
            continue
        if not raw_hanzi:
            result.logs.append(f"❌ Ligne {line_num}: sinnogramme manquant pour {french or raw_pinyin}")
            continue

        compact_pinyin = clean_compact_pinyin(raw_pinyin)
        hanzi = clean_hanzi(raw_hanzi)
        syllables = split_compact_pinyin_into_syllables(compact_pinyin)

        if len(syllables) != len(hanzi):
            hanzi, info = build_placeholder_hanzi(hanzi, len(syllables))
            if len(syllables) != len(hanzi):
                result.logs.append(
                    f"❌ Ligne {line_num}: mismatch pinyin='{compact_pinyin}' ({len(syllables)}) / "
                    f"hanzi='{raw_hanzi}' ({len(clean_hanzi(raw_hanzi))})"
                )
                continue
            if info:
                french = f"{french} ({info})".strip()

        parsed_pairs = []
        row_failed = False

        for syllable, hanzi_char in zip(syllables, hanzi):
            initial, final, tone = split_pinyin_syllable(syllable)
            if initial is None:
                result.logs.append(f"❌ Ligne {line_num}: syllabe invalide '{syllable}'")
                row_failed = True
                break

            if not validate_entering_tone(final, tone):
                result.logs.append(
                    f"❌ Ligne {line_num}: tons 5/6 réservés aux finales p/t/k -> '{syllable}'"
                )
                row_failed = True
                break

            parsed_pairs.append((hanzi_char, initial, final, tone))
            result.initials.add(initial)
            result.finals.add(final)
            result.pronunciation_keys.add((hanzi_char, initial, final, tone))

        if row_failed:
            continue

        result.rows.append(
            WordImportRow(
                french=french,
                english=english,
                category=theme,
                status=status,
                syllables=parsed_pairs,
            )
        )

    return result


@transaction.atomic
def import_words_from_df(df: pd.DataFrame, *, reset: bool = False, traces_details: str = "", platform_data=None) -> dict:
    parsed = parse_words_df(df)

    if reset:
        WordPronunciation.objects.all().delete()
        Word.objects.all().delete()
        Pronunciation.objects.all().delete()
        Initial.objects.all().delete()
        Final.objects.all().delete()
        Tone.objects.all().delete()
    Initial.objects.bulk_create(
        [Initial(initial=value) for value in sorted(parsed.initials)],
        ignore_conflicts=True,
    )
    Final.objects.bulk_create(
        [Final(final=value) for value in sorted(parsed.finals)],
        ignore_conflicts=True,
    )
    Tone.objects.bulk_create(
        [Tone(tone_number=i) for i in range(1, 7)],
        ignore_conflicts=True,
    )

    initial_map = {obj.initial: obj for obj in Initial.objects.filter(initial__in=parsed.initials)}
    final_map = {obj.final: obj for obj in Final.objects.filter(final__in=parsed.finals)}
    tone_map = {obj.tone_number: obj for obj in Tone.objects.all()}

    pronunciation_payloads = []
    pronunciation_db_keys = set(
        Pronunciation.objects.values_list(
            "hanzi",
            "initial__initial",
            "final__final",
            "tone__tone_number",
        )
    )

    for hanzi_char, initial, final, tone in sorted(parsed.pronunciation_keys):
        db_key = (hanzi_char, initial, final, tone)
        if db_key in pronunciation_db_keys:
            continue
        pronunciation_payloads.append(
            Pronunciation(
                hanzi=hanzi_char,
                initial=initial_map[initial],
                final=final_map[final],
                tone=tone_map[tone],
            )
        )

    if pronunciation_payloads:
        Pronunciation.objects.bulk_create(pronunciation_payloads, ignore_conflicts=True)

    pronunciation_map = {
        (p.hanzi, p.initial.initial, p.final.final, p.tone.tone_number): p
        for p in Pronunciation.objects.select_related("initial", "final", "tone")
    }

    word_objects = [
        Word(
            french=item.french,
            tahitian=item.english,
            mandarin="",
            category=item.category or None,
            status=item.status or None,
        )
        for item in parsed.rows
    ]
    Word.objects.bulk_create(word_objects)

    word_pronunciations = []
    for word_obj, item in zip(word_objects, parsed.rows):
        for position, syllable_data in enumerate(item.syllables):
            pronunciation = pronunciation_map[syllable_data]
            word_pronunciations.append(
                WordPronunciation(
                    word=word_obj,
                    pronunciation=pronunciation,
                    position=position,
                )
            )

    WordPronunciation.objects.bulk_create(word_pronunciations)

    Traces.objects.create(
        details="\n".join([traces_details, *parsed.logs]).strip(),
        char_count=Pronunciation.objects.values("hanzi").distinct().count(),
        word_count=Word.objects.count(),
        platform_data=platform_data,
    )

    return {
        "rows_imported": len(parsed.rows),
        "logs": parsed.logs,
        "pronunciations": len(parsed.pronunciation_keys),
    }
