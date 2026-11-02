"""Importing words from text documents (Validation page): Excel, CSV, text,
Word, and PDFs that contain text -- never images or scans, to keep AI use
low. The server extracts the text itself; the AI only sees what it must:
- a spreadsheet whose columns are recognised costs no AI call; otherwise
  only its first rows go to the AI, to name the columns;
- a free text goes by chunks, only the lines with Chinese characters,
  lines whose words the lexicon already has left out.
Every candidate is then checked by the server: already in the lexicon,
already proposed or rejected, reading converted to Wenfa and checked
against the lexicon. The editor ticks what to keep in a preview, and the
words are proposed "À valider". The extracted text is kept
(ImportedDocument) as a source for later lookups; the file is not."""
import csv
import io
import json
import re
import zipfile

from django.http import JsonResponse
from django.views.decorators.http import require_POST

from . import romanization
from .ai import HAN_RE, ai_enabled
from .assistant import AssistantError, CONTEXT, _call, _norm, char_readings, known_words
from .models import ImportedDocument, LexiconAddition
from .permissions import editor_required

MAX_FILE_BYTES = 4 * 1024 * 1024     # Vercel refuses larger request bodies
MAX_TEXT_CHARS = 50_000              # text sent to the AI, per document at most
CHUNK_CHARS = 6_000                  # one AI call
MAX_ROWS = 2_000
EXTENSIONS = {".xlsx": "xlsx", ".csv": "csv", ".tsv": "csv", ".txt": "txt", ".docx": "docx", ".pdf": "pdf"}

HEADER_WORDS = {
    "hanzi": ("hanzi", "caractère", "caracteres", "caractères", "chinois", "汉字", "漢字", "字", "characters",
              "character", "sinogramme", "sinogrammes", "hakka"),
    "pinyin": ("pinyin", "lecture", "prononciation", "romanisation", "romanization", "wenfa", "reading", "phonétique"),
    "french": ("français", "francais", "french", "traduction", "sens", "fr", "signification"),
    "english": ("anglais", "english", "en"),
    "themes": ("thème", "theme", "thèmes", "catégorie", "categorie", "category"),
    "page": ("page", "pages", "p.", "folio"),
    "lang": ("langue du sens", "langue"),
    "remark": ("remarque", "remarques", "note", "notes", "commentaire", "commentaires", "observations"),
    "type": ("type", "nature"),
}
EXTRA_FIELDS = ("page", "source_sense", "remark", "type")


def _header_field(name):
    """Field of a header cell. « Sens (anglais) » is English and « Sens
    (document) » the document's own wording, not French."""
    if name.startswith(("sens", "meaning", "gloss")) and "(" in name:
        inside = name.split("(", 1)[1]
        if inside.startswith(("angl", "engl")):
            return "english"
        if inside.startswith(("doc", "orig", "chin", "中")):
            return "source_sense"
        return "french"
    if name in ("gloss", "meaning"):
        return "english"
    for field, words in HEADER_WORDS.items():
        if name in words or any(name.startswith(w + " ") for w in words if len(w) > 2):
            return field
    return None
SYLLABLE_RE = re.compile(r"([a-zA-Zàâäéèêëïîôöùûüçŋεɔš'’]+)([0-8¹²³⁴⁵⁶⁷⁸]?)")
SUPERSCRIPTS = str.maketrans("¹²³⁴⁵⁶⁷⁸", "12345678")


class ImportError_(Exception):
    """A problem to show the editor as is (French)."""


# ---- reading the file -----------------------------------------------------------------

def _decode(data):
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ImportError_("Encodage du fichier non reconnu : enregistrez-le en UTF-8.")


def _cell(value):
    return " ".join(str(value).split()) if value is not None else ""


