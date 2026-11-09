"""« Lectures surprenantes » (Dictionnaires): readings of the
lexicon that no Hakka source supports while several sources agree on
another one -- found without the AI (source_rules: each source's readings
read in Wenfa through the correspondences learnt from the lexicon), then
read by the AI with everything the sources say. Its corrections become
remarks (assistant.add_comment) on the words that use that reading: they
are reviewed like any other remark (Relecture, Suivi). Nothing in the
lexicon changes.

A reading the AI has read is remembered (AITarget "reading", by
Pronunciation id) and not proposed again."""
import json
import logging
from collections import Counter, defaultdict

from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from . import source_rules as sr
from .assistant import CONTEXT, AssistantError, _call, _error, add_comment, load_items
from .models import AITarget, Pronunciation, ReviewComment, Word

logger = logging.getLogger(__name__)

TARGET_READING = AITarget.TARGET_READING
MAX_CHARS = 5           # readings read by the AI in one request (the AI client stops at 25 s)
MAX_WORDS = 8           # words of the lexicon shown per reading


# ---- without the AI: the readings no source supports ----------------------------------------------

def _word_index():
    """{(simplified char, (initial, final, tone)): [(word id, hanzi, pinyin, french)]}."""
    index = defaultdict(list)
    words = Word.objects.prefetch_related("wordpronunciation_set__pronunciation__initial",
                                          "wordpronunciation_set__pronunciation__final",
                                          "wordpronunciation_set__pronunciation__tone")
    for w in words:
        wps = sorted(w.wordpronunciation_set.all(), key=lambda wp: wp.position)
        hanzi = "".join(wp.pronunciation.hanzi for wp in wps)
        pinyin = "".join(wp.pronunciation.pinyin() for wp in wps)
        for wp in wps:
            p = wp.pronunciation
            reading = (p.initial.initial if p.initial else "", p.final.final if p.final else "",
                       str(p.tone.tone_number) if p.tone else "")
            entry = (w.id, hanzi, pinyin, w.french or "")
            key = (sr._norm(p.hanzi), tuple(x or "" for x in reading))
            if entry not in index[key]:
                index[key].append(entry)
    return index


def _pronunciation_ids():
    """{(simplified char, reading): Pronunciation id} -- what AITarget remembers."""
    out = {}
    for p in Pronunciation.objects.select_related("initial", "final", "tone"):
        if not p.hanzi:
            continue
        reading = (p.initial.initial if p.initial else "", p.final.final if p.final else "",
                   str(p.tone.tone_number) if p.tone else "")
        out.setdefault((sr._norm(p.hanzi), tuple(x or "" for x in reading)), p.id)
    return out


MIN_ATTESTED = 3        # learning pairs showing a correspondence for it to count as regular


def _attested(rules, source_id, src, reading, parts):
    """Does the source reading `src` turn into the lexicon's `reading` by
    correspondences seen at least MIN_ATTESTED times, on its first `parts`
    parts (2: initial and final; 3: the tone too)?"""
    tables = rules[source_id]["parts"]
    return all(tables[part].get(src[k], {}).get(reading[k], 0) >= MIN_ATTESTED
               for k, part in enumerate(("initial", "final", "tone")[:parts]))


