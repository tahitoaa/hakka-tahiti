"""« Rechercher » : un mot, une lecture ou un sens dans toutes les sources à
la fois, sans IA (page /rechercher/, rechercher.html).

Ce qui est tapé décide de la recherche :
- des caractères : le mot (formes simplifiée et traditionnelle) et chacun de
  ses caractères dans les dictionnaires ;
- des lettres : la lecture (« zen lao » trouve zen¹lao¹, tons et espaces
  ignorés) et le sens (français, anglais), accents ignorés.

Sources, dans l'ordre de la page :
    lexique (mots, expressions)     tout le monde
    ajouts validés                  tout le monde (les autres : éditeurs)
    caractères des dictionnaires    tout le monde (source_rules, comme Dictionnaires)
    Rey 1926 (pages lues)           tout le monde
    transcriptions publiées         membres connectés, comme /ecouter/
    documents importés              éditeurs (textes d'ouvrages, non publiés)
"""
import re
import time
import unicodedata
from collections import defaultdict

from django.http import JsonResponse
from django.shortcuts import render
from django.urls import reverse
from django.views.decorators.http import require_GET

from .models import (Expression, ExpressionWord, ImportedDocument, LexiconAddition, Pronunciation, ReyPage,
                     SharedTranscript, Word, WordPronunciation, to_simp, to_trad)
from .permissions import is_editor

LIMIT = 30          # résultats affichés par source
MAX_QUERY = 40
CACHE_SECONDS = 600
HAN = re.compile(r"[㐀-鿿豈-﫿\U00020000-\U0002ffff]")
_SUPERSCRIPTS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")
_cache = {}
# « la maison », « to eat » : le sens entier, pour le classement.
ARTICLES = re.compile(r"^(?:(?:le|la|les|un|une|des|du|de la|the|a|an|to)\s+|l'|d')")


# ---- Normalisation -----------------------------------------------------------------------------

def fold(text):
    """Minuscules, sans accents : « Maison », « maisón » -> « maison »."""
    text = unicodedata.normalize("NFD", (text or "").translate(_SUPERSCRIPTS))
    text = "".join(c for c in text if not 0x300 <= ord(c) <= 0x36F)
    return (text.replace("ŋ", "ng").replace("ε", "e").replace("ɔ", "o").replace("’", "'").lower())


def reading_key(text):
    """Une lecture comme clé : sans tons, espaces ni apostrophes (« zen¹ lao¹ » -> « zenlao »)."""
    return re.sub(r"[\s\d'\-·.,]", "", fold(text))


def han_only(text):
    """Les seuls caractères d'un texte, sans espaces ni ponctuation."""
    return "".join(HAN.findall(text or ""))


def han_score(query, text):
    """3 = le même mot, 2 = il commence par la requête, 1 = il la contient. La
    requête est comparée sous ses formes simplifiée et traditionnelle ; le texte
    n'est pas converti (c'est lent, et la plupart des textes sont simplifiés)."""
    h = han_only(text)
    if not h:
        return 0
    best = 0
    for form in query["forms"]:
        if form == h:
            return 3
        if h.startswith(form):
            best = max(best, 2)
        elif form in h:
            best = max(best, 1)
    return best


def sense_score(q, text):
    """0 si le sens `text` ne contient pas `q` ; plus c'est haut, mieux c'est :
    3 = tout le sens (ou l'un de ses éléments séparés par , ;), 2 = un mot entier, 1 = un morceau."""
    t = fold(text)
    if not q or q not in t:
        return 0
    if any(ARTICLES.sub("", part.strip(" .!?()«»\"'")) == q for part in re.split(r"[,;/()]", t)):
        return 3
    if re.search(rf"(?<![\w]){re.escape(q)}(?![\w])", t):
        return 2
    return 1 if len(q) >= 3 else 0


