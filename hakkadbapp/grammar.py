"""« Grammaire » : les règles en arbre, illustrées par les phrases du site.

Une règle (GrammarRule) est un nœud : chapitre, règle, règle plus fine…
Ses exemples (GrammarExample) sont des liens vers des phrases existantes :
les expressions du lexique, les ajouts, les segments des transcriptions
publiées. Rien n'est recopié : un exemple montre toujours la phrase telle
qu'elle est aujourd'hui (et son texte du jour du lien si elle a disparu).

Privé pour l'instant : le propriétaire du site seulement (owner_required).

    GET  /grammaire/                    la page (grammar.html)
    GET  /api/grammaire                 {rules: [...]} avec les exemples
    POST /api/grammaire/regle           {action: create|update|delete|move, ...}
    POST /api/grammaire/exemple         {action: add|update|remove, ...}
    GET  /api/grammaire/phrases?q=      les phrases qui contiennent q (sans IA),
                                        ?libres=1 : seulement celles d'aucune règle
"""
import json
import uuid
from collections import defaultdict
from urllib.parse import quote

from django.db import transaction
from django.db.models import Max
from django.http import JsonResponse
from django.shortcuts import render
from django.urls import reverse
from django.views.decorators.http import require_GET, require_POST

from .models import Expression, GrammarExample, GrammarRule, LexiconAddition, SentenceAnalysis, SharedTranscript
from .permissions import owner_required
from . import grammar_analysis, search_sources

LIMIT = 60
FIELDS = {"title": 200, "pattern": 300, "explanation": 20000, "learner_text": 20000, "post_text": 5000}
TEXTS = {"explanation", "learner_text", "post_text"}   # kept as typed, line breaks included


def _read(request):
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _bad(message, status=400):
    return JsonResponse({"error": message}, status=status)


# ---- Les phrases : expressions, ajouts, segments -------------------------------------------------

def _segment_key(transcript_id, start):
    return f"{transcript_id}@{int(start)}"


def sentences(only=None):
    """Toutes les phrases que l'on peut citer : [{target_type, target_key,
    hanzi, pinyin, french, detail, link}]. `only` : {target_type: {keys}}
    pour ne lire que celles-là (les exemples à afficher)."""
    out = []
    want = (lambda t, k: k in only.get(t, ())) if only is not None else (lambda t, k: True)

    if only is None or only.get(GrammarExample.TARGET_EXPRESSION):
        for e in search_sources.lexicon()["expressions"]:
            key = e.get("platform_id") or ""
            if key and want(GrammarExample.TARGET_EXPRESSION, key):
                out.append({"target_type": GrammarExample.TARGET_EXPRESSION, "target_key": key, "hanzi": e["hanzi"],
                            "pinyin": e["pinyin"], "french": e["french"], "detail": "Expression du lexique",
                            "spaced": e.get("spaced", ""),
                            "link": f"{reverse('rechercher')}?q={quote(e['hanzi'])}"})

    if only is None or only.get(GrammarExample.TARGET_ADDITION):
        labels = dict(LexiconAddition.STATUS_CHOICES)
        additions = LexiconAddition.objects.exclude(status=LexiconAddition.STATUS_REJECTED).exclude(ai_pending=True)
        if only is None:
            additions = additions.filter(kind=LexiconAddition.KIND_EXPRESSION)
        else:
            additions = additions.filter(id__in=[int(k) for k in only[GrammarExample.TARGET_ADDITION] if k.isdigit()])
        for a in additions.only("id", "kind", "status", "hanzi", "pinyin", "french"):
            out.append({"target_type": GrammarExample.TARGET_ADDITION, "target_key": str(a.id),
                        "hanzi": a.hanzi.replace(" ", "") if a.kind == LexiconAddition.KIND_EXPRESSION else a.hanzi,
                        "pinyin": a.pinyin, "french": a.french, "detail": f"Ajout · {labels.get(a.status, a.status)}",
                        "spaced": a.hanzi,
                        "link": f"{reverse('saisie')}?modifier={a.id}"})

    if only is None or only.get(GrammarExample.TARGET_SEGMENT):
        transcripts = SharedTranscript.objects.only("id", "title", "data")
        if only is not None:
            ids = set()
            for k in only[GrammarExample.TARGET_SEGMENT]:
                try:
                    ids.add(uuid.UUID(k.split("@", 1)[0]))
                except ValueError:
                    pass
            transcripts = transcripts.filter(id__in=ids)
        for t in transcripts:
            people = (t.data or {}).get("participants") or []
            for i, s in enumerate((t.data or {}).get("segments") or []):
                if not isinstance(s.get("start"), (int, float)):
                    continue
                key = _segment_key(t.id, s["start"])
                if not want(GrammarExample.TARGET_SEGMENT, key):
                    continue
                speaker = s.get("speaker")
                who = people[speaker]["name"] if isinstance(speaker, int) and 0 <= speaker < len(people) else ""
                out.append({"target_type": GrammarExample.TARGET_SEGMENT, "target_key": key,
                            "hanzi": search_sources._segment_hanzi(s) or s.get("transcript", ""),
                            "pinyin": s.get("pinyin") or "", "french": s.get("translation") or "",
                            "detail": " · ".join(x for x in (t.title, who) if x),
                            "link": f"{reverse('transcription_listen', args=[t.id])}?seg={i + 1}"})
    return out


