"""« Corrections e-reo »: what must be fixed by hand on the e-reo platform,
for entries already in the lexicon (imported from the platform): the open
remarks on lexicon words and expressions (ReviewComment, by the AI or an
editor) -- corrections (one field, current -> proposed value) and comments
(a point to check or make precise).

Each item says where (the entry's platform id and its « target » line, as
on the platform), what (the platform field: primary = French, secondary =
English) and the platform's value at the last import (Traces.platform_data),
so a person -- or an AI agent reading the JSON -- can do it. Marked « Fait »
on the site once done there (assistant.api_comment_action "done").

Shown as the last step of the Suivi page (after « Validés »): its own steps
En attente (open) -> À faire (todo) -> Fait (applied), or Rejetée (dismissed)."""
import time

from django.contrib.auth.views import redirect_to_login
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse

from .ai import ai_enabled
from .models import AITarget, Expression, ReviewComment, Traces, Word
from .permissions import is_editor

# The lexicon's fields, as named on the platform (translations.<name>).
PLATFORM_FIELDS = {"french": ("primary", "Français (primary)"), "english": ("secondary", "Anglais (secondary)")}
_cache = {}


def _platform_snapshot():
    """{"words": {...}, "expressions": {...}, "date": ...} from the last
    platform import, kept 10 minutes per server instance."""
    stamp, data = _cache.get("snapshot", (0, None))
    if data is None or time.time() - stamp > 600:
        trace = Traces.objects.exclude(platform_data=None).order_by("-id").only("platform_data", "timestamp").first()
        pd = (trace.platform_data or {}) if trace else {}
        data = {"words": pd.get("words", {}), "expressions": pd.get("expressions", {}),
                "date": trace.timestamp.isoformat() if trace else None}
        _cache["snapshot"] = (time.time(), data)
    return data


# The steps of a remark, as shown on the page and in the JSON (?statut=).
STEPS = {ReviewComment.STATUS_OPEN: "attente", ReviewComment.STATUS_TODO: "todo",
         ReviewComment.STATUS_APPLIED: "fait", ReviewComment.STATUS_DISMISSED: "rejete"}


def corrections(steps=None):
    """The remarks on lexicon entries (all steps, or `steps`), oldest first."""
    snap = _platform_snapshot()
    statuses = [s for s, step in STEPS.items() if not steps or step in steps]
    remarks = list(ReviewComment.objects.filter(
        target_type__in=[ReviewComment.TARGET_WORD, ReviewComment.TARGET_EXPRESSION],
        status__in=statuses).select_related("author").order_by("created_at"))
    ids = {t: [r.target_id for r in remarks if r.target_type == t] for t in ("word", "expression")}
    platform_ids = {"word": dict(Word.objects.filter(id__in=ids["word"]).values_list("id", "platform_id")),
                    "expression": dict(Expression.objects.filter(id__in=ids["expression"]).values_list("id", "platform_id"))}
    muted = set(AITarget.objects.filter(muted=True, target_type__in=["word", "expression"]).values_list("target_type", "target_id"))
    out = []
    for r in remarks:
        pid = platform_ids[r.target_type].get(r.target_id)
        payload = snap["words" if r.target_type == "word" else "expressions"].get(pid or "", {})
        tr = payload.get("translations") or {}
        item = {
            "id": r.id,
            "status": STEPS[r.status],
            "target_type": r.target_type, "target_id": r.target_id,
            "muted": (r.target_type, r.target_id) in muted,
            "entry_type": "mot" if r.target_type == "word" else "expression",
            "platform_id": pid or "",
            "target": tr.get("target", ""),
            "label": r.target_label,
            "kind": "correction" if r.kind == ReviewComment.KIND_CORRECTION else "précision",
            "explanation": r.text,
            "author": "IA" if r.author and r.author.username == "ia" else (r.author.username if r.author else ""),
            "created_at": r.created_at.isoformat(),
        }
        if r.kind == ReviewComment.KIND_CORRECTION:
            field, label = PLATFORM_FIELDS.get(r.field, (r.field, r.field))
            on_platform = tr.get(field, r.current_value) if tr else r.current_value
            item.update({
                "platform_field": field, "field_label": label,
                "current_value": on_platform, "proposed_value": r.proposed_value,
                # The last import already carries the proposed value: probably done.
                "seems_done": bool(tr) and (on_platform or "").strip() == r.proposed_value.strip(),
            })
            item["instruction"] = (f"Sur e-reo, ouvrir {item['entry_type']} « {item['target'] or r.target_label} »"
                                   f"{f' (id {pid})' if pid else ''} ; champ {label} : remplacer « {on_platform} » "
                                   f"par « {r.proposed_value} ».")
        else:
            item["instruction"] = (f"Sur e-reo, vérifier {item['entry_type']} « {item['target'] or r.target_label} »"
                                   f"{f' (id {pid})' if pid else ''} : {r.text}")
        out.append(item)
    return out, snap["date"]


def open_count():
    """The remarks still to deal with (en attente + à faire), for the Suivi step."""
    return ReviewComment.objects.filter(target_type__in=[ReviewComment.TARGET_WORD, ReviewComment.TARGET_EXPRESSION],
                                        status__in=ReviewComment.PENDING).count()


def page(request):
    """The step « Corrections e-reo » of the Suivi page: ?fragment=1 is the
    panel loaded into it; the old address opens that step."""
    if not request.user.is_authenticated:
        return redirect_to_login(request.get_full_path())
    if request.GET.get("fragment") != "1":
        statut = request.GET.get("statut")
        return redirect(reverse("validation") + "?etape=ereo" + (f"&statut={statut}" if statut in STEPS.values() else ""))
    if not is_editor(request.user):
        return JsonResponse({"error": "Connexion requise."}, status=403)
    items, snapshot_date = corrections()
    counts = {step: sum(1 for i in items if i["status"] == step) for step in STEPS.values()}
    start = request.GET.get("statut")
    if start not in counts:
        start = "attente" if counts["attente"] else "todo"
    return render(request, "hakkadbapp/components/ereo_panel.html", {
        "items": items, "snapshot_date": snapshot_date, "counts": counts, "start": start, "ai_enabled": ai_enabled(),
    })


def api(request):
    """GET: the same list as JSON, for an agent working on the platform:
    by default the « À faire » items (?statut=todo, or attente, fait, rejete,
    tous). Each item: id, status, entry_type, platform_id, target, kind
    (correction | précision), platform_field, current_value, proposed_value,
    explanation, instruction, seems_done. Once done: POST
    /api/commentaires/<id> {"action": "done"}."""
    if not is_editor(request.user):
        return JsonResponse({"error": "Connexion requise."}, status=403)
    wanted = request.GET.get("statut", "todo")
    steps = None if wanted == "tous" else [s for s in wanted.split(",") if s in STEPS.values()] or ["todo"]
    items, snapshot_date = corrections(steps)
    return JsonResponse({
        "about": "Corrections à faire à la main sur la plateforme e-reo, pour des entrées déjà dans le lexique. "
                 "Statuts : attente (à examiner), todo (approuvée, à faire sur e-reo), fait, rejete. "
                 "Une fois faite sur e-reo : POST /api/commentaires/<id> {\"action\": \"done\"}. "
                 "Autres actions : \"todo\", \"wait\" (remettre en attente), \"dismiss\" (rejeter).",
        "statut": steps or "tous", "platform_snapshot": snapshot_date, "count": len(items), "items": items,
    }, json_dumps_params={"ensure_ascii": False, "indent": 1})