def reading_score(q, reading):
    """3 = même lecture, 2 = elle commence par `q`, 1 = elle le contient (`q` déjà en clé)."""
    r = reading_key(reading)
    if not q or not r:
        return 0
    if r == q:
        return 3
    if r.startswith(q):
        return 2
    return 1 if len(q) >= 4 and q in r else 0


# ---- Le lexique, gardé quelques minutes par instance ---------------------------------------------

def cached(name, build):
    """build(), gardé CACHE_SECONDS par instance : une page de Rey lue ou un
    document importé apparaît au plus tard 10 minutes après."""
    stamp, data = _cache.get(name, (0, None))
    if data is None or time.time() - stamp >= CACHE_SECONDS:
        data = build()
        _cache[name] = (time.time(), data)
    return data


def lexicon():
    """{"words": [...], "expressions": [...]} : hanzi, pinyin, français, anglais."""
    return cached("lexicon", _build_lexicon)


def _build_lexicon():
    prons = {p.id: (p.hanzi or "", p.pinyin()) for p in Pronunciation.objects.select_related("initial", "final", "tone")}
    parts = defaultdict(list)
    for wid, pos, pid in WordPronunciation.objects.values_list("word_id", "position", "pronunciation_id"):
        parts[wid].append((pos, pid))
    words, by_id = [], {}
    for w in Word.objects.only("id", "french", "english"):
        spelled = [prons.get(pid, ("", "")) for _pos, pid in sorted(parts[w.id])]
        hanzi = "".join(h for h, _r in spelled)
        if not hanzi.strip():
            continue
        entry = {"id": w.id, "hanzi": hanzi, "pinyin": "".join(r for _h, r in spelled),
                 "french": w.french or "", "english": w.english or ""}
        by_id[w.id] = entry
        words.append(entry)
    in_expr = defaultdict(list)
    for eid, pos, wid in ExpressionWord.objects.values_list("expression_id", "position", "word_id"):
        in_expr[eid].append((pos, wid))
    expressions = []
    for e in Expression.objects.only("id", "text", "french", "english"):
        ws = [by_id[wid] for _pos, wid in sorted(in_expr[e.id]) if wid in by_id]
        hanzi = (e.text or "").replace(" ", "") or "".join(w["hanzi"] for w in ws)
        expressions.append({"id": e.id, "hanzi": hanzi, "pinyin": " ".join(w["pinyin"] for w in ws),
                            "french": e.french or "", "english": e.english or ""})
    return {"words": words, "expressions": expressions}


# ---- Chaque source -------------------------------------------------------------------------------

def _match(query, hanzi, pinyin, senses):
    """Score d'une entrée (hanzi, pinyin, [sens]) pour la requête, 0 si rien."""
    if query["han"]:
        return han_score(query, hanzi)
    best = reading_score(query["reading"], pinyin) if query["reading"] else 0
    for sense in senses:
        best = max(best, sense_score(query["sense"], sense))
    return best


def _ranked(items):
    """Meilleurs d'abord, puis les plus courts (le mot avant les expressions qui le contiennent)."""
    items.sort(key=lambda pair: (-pair[0], len(pair[1].get("hanzi") or ""), pair[1].get("hanzi") or ""))
    return [item for _score, item in items]


def search_lexicon(query):
    data = lexicon()
    words, expressions = [], []
    for kind, entries, out in (("word", data["words"], words), ("expression", data["expressions"], expressions)):
        for e in entries:
            score = _match(query, e["hanzi"], e["pinyin"], [e["french"], e["english"]])
            if score:
                out.append((score, {"hanzi": e["hanzi"], "pinyin": e["pinyin"], "french": e["french"],
                                    "english": e["english"]}))
    return _ranked(words), _ranked(expressions)