def read_rows(kind, data):
    if kind == "xlsx":
        import openpyxl

        try:
            book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception:
            raise ImportError_("Fichier Excel illisible.")
        rows = []
        for sheet in book.worksheets:
            for row in sheet.iter_rows(values_only=True):
                cells = [_cell(v) for v in row]
                if any(cells):
                    rows.append(cells)
                if len(rows) >= MAX_ROWS:
                    return rows
        return rows
    text = _decode(data)
    first = text.lstrip("﻿").split("\n", 1)[0]
    if first.count("\t") >= 2:
        # Tab-separated (.tsv): commas and quotes inside the senses are text.
        return [[_cell(c) for c in line.split("\t")] for line in text.splitlines() if line.strip()][:MAX_ROWS]
    try:
        dialect = csv.Sniffer().sniff(text[:5000], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return [[_cell(c) for c in row] for row in csv.reader(io.StringIO(text), dialect) if any(c.strip() for c in row)][:MAX_ROWS]


def read_text(kind, data):
    if kind == "txt":
        return _decode(data)
    if kind == "docx":
        try:
            xml = zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode("utf-8")
        except (zipfile.BadZipFile, KeyError):
            raise ImportError_("Fichier Word illisible (seul le format .docx est accepté).")
        paragraphs = re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S)
        return "\n".join("".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", p)) for p in paragraphs)
    if kind == "pdf":
        from pypdf import PdfReader

        try:
            reader = PdfReader(io.BytesIO(data))
            pages = [page.extract_text() or "" for page in reader.pages]
        except Exception:
            raise ImportError_("PDF illisible.")
        text = "\n".join(f"[page {n}]\n{t}" for n, t in enumerate(pages, 1))
        if len(re.sub(r"\[page \d+\]|\s", "", text)) < 20:
            raise ImportError_("Ce PDF ne contient pas de texte (document scanné ou image) : seuls les PDF texte sont acceptés.")
        return text
    raise ImportError_("Format non accepté.")


# ---- spreadsheets: which column is which ---------------------------------------------------

def _header_map(rows):
    """(header row index, {field: column}) from keyword headers, or None."""
    for r, row in enumerate(rows[:5]):
        found = {}
        for c, cell in enumerate(row):
            name = cell.strip().lower()
            field = _header_field(name)
            if field and field not in found:
                found[field] = c
        if "hanzi" in found and ({"french", "english", "pinyin"} & set(found)):
            return r, found
    return None


def _guess_columns(rows):
    """Without headers: the column most full of Chinese characters is the
    hanzi; the most syllable-like one the reading; the longest other text
    the French. None when there is no hanzi column."""
    width = max(len(r) for r in rows)
    sample = rows[:50]

    def share(c, test):
        cells = [r[c] for r in sample if c < len(r) and r[c]]
        return sum(1 for v in cells if test(v)) / max(len(cells), 1)

    han = [share(c, lambda v: bool(HAN_RE.search(v)) and not re.search(r"[a-zA-Z]{3,}", v)) for c in range(width)]
    if not han or max(han) < 0.6:
        return None
    columns = {"hanzi": han.index(max(han))}
    syl = [share(c, lambda v: bool(re.fullmatch(r"(?:[a-zA-Zŋεɔ'’]+[0-8¹²³⁴⁵⁶⁷⁸]?\s?)+", v))) if c not in columns.values() else 0
           for c in range(width)]
    if max(syl) >= 0.6:
        columns["pinyin"] = syl.index(max(syl))
    text = [share(c, lambda v: bool(re.search(r"[a-zA-Zé]{2,}", v))) if c not in columns.values() else 0
            for c in range(width)]
    if max(text) >= 0.5:
        columns["french"] = text.index(max(text))
    return (0, columns) if "french" in columns or "pinyin" in columns else None


def _ai_columns(rows):
    """One small AI call: the header and first rows only."""
    sample = rows[:8]
    schema = {"type": "object", "properties": {
        "header_row": {"type": "integer"},
        **{f: {"type": "integer"} for f in ("hanzi", "pinyin", "french", "english", "themes")}},
        "required": ["header_row", "hanzi", "pinyin", "french", "english", "themes"], "additionalProperties": False}
    data = _call(CONTEXT + "\n\nYou are given the first rows of a spreadsheet of vocabulary. Give the 0-based index "
                 "of the column holding each field (-1 when absent): hanzi (Chinese characters), pinyin (romanized "
                 "reading), french, english, themes; and header_row, the index of the header row (-1 if none).",
                 json.dumps(sample, ensure_ascii=False), schema, max_tokens=500)
    columns = {f: data[f] for f in ("hanzi", "pinyin", "french", "english", "themes") if isinstance(data.get(f), int) and data[f] >= 0}
    return (max(data.get("header_row", -1), -1) + 1, columns) if "hanzi" in columns else None


def table_candidates(rows):
    """[{hanzi, pinyin, french, english, themes, location, page, source_sense,
    remark, type}] and whether the AI was used. Everything the table says
    about a word is kept: it ends up in the addition's observations."""
    used_ai = False
    found = _header_map(rows)
    start = found[0] + 1 if found else 0
    columns = found[1] if found else None
    if not columns:
        guessed = _guess_columns(rows)
        if guessed:
            start, columns = guessed
    if not columns and ai_enabled():
        guessed = _ai_columns(rows)
        used_ai = True
        if guessed:
            start, columns = guessed
    if not columns:
        raise ImportError_("Colonne des caractères introuvable : ajoutez une ligne d'en-tête (Caractères, Pinyin, Français).")
    out = []
    for n, row in enumerate(rows[start:], start + 1):
        get = lambda f: row[columns[f]] if f in columns and columns[f] < len(row) else ""
        if HAN_RE.search(get("hanzi")):
            entry = {f: get(f).strip() for f in ("hanzi", "pinyin", "french", "english", "themes") + EXTRA_FIELDS}
            lang = get("lang").strip().lower()
            if entry["french"] and lang.startswith(("angl", "engl", "en")):
                entry["english"], entry["french"] = entry["english"] or entry["french"], ""
            elif entry["french"] and lang.startswith(("chin", "zh", "中", "doc")):
                entry["source_sense"], entry["french"] = entry["source_sense"] or entry["french"], ""
            page = entry.pop("page")
            entry["location"] = (f"p. {page}" if page and not page.lower().startswith("p") else page) or f"ligne {n}"
            out.append(entry)
    return out, used_ai


# ---- free text: the AI extracts the entries, chunk by chunk ----------------------------------------

def text_chunks(text, known=None):
    """Chunks of the lines worth reading: with Chinese characters, not all
    known words already. Each line keeps its number (and the page, for a PDF)."""
    known = known if known is not None else known_words()
    lines, page = [], ""
    for n, line in enumerate(text.splitlines(), 1):
        if re.fullmatch(r"\[page \d+\]", line.strip()):
            page = line.strip()[1:-1] + ", "
            continue
        runs = [_norm(r) for r in re.findall(r"[㐀-鿿豈-﫿\U00020000-\U0002ffff]+", line)]
        if runs and not all(r in known for r in runs):
            lines.append(f"[{page}ligne {n}] {line.strip()}")
    chunks, current, total = [], "", 0
    for line in lines:
        if total + len(line) > MAX_TEXT_CHARS:
            break
        if current and len(current) + len(line) > CHUNK_CHARS:
            chunks.append(current)
            current = ""
        current += line + "\n"
        total += len(line) + 1
    if current:
        chunks.append(current)
    return chunks


EXTRACT_SYSTEM = CONTEXT + """

You read an excerpt of a document and list the Hakka vocabulary entries it gives: a word or expression in Chinese characters with its reading and/or its meaning. Each line starts with its location in brackets.
- hanzi: the characters exactly as written (no other character added).
- pinyin: the reading exactly as written in the document ("" if none).
- french: the French meaning given by the document; if the document gives the meaning in another language only, translate it to French and set translated to true. "" if the document gives no meaning.
- english: the English meaning if the document gives one, else "".
- location: the location in brackets of the line it comes from.
Only list entries the document actually gives; do not add words from your own knowledge. Skip sentences that are not vocabulary entries, names of people and places."""


def _extract_schema():
    return {"type": "object", "properties": {"entries": {"type": "array", "items": {
        "type": "object",
        "properties": {f: {"type": "string"} for f in ("hanzi", "pinyin", "french", "english", "location")}
        | {"translated": {"type": "boolean"}},
        "required": ["hanzi", "pinyin", "french", "english", "location", "translated"],
        "additionalProperties": False}}},
        "required": ["entries"], "additionalProperties": False}


def extract_chunk(chunk):
    data = _call(EXTRACT_SYSTEM, chunk, _extract_schema(), max_tokens=8000)
    out = []
    for e in data.get("entries", []):
        hanzi = " ".join(str(e.get("hanzi", "")).split())
        # Only characters really in this excerpt: nothing invented.
        if not hanzi or not HAN_RE.search(hanzi) or "".join(hanzi.split()) not in "".join(chunk.split()):
            continue
        out.append({"hanzi": hanzi, "pinyin": e.get("pinyin", ""), "french": e.get("french", ""),
                    "english": e.get("english", ""), "themes": "", "location": e.get("location", ""),
                    "translated": bool(e.get("translated"))})
    return out


# ---- checks, the same for every candidate -------------------------------------------------------

def _stored_options(syllable, tone):
    """Every stored (Wenfa) spelling `syllable`+`tone` can stand for, in any system."""
    options = []
    for system in [s["id"] for s in romanization.systems()]:
        for initial, final, tones in romanization.source_to_stored(syllable, tone, system):
            for t in (tones or [""]):
                spelled = f"{initial}{final}{t}"
                if spelled not in options:
                    options.append(spelled)
    return options


def resolve_reading(hanzi, raw, readings):
    """(Wenfa reading, note): one reading per character, matched against
    the lexicon's readings of that character; else derived from the
    lexicon when a character has only one reading; else '' and a note."""
    chars = [_norm(c) for c in "".join(hanzi.split())]
    syllables = SYLLABLE_RE.findall(raw.translate(SUPERSCRIPTS).replace("-", " "))
    result, note = [], ""
    if syllables and len(syllables) == len(chars):
        for char, (syl, tone) in zip(chars, syllables):
            options = _stored_options(syl.lower(), tone)
            known = [o for o in options if o in readings.get(char, ())]
            if known:
                result.append(known[0])
            elif options:
                result.append(options[0])
                note = "lecture absente du lexique, à vérifier"
            else:
                return "", "lecture non reconnue, à vérifier"
    elif all(len(readings.get(c, ())) == 1 for c in chars) and chars:
        result = [next(iter(readings[c])) for c in chars]
        note = "lecture reprise du lexique" if not raw.strip() else "lecture du document illisible, reprise du lexique"
    else:
        return "", "lecture à compléter"
    # Back to the entry's words: one group per space-separated token.
    groups, i = [], 0
    for token in hanzi.split():
        n = len(token)
        groups.append("".join(result[i:i + n]))
        i += n
    return " ".join(groups), note


def check_candidates(candidates):
    """Adds to each candidate: kind, Wenfa reading, notes, and state:
    new | known (in the lexicon) | proposed (already an addition) |
    rejected (an editor already rejected it) | duplicate (twice in the file)."""
    known_lexicon = known_words(include_additions=False)
    additions = {}
    for a in LexiconAddition.objects.only("hanzi", "status"):
        key = _norm("".join(a.hanzi.split()))
        if additions.get(key) != "proposed":
            additions[key] = "rejected" if a.status == LexiconAddition.STATUS_REJECTED else "proposed"
    readings = char_readings()
    seen = set()
    for c in candidates:
        c["hanzi"] = " ".join(c["hanzi"].split())
        key = _norm("".join(c["hanzi"].split()))
        kind = c.get("type", "").lower()
        c["kind"] = (LexiconAddition.KIND_EXPRESSION if kind.startswith(("expr", "locution", "phrase"))
                     else LexiconAddition.KIND_WORD if kind.startswith("mot")
                     else LexiconAddition.KIND_EXPRESSION if " " in c["hanzi"] or len(key) > 6 else LexiconAddition.KIND_WORD)
        c["reading"], c["reading_note"] = resolve_reading(c["hanzi"], c.get("pinyin", ""), readings)
        c["state"] = ("duplicate" if key in seen else "known" if key in known_lexicon
                      else additions.get(key, "new"))
        if not c.get("french") and c["state"] == "new":
            missing = "sens français à traduire" if c.get("english") or c.get("source_sense") else "sens manquant"
            c["reading_note"] = (c["reading_note"] + " ; " if c["reading_note"] else "") + missing
        seen.add(key)
    return candidates


# ---- HTTP -----------------------------------------------------------------------------------

def _json(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


@require_POST
@editor_required
def api_analyse(request):
    """POST multipart "file": reads it. A table comes back checked at once;
    a text comes back as chunks to extract one by one (api_extract)."""
    upload = request.FILES.get("file")
    if not upload:
        return JsonResponse({"error": "Aucun fichier reçu."}, status=400)
    ext = "." + upload.name.rsplit(".", 1)[-1].lower() if "." in upload.name else ""
    kind = EXTENSIONS.get(ext)
    if not kind:
        return JsonResponse({"error": "Formats acceptés : Excel (.xlsx), CSV, texte (.txt), Word (.docx), PDF texte."},
                            status=400)
    if upload.size > MAX_FILE_BYTES:
        return JsonResponse({"error": "Fichier trop lourd (4 Mo au plus)."}, status=400)
    data = upload.read()
    try:
        if kind in ("xlsx", "csv"):
            rows = read_rows(kind, data)
            if not rows:
                raise ImportError_("Le fichier est vide.")
            candidates, used_ai = table_candidates(rows)
            doc = ImportedDocument.objects.create(filename=upload.name[:255], kind=ImportedDocument.KIND_TABLE,
                                                  text="\n".join("\t".join(r) for r in rows), uploaded_by=request.user)
            return JsonResponse({"ok": True, "document": doc.id, "filename": doc.filename, "kind": "table",
                                 "used_ai": used_ai, "candidates": check_candidates(candidates)})
        text = read_text(kind, data)
        chunks = text_chunks(text)
        doc = ImportedDocument.objects.create(filename=upload.name[:255], kind=ImportedDocument.KIND_TEXT,
                                              text=text, uploaded_by=request.user)
        return JsonResponse({"ok": True, "document": doc.id, "filename": doc.filename, "kind": "text",
                             "chunks": len(chunks), "chars": sum(len(c) for c in chunks),
                             "truncated": len(text) > MAX_TEXT_CHARS, "ai_enabled": ai_enabled()})
    except ImportError_ as err:
        return JsonResponse({"error": str(err)}, status=400)
    except AssistantError as err:
        return JsonResponse({"error": str(err)}, status=503)


@require_POST
@editor_required
def api_extract(request, document_id):
    """POST {chunk: n}: the AI reads chunk n of an imported text."""
    payload = _json(request) or {}
    doc = ImportedDocument.objects.filter(id=document_id, kind=ImportedDocument.KIND_TEXT).first()
    if not doc:
        return JsonResponse({"error": "Document introuvable."}, status=404)
    chunks = text_chunks(doc.text)
    n = payload.get("chunk")
    if not isinstance(n, int) or not 0 <= n < len(chunks):
        return JsonResponse({"error": "Partie invalide."}, status=400)
    try:
        return JsonResponse({"ok": True, "candidates": check_candidates(extract_chunk(chunks[n]))})
    except AssistantError as err:
        return JsonResponse({"error": str(err)}, status=503)


TRANSLATE_BATCH = 80
TRANSLATE_SYSTEM = CONTEXT + """

Translate dictionary senses into French for a Hakka lexicon. Each item has the Hakka word (Chinese
characters), its sense as given by a source document (in English, or in Chinese), and sometimes a
remark. Give a short, natural French dictionary sense: a few words, alternatives separated by
« ; », grammatical labels translated (VERB → verbe, CLASSIFIER → classificateur, etc.), no
explanation. Keep the meaning of the source; do not add senses of your own. Return one item per
input, with the same i."""


def translate_senses(items):
    """[{i, hanzi, sense, remark}] -> {i: French sense}, one AI call."""
    schema = {"type": "object", "additionalProperties": False, "required": ["items"], "properties": {
        "items": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                             "required": ["i", "french"],
                                             "properties": {"i": {"type": "integer"}, "french": {"type": "string"}}}}}}
    data = _call(TRANSLATE_SYSTEM, json.dumps(items, ensure_ascii=False), schema, max_tokens=6000)
    asked = {it["i"] for it in items}
    return {it["i"]: it["french"].strip()[:300] for it in data.get("items", [])
            if isinstance(it.get("i"), int) and it["i"] in asked and isinstance(it.get("french"), str) and it["french"].strip()}


