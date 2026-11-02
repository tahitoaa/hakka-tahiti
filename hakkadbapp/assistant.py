"""The AI assistant: an account ("ia", group "Assistants IA") that
- suggests new words from the existing data: words used in the lexicon's
  expressions and in the shared transcriptions but missing from the lexicon,
  and new expressions made of lexicon words -- as additions "À valider";
- comments on additions and lexicon words / expressions, and proposes
  corrections (spelling, punctuation...) that an editor applies or dismisses.

What it can't do is enforced here, not asked of the model: Claude only
returns proposals (structured JSON), and this module writes them through two
functions, add_comment() and suggest_new_word(). Neither changes nor deletes
an existing row, nor sets any status but "À valider" on a new suggestion.
The account itself is not an editor (permissions.is_editor), so no other
endpoint accepts it either. Items an editor muted are never sent to Claude
and never commented on.

Runs on request (buttons on the Validation page) or every night (Vercel
cron -> nightly())."""
import json
import logging
import random
import re
from collections import Counter, defaultdict

from decouple import config
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .ai import MODEL, HAN_RE, ai_enabled, _client
from .models import (AITarget, Expression, LexiconAddition, Pronunciation, ReviewComment, SharedTranscript, Word,
                     t2s)
from .permissions import AI_USERNAME, ASSISTANTS_GROUP, editor_required, is_editor

logger = logging.getLogger(__name__)

MAX_REVIEW_ITEMS = 12      # items read in one request
MAX_NEW_WORDS = 5          # words suggested in one request, by default
MAX_NEW_WORDS_REQUEST = 10  # at most in one request (Vercel's 60 s); the page loops for more
NIGHTLY_REVIEW_ITEMS = 10
# Fields the assistant may comment on or propose a correction for.
REVIEW_FIELDS = {
    ReviewComment.TARGET_ADDITION: ("french", "english", "themes", "observations"),
    ReviewComment.TARGET_WORD: ("french", "english"),
    ReviewComment.TARGET_EXPRESSION: ("french", "english"),
}
FIELD_LABELS = {"french": "français", "english": "anglais", "themes": "thème", "observations": "observations"}


class AssistantError(Exception):
    """A failure to show the editor as is (French)."""


# ---- the account ---------------------------------------------------------------

def ai_user():
    """The assistant's account, created on first use: no password (nobody
    logs in with it), in the "Assistants IA" group only."""
    User = get_user_model()
    user, created = User.objects.get_or_create(username=AI_USERNAME, defaults={"first_name": "Assistant IA"})
    if created:
        user.set_unusable_password()
        user.save()
    group, _ = Group.objects.get_or_create(name=ASSISTANTS_GROUP)
    user.groups.add(group)
    return user


# ---- items ---------------------------------------------------------------------

def _word_rows(ids=None):
    query = Word.objects.prefetch_related("wordpronunciation_set__pronunciation__initial",
                                          "wordpronunciation_set__pronunciation__final",
                                          "wordpronunciation_set__pronunciation__tone")
    if ids is not None:
        query = query.filter(id__in=ids)
    for w in query:
        wps = sorted(w.wordpronunciation_set.all(), key=lambda wp: wp.position)
        yield w, "".join(wp.pronunciation.hanzi for wp in wps), "".join(wp.pronunciation.pinyin() for wp in wps)


def load_items(target_type, ids):
    """[{type, id, label, hanzi, pinyin, fields}] for these ids (missing ones skipped)."""
    items = []
    if target_type == ReviewComment.TARGET_ADDITION:
        for a in LexiconAddition.objects.filter(id__in=ids):
            items.append({"type": target_type, "id": a.id, "hanzi": a.hanzi, "pinyin": a.pinyin, "kind": a.kind,
                          "fields": {f: getattr(a, f) for f in REVIEW_FIELDS[target_type]}})
    elif target_type == ReviewComment.TARGET_WORD:
        for w, hanzi, pinyin in _word_rows(ids):
            items.append({"type": target_type, "id": w.id, "hanzi": hanzi, "pinyin": pinyin, "kind": "word",
                          "fields": {"french": w.french or "", "english": w.english or ""}})
    elif target_type == ReviewComment.TARGET_EXPRESSION:
        for e in Expression.objects.filter(id__in=ids):
            items.append({"type": target_type, "id": e.id, "hanzi": e.text or "", "pinyin": e.rendering or "",
                          "kind": "expression", "fields": {"french": e.french or "", "english": e.english or ""}})
    for item in items:
        item["label"] = f"{item['hanzi']} · {item['fields'].get('french', '')}"[:300]
    return items


