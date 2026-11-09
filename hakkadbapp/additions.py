"""The "Saisie" and "Validation" pages: editors type new words/expressions
(LexiconAddition) with the converter's hanzi suggestions on "Saisie" (where
the drafts stay), then move what was proposed through review ->
validated/rejected on "Validation". Kept out of views.py on purpose:
it's a self-contained feature with its own small JSON API."""
import json
import re

from django.contrib.auth.views import redirect_to_login
from django.db import transaction
from django.http import HttpResponseForbidden, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.gzip import gzip_page
from django.views.decorators.http import require_POST

from .ai import ai_enabled
from . import pinyin_rules
from .text_to_words import REVERSE_PUNCT_MAP, _PUNCT_ONLY_TOKEN_RE, normalize_punctuation
from .models import Expression, LexiconAddition, Word
from .permissions import AI_USERNAME, editor_required, is_editor, is_validator, status_change_refused

EDITABLE_FIELDS = ("hanzi", "pinyin", "french", "english", "themes", "observations", "source", "input_text")
KINDS = {k for k, _ in LexiconAddition.KIND_CHOICES}
STATUSES = {s for s, _ in LexiconAddition.STATUS_CHOICES}


def _deny(request):
    if not request.user.is_authenticated:
        return redirect_to_login(request.get_full_path())
    return HttpResponseForbidden("Votre compte ne permet pas la saisie.")


def _addition_json(a):
    return {
        "id": a.id,
        "kind": a.kind,
        "status": a.status,
        "hanzi": a.hanzi,
        "pinyin": a.pinyin,
        "french": a.french,
        "english": a.english,
        "themes": a.themes,
        "observations": a.observations,
        "source": a.source,
        "input_text": a.input_text,
        "platform_id": a.platform_id,
        "created_by": a.created_by.username if a.created_by else "",
        "by_ai": bool(a.created_by and a.created_by.username == AI_USERNAME),
        "ai_pending": a.ai_pending,
        "updated_by": a.updated_by.username if a.updated_by else "",
        "created_at": a.created_at.isoformat(),
        "updated_at": a.updated_at.isoformat(),
    }


def _known_themes():
    """Theme names already used in the lexicon, for the form's suggestions."""
    names = set()
    for model in (Word, Expression):
        for category in model.objects.exclude(category=None).values_list("category", flat=True).distinct():
            names.update(n.strip() for n in category.split(",") if n.strip())
    return sorted(names, key=str.lower)


# What an addition needs before it can be validated (« Validé »).
REQUIRED_FIELDS = (("hanzi", "caractères"), ("pinyin", "pinyin"), ("french", "français"), ("english", "anglais"))


def missing_fields(addition):
    """The labels of the required fields still empty (or a pinyin still
    unsure: « / » between readings, « ? » for an unknown one)."""
    out = [label for field, label in REQUIRED_FIELDS if not (getattr(addition, field) or "").strip()]
    # A «…» block is text: its « ? » is no unsure reading.
    if "pinyin" not in [f for f, _ in REQUIRED_FIELDS if not (getattr(addition, f) or "").strip()] \
            and re.search(r"[/?]", re.sub(r"«[^»]*»?", "", addition.pinyin)):
        out.append("pinyin sûr")
    return out


def incomplete_refused(addition, status):
    if status == LexiconAddition.STATUS_VALIDATED:
        missing = missing_fields(addition)
        if missing:
            return f"Incomplet, impossible de valider « {addition.hanzi} » : il manque {', '.join(missing)}."
    return None


def _apply_payload(addition, payload):
    """Copies the known fields from a JSON payload onto `addition`; returns
    an error message, or None when everything is valid."""
    if "kind" in payload:
        if payload["kind"] not in KINDS:
            return "Type invalide."
        addition.kind = payload["kind"]
    if "status" in payload:
        if payload["status"] not in STATUSES:
            return "Statut invalide."
        addition.status = payload["status"]
        addition.ai_pending = False
    for field in EDITABLE_FIELDS:
        if field in payload:
            value = payload[field]
            if not isinstance(value, str):
                return f"'{field}' doit être une chaîne."
            if field == "hanzi":
                # Punctuation in the characters: the Chinese mark (，。？), whatever was typed.
                value = normalize_punctuation(" ".join(value.split()))
            elif field == "pinyin":
                # ...and the Latin one (, . ?) in the pinyin, as on the platform.
                value = " ".join(tok.replace("…", "...").translate(REVERSE_PUNCT_MAP) if _PUNCT_ONLY_TOKEN_RE.match(tok) else tok
                                 for tok in value.split())
                # Always in Wenfa's pinyin: si1 -> xi1, sit7 -> xit5, zhug5 -> zhuk5 (pinyin_rules).
                value, _fixes = pinyin_rules.normalize(value)
            else:
                value = value.strip()
            setattr(addition, field, value)
    if addition.kind == LexiconAddition.KIND_WORD:
        # A word never contains a space (an expression has one per word).
        addition.hanzi = "".join(addition.hanzi.split())
        addition.pinyin = "".join(addition.pinyin.split())
    if not addition.hanzi:
        return "Les caractères sont obligatoires."
    if "/" in addition.pinyin:
        # A character read several ways (zung1/zhung1): its reading must be chosen.
        return "Choisissez une seule lecture pour chaque caractère (pas de « / » dans le pinyin)."
    return None


