"""hakkadictionary.com (客家話大辭典, Bao'an), read by the site itself: a
character's readings and senses, and the words the dictionary quotes with
it (〔更番〕, 〈番人〉=外族人...), turned into suggestions for the lexicon.

    GET  /api/hakkadict?q=番            -> {entries, words}
    POST /api/hakkadict/brouillons       {char, words: [{hanzi, pinyin, definition, note}]}
         -> the AI's drafts (French / English translated from the Chinese
            definition), sorted on the « Suggestions IA » page.

The dictionary's API (the one its own page calls) answers in traditional
characters only; the words are stored simplified, like the lexicon."""
import html
import json
import re
import time
import urllib.parse
import urllib.request

from django.http import JsonResponse
from django.views.decorators.http import require_POST

from . import pinyin_rules
from . import romanization
from .assistant import AssistantError, _norm, ai_user, char_readings, known_words
from .importer import Deduced, _stored_options, check_languages
from .models import LexiconAddition
from .permissions import editor_required, is_editor
from .pronunciation_sources import _s2t

API = "https://www.hakkadictionary.com/api/zh-tw/hakkadict/data"
SITE = "https://www.hakkadictionary.com/zh-tw/hakkadict/"
SOURCE = "hakkadictionary.com"
_cache = {}
HAN = re.compile(r"[㐀-䶿一-鿿\U00020000-\U0002A6DF]")
NAME = re.compile(r"[〔〈]([^〔〕〈〉]+)[〕〉]")
# 〈…〉: a spoken (colloquial) word -- kept; 〔…〕: a literary one -- left out.
SPOKEN = re.compile(r"〈([^〔〕〈〉]+)〉")


def _text(fragment):
    """HTML -> plain text; the dictionary's glyph images (rare characters) -> □."""
    # Their glyph tags hold a quote and a « > » of their own: up to the « /> ».
    fragment = re.sub(r'<img.*?class="ucs"[^>]*>', "□", str(fragment or ""), flags=re.S)
    fragment = re.sub(r"<img[^>]*>", "□", fragment)
    fragment = re.sub(r"<sup>(\d)</sup>", r"\1", fragment)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def fetch(char):
    """The dictionary's records for one character (traditional form), cached a day."""
    trad = _s2t.convert(char)
    stamp, data = _cache.get(trad, (0, None))
    if data is not None and time.time() - stamp < 86400:
        return data
    url = f"{API}?{urllib.parse.urlencode({'mode': 'character', 'query': trad, 'index': 0, 'offset': 0, 'limit': 50})}"
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (lexique hakka Wenfa)", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=15) as response:
        data = json.loads(response.read().decode("utf-8"))
    _cache[trad] = (time.time(), data)
    return data


def _senses(record):
    """[(heading, [item html])] of one record: « [1] 草茂。<ul><li>〔蕃茂〕繁茂</li></ul>[2] … »."""
    raw = str(record.get("data") or "")
    parts = re.split(r"\[\d+\]", raw)
    out = []
    for part in parts:
        if not part.strip():
            continue
        heading = _text(part.split("<ul", 1)[0])
        items = re.findall(r"<li[^>]*>(.*?)</li>", part, flags=re.S) or re.split(r"(?=[〔〈])", part.split("<ul", 1)[0])
        out.append((heading, items))
    return out


def _words(record):
    """[(names, definition)] quoted in one record: « 〈番背(poi5)〉=〈番片〉=異國地方 »
    -> (["番背(poi5)", "番片"], "異國地方"). Only the spoken words 〈…〉: the
    literary ones 〔…〕 (〔生番〕、〔熟番〕) are not suggested. A word listed
    without its own definition takes its sense's."""
    out = []
    for heading, items in _senses(record):
        for item in items:
            text = _text(item)
            names = SPOKEN.findall(text)
            if not names:
                continue
            definition = re.sub(r"^[\s=、。，,]+", "", NAME.sub("", text)).strip(" =、。；;:，,")
            out.append((names, definition or NAME.sub("", heading).strip(" 、。")))
    return out


def _reading(word, char, char_syllable, readings, deduced):
    """(Wenfa reading, note) for a quoted word, character by character:
    a reading the dictionary writes after a character -- 番背(poi 5),
    過番(fan 1)背(poi 5) -- or the looked-up character's own (Bao'an -> Wenfa,
    the lexicon's reading when one fits); else the lexicon's only reading;
    else the one deduced from the dictionaries. "" when a character stays
    unknown or ambiguous."""
    # [(character, (syllable, tone) written after it or None)]
    chars = []
    # A note in parentheses that is not a reading (番(或蕃)茄: « or 蕃 ») is not part of the word.
    word = re.sub(r"\((?![a-zü'\s]+\d)[^()]*\)", "", word)
    for m in re.finditer(r"(.)(?:\(\s*([a-zü']+)\s*(\d)\s*\))?", word):
        if HAN.match(m.group(1)):
            chars.append((_norm(m.group(1)), (m.group(2), m.group(3)) if m.group(2) else None))
    parts, notes = [], []
    for ch, written in chars:
        known = readings.get(ch, set())
        syllable = written or (char_syllable if ch == _norm(char) else None)
        pick = ""
        if syllable:
            options = _stored_options(*syllable)
            pick = next((o for o in options if o in known), "" if known else (options[0] if options else ""))
            if pick and written and len(known) > 1:
                notes.append(f"{ch} : {pick}, lecture indiquée par le dictionnaire ({syllable[0]}{syllable[1]})")
        if not pick and len(known) == 1:
            pick = next(iter(known))
        elif not pick and known:
            notes.append(f"{ch} : plusieurs lectures ({' / '.join(sorted(known))})")
        elif not pick:
            guess = deduced.get(ch)
            pick = guess[0] if guess else ""
            notes.append(f"{ch} : lecture déduite ({guess[1]})" if guess else f"{ch} : lecture inconnue")
        if not pick:
            return "", " ; ".join(notes)
        parts.append(pick)
    return "".join(parts), " ; ".join(notes)