def muted_ids(target_type, ids=None):
    query = AITarget.objects.filter(target_type=target_type, muted=True)
    if ids is not None:
        query = query.filter(target_id__in=ids)
    return set(query.values_list("target_id", flat=True))


def set_muted(target_type, target_id, muted, user):
    target, _ = AITarget.objects.get_or_create(target_type=target_type, target_id=target_id)
    target.muted = muted
    target.muted_by = user if muted else None
    target.save(update_fields=["muted", "muted_by"])
    return target


def _mark_reviewed(items):
    now = timezone.now()
    for item in items:
        AITarget.objects.update_or_create(target_type=item["type"], target_id=item["id"],
                                          defaults={"reviewed_at": now})


# ---- the only two writes -----------------------------------------------------------

def add_comment(item, kind, text, field="", proposed=""):
    """A comment, or a correction of one field, on `item` -- unless it is
    muted, the field isn't one it may touch, or the same remark is already
    open. Never changes the item. Returns the comment or None."""
    text, proposed = " ".join(str(text).split())[:1000], str(proposed).strip()[:1000]
    if not text or item["id"] in muted_ids(item["type"], [item["id"]]):
        return None
    current = ""
    if kind == ReviewComment.KIND_CORRECTION:
        if field not in REVIEW_FIELDS[item["type"]]:
            return None
        current = item["fields"].get(field, "")
        if proposed == current.strip():
            return None
    else:
        kind, field, proposed = ReviewComment.KIND_COMMENT, "", ""
    open_remarks = ReviewComment.objects.filter(target_type=item["type"], target_id=item["id"],
                                                status=ReviewComment.STATUS_OPEN, kind=kind)
    if kind == ReviewComment.KIND_CORRECTION and open_remarks.filter(field=field, proposed_value=proposed).exists():
        return None
    if kind == ReviewComment.KIND_COMMENT and open_remarks.filter(text=text).exists():
        return None
    return ReviewComment.objects.create(
        target_type=item["type"], target_id=item["id"], target_label=item["label"], kind=kind, text=text,
        field=field, current_value=current, proposed_value=proposed, author=ai_user())


def suggest_new_word(hanzi, pinyin, french, english="", themes="", observations=""):
    """A new word, "À valider", by the assistant -- unless the lexicon or
    the additions already have it, or an editor already rejected it."""
    hanzi, pinyin = "".join(hanzi.split()), "".join(pinyin.split())
    if not hanzi or not french.strip() or hanzi in known_words():
        return None
    return LexiconAddition.objects.create(
        kind=LexiconAddition.KIND_WORD, status=LexiconAddition.STATUS_REVIEW, hanzi=hanzi, pinyin=pinyin,
        french=french.strip()[:300], english=english.strip()[:300], themes=themes[:200],
        observations=observations.strip()[:1000], created_by=ai_user(), updated_by=ai_user())


# ---- what the lexicon knows ------------------------------------------------------------

def _norm(hanzi):
    return t2s.convert(hanzi)


def known_words(include_additions=True):
    """Every word the assistant must not suggest again, simplified: the
    lexicon's words and (unless told otherwise) every word addition,
    rejected ones included."""
    words = {_norm(h) for _w, h, _p in _word_rows()}
    if include_additions:
        words |= {_norm("".join(h.split())) for h in
                  LexiconAddition.objects.filter(kind=LexiconAddition.KIND_WORD).values_list("hanzi", flat=True)}
    return words


