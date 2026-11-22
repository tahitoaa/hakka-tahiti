"""« Grammaire » : le parcours d'analyse et les règles induites.

Le parcours : toutes les phrases que l'on peut analyser (expressions du
lexique, ajouts de la Saisie, segments des transcriptions publiées), avec
leur état (à analyser, analysée, modifiée depuis), et les phrases des
documents (cahiers de grammaire, documents importés) qui ne sont pas encore
dans le corpus : « à saisir ». Les saisir crée un brouillon d'expression
dans la Saisie (une seule source : le lexique et ses ajouts), à compléter,
puis à analyser ; une phrase d'un cahier devient aussi un exemple de sa règle.

Les règles induites : ce que les analyses enregistrées montrent, sans rien
supposer d'autre. Chaque groupe de chaque arbre donne une construction
« GV → NÉG + V » ; on les compte, avec leurs phrases. Une construction
peut devenir une règle (son schéma est la partie droite), et chaque
catégorie a son inventaire de mots.

Privé : le propriétaire du site seulement (owner_required).

    GET  /api/grammaire/corpus?source=&etat=&q=&page=   le parcours
    POST /api/grammaire/corpus/saisir                   {hanzi, french, source, rule}
    GET  /api/grammaire/induites?mots=1&regle=<id>      les constructions et les inventaires (d'une
                                                        règle : de ses exemples et de ceux de ses sous-règles)
    POST /api/grammaire/induites/creer                  {pattern, title, parent, examples}
    POST /api/grammaire/regle/ia                        {id, kind: learner|post} : le texte de l'IA,
                                                        enregistré dans la règle
"""
import json
import re
from collections import Counter, defaultdict

from django.db import transaction
from django.db.models import Max
from django.http import JsonResponse
from django.urls import reverse
from django.views.decorators.http import require_GET, require_POST

from .models import GrammarExample, GrammarRule, ImportedDocument, LexiconAddition, SentenceAnalysis
from .permissions import owner_required
from . import grammar_analysis, grammar_import, search_sources
from .search_sources import HAN

PAGE = 40
SOURCES = {"expression", "addition", "segment", "document"}
# Les catégories fermées (peu de mots, chacun avec son rôle) : « avec les mots »,
# une construction les montre par leurs mots (唔 + V, 冇 + V) plutôt que par leur code.
CLOSED = {"NÉG", "ASP", "PART", "CL", "PRÉP", "DÉM", "CONJ"}
SENTENCE_END = re.compile(r"[。！？!?\n；;]+")


def _json(data, status=200):
    return JsonResponse(data, status=status, json_dumps_params={"ensure_ascii": False})


def _bad(message, status=400):
    return _json({"error": message}, status)


# ---- Les phrases des documents, pas encore dans le corpus ------------------------------------------

def document_sentences(finder=None):
    """[{hanzi, french, source, detail, rule}] : les exemples des cahiers
    introuvables dans le corpus, puis les phrases des documents importés
    (au moins trois caractères, surtout des caractères), sans doublon."""
    finder = finder or grammar_import.Finder()
    out, seen = [], set()

    def add(hanzi, french, source, detail, rule=""):
        key = grammar_import._han_key(hanzi)
        if len(key) < 2 or key in seen or key in finder.by_han:
            return
        seen.add(key)
        out.append({"hanzi": hanzi, "french": french, "source": source, "detail": detail, "rule": rule})

    for chapter in grammar_import.seed()["chapters"]:
        for rule in chapter["rules"]:
            for e in rule.get("examples", []):
                if e.get("hanzi"):
                    add(e["hanzi"], e.get("french", ""), "Cahier de grammaire", f"{chapter['title']} › {rule['title']}",
                        rule["title"])

    def build():
        lines = []
        for d in ImportedDocument.objects.only("filename", "text"):
            for n, line in enumerate(d.text.splitlines(), 1):
                for piece in SENTENCE_END.split(line.replace("\t", " ")):
                    piece = piece.strip(" ，、,.:：·")
                    han = HAN.findall(piece)
                    if 3 <= len(han) <= 60 and len(han) >= 0.6 * len(piece.replace(" ", "")):
                        lines.append((piece, d.filename, n))
        return lines[:5000]

    for piece, filename, n in search_sources.cached("grammar-documents", build):
        add(piece, "", filename, f"{filename} · ligne {n}")
    return out


# ---- Le parcours -----------------------------------------------------------------------------------

def _state(analysis, sentence):
    if analysis is None:
        return "todo"
    return "stale" if grammar_analysis.analysis_json(analysis, sentence)["stale"] else "done"


