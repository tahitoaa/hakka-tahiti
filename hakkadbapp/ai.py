"""AI suggestions on the Saisie page: French, English and theme for a new
word or expression, proposed by Claude from the entry and the related
lexicon entries. Only a suggestion: the editor accepts or changes it, and
nothing is saved here.

Needs ANTHROPIC_API_KEY in the environment (Vercel settings, local .env);
without it the button isn't shown and the endpoint answers 503."""
import json
import logging
import re
from functools import reduce
from operator import or_

from decouple import config
from django.core.cache import cache
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .models import Expression, Word, s2t, t2s
from .permissions import editor_required, is_editor

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-5-5"
DAILY_LIMIT = 200          # suggestions per editor per day (per server instance)
MAX_RELATED_WORDS = 25
MAX_RELATED_EXPRESSIONS = 10
HAN_RE = re.compile(r"[㐀-鿿豈-﫿\U00020000-\U0002ffff]")  # CJK characters, extensions included

SYSTEM_PROMPT = """You help the editors of a Hakka lexicon (the Hakka spoken by the Chinese community of Tahiti, French Polynesia) fill in new entries. The editors are French speakers.

For each new word or expression you get its characters (hanzi), its reading (Wenfa romanization, tone digits), and entries of the existing lexicon that share characters with it. Propose:
- french: the French translation, written the way the related lexicon entries write theirs (short, lowercase, no final period, close meanings separated by commas, a precision in parentheses).
- english: the English translation, same style.
- themes: zero to two themes, chosen only from the list given; none if no theme fits.
- explanation: one short sentence in French saying what the proposal rests on (e.g. which lexicon entries).
- based_on: the hanzi of the lexicon entries you actually relied on.
- confidence: "haute" when the lexicon entries make the meaning clear, "moyenne" when you inferred it from the characters, "basse" when you are guessing.

Rules:
- The reading given is authoritative: never correct or change the hanzi or the reading.
- Hakka meanings can differ from Mandarin; prefer what the lexicon entries show over the Mandarin meaning of the characters, and lower the confidence when you only have the Mandarin meaning.
- If the editor already typed a French or English translation, keep its meaning unless it is clearly wrong; you may polish its wording.
- Never invent lexicon entries in based_on.
- For an expression, "unknown_words" lists its words the lexicon doesn't have yet: give each one (in "words", same hanzi) its own french, english and themes, as for a word entry, in the meaning it has in this expression. When the editor already typed some of them (french_typed_by_editor, english_typed_by_editor, themes_typed_by_editor), rely on them to translate the expression and return them unchanged; fill in only what is missing, the English included."""


def ai_enabled():
    return bool(config("ANTHROPIC_API_KEY", default=""))


def _client():
    import anthropic  # imported here: the rest of the site never needs it

    return anthropic.Anthropic(api_key=config("ANTHROPIC_API_KEY"), timeout=25.0, max_retries=1)


def _schema(themes):
    theme_items = {"type": "string", "enum": themes} if themes else {"type": "string"}
    return {
        "type": "object",
        "properties": {
            "french": {"type": "string"},
            "english": {"type": "string"},
            "themes": {"type": "array", "items": theme_items},
            "explanation": {"type": "string"},
            "based_on": {"type": "array", "items": {"type": "string"}},
            "confidence": {"type": "string", "enum": ["haute", "moyenne", "basse"]},
            "words": {"type": "array", "items": {
                "type": "object",
                "properties": {"hanzi": {"type": "string"}, "french": {"type": "string"}, "english": {"type": "string"},
                               "themes": {"type": "array", "items": theme_items}},
                "required": ["hanzi", "french", "english", "themes"],
                "additionalProperties": False,
            }},
        },
        "required": ["french", "english", "themes", "explanation", "based_on", "confidence", "words"],
        "additionalProperties": False,
    }


def _chars(hanzi):
    """The entry's characters, in simplified and traditional forms."""
    chars = set(HAN_RE.findall(hanzi))
    return {v for c in chars for v in (c, s2t.convert(c), t2s.convert(c))}


def related_entries(hanzi):
    """Lexicon words and expressions sharing a character with `hanzi`."""
    chars = _chars(hanzi)
    if not chars:
        return [], []
    words = []
    query = (Word.objects.filter(pronunciations__hanzi__in=chars).distinct()
             .prefetch_related("wordpronunciation_set__pronunciation__initial",
                               "wordpronunciation_set__pronunciation__final",
                               "wordpronunciation_set__pronunciation__tone"))
    for w in query[:MAX_RELATED_WORDS * 2]:
        wps = sorted(w.wordpronunciation_set.all(), key=lambda wp: wp.position)
        words.append({
            "hanzi": "".join(wp.pronunciation.hanzi for wp in wps),
            "pinyin": "".join(wp.pronunciation.pinyin() for wp in wps),
            "french": w.french, "english": w.english, "theme": w.category or "",
        })
    # Words containing more of the entry's characters first.
    words.sort(key=lambda w: -len(set(w["hanzi"]) & chars))
    expressions = [
        {"hanzi": e.text or "", "rendering": e.rendering or "", "french": e.french,
         "english": e.english or "", "theme": e.category or ""}
        for e in Expression.objects.filter(reduce(or_, (Q(text__contains=c) for c in chars)))[:MAX_RELATED_EXPRESSIONS]
    ]
    return words[:MAX_RELATED_WORDS], expressions


def _over_limit(user):
    key = f"ai-suggestions:{user.pk}"
    count = cache.get(key, 0)
    if count >= DAILY_LIMIT:
        return True
    cache.set(key, count + 1, 24 * 3600)
    return False