def char_readings():
    """{character (simplified): {"wuk5", ...}}: every reading the lexicon has."""
    readings = defaultdict(set)
    for p in Pronunciation.objects.select_related("initial", "final", "tone"):
        tone = str(p.tone.tone_number) if p.tone else ""
        readings[_norm(p.hanzi)].add(f"{p.initial or ''}{p.final or ''}{tone}")
    return readings


# ---- Claude -------------------------------------------------------------------------

def _call(system, user_message, schema, max_tokens=4000):
    import anthropic

    if not ai_enabled():
        raise AssistantError("L'IA n'est pas configurée sur ce serveur.")
    try:
        response = _client().beta.messages.create(
            model=MODEL, max_tokens=max_tokens,
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            cache_control={"type": "ephemeral"},
            system=system, messages=[{"role": "user", "content": user_message}],
        )
    except anthropic.RateLimitError:
        raise AssistantError("L'IA est très demandée : réessayez dans une minute.")
    except anthropic.APIConnectionError:
        raise AssistantError("L'IA ne répond pas : réessayez plus tard.")
    except anthropic.APIStatusError as e:
        logger.exception("assistant: API error %s", e.status_code)
        raise AssistantError("L'IA a renvoyé une erreur : réessayez plus tard.")
    logger.info("assistant: model=%s in=%s out=%s", response.model, response.usage.input_tokens,
                response.usage.output_tokens)
    if response.stop_reason == "refusal":
        raise AssistantError("L'IA a refusé cette demande.")
    if response.stop_reason == "max_tokens":
        raise AssistantError("Réponse de l'IA incomplète : réessayez avec moins d'éléments.")
    try:
        return json.loads(next((b.text for b in response.content if b.type == "text"), ""))
    except json.JSONDecodeError:
        raise AssistantError("Réponse de l'IA illisible : réessayez.")


CONTEXT = ("You assist the editors of a lexicon of the Hakka spoken by the Chinese community of Tahiti "
           "(French Polynesia). Readings use the Wenfa romanization with tone digits. Editors are French "
           "speakers; write every comment in French, short and concrete.")


def _themes():
    from .additions import _known_themes

    return _known_themes()


# ---- reviewing items -----------------------------------------------------------------

REVIEW_SYSTEM = CONTEXT + """

You review entries and leave remarks. Two kinds:
- "correction": a fix of one field's text that needs no judgment on the meaning: spelling, accents, punctuation, typography, capitalisation, spacing, the lexicon's style (short, lowercase, no final period, close meanings separated by commas). proposed_value is the whole corrected field.
- "comment": anything else worth an editor's attention: a translation that seems wrong or incomplete, a French/English mismatch, a missing translation, a theme that doesn't fit, a likely duplicate of another entry given. Never rewrite the meaning as a correction; say it in a comment.
Only remark on real problems: no remark at all is the right answer for a correct entry. Never remark on the hanzi or the reading. Refer to entries by their "ref"."""


def _review_schema():
    return {
        "type": "object",
        "properties": {"remarks": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "ref": {"type": "string"},
                "kind": {"type": "string", "enum": ["correction", "comment"]},
                "field": {"type": "string", "enum": ["french", "english", "themes", "observations", "none"]},
                "proposed_value": {"type": "string"},
                "text": {"type": "string"},
            },
            "required": ["ref", "kind", "field", "proposed_value", "text"],
            "additionalProperties": False,
        }}},
        "required": ["remarks"],
        "additionalProperties": False,
    }