@require_POST
@editor_required
def api_translate(request):
    """POST {entries: [{hanzi, english, source_sense, remark}]} (at most
    TRANSLATE_BATCH): {french: [...]} in the same order ("" when not translated)."""
    entries = (_json(request) or {}).get("entries")
    if not isinstance(entries, list) or not entries or len(entries) > TRANSLATE_BATCH:
        return JsonResponse({"error": f"Entre 1 et {TRANSLATE_BATCH} entrées par requête."}, status=400)
    items = []
    for i, e in enumerate(entries):
        if not isinstance(e, dict):
            return JsonResponse({"error": "Entrée mal formée."}, status=400)
        get = lambda k: e.get(k) if isinstance(e.get(k), str) else ""
        sense = get("english").strip() or get("source_sense").strip()
        if sense and get("hanzi").strip():
            items.append({"i": i, "hanzi": get("hanzi")[:60], "sense": sense[:300]}
                         | ({"remark": get("remark")[:200]} if get("remark").strip() else {}))
    if not items:
        return JsonResponse({"ok": True, "french": [""] * len(entries)})
    try:
        done = translate_senses(items)
    except AssistantError as err:
        return JsonResponse({"error": str(err)}, status=503)
    return JsonResponse({"ok": True, "french": [done.get(i, "") for i in range(len(entries))]})


