
from __future__ import annotations

from pathlib import Path
import pandas as pd


def build_google_sheet_xlsx_url(sheet_id: str) -> str:
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx"


def open_workbook(sheet_id: str | None = None) -> pd.ExcelFile:
    if sheet_id:
        sheet_url = build_google_sheet_xlsx_url(sheet_id)
        return pd.ExcelFile(sheet_url)
    raise ValueError("Provide either sheet_id or xlsx_path.")