def _label(s):
    return " · ".join(x for x in (s["hanzi"], s["pinyin"], s["french"]) if x)[:400]


# ---- L'arbre ------------------------------------------------------------------------------------

def _example_json(example, found, analysis=None, parts=None, tags=None):
    s = found.get((example.target_type, example.target_key))
    return {"analysis": grammar_analysis.analysis_json(analysis, s) if analysis else None,
            "conforms": grammar_analysis.conformity(parts, analysis, tags) if parts else None,
            "id": example.id, "target_type": example.target_type, "target_key": example.target_key,
            "focus": example.focus, "note": example.note, "missing": s is None,
            "hanzi": s["hanzi"] if s else "", "pinyin": s["pinyin"] if s else "", "french": s["french"] if s else "",
            "detail": s["detail"] if s else "Phrase introuvable (supprimée ou modifiée)", "link": s["link"] if s else "",
            "label": example.label}


def tree():
    rules = list(GrammarRule.objects.all())
    examples = list(GrammarExample.objects.all())
    tags = grammar_analysis.Tags()
    analyses = {(a.target_type, a.target_key): a for a in SentenceAnalysis.objects.filter(
        target_key__in={e.target_key for e in examples})} if examples else {}
    patterns = {r.id: grammar_analysis.parse_pattern(r.pattern, tags) for r in rules}
    only = defaultdict(set)
    for e in examples:
        only[e.target_type].add(e.target_key)
    found = {(s["target_type"], s["target_key"]): s for s in sentences(dict(only))} if examples else {}
    by_rule = defaultdict(list)
    for e in examples:
        by_rule[e.rule_id].append(_example_json(e, found, analyses.get((e.target_type, e.target_key)),
                                                patterns.get(e.rule_id), tags))
    return [{"id": r.id, "parent": r.parent_id, "position": r.position, "title": r.title, "pattern": r.pattern,
             "explanation": r.explanation, "status": r.status, "updated_at": r.updated_at.isoformat(),
             "learner_text": r.learner_text, "post_text": r.post_text,
             "pattern_parts": patterns[r.id],
             "examples": by_rule.get(r.id, [])} for r in rules]


def _siblings(parent_id):
    return list(GrammarRule.objects.filter(parent_id=parent_id).order_by("position", "id"))


def _renumber(rules):
    for n, r in enumerate(rules):
        if r.position != n:
            r.position = n
            r.save(update_fields=["position"])


def _descendant_ids(rule):
    ids, todo = set(), [rule.id]
    children = defaultdict(list)
    for rid, pid in GrammarRule.objects.values_list("id", "parent_id"):
        children[pid].append(rid)
    while todo:
        for c in children[todo.pop()]:
            if c not in ids:
                ids.add(c)
                todo.append(c)
    return ids