def review(target_type, ids):
    """Reads these items (muted ones left out) and writes its remarks.
    Returns the new comments."""
    ids = [i for i in ids if i not in muted_ids(target_type, ids)][:MAX_REVIEW_ITEMS]
    items = load_items(target_type, ids)
    if not items:
        return []
    refs = {f"{item['type']}-{item['id']}": item for item in items}
    entries = [{"ref": ref, "kind": item["kind"], "hanzi": item["hanzi"], "reading": item["pinyin"],
                **item["fields"]} for ref, item in refs.items()]
    data = _call(REVIEW_SYSTEM + "\n\nThemes in use: " + json.dumps(_themes(), ensure_ascii=False),
                 "Entries to review:\n" + json.dumps(entries, ensure_ascii=False), _review_schema())
    created = []
    with transaction.atomic():
        for remark in data.get("remarks", []):
            item = refs.get(remark.get("ref"))
            if not item:
                continue
            comment = add_comment(item, remark.get("kind"), remark.get("text", ""),
                                  remark.get("field", ""), remark.get("proposed_value", ""))
            if comment:
                created.append(comment)
        _mark_reviewed(items)
    return created


# ---- suggesting new words -----------------------------------------------------------------

TOKEN_RE = re.compile(r"\(([^()]*)\)")


def _tokens(text):
    """(hanzi, pinned reading) for each Han-only token of a maillage text
    ("㧹(dep5) 死 狗" -> ("㧹", "dep5"), ("死", ""), ("狗", ""))."""
    for raw in str(text or "").split():
        token = raw.split(":")[0]
        pins = TOKEN_RE.findall(token)
        hanzi = TOKEN_RE.sub("", token)
        if hanzi and all(HAN_RE.fullmatch(c) for c in hanzi) and len(hanzi) <= 6:
            yield hanzi, "".join(pins).replace(" ", "")


def missing_candidates(limit):
    """Words used in the lexicon's expressions and in the transcriptions,
    absent from the lexicon and the additions, most frequent first, with
    where they were seen and each character's readings."""
    known, readings = known_words(), char_readings()
    counts, contexts, pins = Counter(), defaultdict(list), {}
    sources = [(e.text, f"expression « {e.text} » : {e.french}") for e in Expression.objects.all()]
    for t in SharedTranscript.objects.all():
        for seg in t.data.get("segments", []):
            sources.append((seg.get("transcript", ""), f"transcription « {seg.get('hanzi', '')} » : {seg.get('translation', '')}"))
    for text, context in sources:
        for hanzi, pin in _tokens(text):
            key = _norm(hanzi)
            if key in known:
                continue
            counts[key] += 1
            if len(contexts[key]) < 3:
                contexts[key].append(context[:200])
            if pin:
                pins[key] = pin
    out = []
    for key, count in counts.most_common():
        char_options = [sorted(readings.get(c, ())) for c in key]
        if key not in pins and not all(char_options):
            continue  # a character the lexicon can't read: no reading to propose
        out.append({"hanzi": key, "seen": count, "contexts": contexts[key], "pinned_reading": pins.get(key, ""),
                    "readings_per_character": char_options})
        if len(out) >= limit:
            break
    return out


NEW_WORDS_SYSTEM = CONTEXT + """

You propose new lexicon words from the data given, never from outside it. For each candidate, decide if it is a real Hakka word worth adding (not a proper name, not a chance sequence of characters); if not, set keep to false. If it is:
- reading: one reading per character, taken only from that character's readings given (or the pinned reading when there is one), joined without spaces ("wuk5ka1");
- french and english: short translations in the lexicon's style (lowercase, no final period, close meanings separated by commas), drawn from the contexts given;
- themes: zero to two themes from the list given;
- note: one sentence in French saying where it was seen or what it rests on."""


def _new_words_schema(themes):
    return {
        "type": "object",
        "properties": {"words": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "hanzi": {"type": "string"}, "keep": {"type": "boolean"}, "reading": {"type": "string"},
                "french": {"type": "string"}, "english": {"type": "string"},
                "themes": {"type": "array", "items": {"type": "string", "enum": themes} if themes else {"type": "string"}},
                "note": {"type": "string"},
            },
            "required": ["hanzi", "keep", "reading", "french", "english", "themes", "note"],
            "additionalProperties": False,
        }}},
        "required": ["words"],
        "additionalProperties": False,
    }