def lookup(char):
    records = fetch(char)
    readings, deduced, known = char_readings(), Deduced(), known_words()
    entries, words, seen = [], [], {_norm(char)}
    for r in records:
        pron = _text(r.get("pronunciation"))
        m = re.match(r"([a-zü']+)\s*(\d)", pron)
        syllable = (m.group(1), m.group(2)) if m else None
        entries.append({"reading": pron, "maciver": r.get("maciver") or "", "text": _text(r.get("data")),
                        "senses": [h for h, _items in _senses(r) if h]})
        for names, definition in _words(r):
            for name in names:
                plain = re.sub(r"\(.*?\)", "", name)
                # A rare character shown as an image (□): the word can't be written.
                if "□" in plain or not HAN.search(plain) or _norm(char) not in _norm(plain):
                    continue
                key = _norm("".join(HAN.findall(plain)))
                if key in seen:
                    continue
                seen.add(key)
                pinyin, note = _reading(name, char, syllable, readings, deduced)
                words.append({"hanzi": key, "trad": "".join(HAN.findall(plain)), "pinyin": pinyin, "definition": definition,
                              "note": note, "dict_reading": pron, "known": key in known})
    # The character itself, when the lexicon has no word for it.
    one = _norm(char)
    if one not in known and entries:
        first = records[0]
        pron = _text(first.get("pronunciation"))
        m = re.match(r"([a-zü']+)\s*(\d)", pron)
        pinyin, note = _reading(char, char, (m.group(1), m.group(2)) if m else None, readings, deduced)
        senses = " ; ".join(entries[0]["senses"]) or entries[0]["text"]
        words.insert(0, {"hanzi": one, "trad": _s2t.convert(char), "pinyin": pinyin, "definition": senses[:300],
                         "note": note, "dict_reading": pron, "known": False})
    return {"char": char, "source": f"{SITE}", "entries": entries, "words": words}


@editor_required
def api_lookup(request):
    if not is_editor(request.user):
        return JsonResponse({"error": "Connexion requise."}, status=403)
    q = "".join(HAN.findall(request.GET.get("q", "")))[:1]
    if not q:
        return JsonResponse({"error": "Indiquez un caractère chinois."}, status=400)
    try:
        return JsonResponse(lookup(q))
    except (OSError, ValueError) as err:
        return JsonResponse({"error": f"hakkadictionary.com ne répond pas ({err.__class__.__name__}) : réessayez plus tard."}, status=503)


@require_POST
@editor_required
def api_drafts(request):
    """The words ticked become the AI's drafts (« Suggestions IA »), their
    French and English translated from the dictionary's Chinese definition."""
    from .additions import _addition_json

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "JSON invalide."}, status=400)
    char, words = str(payload.get("char", ""))[:2], payload.get("words")
    if not isinstance(words, list) or not words or len(words) > 60:
        return JsonResponse({"error": "Entre 1 et 60 mots."}, status=400)
    clean = []
    for w in words:
        if not isinstance(w, dict) or not HAN.search(str(w.get("hanzi", ""))):
            return JsonResponse({"error": "Mot mal formé."}, status=400)
        clean.append({k: str(w.get(k, ""))[:400] for k in ("hanzi", "trad", "pinyin", "definition", "note", "dict_reading")})
    known = known_words()
    clean = [w for w in clean if _norm(w["hanzi"]) not in known and "/" not in w["pinyin"]]
    if not clean:
        return JsonResponse({"ok": True, "additions": [], "skipped": len(words)})
    try:
        senses = check_languages([{"i": i, "hanzi": w["hanzi"], "french": "", "english": "", "sense": w["definition"]}
                                  for i, w in enumerate(clean)])
    except AssistantError as err:
        return JsonResponse({"error": str(err)}, status=503)
    ai = ai_user()
    created = []
    for i, w in enumerate(clean):
        french, english, _changed = senses.get(i, ("", "", []))
        notes = [f"Relevé dans hakkadictionary.com ({char}, {w['dict_reading']}) : 〈{w['trad']}〉 {w['definition']}".strip(),
                 "Sens traduit par l'IA."]
        if w["note"]:
            notes.append(w["note"][:1].upper() + w["note"][1:] + ".")
        if not w["pinyin"]:
            notes.append("Lecture à compléter.")
        w["pinyin"], fixes = pinyin_rules.normalize(w["pinyin"])
        if fixes:
            notes.append(pinyin_rules.normalize_note(fixes)[:1].upper() + pinyin_rules.normalize_note(fixes)[1:] + ".")
        broken = pinyin_rules.violations(w["pinyin"])
        if broken:
            notes.append("Lecture contraire aux règles : " + " ; ".join(broken) + ".")
        created.append(LexiconAddition.objects.create(
            kind=LexiconAddition.KIND_WORD, status=LexiconAddition.STATUS_DRAFT, ai_pending=True, hanzi=w["hanzi"], pinyin=w["pinyin"],
            french=french[:300], english=english[:300], observations=" ".join(notes)[:1000], source=SOURCE,
            created_by=ai, updated_by=ai))
    return JsonResponse({"ok": True, "additions": [_addition_json(a) for a in created], "skipped": len(words) - len(created)})
