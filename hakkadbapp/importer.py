"""Importing words from text documents (Validation page): Excel, CSV, text,
Word, and PDFs that contain text -- never images or scans, to keep AI use
low. The server reads the documents itself, without the AI:
- a spreadsheet (or the tables of a Word file) whose headers are
  recognised is read at once; otherwise the editor says which column is
  which (an « écran de correspondance », prefilled by a guess, remembered
  in the browser for the next document of that source);
- a text is read line by line with templates (import_rules: « caractères
  · lecture · sens », glossed examples...); the other lines give a short
  list of candidate words with their context. The AI only defines that
  list, when asked (api_define), or reads the whole text (api_extract,
  by chunks), when explicitly asked.
Every candidate is then checked by the server: already in the lexicon,
already proposed or rejected, reading converted to Wenfa and checked
against the lexicon. The editor ticks what to keep in a preview, and the
words become drafts (Brouillons of Suivi). The extracted text is kept
(ImportedDocument) as a source for later lookups; the file is not."""
import csv
import io
import json
import os
import re
import zipfile

from django.http import JsonResponse
from django.views.decorators.http import require_POST

from . import romanization
from .ai import HAN_RE, ai_enabled
from .assistant import AssistantError, CONTEXT, _call, _norm, char_readings, known_words
from .models import ImportedDocument, LexiconAddition
from .permissions import editor_required
from . import import_rules, pinyin_rules

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
    # Where this row comes from (« Guide Wen Fa »): the addition's Source, else the file's.
    "origin": ("source", "origine", "provenance"),
}
EXTRA_FIELDS = ("page", "source_sense", "remark", "type", "origin")


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


def table_candidates(rows, layout=None):
    """[{hanzi, pinyin, french, english, themes, location, page, source_sense,
    remark, type}] and False (no AI). `layout`: (first data row, {field:
    column}) as the editor mapped them; else the recognised headers -- None
    when there are none (the editor maps the columns). Everything the table
    says about a word is kept: it ends up in the addition's observations."""
    if layout is None:
        found = _header_map(rows)
        if not found:
            return None, False
        layout = (found[0] + 1, found[1])
    start, columns = layout
    if "hanzi" not in columns:
        raise ImportError_("Indiquez la colonne des caractères.")
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
    return out, False


MAPPABLE = ("hanzi", "pinyin", "french", "english", "themes", "type", "page", "source_sense", "remark", "origin")


