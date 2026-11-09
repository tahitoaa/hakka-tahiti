"""« Demander à l'IA » (Saisie and Suivi): a free instruction on one entry
-- « complète la phrase pour la rendre illustrative », « propose un
exemple », « traduis plus simplement » -- answered in French, with, when
it fits, a whole new version of the entry (characters word by word with
their readings, French, English) the editor may « Utiliser ». Nothing is
saved here: the page fills its form (Saisie) or saves the row (Suivi) only
when asked.

The readings are set in Wenfa's pinyin (pinyin_rules) and checked against
the lexicon's: a character read otherwise is reported, not hidden."""
import json
import logging

from django.http import JsonResponse
from django.views.decorators.http import require_POST

from . import pinyin_rules
from .ai import _over_limit, related_entries
from .assistant import CONTEXT, AssistantError, _call, _error, _norm, char_readings
from .permissions import editor_required, is_editor

logger = logging.getLogger(__name__)

MAX_INSTRUCTION = 500

SYSTEM = CONTEXT + """

An editor asks you something about one entry of the lexicon (a word or an expression), in French. Do what is asked and answer in French, briefly ("answer").
When the request calls for a new version of the entry (complete or rewrite the sentence, give an example, correct it...), also give that whole new version in "proposal":
- "words": the Hakka words in order, each in Chinese characters (simplified) with its reading in Wenfa (tone digits, syllables joined: "wuk5ka1"); punctuation as its own word with an empty reading;
- prefer the words of the lexicon given, with exactly their readings; a word that is not in the lexicon is allowed when needed, with its most likely Tahiti Hakka reading;
- "kind": "word" for a single word, else "expression";
- "french" and "english": the translation of the new version, in the lexicon's style (short, lowercase, no final period).
When no new version is called for (a question, an explanation), set "has_proposal" to false and leave the proposal empty."""


def _schema():
    return {
        "type": "object",
        "properties": {
            "answer": {"type": "string"},
            "has_proposal": {"type": "boolean"},
            "proposal": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["word", "expression"]},
                    "words": {"type": "array", "items": {
                        "type": "object",
                        "properties": {"hanzi": {"type": "string"}, "reading": {"type": "string"}},
                        "required": ["hanzi", "reading"],
                        "additionalProperties": False,
                    }},
                    "french": {"type": "string"},
                    "english": {"type": "string"},
                },
                "required": ["kind", "words", "french", "english"],
                "additionalProperties": False,
            },
        },
        "required": ["answer", "has_proposal", "proposal"],
        "additionalProperties": False,
    }


def _reading_notes(hanzi, reading, readings):
    """The characters of one word read otherwise than in the lexicon."""
    syllables = [f"{b}{t}" for b, t in pinyin_rules.syllables(reading)]
    chars = [c for c in _norm(hanzi) if c.strip()]
    if len(syllables) != len(chars):
        return [f"{hanzi} : {len(chars)} caractère(s) pour {len(syllables)} syllabe(s) ({reading})"] if reading else []
    out = []
    for char, syl in zip(chars, syllables):
        known = readings.get(char)
        if not known:
            out.append(f"{char} ({syl}) : caractère absent du lexique")
        elif syl not in known:
            out.append(f"{char} lu {syl}, le lexique a {', '.join(sorted(known))}")
    return out


def build_proposal(proposal, readings):
    """The AI's proposal as the lexicon stores an entry: {kind, hanzi
    (words separated by spaces), pinyin (Wenfa, one group per word),
    french, english, notes}. None when it has no characters."""
    words = [w for w in proposal.get("words") or [] if str(w.get("hanzi", "")).strip()]
    if not words:
        return None
    hanzi_parts, pinyin_parts, notes = [], [], []
    for w in words:
        hanzi = _norm("".join(str(w["hanzi"]).split()))
        reading, fixes = pinyin_rules.normalize("".join(str(w.get("reading", "")).split()).lower())
        hanzi_parts.append(hanzi)
        if reading:
            pinyin_parts.append(reading)
            notes.extend(_reading_notes(hanzi, reading, readings))
        if fixes:
            notes.append(pinyin_rules.normalize_note(fixes))
    kind = "word" if proposal.get("kind") == "word" and len(hanzi_parts) == 1 else "expression"
    pinyin = " ".join(pinyin_parts)
    notes.extend(pinyin_rules.violations(pinyin))
    return {"kind": kind, "hanzi": "".join(hanzi_parts) if kind == "word" else " ".join(hanzi_parts),
            "pinyin": pinyin.replace(" ", "") if kind == "word" else pinyin,
            "french": " ".join(str(proposal.get("french", "")).split())[:300],
            "english": " ".join(str(proposal.get("english", "")).split())[:300],
            "notes": list(dict.fromkeys(notes))}


def ask(entry, instruction):
    """(answer, proposal or None) for `entry` {kind, hanzi, pinyin, french, english, themes}."""
    hanzi = "".join(str(entry.get("hanzi", "")).split())
    words, expressions = related_entries(hanzi)
    message = {
        "request": instruction,
        "entry": {k: str(entry.get(k, "")) for k in ("kind", "hanzi", "pinyin", "french", "english", "themes")},
        "lexicon_words_sharing_its_characters": words,
        "lexicon_expressions_sharing_its_characters": expressions,
    }
    data = _call(SYSTEM, json.dumps(message, ensure_ascii=False), _schema(), max_tokens=3000)
    proposal = build_proposal(data.get("proposal") or {}, char_readings()) if data.get("has_proposal") else None
    return " ".join(str(data.get("answer", "")).split()), proposal


@require_POST
@editor_required
def api_ask(request):
    """POST {instruction, entry: {kind, hanzi, pinyin, french, english, themes}}
    -> {answer, proposal: {kind, hanzi, pinyin, french, english, notes} | null}."""
    if not is_editor(request.user):
        return JsonResponse({"error": "Connexion requise."}, status=403)
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Demande invalide."}, status=400)
    instruction = " ".join(str(payload.get("instruction", "")).split())[:MAX_INSTRUCTION]
    entry = payload.get("entry") if isinstance(payload.get("entry"), dict) else {}
    if not instruction:
        return JsonResponse({"error": "Écrivez votre demande à l'IA."}, status=400)
    if not str(entry.get("hanzi", "")).strip() and not str(entry.get("french", "")).strip():
        return JsonResponse({"error": "Tapez d'abord le mot ou l'expression."}, status=400)
    if _over_limit(request.user):
        return JsonResponse({"error": "Limite quotidienne de demandes à l'IA atteinte : réessayez demain."}, status=429)
    try:
        answer, proposal = ask(entry, instruction)
    except AssistantError as err:
        return _error(err)
    return JsonResponse({"ok": True, "answer": answer, "proposal": proposal})