def _move(rule, direction):
    """up / down parmi ses sœurs ; indent : sous la sœur d'avant ; outdent : après son parent."""
    siblings = _siblings(rule.parent_id)
    at = next(i for i, r in enumerate(siblings) if r.id == rule.id)
    if direction in ("up", "down"):
        to = at - 1 if direction == "up" else at + 1
        if 0 <= to < len(siblings):
            siblings[at], siblings[to] = siblings[to], siblings[at]
        _renumber(siblings)
    elif direction == "indent":
        if at == 0:
            return "Pas de règle au-dessus sous laquelle la ranger."
        new_parent = siblings[at - 1]
        rule.parent = new_parent
        rule.position = len(_siblings(new_parent.id))
        rule.save(update_fields=["parent", "position"])
        _renumber([r for r in siblings if r.id != rule.id])
    elif direction == "outdent":
        if rule.parent_id is None:
            return "Cette règle est déjà au premier niveau."
        parent = rule.parent
        upper = [r for r in _siblings(parent.parent_id)]
        k = next(i for i, r in enumerate(upper) if r.id == parent.id)
        rule.parent_id = parent.parent_id
        rule.save(update_fields=["parent"])
        _renumber(upper[:k + 1] + [rule] + upper[k + 1:])
        _renumber([r for r in siblings if r.id != rule.id])
    else:
        return "Déplacement inconnu."
    return None


# ---- Vues ---------------------------------------------------------------------------------------

@owner_required
def page(request):
    from .ai import ai_enabled
    from .views import get_all_data  # les lectures du lexique : la saisie assistée, comme Saisie

    context = get_all_data()
    context.update({"page": "grammar", "title": "Grammaire", "ai_enabled": ai_enabled()})
    return render(request, "hakkadbapp/grammar.html", context)


@require_GET
@owner_required
def api_tree(request):
    return JsonResponse({"rules": tree()}, json_dumps_params={"ensure_ascii": False})


@require_POST
@owner_required
def api_rule(request):
    p = _read(request)
    if p is None:
        return _bad("Demande invalide.")
    action = p.get("action")
    with transaction.atomic():
        if action == "create":
            parent_id = p.get("parent")
            if parent_id is not None and not GrammarRule.objects.filter(id=parent_id).exists():
                return _bad("Règle parente introuvable.", 404)
            title = " ".join(str(p.get("title") or "").split())[:200] or "Nouvelle règle"
            last = GrammarRule.objects.filter(parent_id=parent_id).aggregate(m=Max("position"))["m"]
            rule = GrammarRule.objects.create(parent_id=parent_id, title=title, updated_by=request.user,
                                              position=0 if last is None else last + 1)
            return JsonResponse({"ok": True, "id": rule.id, "rules": tree()}, json_dumps_params={"ensure_ascii": False})
        rule = GrammarRule.objects.filter(id=p.get("id")).select_for_update().first() if isinstance(p.get("id"), int) else None
        if rule is None:
            return _bad("Règle introuvable : rechargez la page.", 404)
        if action == "update":
            changed = []
            for field, size in FIELDS.items():
                if isinstance(p.get(field), str):
                    value = p[field][:size] if field in TEXTS else " ".join(p[field].split())[:size]
                    if field == "title" and not value:
                        return _bad("Le titre est vide.")
                    setattr(rule, field, value)
                    changed.append(field)
            if p.get("status") in dict(GrammarRule.STATUS_CHOICES):
                rule.status = p["status"]
                changed.append("status")
            rule.updated_by = request.user
            rule.save(update_fields=changed + ["updated_by", "updated_at"])
        elif action == "delete":
            if rule.children.exists() and not p.get("with_children"):
                return _bad("Cette règle a des sous-règles : déplacez-les ou supprimez-les d'abord.", 409)
            parent_id = rule.parent_id
            rule.delete()
            _renumber(_siblings(parent_id))
        elif action == "move":
            error = _move(rule, p.get("direction"))
            if error:
                return _bad(error, 409)
        else:
            return _bad("Action inconnue.")
    return JsonResponse({"ok": True, "rules": tree()}, json_dumps_params={"ensure_ascii": False})


