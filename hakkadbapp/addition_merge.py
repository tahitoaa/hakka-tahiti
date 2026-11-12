"""« ⇄ Fusionner » in the list of possible duplicates (addition_duplicates.js).

Addition + addition: the other addition is folded into this one, then
deleted. This one keeps its characters, pinyin, kind and status; what the
other brings is added: French / English senses it does not have yet, themes,
sources, observations; its characters or pinyin, when they differ, are kept
in the observations (nothing is lost). Its remarks move to this one; its
visas go (they judged another content).

Addition + lexicon word / expression: the lexicon is edited on e-reo only,
so what the addition brings becomes « Corrections e-reo » on that entry
(ReviewComment, platform_corrections.py): a correction per translation
field gaining senses (current -> merged value), and a remark for the rest
(other pinyin, characters, themes, observations). « À faire » when a
validator merges, « En attente » otherwise. Then the addition is deleted.
Nothing new at all: no remark, the addition is just deleted."""
import json
import re

from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_POST

from .addition_duplicates import EN_ARTICLES, FR_ARTICLES, hanzi_key, pinyin_key, senses
from .additions import _addition_json
from .models import Expression, LexiconAddition, ReviewComment, Visa, Word
from .permissions import editor_required, is_validator
from .text_to_words import split_rendering


def merge_senses(base, extra, articles):
    """« maison » + « foyer, la maison » -> « maison, foyer »: the parts of
    `extra` whose sense `base` lacks, appended."""
    base, extra = (base or "").strip(), (extra or "").strip()
    known = senses(base, articles)
    added = []
    for part in re.split(r"\s*[,;]\s*", extra):
        s = senses(part, articles)
        if part and s and not s <= known:
            added.append(part.strip())
            known |= s
    return ", ".join([base] + added) if base and added else base or ", ".join(added)


def merge_list(base, extra):
    """Comma-separated, without repeats (themes, sources)."""
    out = []
    for part in (base or "").split(",") + (extra or "").split(","):
        if part.strip() and part.strip().lower() not in (p.lower() for p in out):
            out.append(part.strip())
    return ", ".join(out)


def _label(hanzi, pinyin, french):
    return " · ".join(x for x in (hanzi, pinyin, french) if x)


def merge_additions(keep, other):
    """Folds `other` into `keep` (not saved); returns the fields changed."""
    before = {f: getattr(keep, f) for f in ("hanzi", "pinyin", "french", "english", "themes", "source", "observations", "input_text")}
    keep.french = merge_senses(keep.french, other.french, FR_ARTICLES)
    keep.english = merge_senses(keep.english, other.english, EN_ARTICLES)
    keep.themes = merge_list(keep.themes, other.themes)[:200]
    keep.source = merge_list(keep.source, other.source)[:200]
    notes = []
    if not keep.hanzi.strip():
        keep.hanzi = other.hanzi
    elif hanzi_key(other.hanzi) and hanzi_key(other.hanzi) != hanzi_key(keep.hanzi):
        notes.append(f"autres caractères : {other.hanzi}")
    if not keep.pinyin.strip():
        keep.pinyin = other.pinyin
    elif pinyin_key(other.pinyin)[0] and pinyin_key(other.pinyin)[0] != pinyin_key(keep.pinyin)[0]:
        notes.append(f"autre pinyin : {other.pinyin}")
    keep.input_text = keep.input_text or other.input_text
    merged = f"Fusionné avec l'ajout « {_label(other.hanzi, other.pinyin, other.french)} »" + (f" ({' ; '.join(notes)})" if notes else "")
    keep.observations = " — ".join(x for x in (keep.observations.strip(), other.observations.strip(), merged) if x)
    return [f for f, v in before.items() if getattr(keep, f) != v]


def lexicon_entry(kind, entry_id):
    """{hanzi, pinyin, french, english, themes, label} of a lexicon word or expression, or None."""
    if kind == "word":
        w = Word.objects.filter(id=entry_id).first()
        if not w:
            return None
        e = {"hanzi": w.char(), "pinyin": w.pinyin(), "french": w.french or "", "english": w.english or "", "themes": w.category or ""}
    else:
        x = Expression.objects.filter(id=entry_id).first()
        if not x:
            return None
        pinyin, hanzi = split_rendering(x.rendering or "")
        e = {"hanzi": hanzi or x.text or "", "pinyin": pinyin, "french": x.french or "", "english": x.english or "", "themes": x.category or ""}
    e["label"] = _label(e["hanzi"], "", e["french"])[:300]
    return e