def search_additions(query, editor):
    statuses = ([LexiconAddition.STATUS_DRAFT, LexiconAddition.STATUS_REVIEW, LexiconAddition.STATUS_VALIDATED]
                if editor else [LexiconAddition.STATUS_VALIDATED])
    labels = dict(LexiconAddition.STATUS_CHOICES)
    found = []
    for a in (LexiconAddition.objects.filter(status__in=statuses).exclude(ai_pending=True)
              .only("id", "kind", "status", "hanzi", "pinyin", "french", "english", "source")):
        score = _match(query, a.hanzi, a.pinyin, [a.french, a.english])
        if score:
            found.append((score, {"hanzi": a.hanzi.replace(" ", "") if a.kind == LexiconAddition.KIND_EXPRESSION else a.hanzi,
                                  "pinyin": a.pinyin, "french": a.french, "english": a.english,
                                  "detail": " · ".join(x for x in (labels.get(a.status, a.status), a.source) if x),
                                  "link": f"{reverse('saisie')}?modifier={a.id}" if editor else ""}))
    return _ranked(found)


def search_characters(query):
    """Les caractères des dictionnaires (le tableau de « Dictionnaires ») :
    chaque caractère tapé, ou ceux dont le sens anglais contient le mot."""
    from . import source_rules

    try:
        payload = source_rules.cached_payload()
    except Exception:  # les dictionnaires aident, ils ne font jamais échouer la recherche
        return []
    labels = {s["id"]: s["label"] for s in source_rules.SOURCES}
    rows = {r[0]: r for r in payload["rows"]}
    if query["han"]:
        chosen = [rows[c] for c in dict.fromkeys(query["han"]) if c in rows]
        scored = [(3, r) for r in chosen]
    else:
        scored = [(sense_score(query["sense"], r[5] or ""), r) for r in payload["rows"]]
        scored = [(s, r) for s, r in scored if s >= 2]
    out = []
    for score, r in scored:
        readings = [f"{labels.get(sid, sid)} : {', '.join(raw for raw, *_ in rs)}" for sid, rs in (r[7] or {}).items() if rs]
        out.append((score, {"hanzi": r[0] + (f" ({r[1]})" if r[1] and r[1] != r[0] else ""), "pinyin": r[2] or "",
                            "english": r[5] or "",
                            "detail": " · ".join(x for x in (f"mandarin {r[4]}" if r[4] else "",
                                                             f"cantonais {r[6]}" if r[6] else "") if x),
                            "readings": readings,
                            "link": reverse('hanzi', args=[r[0]])}))
    out.sort(key=lambda pair: -pair[0])
    return [item for _s, item in out]


def search_rey(query):
    """Les entrées des pages de Rey déjà lues (par l'IA, une fois pour toutes)."""
    from . import rey

    try:
        images = rey.index()[0]["meta"]["images"]
    except Exception:
        images = ""
    q_reading = rey.fold(query["text"]).replace(" ", "") if not query["han"] else ""
    found = []
    pages = cached("rey", lambda: [(p.page, p.image, p.entries or [])
                                   for p in ReyPage.objects.only("image", "page", "entries")])
    for number, image, entries in pages:
        for e in entries:
            if query["han"]:
                score = _match(query, e.get("hanzi", ""), "", [])
            else:
                score = sense_score(query["sense"], e.get("french", ""))
                spelled = rey.fold(e.get("reading", "")).replace(" ", "")
                if q_reading and spelled:
                    score = max(score, 3 if spelled == q_reading else 2 if spelled.startswith(q_reading) else 0)
            if score:
                found.append((score, {"hanzi": e.get("hanzi", ""), "pinyin": e.get("reading", ""), "french": e.get("french", ""),
                                      "detail": f"Rey p. {number}",
                                      "link": images.format(image=image) if images else ""}))
    return _ranked(found)


def _segment_hanzi(segment):
    """Comme TranscriptDocument.hanzi : la ligne Hanzi, sinon les caractères de la transcription."""
    if segment.get("hanzi"):
        return segment["hanzi"]
    plain = re.sub(r"\([^()]*\)", "", str(segment.get("transcript") or ""))
    return "".join(HAN.findall(plain))


