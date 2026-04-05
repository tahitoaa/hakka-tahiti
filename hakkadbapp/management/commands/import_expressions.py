from django.core.management.base import BaseCommand
from django.db import transaction
import pandas as pd

from hakkadbapp.models import Expression, ExpressionWord
from hakkadbapp.text_to_words import (
    build_phrase_conversion_context,
    convert_phrase_to_word_data,
    render_expression_from_token_data,
)

new_words = []


def import_expressions_from_df(df):
    context = build_phrase_conversion_context(df)
    all_words = context["all_words"]
    all_prons = context["all_prons"]

    expressions = []
    expression_words = []

    with transaction.atomic():
        for row_index, row in df.iterrows():
            if pd.isna(row.phrase) or pd.isna(row.french):
                continue

            phrase = str(row.phrase).strip()
            french = str(row.french).strip()
            status = str(row.status).strip() if hasattr(row, "status") else ""
            category = str(row.themes).strip() if not pd.isna(row.themes) else ""
            english = str(row.english).strip() if not pd.isna(row.english) else " - "

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

                    if token_hanzi not in [", ", "?", "，", "？", "。"]:
                        new_words.append(
                            f"mot inconnu {token_pinyin} {token_hanzi} dans {french} {phrase}"
                        )

            expr.rendering = render_expression_from_token_data(token_data)
            expressions.append(expr)

            print(f"{row_index + 2} {expr.rendering} {expr.status}")

        Expression.objects.bulk_create(expressions)
        ExpressionWord.objects.bulk_create(expression_words)

    return expressions


class Command(BaseCommand):
    help = "Populate Word and WordPronunciation from a google sheet"

    def __init__(self):
        super().__init__()
        self.stdout.reconfigure(encoding="utf-8")
        self.stderr.reconfigure(encoding="utf-8")
        self.traces = ""

    def stream(self, s):
        self.traces += s + "\n"

    def err_stream(self, s):
        self.stderr.write(s)
        self.stream(s)

    def log_stream(self, s):
        self.stdout.write(s)
        self.stream(s)

    def parse_expressions(self, sheet_id):
        sheet_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx"
        excel_file = pd.ExcelFile(sheet_url)

        for sheet_name in excel_file.sheet_names:
            self.log_stream(sheet_name)
            df = pd.read_excel(
                excel_file,
                usecols="A:F",
                sheet_name=sheet_name,
            )
            df.columns = ["french", "phrase", "themes", "comments", "english", "status"]
            import_expressions_from_df(df)

    def handle(self, *args, **options):
        ExpressionWord.objects.all().delete()
        Expression.objects.all().delete()

        self.parse_expressions("1Zq5jZ7D8qfRu_P75iSNPrl1roO3OCroeXOKuj088i14")
        print("\n".join(new_words))