def _mapping_reply(doc, rows):
    """No recognised header: the first rows, and a guess of the columns, for
    the editor to confirm (no AI)."""
    guessed = _guess_columns(rows)
    return JsonResponse({"ok": True, "document": doc.id, "filename": doc.filename, "kind": "mapping",
                         "width": max(len(r) for r in rows[:20]), "preview": rows[:8],
                         "guess": guessed[1] if guessed else {}})


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
- type: "mot" for a word (one unit of meaning, even of several characters: 屋家, 番书), "expression" for a phrase or sentence made of several words (读番书, 今晡日落大水).
Only list entries the document actually gives; do not add words from your own knowledge. Skip sentences that are not vocabulary entries, names of people and places."""


def _extract_schema():
    return {"type": "object", "properties": {"entries": {"type": "array", "items": {
        "type": "object",
        "properties": {f: {"type": "string"} for f in ("hanzi", "pinyin", "french", "english", "location")}
        | {"translated": {"type": "boolean"}, "type": {"type": "string", "enum": ["mot", "expression"]}},
        "required": ["hanzi", "pinyin", "french", "english", "location", "translated", "type"],
        "additionalProperties": False}}},
        "required": ["entries"], "additionalProperties": False}


WANT_PROMPTS = {
    "words": "\nList only words (type « mot »): skip expressions and sentences.",
    "expressions": "\nList only expressions (type « expression »): phrases or sentences of several words; skip single words.",
}


def extract_chunk(chunk, want="all"):
    """`want`: "all", "words" or "expressions" -- what the editor chose to import."""
    data = _call(EXTRACT_SYSTEM + WANT_PROMPTS.get(want, ""), chunk, _extract_schema(), max_tokens=8000)
    plain = _norm("".join(chunk.split()))
    out = []
    for e in data.get("entries", []):
        hanzi = " ".join(str(e.get("hanzi", "")).split())
        # Only characters really in this excerpt: nothing invented.
        # (compared simplified: the AI may answer 番书 for 番書)
        if not hanzi or not HAN_RE.search(hanzi) or _norm("".join(hanzi.split())) not in plain:
            continue
        out.append({"hanzi": hanzi, "pinyin": e.get("pinyin", ""), "french": e.get("french", ""),
                    "english": e.get("english", ""), "themes": "", "location": e.get("location", ""),
                    "translated": bool(e.get("translated")), "type": e.get("type", "")})
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


_DIGITS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸", "012345678")


class Deduced:
    """{simplified char: (Wenfa reading, source, confidence)} for characters
    the lexicon doesn't have: the reading the Dictionnaires
    deduces from the Hakka dictionaries through the learnt correspondences
    (source_rules). Computed only when a character needs it."""

    def __init__(self):
        self._map = None

    def get(self, char):
        if self._map is None:
            from . import source_rules
            self._map = {}
            try:
                for row in source_rules.cached_payload()["rows"]:
                    if not row[2] and row[3]:
                        reading, source, confidence = row[3].split("|")
                        self._map[row[0]] = (reading.translate(_DIGITS), source, confidence)
            except Exception:  # no dictionary data: no deduction
                pass
        return self._map.get(char)


class DocumentRules:
    """Which dictionary romanization the document uses, guessed from its
    words the lexicon already reads, and the correspondences learnt for
    that source (source_rules) to turn its other syllables into Wenfa:
    Basel « šak5 » is yangru, so Wenfa sak6, which no plain conversion knows."""

    MIN_PAIRS = 5

    def __init__(self, pairs):
        """pairs: [(char, syllable, tone)] of the document, the char having
        exactly one lexicon reading (known to be right) -- given as
        (syllable, tone, wenfa)."""
        from . import source_rules as sr
        self.sr, self.source, self.label, self.rate = sr, None, "", 0
        try:
            payload = sr.cached_payload()
        except Exception:
            return
        self.rules = payload["rules"]
        maps = sr._cache.get("maps") or sr.load_sources()
        best = (0, None)
        for s in sr.HAKKA:
            initials = maps["initials"][s["id"]]
            right = sum(1 for syl, tone, wenfa in pairs
                        if "".join(sr.predict(self.rules, s["id"], self._split(s, syl, tone, initials))[0] or ()) == wenfa)
            if right > best[0]:
                best = (right, s)
        if best[1] and best[0] >= self.MIN_PAIRS:
            self.source = best[1]
            self.initials = maps["initials"][best[1]["id"]]
            self.label = best[1]["label"]
            self.rate = round(100 * best[0] / len(pairs))

    def _split(self, source, syl, tone, initials):
        if source["system"]:
            return self.sr.split_source(syl, tone, source["system"], initials)
        return self.sr.split_book(syl, tone, initials)

    def convert(self, syl, tone):
        """(Wenfa reading, confidence %) or (None, 0)."""
        if not self.source:
            return None, 0
        reading, confidence = self.sr.predict(self.rules, self.source["id"],
                                              self._split(self.source, syl, tone, self.initials))
        return ("".join(reading), confidence) if reading else (None, 0)


def _closest(options, known):
    """The lexicon reading nearest the document's (same tone, then longest common start)."""
    def score(k):
        best = 0
        for o in options:
            common = len(os.path.commonprefix([o, k]))
            best = max(best, common + (10 if o[-1:] == k[-1:] else 0))
        return (-best, k)
    return sorted(known, key=score)[0]