def search_transcripts(query):
    found = []
    for t in SharedTranscript.objects.only("id", "title", "data"):
        people = (t.data or {}).get("participants") or []
        for i, s in enumerate((t.data or {}).get("segments") or []):
            hanzi = _segment_hanzi(s)
            score = _match(query, hanzi, s.get("pinyin") or s.get("transcript") or "", [s.get("translation") or ""])
            if score:
                speaker = s.get("speaker")
                who = people[speaker]["name"] if isinstance(speaker, int) and 0 <= speaker < len(people) else ""
                found.append((score, {"hanzi": hanzi or s.get("transcript", ""), "pinyin": s.get("pinyin") or "",
                                      "french": s.get("translation") or "",
                                      "detail": " · ".join(x for x in (t.title, who) if x),
                                      "link": f"{reverse('transcription_listen', args=[t.id])}?seg={i + 1}"}))
    found.sort(key=lambda pair: -pair[0])
    return [item for _s, item in found]


def search_documents(query):
    """Les lignes des documents importés qui citent le mot (ou le sens)."""
    found = []
    documents = cached("documents", lambda: [(d.filename, d.text.splitlines())
                                             for d in ImportedDocument.objects.only("filename", "text")])
    for filename, lines in documents:
        page = ""
        for n, line in enumerate(lines, 1):
            if re.fullmatch(r"\[page \d+\]", line.strip()):
                page = line.strip()[1:-1] + ", "
                continue
            hit = han_score(query, line) if query["han"] else sense_score(query["sense"], line) >= 2
            if hit:
                found.append({"text": " ".join(line.replace("\t", " · ").split())[:300],
                              "detail": f"{filename} · {page}ligne {n}"})
                if len(found) >= 100:  # assez pour compter ; LIMIT affichés
                    return found
    return found


# ---- Vues ------------------------------------------------------------------------------------------

def parse_query(text):
    text = " ".join((text or "").split())[:MAX_QUERY]
    typed = han_only(text)
    han = to_simp(typed)
    return {"text": text, "han": han, "forms": {han, to_trad(han), typed} - {""},
            "reading": "" if han else reading_key(text), "sense": "" if han else fold(text).strip()}


def search(text, user):
    query = parse_query(text)
    if not query["han"] and len(query["sense"]) < 2:
        return {"q": query["text"], "sections": []}
    editor = is_editor(user)
    words, expressions = search_lexicon(query)
    sections = [
        ("mots", "Lexique : mots", words, ""),
        ("expressions", "Lexique : expressions", expressions, ""),
        ("ajouts", "Ajouts" if editor else "Ajouts validés", search_additions(query, editor),
         "" if editor else "Les ajouts en cours ne sont visibles que des éditeurs."),
        ("caracteres", "Caractères des dictionnaires", search_characters(query),
         "" if query["han"] else "Sens anglais des caractères (mot entier)."),
        ("rey", "Rey 1926 (pages lues)", search_rey(query), ""),
    ]
    if user.is_authenticated:
        sections.append(("transcriptions", "Transcriptions publiées", search_transcripts(query), ""))
    if editor:
        sections.append(("documents", "Documents importés", search_documents(query), ""))
    return {"q": query["text"], "by": "caractères" if query["han"] else "lecture ou sens",
            "sections": [{"id": sid, "label": label, "count": len(items), "items": items[:LIMIT], "note": note}
                         for sid, label, items, note in sections]}


@require_GET
def api_search(request):
    response = JsonResponse(search(request.GET.get("q", ""), request.user), json_dumps_params={"ensure_ascii": False})
    response["Cache-Control"] = "private, no-cache"
    return response


@require_GET
def page(request):
    return render(request, "hakkadbapp/rechercher.html", {
        "page": "rechercher", "title": "Rechercher", "q": request.GET.get("q", "")[:MAX_QUERY],
        "signed_in": request.user.is_authenticated, "editor": is_editor(request.user),
    })
