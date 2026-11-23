"""« Grammaire » : les étiquettes et l'analyse des phrases d'exemple.

Les étiquettes (GrammarTag), définies au fur et à mesure :
  catégories de mots (N, V, Nég…), groupes (GN, GV, P…), fonctions (sujet,
  objet…). Une étiquette peut en préciser une autre (V › V de mouvement).
  L'IA peut en proposer (statut « proposée ») : on les retient ou les rejette.

L'analyse d'une phrase (SentenceAnalysis), partagée par toutes les règles qui
la citent :
  linéaire : les mots dans l'ordre, chacun avec sa catégorie, sa fonction,
             sa glose ;
  en arbre : les groupes, des suites de mots voisins (GN:sujet = les mots
             0 à 1), emboîtés, jamais à cheval.

Le schéma d'une règle (« GN:sujet + Nég + V (+ GN:objet) ») est lu avec ces
étiquettes : on vérifie quels exemples analysés le suivent, et on cherche
dans le corpus les phrases analysées qui le suivent.

Privé : le propriétaire du site seulement (owner_required).

    GET  /api/grammaire/etiquettes            {tags: [...]}
    POST /api/grammaire/etiquette             {action: create|update|delete|accept|seed, ...}
    GET  /api/grammaire/analyse?type=&key=    l'analyse enregistrée, sinon un premier découpage
    POST /api/grammaire/analyse/enregistrer   {action: save|delete, target_type, target_key, ...}
    POST /api/grammaire/analyse/ia            une proposition de l'IA (rien n'est enregistré
                                              sauf les étiquettes nouvelles, « proposées »)
"""
import json
import logging
import re
from collections import Counter, defaultdict

from django.db import transaction
from django.db.models import Max
from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST

from .models import GrammarExample, GrammarTag, SentenceAnalysis, to_simp, to_trad
from .permissions import owner_required
from . import search_sources
from .search_sources import HAN, fold

logger = logging.getLogger(__name__)

MAX_TOKENS = 120
KINDS = {k for k, _l in GrammarTag.KIND_CHOICES}
TARGETS = {k for k, _l in GrammarExample.TARGET_CHOICES}
PUNCTUATION = re.compile(r"^[\s,.;:!?…，。、；：！？「」『』（）()《》〈〉“”‘’\"'\-—–·]+$")
SYLLABLE = re.compile(r"[a-zA-ZÀ-ɏŋεɔ'’]+[0-9¹²³⁴⁵⁶⁷⁸]?")

