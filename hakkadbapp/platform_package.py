"""Page « Plateforme » → « Préparer un zip pour e-reo » : au format JSON de
la plateforme (wordCorpus.json / expressionCorpus.json / themeCorpus.json),
au choix et ensemble :
- les ajouts validés pas encore sur la plateforme (origin « addition ») :
  JSON fabriqué ici, avec l'identifiant prévu de l'ajout ;
- les corrections « À faire » (ReviewComment, statut todo) : le JSON de
  l'élément tel que le dernier instantané le donne, la valeur proposée à la
  place de l'ancienne (même identifiant : e-reo met l'élément à jour) ;
- les audios d'un dossier local : les .wav nommés selon la convention de
  « À enregistrer » (voir audio_names), rattachés à leur élément.

Seuls les noms des .wav voyagent : le navigateur garde les fichiers et
fabrique lui-même le zip (les requêtes vers Vercel sont limitées en taille).

POST /api/plateforme/paquet  {"additions": bool, "corrections": bool, "names": ["on1lok6.wav", ...]}
→ {"items": [{id, kind, origin, label, payload, file, has_audio, changes}],
   "themes": {id: payload}, "unmatched": [noms], "warnings": [...]}

Le champ « audio » est rempli par le navigateur avec le nom du fichier : la
plateforme crée son propre identifiant d'audio à l'import."""
import json
import re

from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .audio_names import HAN_RE, safe_stem
from .models import LexiconAddition
from .permissions import owner_required

TO_SUPERSCRIPT = str.maketrans("12345678", "¹²³⁴⁵⁶⁷⁸")
SYLLABLE_RE = re.compile(r"[a-zA-Züāáǎàēéěèīíǐìōóǒòūúǔù'’]+[0-8¹²³⁴⁵⁶⁷⁸_]?")


def _key(name):
    """Clé de comparaison d'un nom de fichier (ou d'un pinyin, de
    caractères) : sans extension, sans signe, en minuscules."""
    name = str(name or "")
    if name.lower().endswith(".wav"):
        name = name[:-4]
    return safe_stem(name).lower()


def _theme_ids(names, theme_id_by_name):
    out = []
    for name in (names or "").split(","):
        theme_id = theme_id_by_name.get(name.strip().lower())
        if theme_id and theme_id not in out:
            out.append(theme_id)
    return out


def _expression_tokens(addition, syllables):
    """[(hanzi, pinyin)] par mot du maillage d'une expression ajoutée
    (« 若 爸爸 在 屋家 么 ») : les syllabes de son pinyin réparties sur les
    caractères, quand leur nombre correspond ; sinon None."""
    tokens = [t.split(":", 1)[0] for t in (addition.hanzi or "").split()]
    if sum(len(HAN_RE.findall(t)) for t in tokens) != len(syllables):
        return None
    out, i = [], 0
    for token in tokens:
        n = len(HAN_RE.findall(token))
        out.append((token, "".join(syllables[i:i + n]) if n else token))
        i += n
    return out


