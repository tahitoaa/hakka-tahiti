"""« 🔤 Caractères », a step of the Suivi page, and the colours of its
tables: the characters of the additions still on their way (Brouillons, À
valider, Validés), each reading they are given compared with the lexicon's
readings of that character (and the words that use them) and with what the
dictionaries say (source_rules: each source's reading set in Wenfa).

The pairing of characters and syllables is done in the browser
(char_review.js), so that an edit shows at once; the server gives:
- "lexicon": {char: [readings]} for every character of the lexicon, under
  its simplified and traditional forms ("wuk5", tones as digits);
- "chars": {char: {...}} for the characters of the additions: the lexicon
  words reading it each way (a few examples) and, with ?dictionnaires=1,
  Mandarin, meaning and the dictionaries' readings."""
from collections import defaultdict

from django.http import JsonResponse
from django.views.decorators.gzip import gzip_page

from .models import LexiconAddition, Pronunciation, Word, WordPronunciation, to_simp, to_trad
from .permissions import editor_required, is_editor

STATUSES = (LexiconAddition.STATUS_DRAFT, LexiconAddition.STATUS_REVIEW, LexiconAddition.STATUS_VALIDATED)
EXAMPLES = 4


def _is_han(c):
    return "㐀" <= c <= "鿿" or "\U00020000" <= c <= "\U0002ffff" or "豈" <= c <= "﫿"


def reading_of(p):
    initial = p.initial.initial if p.initial else ""
    final = p.final.final if p.final else ""
    tone = str(p.tone.tone_number) if p.tone else ""
    return f"{initial or ''}{final or ''}{tone}"


def lexicon_map():
    """{char (as stored, simplified, traditional): [readings]} and
    {pronunciation id: (char, reading)}."""
    readings = defaultdict(list)
    by_id = {}
    for p in Pronunciation.objects.select_related("initial", "final", "tone"):
        if not p.hanzi:
            continue
        r = reading_of(p)
        by_id[p.id] = (p.hanzi, r)
        for form in {p.hanzi, to_simp(p.hanzi), to_trad(p.hanzi)}:
            if r not in readings[form]:
                readings[form].append(r)
    return dict(readings), by_id


def addition_chars():
    """Every Han character of the additions on their way."""
    chars = set()
    for hanzi in (LexiconAddition.objects.filter(status__in=STATUSES)
                  .exclude(ai_pending=True, status=LexiconAddition.STATUS_DRAFT).values_list("hanzi", flat=True)):
        chars.update(c for c in hanzi if _is_han(c))
    return chars


def word_examples(chars, by_id):
    """{char: {reading: {"count": n, "words": ["屋家 wuk5ga1 — maison"]}}} from
    the lexicon words that use one of these characters."""
    forms = {f: c for c in chars for f in {c, to_simp(c), to_trad(c)}}
    pron_ids = [pid for pid, (hanzi, _r) in by_id.items() if hanzi in forms]
    uses = defaultdict(list)          # pronunciation id -> word ids
    for pid, wid in WordPronunciation.objects.filter(pronunciation_id__in=pron_ids).values_list("pronunciation_id", "word_id"):
        if wid not in uses[pid]:
            uses[pid].append(wid)
    wanted = {wid for ids in uses.values() for wid in ids[:EXAMPLES]}
    spelled = defaultdict(list)       # word id -> [(position, pronunciation id)]
    for wid, pos, pid in WordPronunciation.objects.filter(word_id__in=wanted).values_list("word_id", "position", "pronunciation_id"):
        spelled[wid].append((pos, pid))
    french = dict(Word.objects.filter(id__in=wanted).values_list("id", "french"))

    def text(wid):
        parts = [by_id.get(pid, ("?", "?")) for _pos, pid in sorted(spelled[wid])]
        return f"{''.join(h for h, _r in parts)} {''.join(r for _h, r in parts)} — {(french.get(wid) or '').strip()}"

    out = defaultdict(dict)
    for pid, wids in uses.items():
        hanzi, reading = by_id[pid]
        char = forms[hanzi]
        entry = out[char].setdefault(reading, {"count": 0, "words": []})
        entry["count"] += len(wids)
        entry["words"].extend(text(w) for w in wids[:EXAMPLES] if len(entry["words"]) < EXAMPLES)
    return out


def dictionary_readings(chars):
    """{char: {"mandarin", "meaning", "sources": [{source, raw, wenfa, doubtful}]}}
    from the Dictionnaires' data (source_rules), each source reading set in Wenfa."""
    from . import source_rules as sr

    try:
        payload = sr.cached_payload()
    except Exception:  # the dictionaries are a help, never a reason to fail
        return {}
    rows = {r[0]: r for r in payload["rows"]}
    labels = {s["id"]: s["label"] for s in sr.SOURCES}
    out = {}
    for char in chars:
        row = rows.get(to_simp(char)) or rows.get(char)
        if not row:
            continue
        sources = []
        for sid, readings in row[7].items():
            source = next(s for s in sr.HAKKA if s["id"] == sid)
            split = sr.source_readings(source, row[0])
            for k, (raw, _pages, flag) in enumerate(readings):
                guess = sr.predict(payload["rules"], sid, split[k])[0] if k < len(split) else None
                sources.append({"source": labels[sid], "raw": raw, "doubtful": flag == "d",
                                "wenfa": "".join(guess) if guess else ""})
        out[char] = {"mandarin": row[4], "meaning": row[5], "sources": sources}
    return out


@gzip_page
@editor_required
def api_characters(request):
    if not is_editor(request.user):
        return JsonResponse({"error": "Réservé aux éditeurs."}, status=403)
    lexicon, by_id = lexicon_map()
    chars = addition_chars()
    examples = word_examples(chars, by_id)
    # The dictionaries (heavier, slower the first time): only for the « Caractères » step.
    dictionaries = dictionary_readings(chars) if request.GET.get("dictionnaires") else {}
    details = {c: {"words": examples.get(c, {}), **dictionaries.get(c, {})} for c in chars}
    response = JsonResponse({"lexicon": lexicon, "chars": details}, json_dumps_params={"ensure_ascii": False})
    response["Cache-Control"] = "private, no-cache"
    return response