def resolve_reading(hanzi, raw, readings, deduced=None, rules=None):
    """(Wenfa reading, note), character by character:
    1. the document's syllable, in any romanization, that is one of the
       lexicon's readings of the character;
    2. else the lexicon's reading (the nearest one when it has several);
    3. else (character unknown to the lexicon) the document's syllable
       converted to Wenfa through the correspondences of the document's
       romanization (DocumentRules), else through the romanization systems
       (the dictionaries' deduced reading if it is one of the conversions);
    4. else the reading deduced from the dictionaries.
    "" and a note when a character stays without a reading."""
    chars = [_norm(c) for c in "".join(hanzi.split())]
    syllables = SYLLABLE_RE.findall(raw.translate(SUPERSCRIPTS).replace("-", " "))
    per_char = syllables if len(syllables) == len(chars) else [None] * len(chars)
    result, notes = [], []

    def note(text):
        if text not in notes:
            notes.append(text)

    if syllables and per_char[0] is None:
        note("lecture du document non alignée sur les caractères")
    for char, syl in zip(chars, per_char):
        options = _stored_options(syl[0].lower(), syl[1]) if syl else []
        known = readings.get(char, set())
        converted, confidence = rules.convert(syl[0].lower(), syl[1]) if rules and syl else (None, 0)
        if converted:
            options = [converted] + [o for o in options if o != converted]
        hit = [o for o in options if o in known]
        if hit:
            result.append(hit[0])
        elif known:
            result.append(_closest(options, known) if options else sorted(known)[0])
            if len(known) > 1:
                note(f"{char} : plusieurs lectures dans le lexique, à vérifier")
        else:
            guess = deduced.get(char) if deduced else None
            if converted:
                result.append(converted)
                note(f"{char} : lecture convertie selon {rules.label} ({confidence} %), absente du lexique")
            elif options:
                if guess and guess[0] in options:
                    result.append(guess[0])
                else:
                    result.append(options[0])
                note(f"{char} : lecture du document convertie (absente du lexique)")
            elif guess:
                result.append(guess[0])
                note(f"{char} : lecture déduite ({guess[1]}, {guess[2]} %)")
            else:
                return "", "lecture à compléter"
    # Back to the entry's words: one group per space-separated token.
    groups, i = [], 0
    for token in hanzi.split():
        n = len(token)
        groups.append("".join(result[i:i + n]))
        i += n
    return " ".join(groups), " ; ".join(notes)