# Une base de départ, si on la veut (« Partir d'une base ») : rien n'est créé sans le demander.
# (type, abréviation, nom, définition, test pour la reconnaître, équivalent Universal Dependencies)
# Les tests sont distributionnels : ce que le mot accepte autour de lui, plutôt que son sens.
SEED = [
    ("category", "N", "nom", "Désigne une personne, une chose, un lieu, une notion.",
     "Se compte avec un numéral + classificateur (一隻狗) ou se montre avec 這 / 介 + classificateur ; ne se nie pas directement par 唔.",
     "NOUN"),
    ("category", "PRO", "pronom", "Tient la place d'un groupe nominal entier : 我 / 𠊎, 你 / 爾, 佢.",
     "Ne prend ni démonstratif ni classificateur ; se met au pluriel avec 兜 (𠊎兜 « nous ») ; possessif : 吾, 若, ou PRO + 嘅.",
     "PRON"),
    ("category", "V", "verbe", "Exprime une action ou un processus.",
     "Se nie par 唔 (présent) ou 冇 (accompli) ; accepte une marque d'aspect après lui (倒, 過) ; peut avoir un objet.",
     "VERB"),
    ("category", "ADJ", "verbe d'état / adjectif", "Exprime une qualité, un état ; prédicat sans verbe « être ».",
     "Se met après 好 « très » (好靚) et se nie par 唔 comme un verbe, mais ne prend pas d'objet ; se compare avec 過 / 較.",
     "ADJ"),
    ("category", "ADV", "adverbe", "Modifie un verbe, un adjectif ou la phrase : degré, temps, manière.",
     "Toujours devant le verbe ou l'adjectif (好常, 正) ; ne peut pas être prédicat seul ni se nier.",
     "ADV"),
    ("category", "NÉG", "négation", "唔 ng² (présent, habitude, futur), 冇 mao³ (accompli, absence), 莫 / 唔好 (interdiction).",
     "Juste devant le verbe ou l'adjectif ; la forme change avec l'aspect : comparez 𠊎唔看 / 𠊎冇看.",
     "ADV (Polarity=Neg)"),
    ("category", "NUM", "numéral", "Un nombre : 一, 兩, 三…",
     "Devant un classificateur, jamais directement devant un nom comptable (*三人 → 三個人).",
     "NUM"),
    ("category", "CL", "classificateur", "Mot choisi selon le nom, entre le numéral (ou le démonstratif) et le nom : 一隻 jit⁵ zak⁵.",
     "Remplissez « 一 ___ 人 » ou « 這 ___ 狗 » ; seul après 這 / 介, il remplace le nom déjà connu (這隻).",
     "NOUN (relation clf)"),
    ("category", "DÉM", "démonstratif", "Montre ce dont on parle : ngia⁴ 這 (proche), ai⁴ 介 (éloigné).",
     "Devant un classificateur (這隻) ou seul comme pronom (這係舊嘅).",
     "DET"),
    ("category", "PRÉP", "coverbe / préposition", "Introduit un groupe nominal devant le verbe principal : 在, 畀, 㧯…",
     "Souvent aussi verbe plein (在 « se trouver », 畀 « donner ») : c'est un coverbe quand un autre verbe suit, dans la même phrase.",
     "ADP"),
    ("category", "ASP", "marque d'aspect", "Dit comment l'action se déroule : accomplie (倒), déjà vécue (過), en cours, continue…",
     "Collée après le verbe, jamais seule ; ne se traduit pas par un mot français mais par un temps.",
     "AUX"),
    ("category", "PART", "particule finale", "En fin de phrase, change sa modalité : question (無 mo¹), constat, insistance (嘅).",
     "Retirée, la phrase reste correcte mais change de valeur (question → affirmation).",
     "PART"),
    ("category", "CONJ", "conjonction", "Relie deux groupes ou deux propositions : 㧯 « et », 但係 « mais »…",
     "Entre les deux éléments qu'elle relie ; ne porte ni aspect ni négation.",
     "CCONJ / SCONJ"),
    ("category", "INTERJ", "interjection", "Exclamation, appel, réponse : 哎, 係啊…",
     "Hors de la construction : peut former un énoncé à elle seule.",
     "INTJ"),
    ("phrase", "P", "phrase", "L'énoncé complet : un sujet (parfois sous-entendu) et ce qu'on en dit.",
     "Peut se dire seul et se transformer en question avec 無 en fin.",
     "root"),
    ("phrase", "GN", "groupe nominal", "Un nom et ce qui le détermine : (DÉM / NUM + CL) (… 嘅) N.",
     "Peut être remplacé en bloc par un pronom (佢) ou par « quoi ? » / « qui ? ».",
     "nominal"),
    ("phrase", "GV", "groupe verbal", "Le verbe (ou l'adjectif) avec sa négation, ses marques d'aspect et ses compléments.",
     "Se nie en bloc par 唔 / 冇 placé devant ; répond à « que fait-il ? ».",
     "prédicat"),
    ("phrase", "GP", "groupe prépositionnel", "Un coverbe et son groupe nominal, devant le verbe principal : 在學校, 畀蚊仔.",
     "Peut se déplacer ou disparaître sans que la phrase devienne fausse : il est complément, pas noyau.",
     "obl"),
    ("function", "sujet", "sujet", "Ce dont on dit quelque chose ; en général avant le verbe.",
     "Répond à « qui ? / qu'est-ce qui ? » avant le verbe ; souvent omis quand il est connu.",
     "nsubj"),
    ("function", "préd", "prédicat", "Ce qu'on dit du sujet : le groupe verbal ou adjectival.",
     "C'est la partie qui porte la négation et l'aspect.",
     "root"),
    ("function", "obj", "objet (COD)", "Ce sur quoi porte l'action, après le verbe.",
     "Répond à « quoi ? » après le verbe ; peut passer en tête comme thème (豬肉，𠊎唔食).",
     "obj"),
    ("function", "attr", "attribut", "Ce que le sujet est, après 係.",
     "Remplacez 係 par une autre copule ou supprimez-le : avec un adjectif, 係 est inutile (佢好靚).",
     "root + cop"),
    ("function", "compl", "complément circonstanciel", "Temps, lieu, manière, cause… de l'action.",
     "Peut se déplacer en tête de phrase (今晡日，𠊎去) ou disparaître sans rendre la phrase fausse.",
     "obl / advmod"),
    ("function", "dét", "déterminant", "Ce qui détermine un nom : démonstratif, numéral + classificateur, possesseur.",
     "Devant le nom, jamais après ; répond à « lequel ? / combien ? / à qui ? ».",
     "det / nummod / clf / nmod:poss"),
    ("function", "mod", "modifieur", "Ce qui qualifie un nom (avec 嘅) ou un verbe (adverbe).",
     "Peut être retiré : le groupe garde sa fonction (好靚嘅衫 → 衫).",
     "amod / advmod / acl"),
    ("function", "thème", "thème (topique)", "Ce dont on parle, mis en tête de phrase avant le sujet, souvent suivi d'une pause.",
     "Peut être suivi d'une virgule à l'écrit ; reprend souvent un objet déplacé (豬肉，𠊎唔食).",
     "dislocated"),
]


def ensure_seed():
    """Crée les étiquettes de la base qui manquent ; complète celles qui
    existent (même type, même abréviation) sans rien écraser. Renvoie le
    nombre d'étiquettes créées."""
    existing = {(t.kind, t.code): t for t in GrammarTag.objects.all()}
    created = 0
    for i, (kind, code, name, description, tests, equivalent) in enumerate(SEED):
        tag = existing.get((kind, code))
        if tag is None:
            GrammarTag.objects.create(kind=kind, code=code, name=name, description=description, tests=tests,
                                      equivalent=equivalent, position=i)
            created += 1
            continue
        changed = [f for f, v in (("description", description), ("tests", tests), ("equivalent", equivalent))
                   if not getattr(tag, f) and v]
        for f in changed:
            setattr(tag, f, dict(description=description, tests=tests, equivalent=equivalent)[f])
        if changed:
            tag.save(update_fields=changed)
    return created


