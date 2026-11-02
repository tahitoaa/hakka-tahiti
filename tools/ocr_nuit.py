"""Night reading (OCR) of the scanned PDFs of ../doc, smallest first.

Run every night at 02:00 by the Windows Task Scheduler ("Hakka OCR nuit");
stops by itself at 08:00 (local time), or earlier once the night's budget
is spent. Resumable: every page is saved as soon as it is read, and the
next night starts where the previous one stopped.

For each page, Claude (vision) returns the page transcribed as text and the
Hakka words and expressions it gives. Written to ../doc/extraction/:
    <pdf>_ocr.txt        the text, page by page
    <pdf>_mots.tsv       the entries (Caractères, Lecture, Sens, Type, Page)
    ocr_etat.json        progress and money spent, per night
    ocr_journal.log      what happened

Needs ANTHROPIC_API_KEY in app/.env (never deployed: .vercelignore).

    venv\\Scripts\\python.exe tools\\ocr_nuit.py               # inside the 02:00-08:00 window only
    venv\\Scripts\\python.exe tools\\ocr_nuit.py --force       # now (still stops at the budget)
    venv\\Scripts\\python.exe tools\\ocr_nuit.py --budget 5    # dollars per night (default 2)
"""
import argparse
import base64
import datetime as dt
import io
import json
import os
import re
import sys
import time
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
DOC = APP.parent / "doc"
OUT = Path(os.environ.get("OCR_OUT", DOC / "extraction"))  # OCR_OUT: a test folder
STATE = OUT / "ocr_etat.json"
LOG = OUT / "ocr_journal.log"
START_HOUR, END_HOUR = 2, 8
MODEL = "claude-sonnet-5-5"
PRICE_IN, PRICE_OUT = 2.0 / 1e6, 10.0 / 1e6     # $ per token (Claude Sonnet 5.5)
FORCE_OCR = {"clao_0153-3320_1990_num_19_1_1311.pdf"}  # text layer with unreadable Chinese
MAX_SIDE = 1800                                   # pixels, longest side of the page image
HAN = re.compile(r"[㐀-鿿豈-﫿]")

PROMPT = """This is one scanned page of a document about Hakka (a Chinese language), from the library of the Hakka association of Tahiti.
1. text: transcribe the page faithfully, line by line, in reading order: Chinese characters exactly as printed (traditional or simplified as on the page), romanization with its tone marks or digits as printed, French or English as printed. Mark an illegible passage [illisible]. No commentary.
2. entries: the Hakka words and expressions the page actually gives (a vocabulary list, a dictionary entry, an example sentence with its translation). For each: hanzi (characters as printed, "" if the page gives none), reading (romanization as printed), meaning (translation as printed, in its language), meaning_language ("fr", "en", "zh" or ""), kind ("mot" or "expression"). Never add words that are not on the page. An empty list if the page has none (a preface, a table of contents)."""

SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "entries": {"type": "array", "items": {
            "type": "object",
            "properties": {k: {"type": "string"} for k in ("hanzi", "reading", "meaning", "meaning_language", "kind")},
            "required": ["hanzi", "reading", "meaning", "meaning_language", "kind"],
            "additionalProperties": False,
        }},
    },
    "required": ["text", "entries"],
    "additionalProperties": False,
}


def log(message):
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S}  {message}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {"pdfs": {}, "nights": {}}


def save_state(state):
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(STATE)


def night_key(now):
    """The night a moment belongs to (02:00-08:00 -> that date)."""
    return now.strftime("%Y-%m-%d")


def needs_ocr(path, doc):
    """True for a scan: almost no text on a sample of pages."""
    if path.name in FORCE_OCR:
        return True
    n = doc.page_count
    sample = sorted({0, 1, n // 2, n - 1} & set(range(n)))
    chars = sum(len(doc[i].get_text().strip()) for i in sample)
    return chars < 30 * len(sample)


def page_image(page):
    """The page as a JPEG, longest side MAX_SIDE pixels."""
    import pymupdf as fitz
    from PIL import Image

    zoom = MAX_SIDE / max(page.rect.width, page.rect.height)
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csRGB)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def read_page(client, jpeg):
    response = client.messages.create(
        model=MODEL, max_tokens=8000,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                         "data": base64.standard_b64encode(jpeg).decode()}},
            {"type": "text", "text": PROMPT},
        ]}],
    )
    cost = response.usage.input_tokens * PRICE_IN + response.usage.output_tokens * PRICE_OUT
    if response.stop_reason == "refusal":
        return None, cost, "refus"
    if response.stop_reason == "max_tokens":
        return None, cost, "réponse tronquée"
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        return json.loads(text), cost, ""
    except json.JSONDecodeError:
        return None, cost, "réponse illisible"


