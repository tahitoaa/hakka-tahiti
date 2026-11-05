"""Charles Rey, Dictionnaire chinois-français, dialecte hac-ka (1926): its
pages, found by syllable, read by the AI on request.

- The syllable index (data/rey_index.json, manage.py build_rey_index):
  each syllable of Rey's French romanization and the pages where it is,
  each page a scan on minhakka2.ling.sinica.edu.tw (kf_<n>.png). No AI.
- A syllable typed in any spelling (yok, yo, zhung, ngin...) is tried in
  Rey's own spelling too (yoc, tchoung, gnin...).
- « Lire les caractères » of a page: the AI reads the scan once -- the head
  characters with their reading and French sense, then the words quoted
  with them -- and the result is kept (ReyPage), so a page is paid once.
- Every head, word and expression read gives its characters' readings
  (align: one syllable per character), the column « Rey 1926 » of the
  Dictionnaire des caractères (source_rules._load_rey).

    GET  /api/rey?q=yok          -> {matches: [{syllable, pages: [{page, image, url, read}]}]}
    GET  /api/rey/page/<image>   -> {entries} if already read
    POST /api/rey/page/<image>   -> reads it (AI) and keeps it
"""
import base64
import json
import re
import time
import unicodedata
import urllib.request
from pathlib import Path

from django.http import JsonResponse

from .ai import MODEL, _client, ai_enabled
from .models import ReyPage
from .permissions import editor_required, is_editor

INDEX = Path(__file__).with_name("static") / "hakkadbapp" / "data" / "rey_index.json"
_cache = {}

# Common spellings -> Rey's French ones (each tried alone and together).
INITIALS = [("zh", "tch"), ("ch", "tch'"), ("j", "tch"), ("q", "ts'"), ("c", "ts'"), ("z", "ts"), ("x", "s"),
            ("sh", "ch"), ("ng", "gn"), ("th", "t'"), ("ph", "p'"), ("kh", "k'"), ("t'", "t'"), ("k'", "k'")]
FINALS = [("k", "c"), ("ung", "oung"), ("u", "ou"), ("ui", "oui"), ("iu", "iou"), ("eu", "eou")]


def index():
    stamp = INDEX.stat().st_mtime
    if _cache.get("index", (None,))[0] != stamp:
        data = json.loads(INDEX.read_text(encoding="utf-8"))
        _cache["index"] = (stamp, data, {s["syllable"]: s for s in data["syllables"]})
    return _cache["index"][1], _cache["index"][2]


def fold(text):
    """« Yŏc », « yok5 », « yòc » -> « yoc » / « yok »: no tone, no accent, ’ as '."""
    text = unicodedata.normalize("NFD", str(text or "").lower().replace("’", "'"))
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[0-9¹²³⁴⁵⁶⁷⁸\s]", "", text)


def spellings(q):
    """The ways `q` may be written in Rey's romanization, most likely first."""
    out = [q]
    for a, b in INITIALS:
        if q.startswith(a):
            out.append(b + q[len(a):])
    for spelled in list(out):
        for a, b in FINALS:
            if spelled.endswith(a) and not spelled.endswith(b):
                out.append(spelled[: -len(a)] + b)
    # « ngi » -> « gni », initial « i » -> « y »
    out += [s.replace("gni", "gn") for s in out if "gni" in s] + [("y" + s[1:]) for s in out if s.startswith("i")]
    return list(dict.fromkeys(out))


HANZI = re.compile(r"[\u3400-\u9fff\U00020000-\U0002ffff]")


def _syllables(reading):
    """« taí tch'ŏc yā, sē ké » -> [(token, base, tone)]: one per syllable
    (spaces, commas, « ... » between them; a stray trailing ' dropped)."""
    from .source_rules import rey_syllable

    out = []
    for token in re.split(r"[\s,;:.…，、。!?()«»\-]+", reading or ""):
        token = token.strip().rstrip("'’")
        base, tone = rey_syllable(token) if token else ("", "")
        base = base.rstrip("'")
        if base:
            out.append((token, base, tone))
    return out


def align(entries, carry=None):
    """The characters' readings in each entry of a page: [[(char, token, base,
    tone)] or None (not aligned), ...], and the last head of the page.

    A word is aligned when it has as many syllables as characters; where its
    head character stands, the syllable must be the head's (else the reading
    was misread or misordered: not aligned). `carry`: (head chars, base) of the
    previous page, for the words at the top of this one."""
    head = carry
    if head is None:   # words before the page's first head: their most common character
        firsts = []
        for e in entries:
            if e.get("kind") == "caractère":
                break
            firsts += HANZI.findall(e.get("hanzi", ""))
        if firsts:
            head = ({max(set(firsts), key=firsts.count)}, None)
    out = []
    for e in entries:
        chars = HANZI.findall(e.get("hanzi", ""))
        sylls = _syllables(e.get("reading", ""))
        if e.get("kind") == "caractère":
            head = (set(chars), sylls[0][1] if sylls else None)
            # A head (or its variants side by side, 藥 葯): each char the head's reading.
            out.append([(c, *sylls[0]) for c in chars] if chars and sylls else None)
            continue
        if not chars or len(chars) != len(sylls):
            out.append(None)
            continue
        if head and head[1] and any(c in head[0] and s[1] != head[1] for c, s in zip(chars, sylls)):
            out.append(None)
            continue
        out.append([(c, *s) for c, s in zip(chars, sylls)])
    return out, head