def _read(request):
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _bad(message, status=400):
    return JsonResponse({"error": message}, status=status)


def _json(data, status=200):
    return JsonResponse(data, status=status, json_dumps_params={"ensure_ascii": False})


def _clean(value, size):
    return " ".join(str(value or "").split())[:size]


# ---- Les étiquettes ------------------------------------------------------------------------------

def tag_uses():
    """{tag id: nombre d'emplois} dans les analyses (mots et groupes)."""
    uses = Counter()
    for tokens, groups in SentenceAnalysis.objects.values_list("tokens", "groups"):
        for item in list(tokens or []) + list(groups or []):
            for field in ("c", "f"):
                if isinstance(item.get(field), int):
                    uses[item[field]] += 1
    return uses


def tags_json():
    uses = tag_uses()
    return [{"id": t.id, "kind": t.kind, "code": t.code, "name": t.name, "description": t.description,
             "tests": t.tests, "equivalent": t.equivalent,
             "parent": t.parent_id, "status": t.status, "uses": uses.get(t.id, 0)}
            for t in GrammarTag.objects.all()]


class Tags:
    """Les étiquettes chargées une fois : par id, par nom ou code, et leurs
    descendants (un schéma qui demande V accepte V de mouvement)."""

    def __init__(self, tags=None):
        self.list = list(tags if tags is not None else GrammarTag.objects.all())
        self.by_id = {t.id: t for t in self.list}
        children = defaultdict(list)
        for t in self.list:
            if t.parent_id:
                children[t.parent_id].append(t.id)
        self._children = children

    def kind(self, tag_id):
        t = self.by_id.get(tag_id)
        return t.kind if t else None

    def below(self, tag_id):
        """L'étiquette et toutes celles qui la précisent."""
        out, todo = {tag_id}, [tag_id]
        while todo:
            for c in self._children[todo.pop()]:
                if c not in out:
                    out.add(c)
                    todo.append(c)
        return out

    def find(self, text, kinds=None):
        """L'étiquette nommée par `text` (son code, sinon son nom), sans tenir
        compte de la casse ni des accents ; le code d'abord."""
        key = fold(text).strip()
        if not key:
            return None
        pool = [t for t in self.list if kinds is None or t.kind in kinds]
        for attr in ("code", "name"):
            for t in pool:
                if fold(getattr(t, attr)).strip() == key:
                    return t
        return None


@require_GET
@owner_required
def api_tags(request):
    return _json({"tags": tags_json()})


@require_POST
@owner_required
def api_tag(request):
    p = _read(request)
    if p is None:
        return _bad("Demande invalide.")
    action = p.get("action")
    with transaction.atomic():
        if action == "seed":
            return _json({"ok": True, "created": ensure_seed(), "tags": tags_json()})
        if action == "create":
            kind = p.get("kind")
            if kind not in KINDS:
                return _bad("Type d'étiquette inconnu.")
            code = _clean(p.get("code"), 20)
            if not code:
                return _bad("Donnez au moins une abréviation (N, GN, sujet…).")
            if GrammarTag.objects.filter(kind=kind, code__iexact=code).exists():
                return _bad(f"« {code} » existe déjà.", 409)
            parent = _parent(p.get("parent"), kind)
            if parent is False:
                return _bad("L'étiquette générale doit être du même type.")
            last = GrammarTag.objects.filter(kind=kind).aggregate(m=Max("position"))["m"]
            tag = GrammarTag.objects.create(kind=kind, code=code, name=_clean(p.get("name"), 100),
                                            description=str(p.get("description") or "")[:2000].strip(), parent=parent,
                                            tests=str(p.get("tests") or "")[:2000].strip(),
                                            equivalent=_clean(p.get("equivalent"), 60),
                                            position=0 if last is None else last + 1)
            return _json({"ok": True, "id": tag.id, "tags": tags_json()})

        tag = GrammarTag.objects.filter(id=p.get("id")).first() if isinstance(p.get("id"), int) else None
        if tag is None:
            return _bad("Étiquette introuvable : rechargez la page.", 404)
        if action == "accept":
            tag.status = GrammarTag.STATUS_OK
            tag.save(update_fields=["status"])
        elif action == "update":
            if "code" in p:
                code = _clean(p.get("code"), 20)
                if not code:
                    return _bad("L'abréviation est vide.")
                if GrammarTag.objects.filter(kind=tag.kind, code__iexact=code).exclude(id=tag.id).exists():
                    return _bad(f"« {code} » existe déjà.", 409)
                tag.code = code
            if "name" in p:
                tag.name = _clean(p.get("name"), 100)
            if "description" in p:
                tag.description = str(p.get("description") or "")[:2000].strip()
            if "tests" in p:
                tag.tests = str(p.get("tests") or "")[:2000].strip()
            if "equivalent" in p:
                tag.equivalent = _clean(p.get("equivalent"), 60)
            if "parent" in p:
                parent = _parent(p.get("parent"), tag.kind)
                if parent is False or (parent and parent.id in Tags().below(tag.id)):
                    return _bad("Cette étiquette ne peut pas être rangée là.")
                tag.parent = parent
            tag.save()
        elif action == "delete":
            used = tag_uses().get(tag.id, 0)
            if used and not p.get("force"):
                return _bad(f"Cette étiquette sert dans {used} analyse(s) : confirmez pour l'en retirer.", 409)
            if used:
                _forget_tag(tag.id)
            tag.delete()
        else:
            return _bad("Action inconnue.")
    return _json({"ok": True, "tags": tags_json()})