def segment(hanzi, words, longest=6):
    """An expression written in one block (做生理人), split into the
    lexicon's words, longest match first: "做 生理 人". A character in no
    word stands alone. `words`: the lexicon's words, simplified."""
    out, i = [], 0
    while i < len(hanzi):
        for n in range(min(longest, len(hanzi) - i), 0, -1):
            if n == 1 or hanzi[i:i + n] in words:
                out.append(hanzi[i:i + n])
                i += n
                break
    return " ".join(out)


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
    deduced = Deduced()
    # The document's own romanization: its syllables for characters with a single lexicon reading.
    pairs = []
    for c in candidates:
        chars = [_norm(ch) for ch in "".join(c["hanzi"].split())]
        syllables = SYLLABLE_RE.findall((c.get("pinyin") or "").translate(SUPERSCRIPTS).replace("-", " "))
        if syllables and len(syllables) == len(chars):
            pairs += [(syl.lower(), tone, next(iter(readings[ch]))) for ch, (syl, tone) in zip(chars, syllables)
                      if len(readings.get(ch, ())) == 1]
    rules = DocumentRules(pairs[:2000]) if len(pairs) >= DocumentRules.MIN_PAIRS else None
    seen = set()
    for c in candidates:
        # The lexicon is in simplified characters: so is the addition; the
        # document's own form (often traditional) is kept alongside.
        original = " ".join((c.get("document_hanzi") or c["hanzi"]).split())
        c["document_hanzi"] = original
        c["hanzi"] = " ".join(_norm(token) for token in original.split())
        key = "".join(c["hanzi"].split())
        kind = c.get("type", "").lower()
        c["kind"] = (LexiconAddition.KIND_EXPRESSION if kind.startswith(("expr", "locution", "phrase"))
                     else LexiconAddition.KIND_WORD if kind.startswith("mot")
                     else LexiconAddition.KIND_EXPRESSION if " " in c["hanzi"] or len(key) > 6 else LexiconAddition.KIND_WORD)
        if c["kind"] == LexiconAddition.KIND_EXPRESSION and " " not in c["hanzi"]:
            # One space per word, as an expression typed in the Saisie.
            c["hanzi"] = segment(c["hanzi"], known_lexicon)
        elif c["kind"] == LexiconAddition.KIND_WORD:
            c["hanzi"] = "".join(c["hanzi"].split())
        c["reading"], c["reading_note"] = resolve_reading(c["hanzi"], c.get("pinyin", ""), readings, deduced, rules)
        # In Wenfa's pinyin whatever the document's romanization (si1 -> xi1, sit7 -> xit5).
        c["reading"], fixes = pinyin_rules.normalize(c["reading"])
        if fixes:
            c["reading_note"] = "; ".join(filter(None, [c["reading_note"], pinyin_rules.normalize_note(fixes)]))
        broken = pinyin_rules.violations(c["reading"])
        if broken:
            c["reading_note"] = "; ".join(filter(None, [c["reading_note"], "lecture contraire aux règles : " + " ; ".join(broken)]))
        c["romanization"] = f"{rules.label} ({rules.rate} %)" if rules and rules.source else ""
        c["state"] = ("duplicate" if key in seen else "known" if key in known_lexicon
                      else additions.get(key, "new"))
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
        rows = read_rows(kind, data) if kind in ("xlsx", "csv") else []
        if kind == "docx":
            # A Word file's tables are read as a spreadsheet.
            tables = import_rules.docx_tables(data)
            if sum(1 for r in tables if any(HAN_RE.search(c) for c in r)) >= 2:
                rows = tables
        if kind in ("xlsx", "csv") or rows:
            if not rows:
                raise ImportError_("Le fichier est vide.")
            doc = ImportedDocument.objects.create(filename=upload.name[:255], kind=ImportedDocument.KIND_TABLE,
                                                  text="\n".join("\t".join(r) for r in rows), uploaded_by=request.user)
            candidates, _ = table_candidates(rows)
            if candidates is None:
                return _mapping_reply(doc, rows)
            return JsonResponse({"ok": True, "document": doc.id, "filename": doc.filename, "kind": "table",
                                 "used_ai": False, "candidates": check_candidates(candidates)})
        text = read_text(kind, data)
        doc = ImportedDocument.objects.create(filename=upload.name[:255], kind=ImportedDocument.KIND_TEXT,
                                              text=text, uploaded_by=request.user)
        # Without the AI: the lines a template reads, then the candidate words.
        entries, rest = import_rules.read_lines(text)
        candidates = check_candidates(entries + import_rules.shortlist(
            rest, known_words(), char_readings(), segment, _norm))
        templates = {}
        for e in entries:
            templates[e["template"]] = templates.get(e["template"], 0) + 1
        chunks = text_chunks(text)
        return JsonResponse({"ok": True, "document": doc.id, "filename": doc.filename, "kind": "text",
                             "candidates": candidates, "templates": templates,
                             "shortlist": sum(1 for c in candidates if c.get("template") == "candidat"),
                             "chunks": len(chunks), "chars": sum(len(c) for c in chunks),
                             "truncated": len(text) > MAX_TEXT_CHARS, "ai_enabled": ai_enabled()})
    except ImportError_ as err:
        return JsonResponse({"error": str(err)}, status=400)
    except AssistantError as err:
        return JsonResponse({"error": str(err)}, status=503)


