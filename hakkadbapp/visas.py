"""Visas: each member's opinion on an addition or on a character's reading
(models.Visa), and the validators' decisions on readings
(models.ReadingDecision). The Suivi page shows them next to each addition
and in the « Caractères » step (char_review.js, AdditionList.js); deciding
an addition is still its status (validated / rejected), by a validator."""
import json
import re

from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .models import LexiconAddition, ReadingDecision, Visa
from .permissions import editor_required, is_editor, is_validator

READING_KEY = re.compile(r"^.{1,2}\|[a-zü]{1,10}[0-9_]?$")


def _user(u):
    return (u.get_short_name() or u.username) if u else ""


def visa_json(v):
    return {"target_type": v.target_type, "target_key": v.target_key, "user": v.user.username,
            "name": _user(v.user), "opinion": v.opinion, "comment": v.comment, "updated_at": v.updated_at.isoformat()}


def decision_json(d):
    return {"char": d.char, "reading": d.reading, "status": d.status,
            "by": _user(d.decided_by), "at": d.decided_at.isoformat()}


def _read(request):
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


@editor_required
def api_visas(request):
    """GET: every visa and every reading decision, and who is asking."""
    if not is_editor(request.user):
        return JsonResponse({"error": "Réservé aux éditeurs."}, status=403)
    return JsonResponse({
        "visas": [visa_json(v) for v in Visa.objects.select_related("user")],
        "decisions": [decision_json(d) for d in ReadingDecision.objects.select_related("decided_by")],
        "me": request.user.username, "can_decide": is_validator(request.user),
    })


@require_POST
@editor_required
def api_visa(request):
    """{target_type, target_key, opinion: "ok" | "ko" | "" (withdrawn), comment}."""
    payload = _read(request)
    if payload is None:
        return JsonResponse({"error": "JSON invalide."}, status=400)
    target_type, key = payload.get("target_type"), str(payload.get("target_key") or "")
    opinion, comment = payload.get("opinion") or "", payload.get("comment") or ""
    if target_type == Visa.TARGET_ADDITION:
        addition = LexiconAddition.objects.filter(id=int(key)).first() if key.isdigit() else None
        if not addition:
            return JsonResponse({"error": "Cet ajout n'existe plus : rechargez la page."}, status=404)
        # A visa is the opinion of the other members: not on one's own addition (withdrawing stays possible).
        if opinion and addition.created_by_id == request.user.id:
            return JsonResponse({"error": "C'est votre ajout : le visa est donné par les autres membres."}, status=403)
    elif target_type != Visa.TARGET_READING or not READING_KEY.match(key):
        return JsonResponse({"error": "Visa invalide."}, status=400)
    if opinion not in ("", Visa.OPINION_OK, Visa.OPINION_KO) or not isinstance(comment, str):
        return JsonResponse({"error": "Avis invalide."}, status=400)
    if not opinion:
        Visa.objects.filter(target_type=target_type, target_key=key, user=request.user).delete()
        return JsonResponse({"ok": True, "visa": None})
    visa, _ = Visa.objects.update_or_create(target_type=target_type, target_key=key, user=request.user,
                                            defaults={"opinion": opinion, "comment": comment.strip()[:500]})
    return JsonResponse({"ok": True, "visa": visa_json(visa)})


@require_POST
@editor_required
def api_reading_decision(request):
    """A validator accepts or refuses a reading: {char, reading, status:
    "accepted" | "refused" | "" (undecided again)}."""
    if not is_validator(request.user):
        return JsonResponse({"error": "Seuls les validateurs (groupe « Validateurs ») tranchent une lecture."}, status=403)
    payload = _read(request)
    if payload is None:
        return JsonResponse({"error": "JSON invalide."}, status=400)
    char, reading, status = str(payload.get("char") or ""), str(payload.get("reading") or ""), payload.get("status") or ""
    if not READING_KEY.match(f"{char}|{reading}") or status not in ("", *dict(ReadingDecision.STATUS_CHOICES)):
        return JsonResponse({"error": "Décision invalide."}, status=400)
    if not status:
        ReadingDecision.objects.filter(char=char, reading=reading).delete()
        return JsonResponse({"ok": True, "decision": None})
    decision, _ = ReadingDecision.objects.update_or_create(char=char, reading=reading,
                                                           defaults={"status": status, "decided_by": request.user})
    return JsonResponse({"ok": True, "decision": decision_json(decision)})