def _addition_payloads(additions, platform_words, theme_id_by_name, warnings):
    """{platform_id: (kind, payload, label)} pour des ajouts validés, au
    format de la plateforme."""
    from .text_to_words import REVERSE_PUNCT_MAP
    from .views import split_target

    words_by_hanzi = {}
    for platform_id, payload in platform_words.items():
        target = (payload.get("translations") or {}).get("target", "")
        hanzi = split_target(target)[1]
        if hanzi:
            words_by_hanzi.setdefault(hanzi, (platform_id, target))
    for a in additions:
        if a.kind == LexiconAddition.KIND_WORD:
            hanzi = "".join(a.hanzi.split())
            pinyin = "".join(s.translate(TO_SUPERSCRIPT) for s in SYLLABLE_RE.findall(a.pinyin or ""))
            words_by_hanzi.setdefault(hanzi, (a.platform_id, f"{pinyin} {hanzi}".strip()))

    out = {}
    in_expression = {}
    for a in additions:
        translations = {"primary": a.french or "", "secondary": a.english or ""}
        syllables = [s.translate(TO_SUPERSCRIPT) for s in SYLLABLE_RE.findall(a.pinyin or "")]
        if a.kind == LexiconAddition.KIND_WORD:
            hanzi = "".join(a.hanzi.split())
            translations["target"] = f"{''.join(syllables)} {hanzi}".strip()
            out[a.platform_id] = ("word", {
                "audio": "", "gloss_code": [], "image": "", "in_expression": [], "level": 0,
                "part_of_speech": "n", "themes": _theme_ids(a.themes, theme_id_by_name),
                "translations": translations, "variants": {},
            }, translations["target"])
            continue
        tokens = _expression_tokens(a, syllables)
        hanzi_all = "".join(a.hanzi.split())
        if tokens is None:
            warnings.append(f"« {a.hanzi} » : le pinyin ne correspond pas aux caractères, pinyin repris tel quel.")
            pinyin = " ".join(syllables)
            tokens = []
        else:
            pinyin = " ".join(p for _h, p in tokens).translate(REVERSE_PUNCT_MAP)
        components = {}
        for token, _p in tokens:
            if not HAN_RE.search(token):
                continue
            found = words_by_hanzi.get(token)
            if found:
                components[found[1]] = found[0]
                in_expression.setdefault(found[0], []).append(a.platform_id)
            else:
                warnings.append(f"« {a.hanzi} » : le mot « {token} » n'est ni sur la plateforme ni dans les ajouts validés.")
        translations["target"] = f"{pinyin} {hanzi_all}".strip()
        out[a.platform_id] = ("expression", {
            "audio": "", "components": dict(sorted(components.items())), "level": 0,
            "themes": _theme_ids(a.themes, theme_id_by_name), "translations": translations,
        }, translations["target"])
    for word_id, expr_ids in in_expression.items():
        if word_id in out and out[word_id][0] == "word":
            out[word_id][1]["in_expression"] = sorted(set(expr_ids))
    return out


def _corrections(platform_words, platform_expressions, warnings):
    """{platform_id: (kind, payload corrigé, [changements])} des corrections
    « À faire » sur les éléments du lexique."""
    from .models import Expression, ReviewComment, Word
    from .platform_corrections import PLATFORM_FIELDS

    remarks = list(ReviewComment.objects.filter(
        target_type__in=[ReviewComment.TARGET_WORD, ReviewComment.TARGET_EXPRESSION],
        status=ReviewComment.STATUS_TODO).order_by("created_at"))
    ids = {"word": dict(Word.objects.filter(id__in=[r.target_id for r in remarks if r.target_type == "word"])
                        .values_list("id", "platform_id")),
           "expression": dict(Expression.objects.filter(id__in=[r.target_id for r in remarks if r.target_type == "expression"])
                              .values_list("id", "platform_id"))}
    out = {}
    for r in remarks:
        if not (r.field and r.proposed_value):
            warnings.append(f"« {r.target_label} » : remarque sans valeur proposée, à faire à la main ({r.text[:80]}).")
            continue
        if r.field not in PLATFORM_FIELDS:
            warnings.append(f"« {r.target_label} » : le champ « {r.field} » ne se corrige pas par le zip, à faire à la main.")
            continue
        pid = ids[r.target_type].get(r.target_id)
        corpus = platform_words if r.target_type == "word" else platform_expressions
        if not pid or pid not in corpus:
            warnings.append(f"« {r.target_label} » : absent du dernier instantané de la plateforme, correction laissée de côté.")
            continue
        kind, payload, changes = out.get(pid) or (r.target_type, json.loads(json.dumps(corpus[pid])), [])
        field, label = PLATFORM_FIELDS[r.field]
        translations = payload.setdefault("translations", {})
        changes.append(f"{label} : « {translations.get(field, '')} » → « {r.proposed_value} »")
        translations[field] = r.proposed_value
        out[pid] = (kind, payload, changes)
    return out


