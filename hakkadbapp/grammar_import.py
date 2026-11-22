"""« Grammaire » : préremplir les chapitres et les règles avec les documents
existants (grammar_seed.json, tiré du cahier notes/notebook/grammaire.tex,
de la méthode grammar/grammar.md et de hakka-grammar).

Chaque exemple des documents est relié à la phrase du corpus qui a le même
identifiant (platform_id d'une expression), les mêmes caractères (hanzi :
expressions, ajouts, segments des transcriptions) ou la même traduction
(french : expressions et ajouts). Une phrase introuvable est notée dans
l'explication de la règle, à saisir. Rien n'est écrasé : un chapitre ou une
règle qui existe déjà (même titre, même place) est laissé tel quel.

    POST /api/grammaire/importer   {action: preview|run}
"""
import json
from pathlib import Path

from django.db import transaction
from django.db.models import Max
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .models import GrammarExample, GrammarRule, to_simp
from .permissions import owner_required
from . import grammar_analysis, search_sources

SEED_FILE = Path(__file__).resolve().parent / "grammar_seed.json"
ORDER = {GrammarExample.TARGET_EXPRESSION: 0, GrammarExample.TARGET_ADDITION: 1, GrammarExample.TARGET_SEGMENT: 2}


def seed():
    return json.loads(SEED_FILE.read_text(encoding="utf-8"))


# Les graphies du cahier et celles du lexique : 𠊎 / 我 (ngai), 爾 / 你 (ngi), 介 / 嘅 (e, ai), 渠 / 佢 (ki).
SAME = str.maketrans({"𠊎": "我", "爾": "你", "介": "嘅", "渠": "佢"})


def _han_key(text):
    return to_simp(search_sources.han_only(text).translate(SAME))


def _french_key(text):
    return search_sources.fold(text).strip(" .?!…").replace(" ?", "?")


class Finder:
    """Les phrases du corpus, par identifiant, par caractères, par traduction."""

    def __init__(self):
        from .grammar import sentences

        self.by_id, self.by_han, self.by_french = {}, {}, {}
        for s in sorted(sentences(), key=lambda s: ORDER.get(s["target_type"], 9)):
            if s["target_type"] == GrammarExample.TARGET_EXPRESSION:
                self.by_id.setdefault(s["target_key"], s)
            key = _han_key(s["hanzi"])
            if len(key) >= 2:
                self.by_han.setdefault(key, s)
            if s["french"] and s["target_type"] != GrammarExample.TARGET_SEGMENT:
                self.by_french.setdefault(_french_key(s["french"]), s)

    def find(self, example):
        if example.get("platform_id"):
            return self.by_id.get(example["platform_id"])
        if example.get("hanzi"):
            return self.by_han.get(_han_key(example["hanzi"]))
        if example.get("french"):
            return self.by_french.get(_french_key(example["french"]))
        return None


def _explanation(rule, missing):
    text = rule.get("explanation", "").strip()
    if rule.get("source"):
        text += f"\n\nSource : {rule['source']}."
    if missing:
        text += "\n\nExemples des documents, pas encore trouvés dans le corpus (à saisir) :\n" + "\n".join(
            "- " + " — ".join(x for x in (e.get("hanzi"), e.get("french"), e.get("platform_id")) if x) for e in missing)
    return text.strip()


def plan():
    """Ce que l'import ferait : [{chapter, exists, rules: [{title, exists, found, missing}]}]."""
    finder = Finder()
    existing = {(r.parent_id, r.title): r for r in GrammarRule.objects.all()}
    out = []
    for chapter in seed()["chapters"]:
        root = existing.get((None, chapter["title"]))
        rules = []
        for rule in chapter["rules"]:
            found, missing = [], []
            for example in rule.get("examples", []):
                s = finder.find(example)
                (found if s else missing).append((example, s) if s else example)
            rules.append({"rule": rule, "exists": bool(root and (root.id, rule["title"]) in existing),
                          "found": found, "missing": missing})
        out.append({"chapter": chapter, "root": root, "rules": rules})
    return out


def _summary(steps):
    new_rules = [r for c in steps for r in c["rules"] if not r["exists"]]
    return {
        "chapters": sum(1 for c in steps if not c["root"]),
        "new_rules": len(new_rules),
        "already": sum(1 for c in steps for r in c["rules"] if r["exists"]),
        "linked": sum(len(r["found"]) for r in new_rules),
        "missing": sum(len(r["missing"]) for r in new_rules),
    }


def run(user):
    steps = plan()
    with transaction.atomic():
        # Les schémas sont écrits avec les étiquettes de la base de départ.
        grammar_analysis.ensure_seed()
        last = GrammarRule.objects.filter(parent=None).aggregate(m=Max("position"))["m"]
        position = -1 if last is None else last
        for step in steps:
            chapter = step["chapter"]
            root = step["root"]
            if root is None:
                position += 1
                root = GrammarRule.objects.create(title=chapter["title"], explanation=chapter.get("explanation", ""),
                                                  position=position, updated_by=user)
            n = root.children.count()
            for r in step["rules"]:
                if r["exists"]:
                    continue
                rule = GrammarRule.objects.create(parent=root, title=r["rule"]["title"], pattern=r["rule"].get("pattern", ""),
                                                  explanation=_explanation(r["rule"], r["missing"]), position=n, updated_by=user)
                n += 1
                from .grammar import _label

                for k, (_example, s) in enumerate(r["found"]):
                    focus = r["rule"].get("focus", "")
                    GrammarExample.objects.get_or_create(rule=rule, target_type=s["target_type"], target_key=s["target_key"],
                                                         defaults={"label": _label(s), "position": k,
                                                                   "focus": focus if focus and focus in s["hanzi"] else "",
                                                                   "note": "importé des documents"})
    return _summary(steps)


@require_POST
@owner_required
def api_import(request):
    from .grammar import tree

    try:
        action = json.loads(request.body.decode("utf-8") or "{}").get("action")
    except (json.JSONDecodeError, UnicodeDecodeError, AttributeError):
        action = None
    if action == "preview":
        return JsonResponse({"ok": True, **_summary(plan())})
    if action == "run":
        summary = run(request.user)
        return JsonResponse({"ok": True, **summary, "rules": tree()}, json_dumps_params={"ensure_ascii": False})
    return JsonResponse({"error": "Action inconnue."}, status=400)