MAX_NEW_WORDS = 30


def _save_with_new_words(request, addition, payload):
    """Saves `addition` and, for an expression, the unknown words typed
    along with it (payload["new_words"]: [{hanzi, pinyin, french}]), as
    word additions with the same status -- all or nothing. Each word may
    carry its own english and themes (else the expression's themes).
    A word already proposed (same hanzi and pinyin, not rejected) is
    reused rather than added twice. Returns (words, error message)."""
    new_words = payload.get("new_words") or []
    if not isinstance(new_words, list) or len(new_words) > MAX_NEW_WORDS:
        return None, "Liste de mots à ajouter invalide."
    if new_words and addition.kind != LexiconAddition.KIND_EXPRESSION:
        return None, "Seule une expression peut ajouter des mots."
    prepared = []
    for item in new_words:
        if not isinstance(item, dict) or not all(isinstance(item.get(k, ""), str)
                                                 for k in ("hanzi", "pinyin", "french", "english", "themes")):
            return None, "Mot à ajouter mal formé."
        hanzi, pinyin = "".join(item.get("hanzi", "").split()), "".join(item.get("pinyin", "").split())
        if not hanzi:
            return None, "Un mot à ajouter n'a pas de caractères."
        prepared.append((hanzi, pinyin, item.get("french", "").strip(), item.get("english", "").strip(),
                         item.get("themes", "").strip()))

    words = []
    with transaction.atomic():
        addition.save()
        for hanzi, pinyin, french, english, themes in prepared:
            existing = (LexiconAddition.objects.filter(kind=LexiconAddition.KIND_WORD, hanzi=hanzi, pinyin=pinyin)
                        .exclude(status=LexiconAddition.STATUS_REJECTED).first())
            if existing:
                words.append(existing)
                continue
            words.append(LexiconAddition.objects.create(
                kind=LexiconAddition.KIND_WORD, status=addition.status, hanzi=hanzi, pinyin=pinyin, french=french,
                english=english[:300], themes=(themes or addition.themes)[:200],
                observations=f"Ajouté avec l'expression « {addition.hanzi} ».",
                created_by=request.user, updated_by=request.user,
            ))
    return words, None


def _read_json(request):
    try:
        return json.loads(request.body.decode("utf-8")), None
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, JsonResponse({"error": "JSON invalide."}, status=400)


def saisie(request):
    if not is_editor(request.user):
        return _deny(request)
    from .views import get_all_data  # same lexicon data as the converter page

    context = get_all_data()
    context.update({
        "title": "Saisie",
        "page": "saisie",
        "known_themes": _known_themes(),
        "status_labels": dict(LexiconAddition.STATUS_CHOICES),
        "ai_enabled": ai_enabled(),
    })
    return render(request, "hakkadbapp/saisie.html", context)


def validation(request):
    """What was proposed, to validate or reject (no lexicon data needed:
    editing goes back to the Saisie form)."""
    if not is_editor(request.user):
        return _deny(request)
    from .platform_corrections import open_count

    return render(request, "hakkadbapp/validation.html", {
        "title": "Suivi des ajouts",
        "page": "validation",
        "ereo_count": open_count(),
        # Drafts live on the Saisie page.
        "status_choices": [c for c in LexiconAddition.STATUS_CHOICES if c[0] != LexiconAddition.STATUS_DRAFT],
        "status_labels": dict(LexiconAddition.STATUS_CHOICES),
    })