def build(names=(), additions=False, corrections=False):
    from . import expression_mesh
    from .views import split_target

    platform_words, platform_expressions = expression_mesh.reference_corpora()
    theme_payloads = expression_mesh.reference_theme_payloads()
    theme_id_by_name = expression_mesh.reference_theme_map()

    files_by_key = {}
    for name in names:
        files_by_key.setdefault(_key(name), name)
    warnings = []
    items = {}
    matched = set()

    def item(item_id, kind, origin, payload, label):
        if item_id not in items:
            items[item_id] = {"id": item_id, "kind": kind, "origin": origin, "label": label, "payload": payload,
                              "file": "", "has_audio": bool(payload.get("audio")), "changes": []}
        return items[item_id]

    if corrections:
        for pid, (kind, payload, changes) in _corrections(platform_words, platform_expressions, warnings).items():
            target = (payload.get("translations") or {}).get("target", "")
            item(pid, kind, "platform", payload, f"{target} — {payload['translations'].get('primary', '')}")["changes"] = changes

    if files_by_key:
        for kind, corpus in (("word", platform_words), ("expression", platform_expressions)):
            for item_id, payload in corpus.items():
                target = (payload.get("translations") or {}).get("target", "")
                pinyin, hanzi = split_target(target)
                name = files_by_key.get(_key(pinyin if kind == "word" else hanzi))
                if name:
                    matched.add(name)
                    item(item_id, kind, "platform", payload,
                         f"{target} — {(payload.get('translations') or {}).get('primary', '')}")["file"] = name

    if additions or files_by_key:
        pending = [a for a in LexiconAddition.objects.filter(status=LexiconAddition.STATUS_VALIDATED)
                   if a.platform_id not in platform_words and a.platform_id not in platform_expressions]
        by_id = {a.platform_id: a for a in pending}
        for item_id, (kind, payload, target) in _addition_payloads(pending, platform_words, theme_id_by_name, warnings).items():
            a = by_id[item_id]
            name = files_by_key.get(_key(a.pinyin if kind == "word" else a.hanzi))
            if name:
                matched.add(name)
            if name or additions:
                item(item_id, kind, "addition", payload, f"{target} — {a.french}")["file"] = name or ""

    # Plusieurs éléments pour un même fichier (homophones) : tous gardés, signalés.
    count = {}
    for it in items.values():
        if it["file"]:
            count[it["file"]] = count.get(it["file"], 0) + 1
    for name, n in sorted(count.items()):
        if n > 1:
            warnings.append(f"{name} : {n} éléments ont ce nom de fichier (homophones), ils recevront le même audio.")

    themes = {}
    for it in items.values():
        for theme_id in it["payload"].get("themes") or []:
            if theme_id in theme_payloads:
                themes[theme_id] = theme_payloads[theme_id]
    out = sorted(items.values(), key=lambda r: (r["origin"] != "platform", r["kind"] != "word", r["label"]))
    return {"items": out, "themes": themes,
            "unmatched": sorted(n for n in names if n not in matched), "warnings": warnings}


def relink_additions(words, expressions):
    """Après un import de la plateforme : un ajout validé que la plateforme
    a reçu sous un autre identifiant (le sien) reprend cet identifiant --
    il n'est plus « pas encore sur la plateforme », ni proposé en double.
    Reconnu aux mêmes caractères et au même pinyin (sans signe ni espace,
    voir audio_names), quand un seul élément de la plateforme correspond.
    Renvoie le nombre d'ajouts reliés."""
    from .views import split_target

    def key(kind, hanzi, pinyin):
        return kind, safe_stem(hanzi), safe_stem(pinyin).lower()

    found = {}
    for kind, corpus in (("word", words), ("expression", expressions)):
        for item_id, payload in corpus.items():
            pinyin, hanzi = split_target((payload.get("translations") or {}).get("target", ""))
            found.setdefault(key(kind, hanzi, pinyin), []).append(item_id)
    taken = set(LexiconAddition.objects.values_list("platform_id", flat=True))
    linked = 0
    for a in LexiconAddition.objects.filter(status=LexiconAddition.STATUS_VALIDATED):
        if a.platform_id in words or a.platform_id in expressions:
            continue
        ids = found.get(key(a.kind, a.hanzi, a.pinyin), [])
        if len(ids) == 1 and ids[0] not in taken:
            taken.add(ids[0])
            a.platform_id = ids[0]
            a.save(update_fields=["platform_id"])
            linked += 1
    return linked


@require_POST
@owner_required
def package(request):
    try:
        data = json.loads(request.body or b"{}")
    except ValueError:
        return JsonResponse({"error": "Requête illisible."}, status=400)
    names = [str(n) for n in data.get("names") or [] if str(n).lower().endswith(".wav")][:5000]
    return JsonResponse(build(names, additions=bool(data.get("additions")), corrections=bool(data.get("corrections"))))