def _parent(value, kind):
    """L'étiquette générale demandée : None (aucune), False (refusée)."""
    if value in (None, "", 0):
        return None
    parent = GrammarTag.objects.filter(id=value).first() if isinstance(value, int) else None
    return parent if parent and parent.kind == kind else False


def _forget_tag(tag_id):
    for a in SentenceAnalysis.objects.all():
        changed = False
        for item in list(a.tokens or []) + list(a.groups or []):
            for field in ("c", "f"):
                if item.get(field) == tag_id:
                    item[field] = None
                    changed = True
        if changed:
            a.save(update_fields=["tokens", "groups"])


# ---- Vérifier une analyse ------------------------------------------------------------------------

def check(tokens, groups, tags):
    """(tokens, groups) nettoyés, ou une erreur (str). Les étiquettes
    inconnues ou du mauvais type sont oubliées ; les groupes doivent être
    dans la phrase, distincts, emboîtés et jamais à cheval."""
    if not isinstance(tokens, list) or not tokens:
        return "L'analyse n'a aucun mot."
    if len(tokens) > MAX_TOKENS:
        return f"Trop de mots (plus de {MAX_TOKENS})."
    if not isinstance(groups, list):
        return "Groupes invalides."

    def tag(value, kind):
        return value if isinstance(value, int) and not isinstance(value, bool) and tags.kind(value) == kind else None

    clean_tokens = []
    for t in tokens:
        if not isinstance(t, dict):
            return "Mot invalide."
        text = "".join(str(t.get("t") or "").split())[:40]
        if not text:
            return "Un mot est vide."
        clean_tokens.append({"t": text, "p": _clean(t.get("p"), 60), "c": tag(t.get("c"), GrammarTag.KIND_CATEGORY),
                             "f": tag(t.get("f"), GrammarTag.KIND_FUNCTION), "g": _clean(t.get("g"), 100)})
    n = len(clean_tokens)
    clean_groups, spans = [], set()
    for g in groups:
        if not isinstance(g, dict):
            return "Groupe invalide."
        s, e = g.get("s"), g.get("e")
        if not all(isinstance(x, int) and not isinstance(x, bool) for x in (s, e)) or not 0 <= s < e <= n:
            return "Un groupe sort de la phrase."
        if (s, e) in spans:
            return "Deux groupes portent sur les mêmes mots."
        for (s2, e2) in spans:
            if s < s2 < e < e2 or s2 < s < e2 < e:
                return "Deux groupes se chevauchent : un groupe doit être dans l'autre, ou à côté."
        spans.add((s, e))
        clean_groups.append({"s": s, "e": e, "c": tag(g.get("c"), GrammarTag.KIND_PHRASE),
                             "f": tag(g.get("f"), GrammarTag.KIND_FUNCTION)})
    clean_groups.sort(key=lambda g: (g["s"], -g["e"]))
    return clean_tokens, clean_groups


def bracketed(tokens, groups, tags):
    """L'arbre en une ligne : [P [GN:sujet 我/PRO] [GV 唔/NÉG 食/V]]."""
    def label(item):
        parts = [tags.by_id[x].code for x in (item.get("c"), item.get("f")) if x in tags.by_id]
        return ":".join(parts)

    out = []
    opened = []
    order = sorted(groups, key=lambda g: (g["s"], -g["e"]))
    gi = 0
    for i, t in enumerate(tokens):
        while opened and opened[-1] <= i:
            opened.pop()
            out.append("]")
        while gi < len(order) and order[gi]["s"] == i:
            out.append("[" + (label(order[gi]) or "·"))
            opened.append(order[gi]["e"])
            gi += 1
        word = t["t"] + (f"/{label(t)}" if label(t) else "")
        out.append(word)
    out.extend("]" * len(opened))
    text = " ".join(out)
    return text.replace(" ]", "]")


def wrap_word_functions(tokens, groups, tags):
    """La consigne « les fonctions aux groupes, jamais aux mots » appliquée à
    une analyse : un nom ou un pronom (N, PRO et ce qui les précise) qui porte
    lui-même une fonction devient un groupe nominal d'un seul mot,
    [GN:sujet 佢/PRO], et le mot ne garde que sa catégorie. S'il est déjà seul
    dans un groupe, la fonction passe à ce groupe.

    Renvoie (tokens, groups, changés, laissés) : `changés` les indices des mots
    repris, `laissés` [(indice, raison)] ceux qu'on ne touche pas (autre
    catégorie, fonction différente déjà sur son groupe) — à revoir à la main.
    Sans étiquette GN, rien n'est changé. Les listes reçues ne sont pas modifiées."""
    gn = tags.find("GN", {GrammarTag.KIND_PHRASE})
    nominal = set()
    for code in ("N", "PRO"):
        t = tags.find(code, {GrammarTag.KIND_CATEGORY})
        if t:
            nominal |= tags.below(t.id)
    tokens = [dict(t) for t in tokens]
    groups = [dict(g) for g in groups]
    changed, left = [], []
    if gn is None:
        return tokens, groups, changed, [(i, "pas d'étiquette GN") for i, t in enumerate(tokens) if t.get("f")]
    for i, t in enumerate(tokens):
        if not t.get("f"):
            continue
        if t.get("c") not in nominal:
            left.append((i, "ni nom ni pronom"))
            continue
        alone = next((g for g in groups if g["s"] == i and g["e"] == i + 1), None)
        if alone is None:
            groups.append({"s": i, "e": i + 1, "c": gn.id, "f": t["f"]})
        elif alone.get("f") not in (None, t["f"]):
            left.append((i, "son groupe a déjà une autre fonction"))
            continue
        else:
            alone["f"] = t["f"]
            alone["c"] = alone.get("c") or gn.id
        t["f"] = None
        changed.append(i)
    groups.sort(key=lambda g: (g["s"], -g["e"]))
    return tokens, groups, changed, left