def candidates(limit=MAX_CHARS, skip_read=True):
    """The most surprising readings first: [{char, reading, kind, votes,
    alternative, sources, mandarin, cantonese, meaning, words, pron_id}].
    kind "syllabe": no source reads its initial and final; "ton": the
    syllable is supported but no source has its tone while at least three
    agree on another. `votes`: how many sources agree on `alternative`."""
    sr.load_sources()
    lexicon = sr.lexicon_readings()
    rules = sr.learn(lexicon)
    pron_ids = _pronunciation_ids()
    done = set(AITarget.objects.filter(target_type=TARGET_READING).values_list("target_id", flat=True)) if skip_read else set()
    words = None
    found = []
    for char, wenfa in lexicon.items():
        guesses = {}                       # source id -> [(raw text, predicted, confidence)]
        splits = {}                        # source id -> [(initial, final, tone) in its spelling]
        for s in sr.HAKKA:
            raw = sr.raw_readings(s, char)
            if not raw:
                continue
            splits[s["id"]] = sr.source_readings(s, char)
            guesses[s["id"]] = [(f"{syl}{tone.translate(sr.SUPERSCRIPT)}", *sr.predict(rules, s["id"], r))
                                for (syl, tone, *_rest), r in zip(raw, splits[s["id"]])]
        if len(guesses) < 2:
            continue
        for reading in wenfa:
            pron_id = pron_ids.get((char, reading))
            if pron_id in done:
                continue
            # Supported: some reading of the source turns into this one by
            # correspondences the lexicon shows again and again (s -> x
            # before i is regular, not a surprise).
            syllable_ok = [sid for sid, rs in splits.items() if any(_attested(rules, sid, r, reading, 2) for r in rs)]
            tone_ok = [sid for sid, rs in splits.items() if any(_attested(rules, sid, r, reading, 3) for r in rs)]
            votes = Counter()
            for sid, gs in guesses.items():
                for p in {p for _r, p, _c in gs if p}:
                    votes[p] += 1
            if not votes:
                continue
            if not syllable_ok:
                kind = "syllabe"
                alternative, n = votes.most_common(1)[0]
                if n < 2 or alternative[:2] == reading[:2]:
                    continue
            elif not tone_ok:
                kind = "ton"
                same = Counter({p: v for p, v in votes.items() if p[:2] == reading[:2]})
                if not same:
                    continue
                alternative, n = same.most_common(1)[0]
                if n < 3:
                    continue
            else:
                continue
            if words is None:
                words = _word_index()
            info = sr.unihan_entry(char)
            found.append({
                "char": char, "reading": sr.wenfa_text(reading), "kind": kind, "votes": n,
                "alternative": sr.wenfa_text(alternative), "pron_id": pron_id,
                "lexicon": [sr.wenfa_text(r) for r in wenfa],
                "sources": {next(s["label"] for s in sr.HAKKA if s["id"] == sid):
                            [f"{raw} (→ {sr.wenfa_text(p)}, {c} %)" if p else raw for raw, p, c in gs]
                            for sid, gs in guesses.items()},
                "mandarin": " ".join(info.get("mandarin", [])), "cantonese": " ".join(info.get("cantonese", [])),
                "meaning": info.get("meaning", ""),
                "words": words.get((char, reading), [])[:MAX_WORDS],
            })
    # Several sources against the lexicon first, then the syllables before the tones.
    found.sort(key=lambda c: (-c["votes"], c["kind"] != "syllabe", c["char"]))
    return found[:limit]


# ---- the AI ------------------------------------------------------------------------------------

SYSTEM = CONTEXT + """

You check readings of characters in the lexicon that look surprising: no Hakka source supports the lexicon's reading while several agree on another. For each one you get the lexicon's readings of the character, what each Hakka source writes (in its own romanization, then read in Wenfa through correspondences learnt from the lexicon, with how sure that conversion is), Mandarin, Cantonese, the English meaning, and the lexicon's words that use this reading.

For each reading, decide:
- "erreur": the lexicon's reading is very likely a mistake (a typo, a wrong tone, the reading of another character). Give the right reading in Wenfa and, for each word given that uses it, the word's whole corrected reading (Wenfa, tone digits, syllables joined: "hong2lu6").
- "variante": the lexicon's reading is plausible: a colloquial vs literary reading, the Hakka of Tahiti differing from the mainland sources, a sound change typical of the community. No correction.
- "incertain": the sources don't allow a conclusion. No correction; say what an editor should check.
The sources were transcribed from old books and scans: one of them alone can be wrong; several agreeing count. The conversion to Wenfa is learnt and can be wrong too, mostly for tones. Be careful: the community's own reading is the reference; only call an error what the evidence clearly shows. "explanation": two or three sentences in French, citing the sources that matter."""


