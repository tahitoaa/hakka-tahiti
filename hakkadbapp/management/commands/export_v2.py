# hakkadbapp/management/commands/export_v2.py

import datetime
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Prefetch
from openpyxl import Workbook

from hakkadbapp.models import Word, WordPronunciation


CONTRIBUTORS = ["CW", "JFW", "TA"]


def normalize_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def prefetched_words_qs():
    wp_qs = (
        WordPronunciation.objects
        .select_related("pronunciation__initial", "pronunciation__final", "pronunciation__tone")
        .order_by("position")
    )

    return (
        Word.objects
        .prefetch_related(Prefetch("wordpronunciation_set", queryset=wp_qs))
        .order_by("category", "french", "id")
    )

SUP_TO_DIGIT = str.maketrans({
    "⁰": "0",
    "¹": "1",
    "²": "2",
    "³": "3",
    "⁴": "4",
    "⁵": "5",
    "⁶": "6",
    "⁷": "7",
    "⁸": "8",
    "⁹": "9",
})
def to_normal_tone_pinyin(pinyin: str) -> str:
    if not pinyin:
        return ""

    # convert superscript → normal digits
    return pinyin.translate(SUP_TO_DIGIT)
def word_to_v2_row(word):
    """
    Export one Word into the V2 sheet format.

    Assumptions:
    - French = word.french
    - Manual pinyin = word.pinyin()
    - Sinnogramme = word.char() (simplified source stored in Pronunciation.hanzi)
    - Themes = word.category
    - Anglais auto = word.mandarin (temporary mapping; change if needed)
    - Statut global = word.status
    - CW/JFW/TA are not stored in current DB model -> left blank
    """
    french = normalize_text(word.french)
    hanzi = normalize_text(word.char())
    themes = normalize_text(word.category)
    english_auto = normalize_text(word.mandarin)   # change if you have a dedicated english field
    global_status = normalize_text(word.status)
    pinyin_auto = normalize_text(word.pinyin())
    pinyin_manual = to_normal_tone_pinyin(pinyin_auto)

    row = {
        "FRANCAIS": french,
        "PINYIN (manuel)": pinyin_manual,
        "PINYIN (auto)": pinyin_auto,
        "SINNOGRAMME": hanzi,
        "THEMES": themes,
        "ANGLAIS (auto)": english_auto,
        "STATUT": global_status,
    }

    for contributor in CONTRIBUTORS:
        row[contributor] = ""

    return row


def autosize_columns(sheet):
    widths = {}

    for row in sheet.iter_rows():
        for cell in row:
            value = "" if cell.value is None else str(cell.value)
            widths[cell.column_letter] = max(widths.get(cell.column_letter, 0), len(value))

    for col_letter, width in widths.items():
        sheet.column_dimensions[col_letter].width = min(max(width + 2, 10), 48)


class Command(BaseCommand):
    help = "Export words into the new V2 Google Sheet format"

    def add_arguments(self, parser):
        parser.add_argument(
            "--output",
            type=str,
            default="",
            help="Output XLSX path. Default: ../export_v2_YYYYMMDD_HHMMSS.xlsx",
        )
        parser.add_argument(
            "--sheet-name",
            type=str,
            default="LEXIQUE_V2",
            help="Worksheet name",
        )

    def handle(self, *args, **options):
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

        output = options["output"].strip() if options.get("output") else ""
        if output:
            output_path = Path(output)
        else:
            output_path = Path(f"../export_v2_{timestamp}.xlsx")

        sheet_name = normalize_text(options.get("sheet_name")) or "MOTS"

        words = prefetched_words_qs()
        self.stdout.write(f"Exporting {words.count()} words to {output_path}")

        workbook = Workbook()
        sheet = workbook.active
        sheet.title = sheet_name

        headers = [
            "FRANCAIS",
            "PINYIN (manuel)",
            "PINYIN (auto)",
            "SINNOGRAMME",
            "CW",
            "JFW",
            "TA",
            "THEMES",
            "STATUT",
            "ANGLAIS (auto)",
        ]
        sheet.append(headers)

        exported = 0
        skipped_empty = 0

        for word in words:
            row = word_to_v2_row(word)

            if not (row["FRANCAIS"] or row["PINYIN (manuel)"] or row["SINNOGRAMME"]):
                skipped_empty += 1
                continue

            sheet.append([row[h] for h in headers])
            exported += 1

        autosize_columns(sheet)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        workbook.save(output_path)

        self.stdout.write(self.style.SUCCESS(
            f"Done. Exported={exported}, skipped_empty={skipped_empty}, file={output_path}"
        ))