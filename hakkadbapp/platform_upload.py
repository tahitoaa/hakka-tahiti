"""« Analyse du lexique » → « Importer un export de la plateforme »
(propriétaire seulement) : la commande `platform_to_vercel --yes` lancée
depuis le site, à partir du zip téléchargé sur la plateforme.

Le navigateur ouvre le zip (souvent gros : il contient les audios) et
n'envoie que ses trois corpus -- wordCorpus.json, expressionCorpus.json,
themeCorpus.json -- en JSON compressé (gzip) :

POST /api/plateforme/importer   corps gzip de
    {"source": "nom du zip", "words": {...}, "expressions": {...},
     "themes": {...}, "force": false}

Comme la commande : le lexique (Word / Expression / Pronunciation) est
vidé puis reconstruit, en une transaction, et l'instantané est gardé
(Traces.platform_data). Garde-fou : un corpus nettement plus petit que
l'actuel (moins de 80 % des mots ou des expressions) est refusé sans
« force » -- par exemple le petit zip de « Préparer l'import plateforme »,
qui n'a que quelques éléments."""
import gzip
import json

from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .permissions import owner_required

MIN_RATIO = 0.8


def _check(corpus, name):
    if not isinstance(corpus, dict):
        return f"{name} manquant ou illisible."
    for item_id, payload in list(corpus.items())[:50]:
        if not isinstance(payload, dict) or not isinstance(payload.get("translations"), dict):
            return f"{name} : l'élément {item_id} n'a pas le format de la plateforme (translations)."
    return None


@require_POST
@owner_required
def import_corpus(request):
    try:
        raw = request.body
        if request.headers.get("Content-Encoding") == "gzip" or raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        data = json.loads(raw)
    except (OSError, ValueError):
        return JsonResponse({"error": "Envoi illisible."}, status=400)
    words, expressions, themes = data.get("words"), data.get("expressions"), data.get("themes")
    for corpus, name in ((words, "wordCorpus.json"), (expressions, "expressionCorpus.json"), (themes, "themeCorpus.json")):
        error = _check(corpus, name)
        if error:
            return JsonResponse({"error": error}, status=400)
    if not words or not expressions:
        return JsonResponse({"error": "Aucun mot ou aucune expression dans ce zip."}, status=400)

    from .views import get_latest_platform_snapshot

    snapshot = get_latest_platform_snapshot()
    current = (snapshot.platform_data or {}) if snapshot else {}
    now = {"words": len(current.get("words") or {}), "expressions": len(current.get("expressions") or {})}
    new = {"words": len(words), "expressions": len(expressions)}
    if not data.get("force") and any(now[k] and new[k] < MIN_RATIO * now[k] for k in now):
        return JsonResponse({
            "error": (f"Ce zip a {new['words']} mots et {new['expressions']} expressions, contre "
                      f"{now['words']} et {now['expressions']} aujourd'hui : est-ce bien l'export complet de la plateforme ?"),
            "shrink": True, "current": now, "new": new,
        }, status=409)

    # Importé ici, pas en tête : la commande tire pandas et les importeurs.
    from .management.commands.platform_to_vercel import run_import

    source = f"zip {str(data.get('source') or '')[:200]}".strip()
    result = run_import(words, expressions, themes, source)
    return JsonResponse({"ok": True, **result,
                         "word_logs": result["word_logs"][:200], "unknown_tokens": result["unknown_tokens"][:200]})