def save_page(stem, number, data):
    with open(OUT / f"{stem}_ocr.txt", "a", encoding="utf-8") as f:
        f.write(f"[page {number}]\n{data.get('text', '').strip()}\n\n")
    tsv = OUT / f"{stem}_mots.tsv"
    new = not tsv.exists()
    with open(tsv, "a", encoding="utf-8") as f:
        if new:
            f.write("Caractères\tLecture (document)\tSens\tLangue du sens\tType\tPage\n")
        for e in data.get("entries", []):
            cells = [" ".join(str(e.get(k, "")).split()) for k in ("hanzi", "reading", "meaning", "meaning_language", "kind")]
            if cells[0] or cells[1]:
                f.write("\t".join(cells + [str(number)]) + "\n")
    return len(data.get("entries", []))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="run now, outside 02:00-08:00")
    parser.add_argument("--budget", type=float, default=2.0, help="dollars per night (default 2)")
    parser.add_argument("--max-pages", type=int, default=0, help="stop after this many pages (test)")
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now()
    if not args.force and not (START_HOUR <= now.hour < END_HOUR):
        log(f"Hors de la plage {START_HOUR}h-{END_HOUR}h : rien à faire (--force pour lancer quand même).")
        return 0
    from dotenv import load_dotenv
    load_dotenv(APP / ".env")
    if not os.environ.get("ANTHROPIC_API_KEY"):
        log("ANTHROPIC_API_KEY absente de app/.env : lecture impossible.")
        return 1
    import anthropic
    import pymupdf as fitz

    client = anthropic.Anthropic(timeout=180.0, max_retries=3)
    state = load_state()
    night = night_key(now)
    spent = state["nights"].get(night, {}).get("dollars", 0.0)
    log(f"Début de la nuit {night} : budget {args.budget:.2f} $, déjà dépensé {spent:.2f} $.")
    pages_read = 0
    pdfs = sorted((p for p in DOC.glob("*.pdf")), key=lambda p: p.stat().st_size) \
        + sorted(DOC.glob("*/*.pdf"), key=lambda p: p.stat().st_size)
    pdfs = sorted(pdfs, key=lambda p: p.stat().st_size)
    for path in pdfs:
        info = state["pdfs"].setdefault(path.name, {})
        if info.get("status") in ("texte", "fini"):
            continue
        with fitz.open(path) as doc:
            if "status" not in info:
                info.update(status="ocr" if needs_ocr(path, doc) else "texte", pages=doc.page_count, done=0, entries=0)
                save_state(state)
                if info["status"] == "texte":
                    log(f"{path.name} : contient déjà du texte, pas d'OCR.")
                    continue
            stem = path.stem
            while info["done"] < doc.page_count:
                if not args.force and dt.datetime.now().hour >= END_HOUR:
                    log("8h : arrêt jusqu'à la nuit prochaine.")
                    return 0
                if spent >= args.budget:
                    log(f"Budget de la nuit atteint ({spent:.2f} $) : arrêt jusqu'à la nuit prochaine.")
                    return 0
                if args.max_pages and pages_read >= args.max_pages:
                    log(f"{pages_read} page(s) lue(s) : arrêt (--max-pages).")
                    return 0
                number = info["done"] + 1
                try:
                    data, cost, problem = read_page(client, page_image(doc[number - 1]))
                except anthropic.RateLimitError:
                    log("Limite de débit de l'API : pause d'une minute.")
                    time.sleep(60)
                    continue
                except anthropic.APIError as err:
                    log(f"{path.name} p.{number} : erreur API ({err}) ; nouvel essai la nuit prochaine.")
                    return 1
                spent += cost
                state["nights"][night] = {"dollars": round(spent, 4)}
                if data is None:
                    data = {"text": f"[page non lue : {problem}]", "entries": []}
                    log(f"{path.name} p.{number} : {problem}.")
                found = save_page(stem, number, data)
                info["done"], info["entries"] = number, info.get("entries", 0) + found
                pages_read += 1
                save_state(state)
                log(f"{path.name} p.{number}/{doc.page_count} : {found} entrée(s), {cost * 100:.1f} centimes.")
            info["status"] = "fini"
            save_state(state)
            log(f"{path.name} : terminé ({info['entries']} entrées).")
    log("Tous les PDF sont lus.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
