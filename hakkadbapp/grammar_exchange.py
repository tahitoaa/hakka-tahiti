"""« Grammaire » : l'export au format d'échange commun tumu-kin.

Le format (tumu-kin/FORMAT.md, https://github.com/tahitoaa/tumu-kin) est
partagé avec tumuparau (le tahitien) : étiquettes, règles en arbre, phrases
d'exemple et leurs analyses, dans un seul fichier JSON. Ici, l'export
seulement : il ne fait que lire la base. Les étiquettes y sont désignées par
leur code (les numéros n'ont de sens que dans cette base), les règles par
« rule:<id> », les phrases par « <target_type>:<target_key> ».

    python manage.py export_grammaire grammaire-hakka.json
"""
from . import grammar
from .models import GrammarExample, GrammarRule, GrammarTag, SentenceAnalysis

FORMAT = "tumu-kin/grammaire"
VERSION = 1


def _sentence_id(target_type, target_key):
    return f"{target_type}:{target_key}"


def export_grammar():
    """La grammaire entière au format d'échange (un dict, prêt pour json.dump)."""
    tags = list(GrammarTag.objects.all())
    code = {t.id: t.code for t in tags}
    rules = list(GrammarRule.objects.all())
    examples = list(GrammarExample.objects.all())
    analyses = list(SentenceAnalysis.objects.all())

    # Les phrases citées par un exemple ou analysées, avec leur texte du jour.
    wanted = {}
    for x in [*examples, *analyses]:
        wanted.setdefault(x.target_type, set()).add(x.target_key)
    found = {(s["target_type"], s["target_key"]): s for s in grammar.sentences(wanted)} if wanted else {}
    labels = {(x.target_type, x.target_key): x.label for x in [*analyses, *examples] if x.label}

    sentences = []
    for target_type, keys in sorted(wanted.items()):
        for key in sorted(keys):
            s = found.get((target_type, key))
            sentences.append({
                "id": _sentence_id(target_type, key),
                "text": s["hanzi"] if s else labels.get((target_type, key), ""),
                "reading": s["pinyin"] if s else "",
                "translation": s["french"] if s else "",
                "source": s["detail"] if s else "Phrase introuvable (supprimée ou modifiée)",
            })

    by_rule = {}
    for e in examples:
        by_rule.setdefault(e.rule_id, []).append(
            {"sentence": _sentence_id(e.target_type, e.target_key), "focus": e.focus, "note": e.note})

    def ordered(items, parent_of):
        """Les nœuds dans l'ordre de l'arbre : chaque parent avant ses enfants."""
        children = {}
        for item in items:
            children.setdefault(parent_of(item), []).append(item)
        out = []

        def walk(parent):
            for item in sorted(children.get(parent, []), key=lambda i: (i.position, i.id)):
                out.append(item)
                walk(item.id)
        walk(None)
        out += [i for i in items if i not in out]  # parent disparu : à la fin
        return out

    return {
        "format": FORMAT,
        "version": VERSION,
        "language": "hak",
        "tags": [{"kind": t.kind, "code": t.code, "name": t.name, "description": t.description, "tests": t.tests,
                  "equivalent": t.equivalent, "parent": code.get(t.parent_id), "status": t.status}
                 for t in sorted(tags, key=lambda t: (t.kind, t.position, t.id))],
        "rules": [{"id": f"rule:{r.id}", "parent": f"rule:{r.parent_id}" if r.parent_id else None, "title": r.title,
                   "pattern": r.pattern, "explanation": r.explanation, "learner_text": r.learner_text,
                   "post_text": r.post_text, "status": r.status, "examples": by_rule.get(r.id, [])}
                  for r in ordered(rules, lambda r: r.parent_id)],
        "sentences": sentences,
        "analyses": [{"sentence": _sentence_id(a.target_type, a.target_key), "text": a.text,
                      "tokens": [{**t, "c": code.get(t.get("c")), "f": code.get(t.get("f"))} for t in a.tokens or []],
                      "groups": [{**g, "c": code.get(g.get("c")), "f": code.get(g.get("f"))} for g in a.groups or []],
                      "note": a.note, "source": a.source}
                     for a in sorted(analyses, key=lambda a: (a.target_type, a.target_key))],
    }