def _valid_reading(hanzi, reading, readings, pinned=""):
    """True when `reading` is one lexicon reading per character (or the pin)."""
    reading = reading.replace(" ", "").lower()
    if pinned and reading == pinned.lower():
        return True

    def split(rest, chars):
        if not chars:
            return not rest
        return any(rest.startswith(r) and split(rest[len(r):], chars[1:]) for r in readings.get(chars[0], ()))

    return split(reading, list(_norm(hanzi)))


def _create_from(words, candidates, themes, origin, limit=MAX_NEW_WORDS):
    readings = char_readings()
    by_hanzi = {c["hanzi"]: c for c in candidates}
    created = []
    for w in words:
        hanzi = _norm("".join(str(w.get("hanzi", "")).split()))
        candidate = by_hanzi.get(hanzi)
        if not w.get("keep") or (candidates and not candidate):
            continue
        if not all(HAN_RE.fullmatch(c) for c in hanzi) or not _valid_reading(
                hanzi, w.get("reading", ""), readings, (candidate or {}).get("pinned_reading", "")):
            logger.info("assistant: %s dropped (reading %r not from the lexicon)", hanzi, w.get("reading"))
            continue
        note = f"Suggestion de l'IA ({origin}). {w.get('note', '')}".strip()
        addition = suggest_new_word(hanzi, w["reading"].replace(" ", "").lower(), w.get("french", ""),
                                    w.get("english", ""), ", ".join(t for t in w.get("themes", []) if t in themes),
                                    note)
        if addition:
            created.append(addition)
        if len(created) >= limit:
            break
    return created


def suggest_missing(limit=MAX_NEW_WORDS):
    candidates = missing_candidates(limit * 2)
    if not candidates:
        return []
    themes = _themes()
    data = _call(NEW_WORDS_SYSTEM + "\n\nThemes: " + json.dumps(themes, ensure_ascii=False),
                 "Candidates (words seen in the data, missing from the lexicon):\n"
                 + json.dumps(candidates, ensure_ascii=False), _new_words_schema(themes))
    return _create_from(data.get("words", []), candidates, themes, "mot repéré dans le corpus", limit)


EXPRESSIONS_SYSTEM = CONTEXT + """

You propose new Hakka expressions for the lexicon. An expression is a group of words of the lexicon: a full sentence, a phrase, or only two words. Build each one only from the lexicon words given, referring to them by their "ref" in order; never use a word that is not in the list. Prefer what Hakka speakers really say, in the theme given, and don't repeat the existing expressions shown.
For each: words (the refs, in order, at least two), french and english (natural translations, in the style of the existing expressions), themes (zero to two from the list), note (one sentence in French on what it shows: a construction, a common use)."""


def _expressions_schema(themes):
    return {
        "type": "object",
        "properties": {"expressions": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "words": {"type": "array", "items": {"type": "string"}},
                "french": {"type": "string"}, "english": {"type": "string"},
                "themes": {"type": "array", "items": {"type": "string", "enum": themes} if themes else {"type": "string"}},
                "note": {"type": "string"},
            },
            "required": ["words", "french", "english", "themes", "note"],
            "additionalProperties": False,
        }}},
        "required": ["expressions"],
        "additionalProperties": False,
    }


SUPERSCRIPT_DIGITS = str.maketrans("¹²³⁴⁵⁶⁷⁸", "12345678")


def known_expressions():
    """Every expression already there (lexicon and additions), without spaces."""
    texts = {_norm("".join((t or "").split())) for t in Expression.objects.values_list("text", flat=True)}
    texts |= {_norm("".join(h.split())) for h in LexiconAddition.objects.filter(
        kind=LexiconAddition.KIND_EXPRESSION).values_list("hanzi", flat=True)}
    return texts