# ---- Le schéma d'une règle -----------------------------------------------------------------------

def parse_pattern(pattern, tags):
    """« GN:sujet + Nég + V (+ GN:objet) » -> les éléments, dans l'ordre :
    [{text, kind: tag|word|reading|any|unknown, optional, tags: [[ids…] par
    alternative], ...}]. « … » : n'importe quels mots ; « V|ADJ » : l'un ou
    l'autre ; ( ) : facultatif ; un caractère ou une lecture : ce mot-là."""
    parts, depth = [], 0
    for piece in re.findall(r"\(|\)|\+|[^()+]+", pattern or ""):
        if piece == "(":
            depth += 1
        elif piece == ")":
            depth = max(0, depth - 1)
        elif piece != "+" and piece.strip():
            parts.append(_element(piece.strip(), depth > 0, tags))
    return parts


def _element(text, optional, tags):
    base = {"text": text, "optional": optional}
    if text in ("…", "...", "*"):
        return {**base, "kind": "any"}
    if HAN.search(text):
        return {**base, "kind": "word", "value": "".join(HAN.findall(text))}
    alternatives = []
    for alt in re.split(r"[|/]", text):
        alt = alt.strip()
        if not alt:
            continue
        wanted = []
        if ":" in alt:
            head, fn = alt.split(":", 1)
            a = tags.find(head, {GrammarTag.KIND_CATEGORY, GrammarTag.KIND_PHRASE})
            b = tags.find(fn, {GrammarTag.KIND_FUNCTION})
            if not a or not b:
                alternatives = None
                break
            wanted = [a.id, b.id]
        else:
            a = tags.find(alt)
            if not a:
                alternatives = None
                break
            wanted = [a.id]
        alternatives.append(wanted)
    if alternatives:
        return {**base, "kind": "tag", "tags": alternatives,
                "codes": [":".join(tags.by_id[i].code for i in alt) for alt in alternatives]}
    if re.fullmatch(r"(?:[a-zA-ZÀ-ɏŋεɔ'’]+[0-9¹²³⁴⁵⁶⁷⁸]?\s*)+", text):
        return {**base, "kind": "reading", "value": fold(text).replace(" ", "")}
    return {**base, "kind": "unknown"}


def _units(tokens, groups):
    """Ce qu'un élément du schéma peut couvrir, par mot de départ : chaque mot
    seul, chaque groupe, et toute suite de mots (pour un caractère, une lecture)."""
    by_start = defaultdict(list)
    for i, t in enumerate(tokens):
        by_start[i].append(("token", i, i + 1, t))
    for g in groups:
        by_start[g["s"]].append(("group", g["s"], g["e"], g))
    return by_start


def _fits(element, unit, tokens, tags):
    what, s, e, item = unit
    if element["kind"] == "tag":
        for alternative in element["tags"]:
            ok = True
            for tag_id in alternative:
                kind = tags.kind(tag_id)
                if kind == GrammarTag.KIND_CATEGORY:
                    ok = what == "token" and item.get("c") in tags.below(tag_id)
                elif kind == GrammarTag.KIND_PHRASE:
                    ok = what == "group" and item.get("c") in tags.below(tag_id)
                else:
                    ok = item.get("f") in tags.below(tag_id)
                if not ok:
                    break
            if ok:
                return True
        return False
    return False


def _reading(text, toned):
    """Une lecture comparable : avec ses tons (ng2) si le schéma en donne, sinon sans."""
    return fold(text).replace(" ", "") if toned else search_sources.reading_key(text)


def _word_ends(element, tokens, start):
    """Les fins possibles d'un caractère ou d'une lecture à partir du mot `start`."""
    toned = bool(re.search(r"\d", element["value"]))
    target = element["value"] if element["kind"] == "word" else _reading(element["value"], toned)
    ends, text = [], ""
    for j in range(start, len(tokens)):
        text += "".join(HAN.findall(tokens[j]["t"])) if element["kind"] == "word" else _reading(tokens[j]["p"], toned)
        if text == target:
            ends.append(j + 1)
        if not target.startswith(text) or not text:
            break
    return ends