def lexicon_remarks(addition, entry):
    """What `addition` brings to the lexicon `entry`: [{kind, field,
    current_value, proposed_value, text}] -- empty when nothing."""
    out = []
    origin = f"Fusion de l'ajout « {_label(addition.hanzi, addition.pinyin, addition.french)} »"
    for field, articles, name in (("french", FR_ARTICLES, "français"), ("english", EN_ARTICLES, "anglais")):
        merged = merge_senses(entry[field], getattr(addition, field), articles)
        if merged != entry[field].strip():
            out.append({"kind": ReviewComment.KIND_CORRECTION, "field": field, "current_value": entry[field],
                        "proposed_value": merged, "text": f"{origin} : ajouter le sens {name} manquant."})
    points = []
    if hanzi_key(addition.hanzi) and hanzi_key(addition.hanzi) != hanzi_key(entry["hanzi"]):
        points.append(f"autre graphie proposée : {addition.hanzi}")
    if pinyin_key(addition.pinyin)[0] and pinyin_key(addition.pinyin)[0] != pinyin_key(entry["pinyin"])[0]:
        points.append(f"autre pinyin proposé : {addition.pinyin} (lexique : {entry['pinyin'] or '—'})")
    themes = merge_list(entry["themes"], addition.themes)
    if themes != merge_list(entry["themes"], ""):
        points.append(f"thèmes : {themes}")
    if addition.observations.strip():
        points.append(f"observations : {addition.observations.strip()}")
    if addition.source.strip():
        points.append(f"source : {addition.source.strip()}")
    if points:
        out.append({"kind": ReviewComment.KIND_COMMENT, "field": "", "current_value": "", "proposed_value": "",
                    "text": f"{origin} — à vérifier / reporter : " + " ; ".join(points) + "."})
    return out


def _forget(addition_id):
    Visa.objects.filter(target_type=Visa.TARGET_ADDITION, target_key=str(addition_id)).delete()


@require_POST
@editor_required
def api_merge(request, addition_id):
    """POST {type: "addition" | "word" | "expression", id}: merges that item
    and this addition (see the module). Returns {ok, addition?, removed, remarks, message}."""
    addition = get_object_or_404(LexiconAddition, id=addition_id)
    try:
        payload = json.loads(request.body.decode("utf-8"))
        kind, other_id = payload.get("type"), int(payload.get("id"))
    except (ValueError, TypeError, UnicodeDecodeError, AttributeError):
        return JsonResponse({"error": "Requête invalide."}, status=400)

    if kind == "addition":
        if other_id == addition.id:
            return JsonResponse({"error": "Un ajout ne se fusionne pas avec lui-même."}, status=400)
        other = LexiconAddition.objects.filter(id=other_id).first()
        if not other:
            return JsonResponse({"error": "L'autre ajout n'existe plus : rechargez la page."}, status=404)
        with transaction.atomic():
            changed = merge_additions(addition, other)
            addition.updated_by = request.user
            addition.save()
            ReviewComment.objects.filter(target_type=ReviewComment.TARGET_ADDITION, target_id=other.id).update(target_id=addition.id)
            other.delete()
            _forget(other_id)
        return JsonResponse({"ok": True, "addition": _addition_json(addition), "removed": other_id, "remarks": 0,
                             "message": f"Fusionné ({', '.join(changed) or 'rien de nouveau'}) ; l'autre ajout est supprimé."})

    if kind not in ("word", "expression"):
        return JsonResponse({"error": "Type invalide."}, status=400)
    entry = lexicon_entry(kind, other_id)
    if not entry:
        return JsonResponse({"error": "Cette entrée du lexique n'existe plus."}, status=404)
    remarks = lexicon_remarks(addition, entry)
    status = ReviewComment.STATUS_TODO if is_validator(request.user) else ReviewComment.STATUS_OPEN
    target_type = ReviewComment.TARGET_WORD if kind == "word" else ReviewComment.TARGET_EXPRESSION
    with transaction.atomic():
        for r in remarks:
            ReviewComment.objects.create(target_type=target_type, target_id=other_id, target_label=entry["label"],
                                         author=request.user, status=status, **r)
        ReviewComment.objects.filter(target_type=ReviewComment.TARGET_ADDITION, target_id=addition.id).delete()
        addition.delete()
        _forget(addition_id)
    step = "« À faire »" if status == ReviewComment.STATUS_TODO else "« En attente »"
    message = (f"{len(remarks)} correction{'s' if len(remarks) > 1 else ''} e-reo créée{'s' if len(remarks) > 1 else ''} ({step}) ; l'ajout est supprimé."
               if remarks else "Rien de nouveau par rapport au lexique : l'ajout est simplement supprimé.")
    return JsonResponse({"ok": True, "addition": None, "removed": addition_id, "remarks": len(remarks), "message": message})