def suggest_expressions(limit=MAX_NEW_WORDS, theme=None):
    """New expressions made of lexicon words: the AI picks the words (by
    ref) and translates; the characters and the reading come from those
    lexicon words, never from the AI."""
    themes = _themes()
    rows = [(w, h, p.translate(SUPERSCRIPT_DIGITS)) for w, h, p in _word_rows() if h and p]
    by_theme = defaultdict(list)
    for row in rows:
        for name in (row[0].category or "").split(","):
            if name.strip():
                by_theme[name.strip()].append(row)
    if not by_theme:
        return []
    theme = theme if theme in by_theme else random.choice(sorted(by_theme))
    # The theme's words, and the words the lexicon's expressions use most
    # (pronouns, verbs, particles: what holds a sentence together).
    usage = Counter(Expression.words.through.objects.values_list("word_id", flat=True))
    common = sorted(rows, key=lambda r: -usage.get(r[0].id, 0))[:40]
    sample, seen = [], set()
    for row in by_theme[theme][:50] + common:
        if row[0].id not in seen:
            seen.add(row[0].id)
            sample.append(row)
    refs = {f"w{w.id}": (h, p) for w, h, p in sample}
    examples = [{"expression": e.text, "french": e.french} for e in Expression.objects.exclude(text="").order_by("?")[:12]]
    message = json.dumps({
        "theme": theme,
        "lexicon_words": [{"ref": f"w{w.id}", "hanzi": h, "reading": p, "french": w.french} for w, h, p in sample],
        "existing_expressions": examples,
        "propose_at_most": limit,
    }, ensure_ascii=False)
    data = _call(EXPRESSIONS_SYSTEM + "\n\nThemes: " + json.dumps(themes, ensure_ascii=False), message,
                 _expressions_schema(themes))
    known, created, ai = known_expressions(), [], ai_user()
    for e in data.get("expressions", []):
        parts = [refs.get(r) for r in e.get("words", [])]
        if len(parts) < 2 or None in parts or not str(e.get("french", "")).strip():
            continue  # a word that isn't in the lexicon, or too short: dropped
        hanzi = " ".join(h for h, _p in parts)
        key = _norm("".join(hanzi.split()))
        if key in known:
            continue
        known.add(key)
        created.append(LexiconAddition.objects.create(
            kind=LexiconAddition.KIND_EXPRESSION, status=LexiconAddition.STATUS_REVIEW, hanzi=hanzi,
            pinyin=" ".join(p for _h, p in parts), french=e["french"].strip()[:300],
            english=str(e.get("english", "")).strip()[:300],
            themes=", ".join(t for t in e.get("themes", []) if t in themes)[:200],
            observations=f"Suggestion de l'IA (expression, thème {theme}). {e.get('note', '')}".strip()[:1000],
            created_by=ai, updated_by=ai))
        if len(created) >= limit:
            break
    return created


# ---- nightly run ---------------------------------------------------------------------------------

def nightly():
    """The scheduled run: reviews additions changed since it last read
    them, a slice of the lexicon it hasn't read yet, and suggests a few
    words or expressions (missing words and new expressions on alternate
    nights)."""
    ai = ai_user()
    report = {}
    reviewed = {(t.target_type, t.target_id): t.reviewed_at for t in AITarget.objects.exclude(reviewed_at=None)}
    additions = [a.id for a in LexiconAddition.objects.filter(
        status__in=[LexiconAddition.STATUS_DRAFT, LexiconAddition.STATUS_REVIEW]).exclude(created_by=ai)
        if not reviewed.get(("addition", a.id)) or reviewed[("addition", a.id)] < a.updated_at]
    report["additions"] = len(review(ReviewComment.TARGET_ADDITION, additions[:NIGHTLY_REVIEW_ITEMS]))
    words = [i for i in Word.objects.order_by("id").values_list("id", flat=True) if ("word", i) not in reviewed]
    report["lexicon"] = len(review(ReviewComment.TARGET_WORD, words[:NIGHTLY_REVIEW_ITEMS]))
    if timezone.now().toordinal() % 2:
        report["new_words"] = len(suggest_missing(3))
    else:
        report["new_words"] = len(suggest_expressions(3))
    logger.info("assistant nightly: %s", report)
    return report


# ---- HTTP --------------------------------------------------------------------------------------