@gzip_page
@editor_required
def lexicon_data(request):
    """The lexicon's readings and words (components/data.html), alone: the
    Suivi page loads them the first time a hakka is edited there, to read
    the Saisie text as the Saisie does (SaisieEntry)."""
    from django.db.models import Prefetch

    from .models import Pronunciation, WordPronunciation

    word_prons = WordPronunciation.objects.select_related("pronunciation__initial", "pronunciation__final",
                                                          "pronunciation__tone")
    response = render(request, "hakkadbapp/components/data.html", {
        "pronunciations": Pronunciation.objects.select_related("initial", "final", "tone").all(),
        "words": Word.objects.prefetch_related(Prefetch("wordpronunciation_set", queryset=word_prons)),
    })
    response["Cache-Control"] = "private, max-age=300"
    return response


def drafts(request):
    """« Brouillons » is now the first step of the Suivi page."""
    from django.shortcuts import redirect
    from django.urls import reverse

    return redirect(reverse("validation") + "?etape=brouillons")


def ai_suggestions(request):
    """The AI's suggestions: generated as its drafts, filtered and corrected
    here, then proposed to Validation (or set aside) by a person."""
    if not is_editor(request.user):
        return _deny(request)
    from .assistant import _themes

    return render(request, "hakkadbapp/ai_suggestions.html", {
        "title": "Suggestions IA", "page": "ai_suggestions", "ai_enabled": ai_enabled(), "themes": _themes(),
        "status_labels": dict(LexiconAddition.STATUS_CHOICES),
    })


def input_guide(request):
    """The input syntax, for members with little computer experience."""
    return render(request, "hakkadbapp/guide_saisie.html", {"title": "Guide de saisie", "page": "guide_saisie"})


def document_import(request):
    """Import words from a document (importer.py), on its own page of the
    members' area; what is proposed goes to Validation."""
    if not is_editor(request.user):
        return _deny(request)
    return render(request, "hakkadbapp/document_import.html", {"title": "Importer", "page": "document_import"})


@editor_required
def additions_api(request):
    """GET: every addition. POST: create one from a JSON payload."""
    if not is_editor(request.user):
        return JsonResponse({"error": "Connexion requise."}, status=403)

    if request.method == "POST":
        payload, error = _read_json(request)
        if error:
            return error
        addition = LexiconAddition(created_by=request.user, updated_by=request.user)
        message = _apply_payload(addition, payload)
        if message:
            return JsonResponse({"error": message}, status=400)
        message = status_change_refused(request.user, LexiconAddition.STATUS_DRAFT, addition.status)
        if message:
            return JsonResponse({"error": message}, status=403)
        words, message = _save_with_new_words(request, addition, payload)
        if message:
            return JsonResponse({"error": message}, status=400)
        return JsonResponse({"ok": True, "addition": _addition_json(addition),
                             "words": [_addition_json(w) for w in words]}, status=201)

    additions = LexiconAddition.objects.select_related("created_by", "updated_by")
    return JsonResponse({"additions": [_addition_json(a) for a in additions]})


@require_POST
@editor_required
def addition_update(request, addition_id):
    addition = get_object_or_404(LexiconAddition, id=addition_id)
    payload, error = _read_json(request)
    if error:
        return error
    old_status = addition.status
    message = _apply_payload(addition, payload)
    if message:
        return JsonResponse({"error": message}, status=400)
    message = status_change_refused(request.user, old_status, addition.status)
    if message:
        return JsonResponse({"error": message}, status=403)
    message = incomplete_refused(addition, addition.status) if addition.status != old_status else None
    if message:
        return JsonResponse({"error": message}, status=400)
    addition.updated_by = request.user
    words, message = _save_with_new_words(request, addition, payload)
    if message:
        return JsonResponse({"error": message}, status=400)
    return JsonResponse({"ok": True, "addition": _addition_json(addition),
                         "words": [_addition_json(w) for w in words]})


@require_POST
@editor_required
def addition_delete(request, addition_id):
    get_object_or_404(LexiconAddition, id=addition_id).delete()
    return JsonResponse({"ok": True})


MAX_BULK = 500


SYLLABLE_RE = re.compile(r"[^\s\d⁰¹²³⁴⁵⁶⁷⁸]+[\d⁰¹²³⁴⁵⁶⁷⁸]")
HAN_CHAR_RE = re.compile(r"[\u3400-\u9fff\U00020000-\U0002ffff]")