@require_POST
@editor_required
def api_paste(request):
    """POST {text, name}: a text pasted in the page, to be read by the AI
    (api_extract, chunk by chunk). Only the lines with Chinese characters
    the lexicon doesn't fully know are sent (text_chunks)."""
    payload = _json(request) or {}
    text = payload.get("text") if isinstance(payload.get("text"), str) else ""
    name = " ".join(str(payload.get("name") or "").split())[:200] or "Texte collé"
    if not HAN_RE.search(text):
        return JsonResponse({"error": "Collez un texte qui contient des caractères chinois."}, status=400)
    if len(text) > MAX_TEXT_CHARS * 2:
        return JsonResponse({"error": f"Texte trop long ({len(text)} caractères, {MAX_TEXT_CHARS * 2} au plus)."}, status=400)
    if not ai_enabled():
        return JsonResponse({"error": "L'IA n'est pas configurée sur ce serveur."}, status=503)
    doc = ImportedDocument.objects.create(filename=name, kind=ImportedDocument.KIND_TEXT, text=text, uploaded_by=request.user)
    chunks = text_chunks(text)
    return JsonResponse({"ok": True, "document": doc.id, "filename": doc.filename, "kind": "text", "pasted": True,
                         "candidates": [], "templates": {}, "shortlist": 0, "chunks": len(chunks),
                         "chars": sum(len(c) for c in chunks), "truncated": len(text) > MAX_TEXT_CHARS, "ai_enabled": True})


@require_POST
@editor_required
def api_columns(request, document_id):
    """POST {columns: {field: column index}, header: bool}: the table read
    with the columns the editor chose (no AI)."""
    doc = ImportedDocument.objects.filter(id=document_id, kind=ImportedDocument.KIND_TABLE).first()
    payload = _json(request) or {}
    columns = payload.get("columns")
    if not doc or not isinstance(columns, dict):
        return JsonResponse({"error": "Document ou colonnes introuvables."}, status=400)
    columns = {f: c for f, c in columns.items() if f in MAPPABLE and isinstance(c, int) and c >= 0}
    rows = [line.split("\t") for line in doc.text.split("\n")]
    try:
        candidates, _ = table_candidates(rows, (1 if payload.get("header") else 0, columns))
    except ImportError_ as err:
        return JsonResponse({"error": str(err)}, status=400)
    return JsonResponse({"ok": True, "candidates": check_candidates(candidates)})


DEFINE_SYSTEM = CONTEXT + """

You are given candidate Hakka words found in a document (Chinese characters), each with the
sentence it comes from. For each: keep = true only if it is really a word or a fixed expression
(not a fragment cut across two words, not a name of a person or place); then its meaning in that
sentence: french (short dictionary sense, alternatives separated by « ; ») and english. Use the
context; do not invent. Return one item per input, with the same i."""


@require_POST
@editor_required
def api_define(request):
    """POST {entries: [{hanzi, context}]} (60 at most): the candidate words
    the server found in a text, judged and defined by the AI -- one small
    call instead of the whole text."""
    entries = (_json(request) or {}).get("entries")
    if not isinstance(entries, list) or not entries or len(entries) > 60:
        return JsonResponse({"error": "Entre 1 et 60 candidats."}, status=400)
    items = [{"i": i, "hanzi": str(e.get("hanzi", ""))[:20], "context": str(e.get("context", ""))[:120]}
             for i, e in enumerate(entries) if isinstance(e, dict)]
    schema = {"type": "object", "additionalProperties": False, "required": ["items"], "properties": {
        "items": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                             "required": ["i", "keep", "french", "english"],
                                             "properties": {"i": {"type": "integer"}, "keep": {"type": "boolean"},
                                                            "french": {"type": "string"}, "english": {"type": "string"}}}}}}
    try:
        data = _call(DEFINE_SYSTEM, json.dumps(items, ensure_ascii=False), schema, max_tokens=6000)
    except AssistantError as err:
        return JsonResponse({"error": str(err)}, status=503)
    by_i = {it.get("i"): it for it in data.get("items", []) if isinstance(it, dict)}
    out = []
    for i in range(len(entries)):
        it = by_i.get(i, {})
        out.append({"keep": bool(it.get("keep", True)), "french": str(it.get("french", "")).strip()[:300],
                    "english": str(it.get("english", "")).strip()[:300]})
    return JsonResponse({"ok": True, "entries": out})


