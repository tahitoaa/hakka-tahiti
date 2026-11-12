"""Possible duplicates of the additions on their way (Suivi): for each one,
the lexicon words and expressions and the other additions that share its
hakka (same characters), its pinyin, a sense of its French or a sense of
its English. Shown in the Suivi table, its slideshow and its « Doublons »
filter (addition_duplicates.js).

Levels, for an addition: "exact" (same characters and same pinyin as
something else, or same pinyin, French and English), "strong" (same characters, or same French and same
English), "weak" (a shared pinyin of two syllables or more, a shared
sense), "" (nothing found). A one-syllable pinyin alone is not reported:
homophones are the rule, not a duplicate."""
import re
from collections import defaultdict

from django.db.models import Prefetch
from django.http import JsonResponse
from django.views.decorators.gzip import gzip_page

from .models import Expression, LexiconAddition, Word, WordPronunciation, to_simp
from .permissions import editor_required, is_editor
from .text_to_words import split_rendering

SCOPE = (LexiconAddition.STATUS_DRAFT, LexiconAddition.STATUS_REVIEW, LexiconAddition.STATUS_VALIDATED)
MAX_MATCHES = 8
SUPERSCRIPTS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")
TEXT_BLOCK = re.compile(r"«[^»]*»?")
FR_ARTICLES = re.compile(r"^(?:le |la |les |l'|l’|un |une |des |du |de la |se |s'|s’)")
EN_ARTICLES = re.compile(r"^(?:to |a |an |the )")


def _is_han(c):
    return "㐀" <= c <= "鿿" or "\U00020000" <= c <= "\U0002ffff" or "豈" <= c <= "﫿"


def hanzi_key(text):
    """The characters alone, simplified: « 屋家 », « 若 爸爸:père 在 » -> 若爸爸在."""
    text = re.sub(r":\S*", "", TEXT_BLOCK.sub(" ", text or ""))
    return to_simp("".join(c for c in text if _is_han(c)))


def pinyin_key(text):
    """« wuk⁵ ga¹ », « wuk5 ga1 » -> wuk5ga1; the number of syllables."""
    text = TEXT_BLOCK.sub(" ", (text or "").lower()).translate(SUPERSCRIPTS)
    key = re.sub(r"[^a-zü0-9_]", "", text)
    return key, len(re.findall(r"[a-zü]+[0-9_]?", text))


def senses(text, articles):
    """« la maison, le foyer (familial) » -> {"maison", "foyer"}."""
    text = re.sub(r"\([^)]*\)|\[[^]]*\]", " ", (text or "").lower())
    out = set()
    for part in re.split(r"[,;/|]| ou | or ", text):
        part = articles.sub("", " ".join(part.replace("…", " ").split()).strip(" .!?"))
        if len(part) > 1:
            out.add(part)
    return out


def _items():
    """Everything to compare with: [{type, id, kind, hanzi, pinyin, french, english, status?}]."""
    items = []
    word_prons = WordPronunciation.objects.select_related("pronunciation__initial", "pronunciation__final", "pronunciation__tone")
    for w in Word.objects.prefetch_related(Prefetch("wordpronunciation_set", queryset=word_prons)):
        items.append({"type": "word", "id": w.id, "kind": "word", "hanzi": w.char(), "pinyin": w.pinyin(),
                      "french": w.french or "", "english": w.english or ""})
    for e in Expression.objects.all():
        pinyin, hanzi = split_rendering(e.rendering or "")
        items.append({"type": "expression", "id": e.id, "kind": "expression", "hanzi": hanzi or e.text or "",
                      "pinyin": pinyin, "french": e.french or "", "english": e.english or ""})
    for a in LexiconAddition.objects.all():
        items.append({"type": "addition", "id": a.id, "kind": a.kind, "hanzi": a.hanzi, "pinyin": a.pinyin,
                      "french": a.french, "english": a.english, "status": a.status, "ai_pending": a.ai_pending})
    for it in items:
        it["_hanzi"] = hanzi_key(it["hanzi"])
        it["_pinyin"], it["_syllables"] = pinyin_key(it["pinyin"])
        it["_fr"] = senses(it["french"], FR_ARTICLES)
        it["_en"] = senses(it["english"], EN_ARTICLES)
    return items


def report():
    """{addition id: {"level", "count", "matches": [{type, id, hanzi, pinyin,
    french, english, status?, fields}]}} for the additions on their way."""
    items = _items()
    index = {"hanzi": defaultdict(list), "pinyin": defaultdict(list), "french": defaultdict(list), "english": defaultdict(list)}
    for k, it in enumerate(items):
        if it["_hanzi"]:
            index["hanzi"][it["_hanzi"]].append(k)
        if it["_pinyin"]:
            index["pinyin"][it["_pinyin"]].append(k)
        for s in it["_fr"]:
            index["french"][(it["kind"], s)].append(k)
        for s in it["_en"]:
            index["english"][(it["kind"], s)].append(k)

    out = {}
    for k, it in enumerate(items):
        if it["type"] != "addition" or it["status"] not in SCOPE or (it["ai_pending"] and it["status"] == LexiconAddition.STATUS_DRAFT):
            continue
        found = defaultdict(set)
        for j in index["hanzi"].get(it["_hanzi"], []) if it["_hanzi"] else []:
            found[j].add("hakka")
        for j in index["pinyin"].get(it["_pinyin"], []) if it["_pinyin"] else []:
            found[j].add("pinyin")
        for s in it["_fr"]:
            for j in index["french"].get((it["kind"], s), []):
                found[j].add("french")
        for s in it["_en"]:
            for j in index["english"].get((it["kind"], s), []):
                found[j].add("english")
        found.pop(k, None)
        matches = []
        for j, fields in found.items():
            other = items[j]
            if other["type"] == "addition" and other.get("ai_pending") and other["status"] == LexiconAddition.STATUS_DRAFT:
                continue
            # One syllable in common and nothing else: a homophone, not a duplicate.
            if fields == {"pinyin"} and it["_syllables"] < 2:
                continue
            # Same pinyin and same meanings: the same word, maybe written with another character.
            exact = {"hakka", "pinyin"} <= fields or {"pinyin", "french", "english"} <= fields
            strong = "hakka" in fields or {"french", "english"} <= fields
            matches.append({
                "type": other["type"], "id": other["id"], "hanzi": other["hanzi"], "pinyin": other["pinyin"],
                "french": other["french"], "english": other["english"], "status": other.get("status", ""),
                "fields": [f for f in ("hakka", "pinyin", "french", "english") if f in fields],
                "level": "exact" if exact else "strong" if strong else "weak",
            })
        if not matches:
            continue
        rank = {"exact": 0, "strong": 1, "weak": 2}
        # A lexicon entry first (the addition may be useless), then by how much matches.
        matches.sort(key=lambda m: (rank[m["level"]], m["type"] == "addition", -len(m["fields"])))
        out[it["id"]] = {"level": matches[0]["level"], "count": len(matches), "matches": matches[:MAX_MATCHES]}
    return out


@gzip_page
@editor_required
def api_duplicates(request):
    if not is_editor(request.user):
        return JsonResponse({"error": "Réservé aux éditeurs."}, status=403)
    response = JsonResponse({"duplicates": report()}, json_dumps_params={"ensure_ascii": False})
    response["Cache-Control"] = "private, no-cache"
    return response