def toggle_kind(addition, known):
    """Word <-> expression, in place; returns an error message or None.
    An expression becomes one word (no spaces); a word becomes an expression
    split into the lexicon's words (`known`), its pinyin split the same way
    when it has one syllable per character. The text typed in the Saisie no
    longer applies."""
    from .importer import segment

    if addition.kind == LexiconAddition.KIND_EXPRESSION:
        joined = "".join(addition.hanzi.split())
        if not all(HAN_CHAR_RE.fullmatch(c) for c in joined):
            return f"« {addition.hanzi} » contient de la ponctuation ou d'autres signes : un mot ne peut pas en avoir."
        addition.kind = LexiconAddition.KIND_WORD
        addition.hanzi, addition.pinyin = joined, "".join(addition.pinyin.split())
    else:
        addition.kind = LexiconAddition.KIND_EXPRESSION
        hanzi = "".join(addition.hanzi.split())
        addition.hanzi = segment(hanzi, known)
        syllables = SYLLABLE_RE.findall(addition.pinyin)
        if len(syllables) == len(hanzi) and "".join(syllables) == "".join(addition.pinyin.split()):
            parts, at = [], 0
            for token in addition.hanzi.split():
                parts.append("".join(syllables[at:at + len(token)]))
                at += len(token)
            addition.pinyin = " ".join(parts)
    addition.input_text = ""
    return None


@require_POST
@editor_required
def additions_rename_source(request):
    """POST {old, new}: the source renamed on every addition that has it
    (and in the import notes that name it). A name already used merges."""
    payload, error = _read_json(request)
    if error:
        return error
    old = payload.get("old") if isinstance(payload, dict) else None
    new = payload.get("new") if isinstance(payload, dict) else None
    if not isinstance(old, str) or not isinstance(new, str) or not old.strip():
        return JsonResponse({"error": "Demande invalide."}, status=400)
    new = " ".join(new.split())[:200]
    if not new:
        return JsonResponse({"error": "Le nouveau nom est vide."}, status=400)
    additions = list(LexiconAddition.objects.filter(source=old).select_related("created_by", "updated_by"))
    if not additions:
        return JsonResponse({"error": "Cette source n'existe plus : rechargez la page."}, status=404)
    with transaction.atomic():
        for a in additions:
            a.source = new
            a.observations = a.observations.replace(f"source : {old}.", f"source : {new}.")
            a.updated_by = request.user
            a.save(update_fields=["source", "observations", "updated_by", "updated_at"])
    return JsonResponse({"ok": True, "additions": [_addition_json(a) for a in additions]})


# « Garder tel quel » in the « Lectures à vérifier » panel: the reading isn't reported again.
KEPT_READING = "Lecture gardée telle quelle après vérification : {}."


def pinyin_report(addition):
    """What « Vérifier le pinyin » says of one addition, without changing
    it: {id, hanzi, pinyin, proposed (Wenfa's pinyin where the rule leaves no
    doubt, '' if nothing to change), fixes, problems (of the reading as it
    is), proposed_problems (left after the proposal), kept}. A reading an
    editor chose to keep as it is counts as checked."""
    pinyin = addition.pinyin or ""
    fixed, fixes = pinyin_rules.normalize(pinyin)
    kept = bool(pinyin.strip()) and KEPT_READING.format(pinyin) in (addition.observations or "")
    return {"id": addition.id, "hanzi": addition.hanzi, "pinyin": pinyin, "kept": kept,
            "proposed": fixed if fixes and not kept else "", "fixes": [] if kept else fixes,
            "problems": [] if kept else (pinyin_rules.violations(pinyin) if pinyin.strip() else ["lecture vide"]),
            "proposed_problems": pinyin_rules.violations(fixed) if fixes and not kept else []}


def set_pinyin(addition, user, pinyin=None, keep=False):
    """An item of the « Lectures à vérifier » panel settled: `keep` the
    reading as it is (noted, never reported again), or the reading
    `pinyin` (set in Wenfa's pinyin, the change noted in the observations)."""
    old = addition.pinyin or ""
    if keep:
        note = KEPT_READING.format(old)
    else:
        new, _fixes = pinyin_rules.normalize(" ".join(str(pinyin or "").split()))
        if addition.kind == LexiconAddition.KIND_WORD:
            new = "".join(new.split())
        if new == old:
            return addition
        addition.pinyin = new
        note = f"Lecture corrigée après vérification : {old or '(vide)'} → {new}."
    addition.observations = f"{(addition.observations or '').strip()} {note}".strip()
    addition.updated_by = user
    addition.save(update_fields=["pinyin", "observations", "updated_by", "updated_at"])
    return addition


