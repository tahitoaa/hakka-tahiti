
from __future__ import annotations

import pandas as pd
from django.db import transaction

from hakkadbapp.models import Expression, ExpressionWord
from hakkadbapp.text_to_words import (
    build_phrase_conversion_context,
    convert_phrase_to_word_data,
    render_expression_from_token_data,
)


EXPRESSION_SHEET = "EXPRESSIONS"


def read_expressions_sheet(excel_file) -> pd.DataFrame:
    # excel_file = pd.ExcelFile(...)
    if EXPRESSION_SHEET in excel_file.sheet_names:
        df = excel_file.parse(EXPRESSION_SHEET)
        df = df.rename(columns=lambda c: str(c).strip())
        return df


def normalize_expressions_df(df: pd.DataFrame) -> pd.DataFrame:
    keep = pd.DataFrame()
    keep["french"] = df.get("FRANCAIS")
    keep["phrase"] = df.get("SINOGRAMME")
    keep["themes"] = df.get("THEMES")
    keep["comments"] = df.get("OBSERVATIONS")
    keep["english"] = df.get("ANGLAIS")
    keep["status"] = ""
    return keep


@transaction.atomic
def import_expressions_from_df(df: pd.DataFrame, *, reset: bool = True) -> dict:

    if reset:
        ExpressionWord.objects.all().delete()
        Expression.objects.all().delete()
    if df is None:
        return {'rows_imported': 0, 'unknown_tokens': 0}
    
    df = normalize_expressions_df(df)

    context = build_phrase_conversion_context(df)
    all_words = context["all_words"]
    all_prons = context["all_prons"]

    expressions = []
    expression_words = []
    unknown_tokens = []

    for row_index, row in df.iterrows():
        if pd.isna(row.phrase) or pd.isna(row.french):
            continue

        phrase = str(row.phrase).strip()
        french = str(row.french).strip()
        status = str(row.status).strip() if hasattr(row, "status") else ""
        category = str(row.themes).strip() if not pd.isna(row.themes) else ""
        english = str(row.english).strip() if not pd.isna(row.english) else ""

        expr = Expression(
            french=french,
            text=phrase,
            status=status,
            category=category,
            english=english,
        )

        token_data = convert_phrase_to_word_data(
            phrase=phrase,
            all_words=all_words,
            all_prons=all_prons,
        )

        for pos, item in enumerate(token_data):
            if item["word"] is not None:
                expression_words.append(
                    ExpressionWord(
                        expression=expr,
                        word=item["word"],
                        position=pos,
                    )
                )
            else:
                token_hanzi = item["hanzi"]
                token_pinyin = item["pinyin"]
                if token_hanzi not in {", ", "?", "，", "？", "。"}:
                    unknown_tokens.append(
                        f"mot inconnu {token_pinyin} {token_hanzi} dans {french} | {phrase}"
                    )

        expr.rendering = render_expression_from_token_data(token_data)
        expressions.append(expr)

    Expression.objects.bulk_create(expressions)
    ExpressionWord.objects.bulk_create(expression_words)

    return {
        "rows_imported": len(expressions),
        "unknown_tokens": unknown_tokens,
    }