@require_POST
@editor_required
def api_propose(request, document_id):
    """POST {entries: [{hanzi, reading, french, english, themes, location,
    reading_note, translated, source_sense, remark, type}]}: the ticked entries become additions
    "À valider", checked again here (the browser is not trusted)."""
    from .additions import _addition_json

    doc = ImportedDocument.objects.filter(id=document_id).first()
    payload = _json(request) or {}
    entries = payload.get("entries")
    source = payload.get("source") if isinstance(payload.get("source"), str) else ""
    source = " ".join(source.split())[:200] or doc.filename[:200]
    if not doc or not isinstance(entries, list) or not entries or len(entries) > MAX_ROWS:
        return JsonResponse({"error": "Rien à proposer."}, status=400)
    clean = []
    for e in entries:
        fields = ("hanzi", "pinyin", "french", "english", "themes", "location", "source_sense", "remark", "type")
        if not isinstance(e, dict) or not all(isinstance(e.get(k, ""), str) for k in fields):
            return JsonResponse({"error": "Entrée mal formée."}, status=400)
        clean.append({k: e.get(k, "")[:300] for k in fields}
                     | {"translated": bool(e.get("translated"))})
    created, skipped = [], 0
    for c in check_candidates(clean):
        if c["state"] != "new":
            skipped += 1
            continue
        notes = [f"Importé de « {doc.filename} » ({c['location']})." if c["location"] else f"Importé de « {doc.filename} »."]
        doc_reading = " ".join(c["pinyin"].split())
        if doc_reading and doc_reading.replace(" ", "") != c["reading"].replace(" ", ""):
            notes.append(f"Lecture du document : {doc_reading}.")
        if c.get("source_sense"):
            notes.append(f"Sens dans le document : {c['source_sense'].strip()}.")
        if c.get("remark"):
            notes.append(f"Remarque du document : {c['remark'].strip().rstrip('.')}.")
        if c.get("translated"):
            notes.append("Sens traduit en français par l'IA.")
        if c["reading_note"]:
            notes.append(c["reading_note"].capitalize() + ".")
        created.append(LexiconAddition.objects.create(
            kind=c["kind"], status=LexiconAddition.STATUS_REVIEW, hanzi=c["hanzi"], pinyin=c["reading"],
            french=c["french"].strip(), english=c["english"].strip(), themes=c["themes"].strip(),
            observations=" ".join(notes), source=source, created_by=request.user, updated_by=request.user))
    return JsonResponse({"ok": True, "additions": [_addition_json(a) for a in created], "skipped": skipped})