def _json(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


def comment_json(c):
    return {
        "id": c.id, "target_type": c.target_type, "target_id": c.target_id, "target_label": c.target_label,
        "kind": c.kind, "text": c.text, "field": c.field, "field_label": FIELD_LABELS.get(c.field, c.field),
        "current_value": c.current_value, "proposed_value": c.proposed_value, "status": c.status,
        "author": c.author.username if c.author else "", "by_ai": bool(c.author and c.author.username == AI_USERNAME),
        "created_at": c.created_at.isoformat(),
        "applicable": c.target_type == ReviewComment.TARGET_ADDITION and c.kind == ReviewComment.KIND_CORRECTION,
    }


def _error(err, status=503):
    return JsonResponse({"error": str(err)}, status=status)


@require_POST
@editor_required
def api_review(request):
    """POST {target_type, ids}: the AI reads these items now."""
    payload = _json(request)
    if not payload or payload.get("target_type") not in REVIEW_FIELDS:
        return JsonResponse({"error": "Demande invalide."}, status=400)
    if payload.get("next") and payload["target_type"] != ReviewComment.TARGET_ADDITION:
        # The next lexicon items it hasn't read yet, muted ones left out.
        model = Word if payload["target_type"] == ReviewComment.TARGET_WORD else Expression
        done = set(AITarget.objects.filter(target_type=payload["target_type"])
                   .exclude(reviewed_at=None, muted=False).values_list("target_id", flat=True))
        payload["ids"] = [i for i in model.objects.order_by("id").values_list("id", flat=True)
                          if i not in done][:NIGHTLY_REVIEW_ITEMS]
        if not payload["ids"]:
            return JsonResponse({"ok": True, "comments": [], "message": "L'IA a déjà relu tout le lexique."})
    ids = payload.get("ids")
    if not isinstance(ids, list) or not ids or not all(isinstance(i, int) for i in ids):
        return JsonResponse({"error": "Sélection invalide."}, status=400)
    if len(ids) > MAX_REVIEW_ITEMS:
        return JsonResponse({"error": f"L'IA relit au plus {MAX_REVIEW_ITEMS} éléments à la fois."}, status=400)
    try:
        created = review(payload["target_type"], ids)
    except AssistantError as err:
        return _error(err)
    return JsonResponse({"ok": True, "comments": [comment_json(c) for c in created]})


@require_POST
@editor_required
def api_new_words(request):
    """POST {mode: "missing" | "expressions", count}: the AI suggests up to
    `count` words or expressions (1 to MAX_NEW_WORDS_REQUEST; the page asks
    again for more)."""
    from .additions import _addition_json

    payload = _json(request) or {}
    count = payload.get("count", MAX_NEW_WORDS)
    count = max(1, min(MAX_NEW_WORDS_REQUEST, count if isinstance(count, int) else MAX_NEW_WORDS))
    try:
        created = (suggest_expressions(count) if payload.get("mode") in ("expressions", "compounds")
                   else suggest_missing(count))
    except AssistantError as err:
        return _error(err)
    return JsonResponse({"ok": True, "additions": [_addition_json(a) for a in created]})


@editor_required
def api_comments(request):
    """GET ?scope=additions|lexicon: open remarks (and the last resolved
    ones) with the muted items. POST {target_type, target_id, text}: an
    editor's own comment."""
    if not is_editor(request.user):
        return JsonResponse({"error": "Connexion requise."}, status=403)
    if request.method == "POST":
        payload = _json(request) or {}
        target_type, text = payload.get("target_type"), " ".join(str(payload.get("text", "")).split())
        if target_type not in REVIEW_FIELDS or not isinstance(payload.get("target_id"), int) or not text:
            return JsonResponse({"error": "Commentaire invalide."}, status=400)
        items = load_items(target_type, [payload["target_id"]])
        if not items:
            return JsonResponse({"error": "Élément introuvable."}, status=404)
        comment = ReviewComment.objects.create(target_type=target_type, target_id=items[0]["id"],
                                               target_label=items[0]["label"], text=text[:1000], author=request.user)
        return JsonResponse({"ok": True, "comment": comment_json(comment)}, status=201)

    types = ([ReviewComment.TARGET_WORD, ReviewComment.TARGET_EXPRESSION] if request.GET.get("scope") == "lexicon"
             else [ReviewComment.TARGET_ADDITION])
    comments = ReviewComment.objects.filter(target_type__in=types).select_related("author")
    open_ = list(comments.filter(status=ReviewComment.STATUS_OPEN))
    resolved = list(comments.exclude(status=ReviewComment.STATUS_OPEN)[:100])
    muted = [{"target_type": t, "target_id": i} for t, i in
             AITarget.objects.filter(target_type__in=types, muted=True).values_list("target_type", "target_id")]
    return JsonResponse({"comments": [comment_json(c) for c in open_ + resolved], "muted": muted,
                         "ai_enabled": ai_enabled()})


@require_POST
@editor_required
def api_comment_action(request, comment_id):
    """POST {action: "apply" | "dismiss" | "done"}. "apply" copies a
    correction into the addition (an editor's change, recorded as theirs);
    "done" closes a lexicon remark once fixed on the platform."""
    payload = _json(request) or {}
    action = payload.get("action")
    try:
        comment = ReviewComment.objects.select_related("author").get(id=comment_id)
    except ReviewComment.DoesNotExist:
        return JsonResponse({"error": "Remarque introuvable."}, status=404)
    if comment.status != ReviewComment.STATUS_OPEN:
        return JsonResponse({"error": "Cette remarque est déjà traitée."}, status=409)
    addition = None
    if action == "apply":
        if comment.target_type != ReviewComment.TARGET_ADDITION or comment.kind != ReviewComment.KIND_CORRECTION:
            return JsonResponse({"error": "Seule une correction d'un ajout s'applique ici."}, status=400)
        addition = LexiconAddition.objects.filter(id=comment.target_id).first()
        if not addition:
            return JsonResponse({"error": "L'ajout n'existe plus."}, status=404)
        if getattr(addition, comment.field).strip() != comment.current_value.strip():
            return JsonResponse({"error": "Le champ a changé depuis la remarque : vérifiez-le à la main."}, status=409)
        setattr(addition, comment.field, comment.proposed_value)
        addition.updated_by = request.user
        addition.save(update_fields=[comment.field, "updated_by", "updated_at"])
        comment.status = ReviewComment.STATUS_APPLIED
    elif action in ("dismiss", "done"):
        comment.status = ReviewComment.STATUS_DISMISSED if action == "dismiss" else ReviewComment.STATUS_APPLIED
    else:
        return JsonResponse({"error": "Action invalide."}, status=400)
    comment.resolved_by, comment.resolved_at = request.user, timezone.now()
    comment.save(update_fields=["status", "resolved_by", "resolved_at"])
    from .additions import _addition_json

    return JsonResponse({"ok": True, "comment": comment_json(comment),
                         "addition": _addition_json(addition) if addition else None})


@require_POST
@editor_required
def api_mute(request):
    """POST {target_type, target_id, muted}: the AI leaves this item alone (or not)."""
    payload = _json(request) or {}
    if (payload.get("target_type") not in REVIEW_FIELDS or not isinstance(payload.get("target_id"), int)
            or not isinstance(payload.get("muted"), bool)):
        return JsonResponse({"error": "Demande invalide."}, status=400)
    set_muted(payload["target_type"], payload["target_id"], payload["muted"], request.user)
    return JsonResponse({"ok": True, "muted": payload["muted"]})


@csrf_exempt
def api_nightly(request):
    """Called by Vercel Cron with "Authorization: Bearer <CRON_SECRET>"."""
    secret = config("CRON_SECRET", default="")
    if not secret or request.headers.get("Authorization") != f"Bearer {secret}":
        return JsonResponse({"error": "Non autorisé."}, status=401)
    if not ai_enabled():
        return JsonResponse({"ok": False, "error": "IA non configurée."}, status=503)
    try:
        return JsonResponse({"ok": True, "report": nightly()})
    except AssistantError as err:
        return _error(err)