@require_POST
@editor_required
def api_extract(request, document_id):
    """POST {chunk: n, want: "all" | "words" | "expressions"}: the AI reads chunk n of an imported text."""
    payload = _json(request) or {}
    doc = ImportedDocument.objects.filter(id=document_id, kind=ImportedDocument.KIND_TEXT).first()
    if not doc:
        return JsonResponse({"error": "Document introuvable."}, status=404)
    chunks = text_chunks(doc.text)
    n = payload.get("chunk")
    if not isinstance(n, int) or not 0 <= n < len(chunks):
        return JsonResponse({"error": "Partie invalide."}, status=400)
    try:
        want = payload.get("want") if payload.get("want") in ("all", "words", "expressions") else "all"
        return JsonResponse({"ok": True, "candidates": check_candidates(extract_chunk(chunks[n], want))})
    except AssistantError as err:
        return JsonResponse({"error": str(err)}, status=503)


LANGUAGES_BATCH = 60
LANGUAGES_SYSTEM = CONTEXT + """

You check the two sense fields of words imported from a document into a Hakka lexicon. Each item
has the Hakka word (Chinese characters), "french" and "english" as read from the document (either
may be empty or in the wrong language), and sometimes the document's own sense (often Chinese) and
a remark. Return for each item:
- french: a French dictionary sense. If the given french is good French, return it verbatim. If it
  is in another language (often English) or empty, translate the meaning into short, natural French
  (a few words, alternatives separated by « ; », grammatical labels translated: VERB → verbe,
  CLASSIFIER → classificateur...).
- english: the same for English: verbatim when it is good English; else an English translation.
  When the given french was really English, it becomes the english (if english was empty).
- changed: the fields you wrote yourself (translated or moved), among "french", "english".
Keep the meaning of the document; do not add senses of your own; no explanation. "" for a field only
when the item has no meaning at all. Return one item per input, with the same i."""


def check_languages(items):
    """[{i, hanzi, french, english, sense?, remark?}] -> {i: (french, english, changed)}, one AI call."""
    schema = {"type": "object", "additionalProperties": False, "required": ["items"], "properties": {
        "items": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["i", "french", "english", "changed"],
            "properties": {"i": {"type": "integer"}, "french": {"type": "string"}, "english": {"type": "string"},
                           "changed": {"type": "array", "items": {"type": "string", "enum": ["french", "english"]}}}}}}}
    data = _call(LANGUAGES_SYSTEM, json.dumps(items, ensure_ascii=False), schema, max_tokens=12000)
    asked = {it["i"]: it for it in items}
    out = {}
    for it in data.get("items", []):
        i = it.get("i")
        if i not in asked or not isinstance(it.get("french"), str) or not isinstance(it.get("english"), str):
            continue
        french, english = it["french"].strip()[:300], it["english"].strip()[:300]
        # What counts as changed is what differs from the document, whatever the AI says.
        changed = [f for f, v in (("french", french), ("english", english)) if v and v != asked[i][f]]
        out[i] = (french or asked[i]["french"], english or asked[i]["english"], changed)
    return out