def _schema():
    return {
        "type": "object",
        "properties": {"findings": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "ref": {"type": "string"},
                "verdict": {"type": "string", "enum": ["erreur", "variante", "incertain"]},
                "proposed_reading": {"type": "string"},
                "explanation": {"type": "string"},
                "corrections": {"type": "array", "items": {
                    "type": "object",
                    "properties": {"word_ref": {"type": "string"}, "proposed_pinyin": {"type": "string"}},
                    "required": ["word_ref", "proposed_pinyin"],
                    "additionalProperties": False,
                }},
            },
            "required": ["ref", "verdict", "proposed_reading", "explanation", "corrections"],
            "additionalProperties": False,
        }}},
        "required": ["findings"],
        "additionalProperties": False,
    }


def ask(found):
    """What the AI says of these candidates: (refs, word refs, its answer). Writes nothing."""
    refs = {f"c{k}": c for k, c in enumerate(found)}
    word_refs = {}
    entries = []
    for ref, c in refs.items():
        ws = []
        for word_id, hanzi, pinyin, french in c["words"]:
            word_refs[f"w{word_id}"] = word_id
            ws.append({"ref": f"w{word_id}", "hanzi": hanzi, "reading": pinyin, "french": french})
        entries.append({"ref": ref, "char": c["char"], "lexicon_reading": c["reading"], "all_lexicon_readings": c["lexicon"],
                        "surprise": "initial and final" if c["kind"] == "syllabe" else "tone",
                        "sources_agree_on": f"{c['alternative']} ({c['votes']} sources)", "sources": c["sources"],
                        "mandarin": c["mandarin"], "cantonese": c["cantonese"], "meaning": c["meaning"], "words": ws})
    data = _call(SYSTEM, "Readings to check:\n" + json.dumps(entries, ensure_ascii=False), _schema(), max_tokens=6000)
    return refs, word_refs, data


def check(limit=MAX_CHARS):
    """The AI reads the most surprising readings not read yet; its
    corrections become remarks on the words. Returns (findings for the
    page, comments created)."""
    found = candidates(limit)
    if not found:
        return [], []
    refs, word_refs, data = ask(found)
    items = {i["id"]: i for i in load_items(ReviewComment.TARGET_WORD, list(set(word_refs.values())))}
    results, created = [], []
    now = timezone.now()
    with transaction.atomic():
        for f in data.get("findings", []):
            c = refs.get(f.get("ref"))
            if not c:
                continue
            explanation = " ".join(str(f.get("explanation", "")).split())
            corrections = []
            if f.get("verdict") == "erreur":
                for fix in f.get("corrections", []):
                    item = items.get(word_refs.get(fix.get("word_ref")))
                    proposed = "".join(str(fix.get("proposed_pinyin", "")).split())
                    if not item or not proposed or proposed == item["pinyin"]:
                        continue
                    text = (f"Lecture surprenante de {c['char']} ({c['reading']}) : {explanation} "
                            f"Lecture proposée pour {item['hanzi']} : {proposed} (au lieu de {item['pinyin']}).")
                    comment = add_comment(item, ReviewComment.KIND_COMMENT, text)
                    corrections.append({"word_id": item["id"], "hanzi": item["hanzi"], "current": item["pinyin"],
                                        "proposed": proposed, "comment_id": comment.id if comment else None})
                    if comment:
                        created.append(comment)
            if c["pron_id"]:
                AITarget.objects.update_or_create(target_type=TARGET_READING, target_id=c["pron_id"],
                                                  defaults={"reviewed_at": now})
            results.append({"char": c["char"], "reading": c["reading"], "kind": c["kind"], "alternative": c["alternative"],
                            "votes": c["votes"], "sources": c["sources"], "verdict": f.get("verdict"),
                            "proposed_reading": f.get("proposed_reading", ""), "explanation": explanation,
                            "corrections": corrections})
    return results, created


@require_POST
@login_required
def api_check(request):
    """POST: the AI reads the next surprising readings. Signed-in users only."""
    from .ai import _over_limit

    if _over_limit(request.user):
        return JsonResponse({"error": "Limite quotidienne de demandes à l'IA atteinte : réessayez demain."}, status=429)
    try:
        results, created = check()
    except AssistantError as err:
        return _error(err)
    if not results:
        return JsonResponse({"ok": True, "findings": [], "message": "Aucune lecture surprenante à relire : tout a déjà été vu."})
    return JsonResponse({"ok": True, "findings": results, "comments": len(created)})