def match(parts, tokens, groups, tags):
    """(début, fin) des mots qui suivent le schéma, sinon None. Le schéma peut
    commencer n'importe où dans la phrase."""
    if not parts or not tokens:
        return None
    units = _units(tokens, groups)
    n = len(tokens)
    memo = {}

    def ends(k, i):
        """Les fins possibles des éléments k… à partir du mot i."""
        if (k, i) not in memo:
            memo[(k, i)] = sorted(set(_ends(k, i)))
        return memo[(k, i)]

    def _ends(k, i):
        if k == len(parts):
            return [i]
        element = parts[k]
        out = []
        if element["optional"] or element["kind"] == "any":
            out += ends(k + 1, i)
        if element["kind"] == "any":
            for j in range(i + 1, n + 1):
                out += ends(k + 1, j)
        elif element["kind"] in ("word", "reading"):
            for j in _word_ends(element, tokens, i):
                out += ends(k + 1, j)
        elif i < n:
            for unit in units[i]:
                if _fits(element, unit, tokens, tags):
                    out += ends(k + 1, unit[2])
        return out

    for start in range(n):
        found = ends(0, start)
        found = [e for e in found if e > start]
        if found:
            return start, max(found)
    return None


def conformity(parts, analysis, tags):
    """Pour un exemple : {"ok": True/False, "span": [s, e]} — ou None quand on
    ne peut pas juger (pas de schéma, un élément inconnu, pas d'analyse)."""
    if not parts or analysis is None or any(p["kind"] == "unknown" for p in parts):
        return None
    found = match(parts, analysis.tokens or [], analysis.groups or [], tags)
    return {"ok": found is not None, "span": list(found) if found else None}


# ---- Le premier découpage d'une phrase -----------------------------------------------------------

def _word_index():
    """{hanzi: lecture} des mots du lexique, et la longueur du plus long."""
    def build():
        index = {}
        for w in search_sources.lexicon()["words"]:
            index.setdefault(w["hanzi"], w["pinyin"])
            simp, trad = to_simp(w["hanzi"]), to_trad(w["hanzi"])
            index.setdefault(simp, w["pinyin"])
            index.setdefault(trad, w["pinyin"])
        return index, max((len(k) for k in index), default=1)
    return search_sources.cached("grammar-words", build)


def _split_reading(pinyin):
    return SYLLABLE.findall(pinyin or "")


def segment(sentence):
    """Les mots d'une phrase, [{t, p}] : son découpage connu (les espaces de
    l'expression ou de l'ajout), sinon le plus long mot du lexique à chaque
    pas ; la ponctuation est laissée de côté."""
    spaced = (sentence.get("spaced") or "").split()
    readings = (sentence.get("pinyin") or "").split()
    if len(spaced) > 1:
        words = [w for w in spaced if not PUNCTUATION.match(w)]
        if len(readings) == len(spaced):
            pairs = [(w, r) for w, r in zip(spaced, readings) if not PUNCTUATION.match(w)]
            return [{"t": w, "p": r} for w, r in pairs]
        return _with_readings([{"t": w, "p": ""} for w in words], sentence.get("pinyin"))
    text = sentence.get("hanzi") or ""
    index, longest = _word_index()
    out, i = [], 0
    while i < len(text):
        c = text[i]
        if c.isspace() or PUNCTUATION.match(c):
            i += 1
            continue
        if not HAN.match(c):
            j = i
            while j < len(text) and not HAN.match(text[j]) and not text[j].isspace() and not PUNCTUATION.match(text[j]):
                j += 1
            out.append({"t": text[i:j], "p": ""})
            i = j
            continue
        for size in range(min(longest, len(text) - i), 0, -1):
            piece = text[i:i + size]
            if size == 1 or piece in index:
                out.append({"t": piece, "p": index.get(piece, "")})
                i += size
                break
    return _with_readings(out, sentence.get("pinyin"))


def _with_readings(tokens, pinyin):
    """La lecture de la phrase répartie sur ses mots, quand elle a une syllabe par caractère."""
    syllables = _split_reading(pinyin)
    chars = sum(max(1, len(HAN.findall(t["t"]))) for t in tokens)
    if syllables and len(syllables) == chars:
        at = 0
        for t in tokens:
            k = max(1, len(HAN.findall(t["t"])))
            t["p"] = "".join(syllables[at:at + k])
            at += k
    return tokens


def guesses():
    """{mot: catégorie la plus fréquente} d'après les analyses déjà faites."""
    seen = defaultdict(Counter)
    for tokens in SentenceAnalysis.objects.values_list("tokens", flat=True):
        for t in tokens or []:
            if isinstance(t.get("c"), int):
                seen[t.get("t")][t["c"]] += 1
    return {word: counter.most_common(1)[0][0] for word, counter in seen.items()}


def draft(sentence):
    """Un premier découpage, les catégories devinées d'après les analyses faites."""
    tokens = segment(sentence)
    known = guesses()
    for t in tokens:
        t.update({"c": known.get(t["t"]), "f": None, "g": "", "guessed": t["t"] in known})
    return tokens


# ---- Les vues : une analyse ----------------------------------------------------------------------

def _sentence(target_type, target_key):
    from .grammar import sentences

    if target_type not in TARGETS or not isinstance(target_key, str) or not target_key:
        return None
    found = sentences({target_type: {target_key}})
    return found[0] if found else None


def analysis_json(a, sentence=None):
    stale = bool(sentence) and search_sources.han_only(a.text) != search_sources.han_only(sentence["hanzi"])
    return {"id": a.id, "tokens": a.tokens, "groups": a.groups, "note": a.note, "source": a.source,
            "updated_at": a.updated_at.isoformat(), "stale": stale, "text": a.text}