@require_POST
@editor_required
def additions_bulk(request):
    """The rows ticked on the Validation page, all or nothing:
    {"ids": [...], "status": "validated"} changes their status,
    {"ids": [...], "action": "delete"} deletes them,
    {"ids": [...], "action": "toggle-kind"} turns words into expressions and back,
    {"ids": [...], "action": "check-pinyin"} sets their readings in Wenfa's
    pinyin where the rule leaves no doubt and reports the rest."""
    payload, error = _read_json(request)
    if error:
        return error
    ids = payload.get("ids") if isinstance(payload, dict) else None
    if (not isinstance(ids, list) or not ids or len(ids) > MAX_BULK
            or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids)):
        return JsonResponse({"error": "Sélection invalide."}, status=400)
    additions = list(LexiconAddition.objects.filter(id__in=ids).select_related("created_by", "updated_by"))
    if len(additions) != len(set(ids)):
        return JsonResponse({"error": "Certains ajouts n'existent plus : rechargez la page."}, status=404)

    if payload.get("action") == "delete":
        with transaction.atomic():
            LexiconAddition.objects.filter(id__in=ids).delete()
        return JsonResponse({"ok": True, "deleted": sorted(set(ids))})

    if payload.get("action") == "check-pinyin":
        # A report only: nothing changes until an editor settles each item.
        report = [r for r in map(pinyin_report, additions)]
        return JsonResponse({"ok": True, "report": report})

    if payload.get("action") in ("set-pinyin", "apply-pinyin"):
        # « Lectures à vérifier »: one reading corrected or kept as it is
        # ({ids: [id], pinyin} / {ids: [id], keep: true}), or the proposals
        # of these additions applied ({ids}). A decided addition only by a validator.
        decided = (LexiconAddition.STATUS_VALIDATED, LexiconAddition.STATUS_REJECTED)
        if not is_validator(request.user) and any(a.status in decided for a in additions):
            return JsonResponse({"error": "Seuls les validateurs peuvent modifier un ajout validé ou rejeté."}, status=403)
        if payload["action"] == "set-pinyin":
            if len(additions) != 1 or not (payload.get("keep") is True or isinstance(payload.get("pinyin"), str)):
                return JsonResponse({"error": "Demande invalide."}, status=400)
        with transaction.atomic():
            for a in additions:
                if payload["action"] == "apply-pinyin":
                    proposed = pinyin_report(a)["proposed"]
                    if proposed:
                        set_pinyin(a, request.user, proposed)
                else:
                    set_pinyin(a, request.user, payload.get("pinyin"), keep=payload.get("keep") is True)
        return JsonResponse({"ok": True, "additions": [_addition_json(a) for a in additions],
                             "report": [pinyin_report(a) for a in additions]})

    if payload.get("action") == "toggle-kind":
        from .assistant import known_words

        decided = (LexiconAddition.STATUS_VALIDATED, LexiconAddition.STATUS_REJECTED)
        if not is_validator(request.user) and any(a.status in decided for a in additions):
            return JsonResponse({"error": "Seuls les validateurs peuvent modifier un ajout validé ou rejeté."}, status=403)
        known = known_words(include_additions=False)
        with transaction.atomic():
            for addition in additions:
                message = toggle_kind(addition, known)
                if message:
                    transaction.set_rollback(True)
                    return JsonResponse({"error": message}, status=400)
                addition.updated_by = request.user
                addition.save(update_fields=["kind", "hanzi", "pinyin", "input_text", "updated_by", "updated_at"])
        return JsonResponse({"ok": True, "additions": [_addition_json(a) for a in additions]})

    status = payload.get("status")
    if status not in STATUSES:
        return JsonResponse({"error": "Statut invalide."}, status=400)
    refused = next((m for m in (status_change_refused(request.user, a.status, status) for a in additions) if m), None)
    if refused:
        return JsonResponse({"error": refused}, status=403)
    incomplete = [a for a in additions if incomplete_refused(a, status)]
    if incomplete:
        names = ", ".join(f"{a.hanzi} ({', '.join(missing_fields(a))})" for a in incomplete[:5])
        return JsonResponse({"error": f"Incomplet, impossible de valider : {names}{'…' if len(incomplete) > 5 else ''}."}, status=400)
    with transaction.atomic():
        for addition in additions:
            addition.status = status
            addition.ai_pending = False      # sorted by a person (« Suggestions IA » → Brouillons)
            addition.updated_by = request.user
            addition.save(update_fields=["status", "ai_pending", "updated_by", "updated_at"])
    return JsonResponse({"ok": True, "additions": [_addition_json(a) for a in additions]})