@require_GET
@owner_required
def api_corpus(request):
    from .grammar import sentences

    source = request.GET.get("source", "")
    state = request.GET.get("etat", "")
    query = search_sources.parse_query(request.GET.get("q", ""))
    try:
        page = max(1, int(request.GET.get("page", "1")))
    except ValueError:
        page = 1
    finder = grammar_import.Finder()
    analyses = {(a.target_type, a.target_key): a for a in SentenceAnalysis.objects.all()}
    cited = defaultdict(list)
    titles = dict(GrammarRule.objects.values_list("id", "title"))
    for kind, key, rid in GrammarExample.objects.values_list("target_type", "target_key", "rule_id"):
        cited[(kind, key)].append(titles.get(rid, ""))

    def matches(hanzi, pinyin, french):
        if not (query["han"] or query["sense"] or query["reading"]):
            return True
        return bool(search_sources._match(query, hanzi, pinyin, [french]))

    items, counts = [], Counter()
    for s in sentences():
        k = (s["target_type"], s["target_key"])
        st = _state(analyses.get(k), s)
        counts[st] += 1
        counts["all"] += 1
        if source and source != s["target_type"]:
            continue
        if state and state != st:
            continue
        if not matches(s["hanzi"], s["pinyin"], s["french"]):
            continue
        items.append({**s, "state": st, "rules": cited.get(k, [])})
    documents = document_sentences(finder)
    counts["document"] = len(documents)
    if source in ("", "document") and state in ("", "document"):
        for d in documents:
            if matches(d["hanzi"], "", d["french"]):
                items.append({**d, "target_type": "document", "target_key": "", "state": "document", "pinyin": "",
                              "rules": [d["rule"]] if d["rule"] else []})
    # Les phrases déjà citées par une règle d'abord, puis les plus courtes : on commence par le plus simple.
    rank = {"stale": 0, "todo": 1, "done": 2, "document": 3}
    items.sort(key=lambda s: (rank[s["state"]] if not state else 0, not s["rules"],
                              len(search_sources.han_only(s["hanzi"])) or 99))
    pages = max(1, -(-len(items) // PAGE))
    page = min(page, pages)
    return _json({"counts": dict(counts), "count": len(items), "page": page, "pages": pages,
                  "items": items[(page - 1) * PAGE: page * PAGE]})


@require_POST
@owner_required
def api_enter(request):
    """Une phrase de document -> un brouillon d'expression de la Saisie, ses
    mots découpés d'après le lexique ; d'un cahier, aussi un exemple de sa règle."""
    try:
        p = json.loads(request.body.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _bad("Demande invalide.")
    hanzi = " ".join(str(p.get("hanzi") or "").split())[:300]
    if len(HAN.findall(hanzi)) < 1:
        return _bad("Pas de caractères à saisir.")
    finder = grammar_import.Finder()
    if grammar_import._han_key(hanzi) in finder.by_han:
        return _bad("Cette phrase est déjà dans le corpus.", 409)
    tokens = grammar_analysis.segment({"hanzi": hanzi.replace(" ", ""), "pinyin": ""})
    words = [t["t"] for t in tokens]
    readings = [t["p"] for t in tokens]
    with transaction.atomic():
        addition = LexiconAddition.objects.create(
            kind=LexiconAddition.KIND_EXPRESSION, status=LexiconAddition.STATUS_DRAFT,
            hanzi=" ".join(words), pinyin=" ".join(readings) if all(readings) else "",
            french=" ".join(str(p.get("french") or "").split())[:500],
            source=" ".join(str(p.get("source") or "").split())[:200],
            observations="Ajoutée depuis la Grammaire, à compléter (lecture, traduction) avant de l'analyser.",
            created_by=request.user, updated_by=request.user)
        linked = None
        title = str(p.get("rule") or "")
        if title:
            rule = GrammarRule.objects.filter(title=title).first()
            if rule:
                last = rule.examples.aggregate(m=Max("position"))["m"]
                GrammarExample.objects.get_or_create(rule=rule, target_type=GrammarExample.TARGET_ADDITION,
                                                     target_key=str(addition.id),
                                                     defaults={"label": hanzi, "position": 0 if last is None else last + 1,
                                                               "note": "saisie depuis le cahier"})
                linked = rule.title
    search_sources._cache.pop("grammar-documents", None)
    return _json({"ok": True, "id": addition.id, "target_type": "addition", "target_key": str(addition.id),
                  "link": f"{reverse('saisie')}?modifier={addition.id}", "missing_reading": not all(readings),
                  "rule": linked})


# ---- Les règles induites ---------------------------------------------------------------------------

def _item_label(item, tags, words, token=None):
    """Un enfant dans une construction : son étiquette (GN:sujet, NÉG), ou son
    mot pour une catégorie fermée quand on montre les mots."""
    code = tags.by_id[item["c"]].code if item.get("c") in tags.by_id else ""
    fn = tags.by_id[item["f"]].code if item.get("f") in tags.by_id else ""
    if token is not None and words and code in CLOSED:
        code = token["t"]
    return ":".join(x for x in (code or "?", fn) if x)


def productions(analyses, tags, words=False):
    """{(gauche, (droite…)): [analyses]} : chaque groupe et ses enfants directs ;
    les mots hors de tout groupe forment la phrase « (phrase) »."""
    found = defaultdict(list)
    for a in analyses:
        tokens, groups = a.tokens or [], a.groups or []
        if not tokens:
            continue
        ordered = sorted(groups, key=lambda g: (g["s"], -g["e"]))
        parent = {}
        for i, g in enumerate(ordered):
            inner = [j for j, h in enumerate(ordered) if j != i and h["s"] <= g["s"] and g["e"] <= h["e"]
                     and (h["s"], h["e"]) != (g["s"], g["e"])]
            parent[i] = min(inner, key=lambda j: ordered[j]["e"] - ordered[j]["s"]) if inner else None

        def children(index):
            """Les enfants directs du groupe `index` (None : la phrase entière)."""
            span = (0, len(tokens)) if index is None else (ordered[index]["s"], ordered[index]["e"])
            subs = [j for j in parent if parent[j] == index]
            out, t = [], span[0]
            for j in sorted(subs, key=lambda j: ordered[j]["s"]):
                while t < ordered[j]["s"]:
                    out.append(_item_label(tokens[t], tags, words, tokens[t]))
                    t += 1
                out.append(_item_label(ordered[j], tags, words))
                t = ordered[j]["e"]
            while t < span[1]:
                out.append(_item_label(tokens[t], tags, words, tokens[t]))
                t += 1
            return out

        for i, g in enumerate(ordered):
            rhs = children(i)
            if len(rhs) > 1 or g["e"] - g["s"] == 1:
                found[(_item_label(g, tags, words), tuple(rhs))].append(a)
        top = children(None)
        if len(top) > 1:
            found[("(phrase)", tuple(top))].append(a)
    return found


def _key(pattern):
    return re.sub(r"\s+", "", search_sources.fold(pattern))


@require_GET
@owner_required
def api_induced(request):
    from .grammar import sentences

    tags = grammar_analysis.Tags()
    words = request.GET.get("mots") == "1"
    analyses = list(SentenceAnalysis.objects.all())
    # D'une règle : seulement les phrases qu'elle cite, elle et ses sous-règles ; une construction
    # « retenue » est une sous-règle directe de même schéma.
    scope = GrammarRule.objects.filter(id=request.GET["regle"]).first() if request.GET.get("regle", "").isdigit() else None
    if scope is not None:
        from .grammar import _descendant_ids

        ids = _descendant_ids(scope) | {scope.id}
        quoted = set(GrammarExample.objects.filter(rule_id__in=ids).values_list("target_type", "target_key"))
        analyses = [a for a in analyses if (a.target_type, a.target_key) in quoted]
    found = productions(analyses, tags, words)
    labels = {(s["target_type"], s["target_key"]): s for s in sentences(
        {t: {a.target_key for a in analyses if a.target_type == t} for t in {a.target_type for a in analyses}})} \
        if analyses else {}
    rules = list(GrammarRule.objects.exclude(pattern=""))
    if scope is not None:
        rules = [r for r in rules if r.parent_id == scope.id] + [r for r in rules if r.parent_id != scope.id]
    by_pattern = {}
    for r in rules:
        by_pattern.setdefault(_key(r.pattern), r)
    citing = defaultdict(set)
    for kind, key, title in GrammarExample.objects.values_list("target_type", "target_key", "rule__title"):
        citing[(kind, key)].add(title)

    out = []
    for (lhs, rhs), items in found.items():
        pattern = " + ".join(rhs)
        rule = by_pattern.get(_key(pattern))
        examples = []
        for a in items[:8]:
            s = labels.get((a.target_type, a.target_key))
            examples.append({"target_type": a.target_type, "target_key": a.target_key,
                             "hanzi": s["hanzi"] if s else a.text, "french": s["french"] if s else "",
                             "link": s["link"] if s else "", "bracketed": grammar_analysis.bracketed(a.tokens, a.groups, tags)})
        out.append({"lhs": lhs, "rhs": list(rhs), "pattern": pattern, "count": len(items), "examples": examples,
                    "sentences": len({(a.target_type, a.target_key) for a in items}),
                    "rule": {"id": rule.id, "title": rule.title, "here": bool(scope and rule.parent_id == scope.id)}
                    if rule else None,
                    "cited_by": sorted(set().union(*[citing[(a.target_type, a.target_key)] for a in items]))[:6]})
    out.sort(key=lambda p: (-p["count"], p["lhs"], p["pattern"]))

    inventory = defaultdict(Counter)
    for a in analyses:
        for t in a.tokens or []:
            if t.get("c") in tags.by_id:
                inventory[t["c"]][t["t"]] += 1
    words_by_tag = [{"tag": tags.by_id[c].code, "name": tags.by_id[c].name, "count": sum(n.values()),
                     "words": n.most_common(20)}
                    for c, n in sorted(inventory.items(), key=lambda kv: -sum(kv[1].values()))]
    return _json({"analyses": len(analyses), "productions": out, "inventory": words_by_tag})


@require_POST
@owner_required
def api_create_induced(request):
    """Une construction devient une règle (brouillon) : son schéma, ses phrases
    comme exemples, rangée sous le chapitre choisi (sinon « Règles induites »)."""
    from .grammar import _label, sentences, tree

    try:
        p = json.loads(request.body.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _bad("Demande invalide.")
    pattern = " ".join(str(p.get("pattern") or "").split())[:300]
    if not pattern:
        return _bad("Schéma vide.")
    title = " ".join(str(p.get("title") or "").split())[:200] or pattern
    examples = [e for e in (p.get("examples") or []) if isinstance(e, dict)][:20]
    with transaction.atomic():
        parent = GrammarRule.objects.filter(id=p.get("parent")).first() if isinstance(p.get("parent"), int) else None
        if parent is None:
            parent = GrammarRule.objects.filter(parent=None, title="Règles induites").first()
            if parent is None:
                last = GrammarRule.objects.filter(parent=None).aggregate(m=Max("position"))["m"]
                parent = GrammarRule.objects.create(
                    title="Règles induites", position=0 if last is None else last + 1, updated_by=request.user,
                    explanation="Les constructions relevées dans les analyses, en attendant d'être rangées dans leur chapitre.")
        last = parent.children.aggregate(m=Max("position"))["m"]
        rule = GrammarRule.objects.create(parent=parent, title=title, pattern=pattern, updated_by=request.user,
                                          position=0 if last is None else last + 1,
                                          explanation=f"Règle induite de {len(examples)} phrase(s) analysée(s) : "
                                                      "à rédiger (ce qu'elle exprime, ses limites, ses exceptions).")
        wanted = defaultdict(set)
        for e in examples:
            if e.get("target_type") in grammar_analysis.TARGETS and isinstance(e.get("target_key"), str):
                wanted[e["target_type"]].add(e["target_key"])
        for n, s in enumerate(sentences(dict(wanted)) if wanted else []):
            GrammarExample.objects.get_or_create(rule=rule, target_type=s["target_type"], target_key=s["target_key"],
                                                 defaults={"label": _label(s), "position": n})
    return _json({"ok": True, "id": rule.id, "rules": tree()})


# ---- Pour les apprenants : l'IA explique, l'IA propose un article ---------------------------------

LEARNER_PROMPT = """You write for people of the Chinese community of Tahiti (French Polynesia) who want to learn or relearn the Hakka their grandparents spoke. They are French speakers, often adults, not linguists. You get one grammar rule written by a linguist: its title, its schema (written with the linguist's grammatical labels), its explanation, its sub-rules, and its example sentences, each with its Hakka characters, its reading (Wenfa romanization with tone numbers), its French translation and sometimes its analysis.

Rules:
- Write in French, simply, warmly, without jargon: no grammatical codes (GN, GV, NÉG…), no linguistic terms a learner would not know; say « le mot qui dit non » rather than « la particule de négation » when it helps, and explain any term you keep.
- Use only the example sentences given, with their characters, their reading and their translation exactly as given. Never invent a Hakka sentence, word or reading; if there are too few examples, say less rather than invent.
- Do not state anything about Hakka that the rule or its examples do not show. Hakka is not Mandarin: never rely on Mandarin usage.
- Plain text only, no Markdown: no #, no **, no tables. Line breaks are fine."""

LEARNER_TASK = """Write the learner's explanation of this rule: 120 to 250 words.
1. One or two sentences: what this construction is for, in everyday terms.
2. How to build it, as a simple formula in words (for example « celui qui parle + 唔 + ce qu'il fait »).
3. Two to four of the examples, each on its own line: characters, then reading in parentheses, then « = » and the translation.
4. One tip or a common mistake, only if the rule or its examples show it."""

POST_TASK = """Write a short article for the community's Facebook page that teaches this rule: 80 to 180 words.
- A first line that catches the eye (a question or a familiar situation), with at most one emoji.
- The rule in one or two simple sentences.
- Two or three of the examples, each on its own line: characters, reading in parentheses, « = » translation.
- A last line inviting readers to answer or to share how their family says it.
- Then, on a separate last line, three to five hashtags, among them #hakka #Tahiti #客家話."""


def _rule_context(rule):
    from .grammar import sentences

    tags = grammar_analysis.Tags()
    examples = list(rule.examples.all()[:12])
    wanted = defaultdict(set)
    for e in examples:
        wanted[e.target_type].add(e.target_key)
    found = {(s["target_type"], s["target_key"]): s for s in sentences(dict(wanted))} if wanted else {}
    analyses = {(a.target_type, a.target_key): a for a in SentenceAnalysis.objects.filter(
        target_key__in=[e.target_key for e in examples])}
    out = []
    for e in examples:
        s = found.get((e.target_type, e.target_key))
        if not s:
            continue
        a = analyses.get((e.target_type, e.target_key))
        out.append({"hanzi": s["hanzi"], "reading": s["pinyin"], "french": s["french"], "word_the_rule_is_about": e.focus,
                    "note": e.note, "analysis": grammar_analysis.bracketed(a.tokens, a.groups, tags) if a else ""})
    parts = grammar_analysis.parse_pattern(rule.pattern, tags)
    legend = {}
    for p in parts:
        for alternative in p.get("tags", []):
            for tag_id in alternative:
                t = tags.by_id[tag_id]
                legend[t.code] = t.name or t.code
    return {
        "title": rule.title, "schema": rule.pattern, "schema_labels": legend,
        "chapter": rule.parent.title if rule.parent_id else "",
        "explanation": rule.explanation[:4000],
        "sub_rules": [{"title": c.title, "schema": c.pattern} for c in rule.children.all()[:12]],
        "examples": out,
    }


@require_POST
@owner_required
def api_rule_ai(request):
    from . import ai

    try:
        p = json.loads(request.body.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _bad("Demande invalide.")
    kind = p.get("kind")
    if kind not in ("learner", "post"):
        return _bad("Texte inconnu.")
    rule = GrammarRule.objects.filter(id=p.get("id")).first() if isinstance(p.get("id"), int) else None
    if rule is None:
        return _bad("Règle introuvable : rechargez la page.", 404)
    if not ai.ai_enabled():
        return _bad("L'IA n'est pas configurée sur ce serveur (ANTHROPIC_API_KEY).", 503)
    context = _rule_context(rule)
    if not context["examples"]:
        return _bad("Ajoutez d'abord des exemples à cette règle : l'IA n'écrit qu'à partir des phrases du corpus.")
    if ai._over_limit(request.user):
        return _bad(f"Limite de {ai.DAILY_LIMIT} demandes à l'IA par jour atteinte.", 429)
    import anthropic

    try:
        response = ai._client().beta.messages.create(
            model=ai.MODEL, max_tokens=1500,
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            output_config={"effort": "low"},
            cache_control={"type": "ephemeral"},
            system=LEARNER_PROMPT,
            messages=[{"role": "user", "content": (LEARNER_TASK if kind == "learner" else POST_TASK)
                       + "\n\nThe rule:\n" + json.dumps(context, ensure_ascii=False)}],
        )
    except anthropic.RateLimitError:
        return _bad("L'IA est très demandée : réessayez dans une minute.", 429)
    except anthropic.APIConnectionError:
        return _bad("L'IA ne répond pas : réessayez plus tard.", 503)
    except anthropic.APIStatusError:
        return _bad("L'IA a renvoyé une erreur : réessayez plus tard.", 502)
    if response.stop_reason in ("refusal", "max_tokens"):
        return _bad("L'IA n'a pas pu écrire ce texte : réessayez.", 502)
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)   # no Markdown on Facebook
    field = "learner_text" if kind == "learner" else "post_text"
    setattr(rule, field, text[:20000])
    rule.updated_by = request.user
    rule.save(update_fields=[field, "updated_by", "updated_at"])
    return _json({"ok": True, "field": field, "text": getattr(rule, field)})
