"""The "Mots à enregistrer" page: what is still to record --
- words: lexicon words with no audio on the platform (latest platform
  snapshot, the same source as the "Analyse du lexique" page) and validated
  word additions not on the platform yet; each with an expression it
  appears in, when there is one, to record it in context;
- expressions: the same, for expressions.
Each with the file name the platform export expects: digit-tone pinyin for
a word ("on1lok6.wav"), the hanzi for an expression ("我爱屋家.wav")."""
from django.contrib.auth.views import redirect_to_login
from django.shortcuts import render

from .models import Expression, LexiconAddition, Word


def _digits(pinyin):
    from .views import SUPERSCRIPT_TO_DIGIT

    return "".join(str(pinyin or "").split()).translate(SUPERSCRIPT_TO_DIGIT)


def _example_from_lexicon(hanzi, expressions):
    """The first lexicon expression with `hanzi` as one of its words."""
    for e in expressions:
        if hanzi in (e.text or "").split():
            return {"target": f"{e.rendering or ''}".strip() or e.text, "french": e.french}
    return None


def to_record():
    """(words, expressions, snapshot date or None)."""
    from .views import get_latest_platform_snapshot, split_target

    snapshot = get_latest_platform_snapshot()
    data = (snapshot.platform_data or {}) if snapshot else {}
    platform_words = data.get("words", {}) or {}
    platform_expressions = data.get("expressions", {}) or {}
    word_themes = dict(Word.objects.exclude(platform_id=None).values_list("platform_id", "category"))
    expr_themes = dict(Expression.objects.exclude(platform_id=None).values_list("platform_id", "category"))
    lexicon_expressions = list(Expression.objects.only("text", "rendering", "french"))

    def example(payload):
        for expr_id in payload.get("in_expression") or []:
            tr = (platform_expressions.get(expr_id) or {}).get("translations", {}) or {}
            if tr.get("target"):
                return {"target": tr["target"], "french": tr.get("primary", "")}
        return None

    words = []
    for platform_id, payload in platform_words.items():
        if payload.get("audio"):
            continue
        tr = payload.get("translations", {}) or {}
        pinyin, hanzi = split_target(tr.get("target", ""))
        words.append({"hanzi": hanzi, "pinyin": pinyin, "french": tr.get("primary", ""),
                      "theme": word_themes.get(platform_id) or "",
                      "filename": f"{_digits(pinyin)}.wav" if pinyin else "", "origin": "Lexique",
                      "example": example(payload) or _example_from_lexicon(hanzi, lexicon_expressions)})
    expressions = []
    for platform_id, payload in platform_expressions.items():
        if payload.get("audio"):
            continue
        tr = payload.get("translations", {}) or {}
        pinyin, hanzi = split_target(tr.get("target", ""))
        expressions.append({"hanzi": hanzi, "pinyin": pinyin, "french": tr.get("primary", ""),
                            "theme": expr_themes.get(platform_id) or "",
                            "filename": f"{''.join(hanzi.split())}.wav" if hanzi else "", "origin": "Lexique"})
    # Validated additions the platform doesn't have yet.
    for a in LexiconAddition.objects.filter(status=LexiconAddition.STATUS_VALIDATED):
        if a.platform_id in platform_words or a.platform_id in platform_expressions:
            continue
        hanzi = "".join(a.hanzi.split())
        if a.kind == LexiconAddition.KIND_WORD:
            words.append({"hanzi": hanzi, "pinyin": "".join(a.pinyin.split()), "french": a.french, "theme": a.themes,
                          "filename": f"{_digits(a.pinyin)}.wav" if a.pinyin else "", "origin": "Ajout validé",
                          "example": _example_from_lexicon(hanzi, lexicon_expressions)})
        else:
            expressions.append({"hanzi": a.hanzi, "pinyin": a.pinyin, "french": a.french, "theme": a.themes,
                                "filename": f"{hanzi}.wav", "origin": "Ajout validé"})
    words.sort(key=lambda r: (r["theme"].lower(), r["pinyin"]))
    expressions.sort(key=lambda r: (r["theme"].lower(), r["hanzi"]))
    return words, expressions, (snapshot.timestamp if snapshot else None)


def page(request):
    """Logged-in members (readers included: they may be the ones recording)."""
    if not request.user.is_authenticated:
        return redirect_to_login(request.get_full_path())
    words, expressions, snapshot_date = to_record()
    return render(request, "hakkadbapp/recordings.html", {
        "title": "Mots à enregistrer", "page": "recordings", "words": words, "expressions": expressions,
        "snapshot_date": snapshot_date,
        "themes": sorted({r["theme"] for r in words + expressions if r["theme"]}, key=str.lower),
        "added": sum(1 for r in words + expressions if r["origin"] != "Lexique"),
    })