@require_POST
@owner_required
def api_example(request):
    p = _read(request)
    if p is None:
        return _bad("Demande invalide.")
    action = p.get("action")
    if action == "add":
        rule = GrammarRule.objects.filter(id=p.get("rule")).first() if isinstance(p.get("rule"), int) else None
        kind, key = p.get("target_type"), str(p.get("target_key") or "")
        if rule is None:
            return _bad("Règle introuvable : rechargez la page.", 404)
        if kind not in dict(GrammarExample.TARGET_CHOICES) or not key:
            return _bad("Phrase invalide.")
        found = sentences({kind: {key}})
        if not found:
            return _bad("Cette phrase n'existe plus.", 404)
        last = rule.examples.aggregate(m=Max("position"))["m"]
        GrammarExample.objects.get_or_create(rule=rule, target_type=kind, target_key=key, defaults={
            "label": _label(found[0]), "focus": str(p.get("focus") or "")[:40],
            "position": 0 if last is None else last + 1})
    elif action in ("update", "remove", "up", "down"):
        example = GrammarExample.objects.filter(id=p.get("id")).first() if isinstance(p.get("id"), int) else None
        if example is None:
            return _bad("Exemple introuvable : rechargez la page.", 404)
        if action == "remove":
            example.delete()
        elif action == "update":
            if isinstance(p.get("focus"), str):
                example.focus = p["focus"].strip()[:40]
            if isinstance(p.get("note"), str):
                example.note = " ".join(p["note"].split())[:300]
            example.save(update_fields=["focus", "note"])
        else:
            items = list(example.rule.examples.order_by("position", "id"))
            at = next(i for i, e in enumerate(items) if e.id == example.id)
            to = at - 1 if action == "up" else at + 1
            if 0 <= to < len(items):
                items[at], items[to] = items[to], items[at]
            for n, e in enumerate(items):
                if e.position != n:
                    e.position = n
                    e.save(update_fields=["position"])
    else:
        return _bad("Action inconnue.")
    return JsonResponse({"ok": True, "rules": tree()}, json_dumps_params={"ensure_ascii": False})


@require_GET
@owner_required
def api_sentences(request):
    """Les phrases qui contiennent le mot, la lecture ou le sens tapé (comme
    « Rechercher »), avec les règles qui les citent déjà. ?libres=1 : seulement
    celles qu'aucune règle ne cite encore."""
    query = search_sources.parse_query(request.GET.get("q", ""))
    free_only = request.GET.get("libres") == "1"
    # ?schema=<règle> : seulement les phrases analysées qui suivent son schéma.
    schema_rule = GrammarRule.objects.filter(id=request.GET["schema"]).first()         if request.GET.get("schema", "").isdigit() else None
    tags = grammar_analysis.Tags()
    parts = grammar_analysis.parse_pattern(schema_rule.pattern, tags) if schema_rule else None
    if schema_rule and (not parts or any(x["kind"] == "unknown" for x in parts)):
        return _bad("Le schéma de cette règle n'est pas encore lisible : chaque élément doit être une étiquette, "
                    "un caractère ou une lecture.")
    analyses = {(a.target_type, a.target_key): a for a in SentenceAnalysis.objects.all()}
    if not query["han"] and len(query["sense"]) < 2 and not free_only and not parts:
        return JsonResponse({"q": query["text"], "count": 0, "items": []})
    cited = defaultdict(list)
    titles = dict(GrammarRule.objects.values_list("id", "title"))
    for kind, key, rid in GrammarExample.objects.values_list("target_type", "target_key", "rule_id"):
        cited[(kind, key)].append(titles.get(rid, ""))
    found = []
    for s in sentences():
        rules = cited.get((s["target_type"], s["target_key"]), [])
        if free_only and rules:
            continue
        analysis = analyses.get((s["target_type"], s["target_key"]))
        span = None
        if parts:
            if analysis is None:
                continue
            span = grammar_analysis.match(parts, analysis.tokens or [], analysis.groups or [], tags)
            if span is None:
                continue
        score = search_sources._match(query, s["hanzi"], s["pinyin"], [s["french"]]) if (query["han"] or query["sense"]) else 1
        if score:
            found.append((score, {**s, "rules": rules, "analysed": analysis is not None,
                                  "tokens": analysis.tokens if analysis and parts else None,
                                  "span": list(span) if span else None}))
    found.sort(key=lambda pair: (-pair[0], len(pair[1]["hanzi"])))
    return JsonResponse({"q": query["text"], "count": len(found), "items": [s for _sc, s in found[:LIMIT]]},
                        json_dumps_params={"ensure_ascii": False})