@require_GET
@owner_required
def api_analysis(request):
    from .ai import ai_enabled

    target_type, target_key = request.GET.get("type", ""), request.GET.get("key", "")
    sentence = _sentence(target_type, target_key)
    saved = SentenceAnalysis.objects.filter(target_type=target_type, target_key=target_key).first()
    if sentence is None and saved is None:
        return _bad("Phrase introuvable.", 404)
    return _json({
        "sentence": sentence, "ai": ai_enabled(),
        "analysis": analysis_json(saved, sentence) if saved else None,
        "draft": draft(sentence) if sentence else None,
        "rules": list(GrammarExample.objects.filter(target_type=target_type, target_key=target_key)
                      .values_list("rule__title", flat=True)),
    })


@require_POST
@owner_required
def api_save_analysis(request):
    p = _read(request)
    if p is None:
        return _bad("Demande invalide.")
    target_type, target_key = p.get("target_type"), p.get("target_key")
    if target_type not in TARGETS or not isinstance(target_key, str) or not target_key:
        return _bad("Phrase invalide.")
    if p.get("action") == "delete":
        SentenceAnalysis.objects.filter(target_type=target_type, target_key=target_key).delete()
        return _json({"ok": True})
    if p.get("action") != "save":
        return _bad("Action inconnue.")
    sentence = _sentence(target_type, target_key)
    if sentence is None:
        return _bad("Phrase introuvable : elle a peut-être été supprimée.", 404)
    result = check(p.get("tokens"), p.get("groups") or [], Tags())
    if isinstance(result, str):
        return _bad(result)
    tokens, groups = result
    from .grammar import _label

    analysis, _created = SentenceAnalysis.objects.update_or_create(
        target_type=target_type, target_key=target_key,
        defaults={"tokens": tokens, "groups": groups, "text": sentence["hanzi"][:400], "label": _label(sentence),
                  "note": str(p.get("note") or "")[:5000].strip(),
                  "source": SentenceAnalysis.SOURCE_AI if p.get("source") == "ai" else SentenceAnalysis.SOURCE_MANUAL,
                  "updated_by": request.user})
    return _json({"ok": True, "analysis": analysis_json(analysis, sentence),
                  "bracketed": bracketed(tokens, groups, Tags())})


# ---- L'IA : une proposition d'analyse ------------------------------------------------------------

AI_PROMPT = """You help a French-speaking linguist write a grammar of the Hakka spoken by the Chinese community of Tahiti (French Polynesia). You analyse one example sentence at a time, in two ways:
- linear: the sentence's words in order, each with its word category and a short French gloss (function: null — functions belong to groups);
- constituents: the groups of neighbouring words (noun phrase, verb phrase, the whole sentence…), nested and never overlapping, each with its phrase category and its function. A word that fills a function on its own forms a one-word group: a pronoun or bare noun subject is a noun phrase of one word with the function "sujet" ([GN:sujet 佢/PRO]), never a word carrying the function itself.

Use the linguist's own labels, given with their codes. Use a code only for its own kind (word category, phrase, function). Prefer an existing label whenever one fits, even roughly; propose a new one in new_tags only when none fits, with a short French name and a one-sentence French description saying what it covers. A new label's code is short (2 to 6 letters, French abbreviations like the existing ones).

Rules:
- Keep the words exactly as given (same order, same characters, same count): the segmentation is the linguist's. Give one entry per given word.
- start and end of a group count words from 0; end is the index after the group's last word. A group covers at least one word, the sentence group may cover all of them.
- Hakka grammar is not Mandarin grammar: rely on the French translation and on the linguist's earlier analyses, given as examples, rather than on Mandarin usage. Characters may be used for their sound only.
- explanation: two or three short French sentences on the choices that are not obvious.
- confidence: "haute", "moyenne" or "basse"."""


def _ai_schema():
    tag_ref = {"type": "string"}
    return {
        "type": "object",
        "properties": {
            "words": {"type": "array", "items": {"type": "object", "properties": {
                "category": tag_ref, "function": tag_ref, "gloss": {"type": "string"}},
                "required": ["category", "function", "gloss"], "additionalProperties": False}},
            "groups": {"type": "array", "items": {"type": "object", "properties": {
                "start": {"type": "integer"}, "end": {"type": "integer"}, "category": tag_ref, "function": tag_ref},
                "required": ["start", "end", "category", "function"], "additionalProperties": False}},
            "new_tags": {"type": "array", "items": {"type": "object", "properties": {
                "kind": {"type": "string", "enum": ["category", "phrase", "function"]}, "code": {"type": "string"},
                "name": {"type": "string"}, "description": {"type": "string"}},
                "required": ["kind", "code", "name", "description"], "additionalProperties": False}},
            "explanation": {"type": "string"},
            "confidence": {"type": "string", "enum": ["haute", "moyenne", "basse"]},
        },
        "required": ["words", "groups", "new_tags", "explanation", "confidence"],
        "additionalProperties": False,
    }


def _examples_for_ai(tags, skip, limit=6):
    out = []
    for a in SentenceAnalysis.objects.exclude(target_type=skip[0], target_key=skip[1]).order_by("-updated_at")[:limit]:
        out.append({"sentence": a.label, "analysis": bracketed(a.tokens or [], a.groups or [], tags)})
    return out