def previous_head(page):
    """The last head of the page before `page`, if read (for align's carry)."""
    prev = ReyPage.objects.filter(page=page - 1).only("entries").first()
    return align(prev.entries or [])[1] if prev else None


def _pages(data, syllable):
    pages = data["pages"]
    url = data["meta"]["images"]
    read = set(ReyPage.objects.values_list("image", flat=True))
    out = []
    for a, b in syllable["ranges"]:
        for i in range(a, b + 1):
            p = pages[i]
            out.append({"page": p["page"], "image": p["image"], "url": url.format(image=p["image"]), "read": p["image"] in read})
    return out


def search(q):
    data, by_syllable = index()
    q = fold(q)
    if not q:
        return []
    keys = {fold(k): k for k in by_syllable}
    found = []
    for spelled in spellings(q):
        if spelled in keys and keys[spelled] not in found:
            found.append(keys[spelled])
    # Then the syllables that start like it (« yo » -> yoc, yoi, yong...), a few.
    for k in sorted(by_syllable):
        if len(found) >= 12:
            break
        if k not in found and any(fold(k).startswith(s) for s in spellings(q)[:3]):
            found.append(k)
    return [{"syllable": k, "exact": n < len(spellings(q)) and fold(k) in spellings(q), "pages": _pages(data, by_syllable[k])}
            for n, k in enumerate(found)]


@editor_required
def api_search(request):
    if not is_editor(request.user):
        return JsonResponse({"error": "Connexion requise."}, status=403)
    q = request.GET.get("q", "")[:20]
    data, _ = index()
    return JsonResponse({"q": q, "spellings": spellings(fold(q)) if q else [], "matches": search(q),
                         "title": data["meta"]["title"], "romanization": data["meta"]["romanization"], "index": data["meta"]["index"]})


READ_SYSTEM = """You read one scanned page of Charles Rey's « Dictionnaire chinois-français, dialecte hac-ka » (1926).
Entries: a head character (large, followed by its radical and stroke numbers, e.g. 藥 140,15), its reading in
Rey's French romanization with tone marks (Yŏc), and its French sense; then the words and phrases built with
it, where « | » stands for the head character, each with its reading and French sense.
List them in page order:
- hanzi: the characters, « | » replaced by the head character (no other change); skip a line whose characters
  you cannot read;
- reading: as printed (accents kept, lower case);
- french: the French sense as printed, shortened if very long;
- kind: "caractère" for a head entry, "mot" for a word, "expression" for a phrase or sentence.
Do not add anything that is not on the page."""


def read_page(image, user):
    """The AI reads kf_<image>.png once; kept in ReyPage."""
    data, _ = index()
    page = next((p for p in data["pages"] if p["image"] == image), None)
    if not page:
        raise ValueError("Page inconnue.")
    url = data["meta"]["images"].format(image=image)
    raw = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (lexique hakka Wenfa)"}),
                                 timeout=20).read()
    schema = {"type": "object", "additionalProperties": False, "required": ["entries"], "properties": {
        "entries": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                               "required": ["hanzi", "reading", "french", "kind"],
                                               "properties": {"hanzi": {"type": "string"}, "reading": {"type": "string"},
                                                              "french": {"type": "string"},
                                                              "kind": {"type": "string", "enum": ["caractère", "mot", "expression"]}}}}}}
    started = time.time()
    response = _client().beta.messages.create(
        model=MODEL, max_tokens=8000, betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        system=READ_SYSTEM,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(raw).decode()}},
            {"type": "text", "text": f"Page {page['page']} du dictionnaire de Rey."}]}])
    text = "".join(getattr(b, "text", "") for b in response.content)
    entries = [e for e in json.loads(text).get("entries", []) if re.search(r"[㐀-鿿]", e.get("hanzi", ""))]
    row, _ = ReyPage.objects.update_or_create(image=image, defaults={"page": page["page"], "entries": entries, "read_by": user})
    # Its characters are now a source of the Dictionnaire des caractères (column « Rey 1926 »).
    from . import source_rules
    source_rules._cache.pop("payload", None)
    return row, round(time.time() - started, 1), (response.usage.input_tokens, response.usage.output_tokens)


def _chars(row):
    """Per entry: [[char, reading as printed], ...] or None (not aligned)."""
    if not row:
        return []
    aligned, _ = align(row.entries or [], previous_head(row.page))
    return [[[c, token] for c, token, _b, _t in a] if a else None for a in aligned]


@editor_required
def api_page(request, image):
    if not is_editor(request.user):
        return JsonResponse({"error": "Connexion requise."}, status=403)
    row = ReyPage.objects.filter(image=image).first()
    if request.method == "GET":
        return JsonResponse({"image": image, "read": bool(row), "entries": row.entries if row else [],
                             "chars": _chars(row)})
    if row:
        return JsonResponse({"image": image, "read": True, "entries": row.entries, "chars": _chars(row), "cached": True})
    if not ai_enabled():
        return JsonResponse({"error": "L'IA n'est pas configurée sur ce serveur."}, status=503)
    try:
        row, seconds, usage = read_page(image, request.user)
    except ValueError as err:
        return JsonResponse({"error": str(err)}, status=400)
    except Exception as err:  # network, API
        return JsonResponse({"error": f"Lecture impossible ({err.__class__.__name__}) : réessayez plus tard."}, status=503)
    return JsonResponse({"image": image, "read": True, "entries": row.entries, "chars": _chars(row), "cached": False,
                         "seconds": seconds, "tokens": {"in": usage[0], "out": usage[1]}})
