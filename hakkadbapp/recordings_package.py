"""« À enregistrer » → « Préparer l'import plateforme » : à partir des noms
des fichiers .wav d'un dossier local (nommés selon la convention de la page,
voir audio_names), les mots et expressions qu'ils enregistrent, au format
JSON de la plateforme (wordCorpus.json / expressionCorpus.json).

Seuls les noms voyagent : le navigateur garde les fichiers audio et
fabrique lui-même le zip (les requêtes vers Vercel sont limitées en taille).

POST /api/a-enregistrer/paquet  {"names": ["on1lok6.wav", ...]}
→ {"items": [{file, kind, id, origin, has_audio, label, payload}],
   "themes": {id: payload}, "unmatched": [noms], "warnings": [...]}

- Éléments de la plateforme : leur JSON tel que le dernier instantané le
  donne, avec ou sans audio (le navigateur propose d'écraser l'audio
  existant, case à cocher).
- Ajouts validés pas encore sur la plateforme (origin « addition ») : JSON
  fabriqué ici, avec l'identifiant prévu de l'ajout ; le navigateur les
  ajoute ou non (case à cocher).
Le champ « audio » est rempli par le navigateur avec le nom du fichier : la
plateforme crée son propre identifiant à l'import."""
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


def build(names):
    from . import expression_mesh

    platform_words, platform_expressions = expression_mesh.reference_corpora()
    theme_payloads = expression_mesh.reference_theme_payloads()
    theme_id_by_name = expression_mesh.reference_theme_map()
    from .views import split_target

    files_by_key = {}
    for name in names:
        files_by_key.setdefault(_key(name), name)
    warnings = []
    items = []
    matched = set()

    def add(key, kind, item_id, origin, payload, label):
        name = files_by_key.get(key)
        if not key or not name:
            return
        matched.add(name)
        items.append({"file": name, "kind": kind, "id": item_id, "origin": origin,
                      "has_audio": bool(payload.get("audio")), "label": label, "payload": payload})

    for kind, corpus in (("word", platform_words), ("expression", platform_expressions)):
        for item_id, payload in corpus.items():
            target = (payload.get("translations") or {}).get("target", "")
            pinyin, hanzi = split_target(target)
            key = _key(pinyin if kind == "word" else hanzi)
            add(key, kind, item_id, "platform", payload,
                f"{target} — {(payload.get('translations') or {}).get('primary', '')}")

    additions = [a for a in LexiconAddition.objects.filter(status=LexiconAddition.STATUS_VALIDATED)
                 if a.platform_id not in platform_words and a.platform_id not in platform_expressions]
    by_id = {a.platform_id: a for a in additions}
    for item_id, (kind, payload, target) in _addition_payloads(additions, platform_words, theme_id_by_name, warnings).items():
        a = by_id[item_id]
        key = _key(a.pinyin if kind == "word" else a.hanzi)
        add(key, kind, item_id, "addition", payload, f"{target} — {a.french}")

    # Plusieurs éléments pour un même fichier (homophones) : tous gardés, signalés.
    count = {}
    for item in items:
        count[item["file"]] = count.get(item["file"], 0) + 1
    for name, n in sorted(count.items()):
        if n > 1:
            warnings.append(f"{name} : {n} éléments ont ce nom de fichier (homophones), ils recevront le même audio.")

    themes = {}
    for item in items:
        for theme_id in item["payload"].get("themes") or []:
            if theme_id in theme_payloads:
                themes[theme_id] = theme_payloads[theme_id]
    items.sort(key=lambda r: (r["origin"] != "platform", r["kind"] != "word", r["file"]))
    return {"items": items, "themes": themes,
            "unmatched": sorted(n for n in names if n not in matched), "warnings": warnings}


@require_POST
@owner_required
def package(request):
    try:
        names = json.loads(request.body or b"{}").get("names") or []
    except ValueError:
        return JsonResponse({"error": "Requête illisible."}, status=400)
    names = [str(n) for n in names if str(n).lower().endswith(".wav")][:5000]
    return JsonResponse(build(names))