@require_POST
@editor_required
def api_languages(request):
    """POST {entries: [{hanzi, french, english, source_sense, remark}]} (at
    most LANGUAGES_BATCH): {entries: [{french, english, changed}]} in the
    same order -- French really in French, English really in English, the
    missing one translated by the AI."""
    entries = (_json(request) or {}).get("entries")
    if not isinstance(entries, list) or not entries or len(entries) > LANGUAGES_BATCH:
        return JsonResponse({"error": f"Entre 1 et {LANGUAGES_BATCH} entrées par requête."}, status=400)
    items = []
    for i, e in enumerate(entries):
        if not isinstance(e, dict):
            return JsonResponse({"error": "Entrée mal formée."}, status=400)
        get = lambda k: (e.get(k) if isinstance(e.get(k), str) else "").strip()
        if get("hanzi") and (get("french") or get("english") or get("source_sense")):
            items.append({"i": i, "hanzi": get("hanzi")[:60], "french": get("french")[:300], "english": get("english")[:300]}
                         | ({"sense": get("source_sense")[:300]} if get("source_sense") else {})
                         | ({"remark": get("remark")[:200]} if get("remark") else {}))
    done = {}
    if items:
        try:
            done = check_languages(items)
        except AssistantError as err:
            return JsonResponse({"error": str(err)}, status=503)
    out = []
    for i, e in enumerate(entries):
        french, english, changed = done.get(i, (e.get("french") or "", e.get("english") or "", []))
        out.append({"french": french, "english": english, "changed": changed})
    return JsonResponse({"ok": True, "entries": out})


@require_POST
@editor_required
def api_propose(request, document_id):
    """POST {entries: [{hanzi, reading, french, english, themes, location,
    reading_note, translated, ai_fields, source_sense, remark, type}], source}: the ticked entries become additions
    Brouillons (drafts), checked again here (the browser is not trusted)."""
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
        fields = ("hanzi", "document_hanzi", "pinyin", "french", "english", "themes", "location", "source_sense",
                  "remark", "type", "origin")
        if not isinstance(e, dict) or not all(isinstance(e.get(k, ""), str) for k in fields):
            return JsonResponse({"error": "Entrée mal formée."}, status=400)
        ai_fields = e.get("ai_fields") if isinstance(e.get("ai_fields"), list) else []
        clean.append({k: e.get(k, "")[:300] for k in fields}
                     | {"translated": bool(e.get("translated")),
                        "ai_fields": [f for f in ("french", "english") if f in ai_fields]})
    created, skipped = [], 0
    for c in check_candidates(clean):
        if c["state"] != "new":
            skipped += 1
            continue
        where = f" ({c['location']})" if c["location"] else ""
        row_source = " ".join(c.get("origin", "").split())[:200] or source
        notes = [f"Importé de « {doc.filename} »{where} par {request.user.username} ; source : {row_source}."]
        if c["document_hanzi"] != c["hanzi"]:
            notes.append(f"Forme du document : {c['document_hanzi']}.")
        doc_reading = " ".join(c["pinyin"].split())
        if doc_reading and doc_reading.replace(" ", "") != c["reading"].replace(" ", ""):
            notes.append(f"Lecture du document : {doc_reading}.")
        if c.get("source_sense"):
            notes.append(f"Sens dans le document : {c['source_sense'].strip()}.")
        if c.get("remark"):
            notes.append(f"Remarque du document : {c['remark'].strip().rstrip('.')}.")
        ai_fields = set(c.get("ai_fields") or []) | ({"french"} if c.get("translated") else set())
        if ai_fields:
            labels = {"french": "français", "english": "anglais"}
            notes.append("Sens " + " et ".join(labels[f] for f in ("french", "english") if f in ai_fields)
                         + " traduit" + ("s" if len(ai_fields) > 1 else "") + " par l'IA.")
        if c["reading_note"]:
            notes.append(c["reading_note"].capitalize() + ".")
        created.append(LexiconAddition.objects.create(
            kind=c["kind"], status=LexiconAddition.STATUS_DRAFT, hanzi=c["hanzi"], pinyin=c["reading"],
            french=c["french"].strip(), english=c["english"].strip(), themes=c["themes"].strip(),
            observations=" ".join(notes), source=row_source,
            created_by=request.user, updated_by=request.user))
    return JsonResponse({"ok": True, "additions": [_addition_json(a) for a in created], "skipped": skipped})