@require_POST
@editor_required
def suggestion(request):
    """POST {kind, hanzi, pinyin, french?, english?, new_words?: [{hanzi, pinyin}]}
    -> the proposal (with one for each unknown word of an expression)."""
    from .additions import _known_themes  # same theme list as the form

    if not is_editor(request.user):
        return JsonResponse({"error": "Connexion requise."}, status=403)
    if not ai_enabled():
        return JsonResponse({"error": "Les suggestions IA ne sont pas configurées sur ce serveur."}, status=503)
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "JSON invalide."}, status=400)
    fields = {k: payload.get(k, "") for k in ("kind", "hanzi", "pinyin", "french", "english")}
    if not all(isinstance(v, str) for v in fields.values()):
        return JsonResponse({"error": "Champs invalides."}, status=400)
    fields = {k: " ".join(v.split())[:300] for k, v in fields.items()}
    if not HAN_RE.search(fields["hanzi"]) or not fields["pinyin"]:
        return JsonResponse({"error": "Complétez d'abord les caractères et la lecture."}, status=400)
    unknown = payload.get("new_words") or []
    if not isinstance(unknown, list) or len(unknown) > 30 or not all(
            isinstance(w, dict) and isinstance(w.get("hanzi"), str) and isinstance(w.get("pinyin", ""), str) for w in unknown):
        return JsonResponse({"error": "Mots inconnus invalides."}, status=400)
    def typed(w, name):
        value = w.get(name, "")
        return " ".join(value.split())[:200] if isinstance(value, str) else ""

    unknown = [{"hanzi": "".join(w["hanzi"].split())[:20], "reading": "".join(w.get("pinyin", "").split())[:60],
                **{f"{name}_typed_by_editor": typed(w, name) for name in ("french", "english", "themes") if typed(w, name)}}
               for w in unknown if fields["kind"] == "expression" and HAN_RE.search(w["hanzi"])]
    if _over_limit(request.user):
        return JsonResponse({"error": f"Limite de {DAILY_LIMIT} suggestions par jour atteinte."}, status=429)

    themes = _known_themes()
    words, expressions = related_entries(fields["hanzi"])
    entry = {
        "kind": "expression" if fields["kind"] == "expression" else "word",
        "hanzi": fields["hanzi"], "reading": fields["pinyin"],
        "french_typed_by_editor": fields["french"], "english_typed_by_editor": fields["english"],
        "unknown_words": unknown,
    }
    user_message = (
        "New entry:\n" + json.dumps(entry, ensure_ascii=False)
        + "\n\nRelated lexicon words:\n" + json.dumps(words, ensure_ascii=False)
        + "\n\nRelated lexicon expressions:\n" + json.dumps(expressions, ensure_ascii=False)
    )

    import anthropic

    try:
        response = _client().beta.messages.create(
            model=MODEL,
            max_tokens=2000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": _schema(themes)}},
            cache_control={"type": "ephemeral"},
            system=SYSTEM_PROMPT + "\n\nThemes you may choose from:\n" + json.dumps(themes, ensure_ascii=False),
            messages=[{"role": "user", "content": user_message}],
        )
    except anthropic.AuthenticationError:
        logger.exception("AI suggestion: authentication")
        return JsonResponse({"error": "La clé de l'IA est invalide : prévenez l'administrateur."}, status=503)
    except anthropic.RateLimitError:
        return JsonResponse({"error": "L'IA est très demandée : réessayez dans une minute."}, status=429)
    except anthropic.APIConnectionError:
        return JsonResponse({"error": "L'IA ne répond pas : réessayez plus tard."}, status=503)
    except anthropic.APIStatusError as e:
        logger.exception("AI suggestion: API error %s", e.status_code)
        return JsonResponse({"error": "L'IA a renvoyé une erreur : réessayez plus tard."}, status=502)

    logger.info("AI suggestion by %s: model=%s in=%s out=%s cache_read=%s", request.user.username, response.model,
                response.usage.input_tokens, response.usage.output_tokens,
                getattr(response.usage, "cache_read_input_tokens", None))
    if response.stop_reason == "refusal":
        return JsonResponse({"error": "L'IA n'a pas voulu proposer de traduction pour cette entrée."}, status=422)
    if response.stop_reason == "max_tokens":
        return JsonResponse({"error": "Réponse de l'IA incomplète : réessayez."}, status=502)
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.error("AI suggestion: invalid JSON %r", text[:500])
        return JsonResponse({"error": "Réponse de l'IA illisible : réessayez."}, status=502)

    known = {w["hanzi"] for w in words} | {e["hanzi"] for e in expressions}
    suggestion = {
        "french": str(data.get("french", "")).strip(),
        "english": str(data.get("english", "")).strip(),
        "themes": ", ".join(t for t in data.get("themes", []) if not themes or t in themes),
        "explanation": str(data.get("explanation", "")).strip(),
        # Only entries really sent: the AI can't cite what doesn't exist.
        "based_on": [h for h in data.get("based_on", []) if h in known][:8],
        "confidence": data.get("confidence") if data.get("confidence") in ("haute", "moyenne", "basse") else "basse",
        # Only the unknown words asked about.
        "words": [{"hanzi": w["hanzi"], "french": str(w.get("french", "")).strip(), "english": str(w.get("english", "")).strip(),
                   "themes": ", ".join(t for t in w.get("themes", []) if not themes or t in themes)}
                  for w in data.get("words", []) if isinstance(w, dict) and w.get("hanzi") in {u["hanzi"] for u in unknown}],
    }
    return JsonResponse({"ok": True, "suggestion": suggestion})