@require_POST
@owner_required
def api_ai_analysis(request):
    from . import ai

    p = _read(request)
    if p is None:
        return _bad("Demande invalide.")
    if not ai.ai_enabled():
        return _bad("L'IA n'est pas configurée sur ce serveur (ANTHROPIC_API_KEY).", 503)
    sentence = _sentence(p.get("target_type"), p.get("target_key"))
    if sentence is None:
        return _bad("Phrase introuvable.", 404)
    tags = Tags()
    result = check(p.get("tokens"), [], tags)
    if isinstance(result, str):
        return _bad(result)
    tokens, _groups = result
    if ai._over_limit(request.user):
        return _bad(f"Limite de {ai.DAILY_LIMIT} demandes à l'IA par jour atteinte.", 429)

    labels = [{"kind": t.kind, "code": t.code, "name": t.name, "description": t.description,
               "how_to_recognise": t.tests, "universal_dependencies": t.equivalent,
               "broader": tags.by_id[t.parent_id].code if t.parent_id in tags.by_id else ""}
              for t in tags.list if t.status == GrammarTag.STATUS_OK]
    rules = list(GrammarExample.objects.filter(target_type=p["target_type"], target_key=p["target_key"])
                 .values_list("rule__title", "rule__pattern"))
    message = {
        "sentence": {"hanzi": sentence["hanzi"], "reading": sentence["pinyin"], "french": sentence["french"]},
        "words": [{"index": i, "hanzi": t["t"], "reading": t["p"]} for i, t in enumerate(tokens)],
        "rules_quoting_it": [{"title": r[0], "pattern": r[1]} for r in rules],
        "earlier_analyses": _examples_for_ai(tags, (p["target_type"], p["target_key"])),
    }
    import anthropic

    try:
        response = ai._client().beta.messages.create(
            model=ai.MODEL, max_tokens=4000,
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": _ai_schema()}},
            cache_control={"type": "ephemeral"},
            system=AI_PROMPT + "\n\nThe linguist's labels:\n" + json.dumps(labels, ensure_ascii=False),
            messages=[{"role": "user", "content": json.dumps(message, ensure_ascii=False)}],
        )
    except anthropic.RateLimitError:
        return _bad("L'IA est très demandée : réessayez dans une minute.", 429)
    except anthropic.APIConnectionError:
        return _bad("L'IA ne répond pas : réessayez plus tard.", 503)
    except anthropic.APIStatusError as e:
        logger.exception("AI analysis: API error %s", e.status_code)
        return _bad("L'IA a renvoyé une erreur : réessayez plus tard.", 502)
    if response.stop_reason in ("refusal", "max_tokens"):
        return _bad("L'IA n'a pas pu analyser cette phrase : réessayez.", 502)
    try:
        data = json.loads(next((b.text for b in response.content if b.type == "text"), ""))
    except json.JSONDecodeError:
        return _bad("Réponse de l'IA illisible : réessayez.", 502)
    logger.info("AI analysis by %s: in=%s out=%s", request.user.username, response.usage.input_tokens,
                response.usage.output_tokens)
    return _json({"ok": True, **apply_proposal(data, tokens, tags)})


def apply_proposal(data, tokens, tags):
    """La réponse de l'IA sur les mots donnés : les étiquettes nouvelles sont
    créées « proposées » ; les codes inconnus et les groupes à cheval oubliés."""
    created = []
    with transaction.atomic():
        for new in (data.get("new_tags") or [])[:10]:
            kind, code = new.get("kind"), _clean(new.get("code"), 20)
            if kind not in KINDS or not code or tags.find(code, {kind}):
                continue
            tag = GrammarTag.objects.create(kind=kind, code=code, name=_clean(new.get("name"), 100),
                                            description=str(new.get("description") or "")[:2000],
                                            status=GrammarTag.STATUS_PROPOSED, position=999)
            created.append(tag.code)
    if created:
        tags = Tags()

    def ref(code, kind):
        t = tags.find(code or "", {kind})
        return t.id if t else None

    words = data.get("words") or []
    out_tokens = []
    for i, t in enumerate(tokens):
        w = words[i] if i < len(words) and isinstance(words[i], dict) else {}
        out_tokens.append({**t, "c": ref(w.get("category"), GrammarTag.KIND_CATEGORY) or t.get("c"),
                           "f": ref(w.get("function"), GrammarTag.KIND_FUNCTION),
                           "g": _clean(w.get("gloss"), 100) or t.get("g", "")})
    groups = []
    for g in data.get("groups") or []:
        if not isinstance(g, dict):
            continue
        candidate = groups + [{"s": g.get("start"), "e": g.get("end"), "c": ref(g.get("category"), GrammarTag.KIND_PHRASE),
                               "f": ref(g.get("function"), GrammarTag.KIND_FUNCTION)}]
        if not isinstance(check(out_tokens, candidate, tags), str):
            groups = candidate
    _tokens, groups = check(out_tokens, groups, tags)
    # La consigne « les fonctions aux groupes » : un nom ou pronom que l'IA
    # aurait laissé avec sa fonction devient un GN d'un mot.
    out_tokens, groups, _changed, _left = wrap_word_functions(out_tokens, groups, tags)
    return {"tokens": out_tokens, "groups": groups, "new_tags": created, "tags": tags_json(),
            "explanation": _clean(data.get("explanation"), 1000),
            "confidence": data.get("confidence") if data.get("confidence") in ("haute", "moyenne", "basse") else "basse"}
