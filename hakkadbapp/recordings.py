"""The "Mots à enregistrer" page: the words still to record -- lexicon words
with no audio on the platform (from the latest platform snapshot, the same
source as the "Analyse du lexique" page), and validated additions not on
the platform yet. Each with the file name the platform export expects
(digit-tone pinyin: "on1lok6.wav")."""
from django.contrib.auth.views import redirect_to_login
from django.shortcuts import render

from .models import LexiconAddition, Word


def _expected_filename(pinyin):
    from .views import SUPERSCRIPT_TO_DIGIT

    pinyin = "".join(str(pinyin or "").split()).translate(SUPERSCRIPT_TO_DIGIT)
    return f"{pinyin}.wav" if pinyin else ""


def words_to_record():
    """([{hanzi, pinyin, french, theme, filename, origin}], snapshot date or None)."""
    from .views import get_latest_platform_snapshot, split_target

    snapshot = get_latest_platform_snapshot()
    platform_words = ((snapshot.platform_data or {}).get("words", {}) or {}) if snapshot else {}
    themes = dict(Word.objects.exclude(platform_id=None).values_list("platform_id", "category"))
    rows = []
    for platform_id, payload in platform_words.items():
        if payload.get("audio"):
            continue
        tr = payload.get("translations", {}) or {}
        pinyin, hanzi = split_target(tr.get("target", ""))
        rows.append({"hanzi": hanzi, "pinyin": pinyin, "french": tr.get("primary", ""),
                     "theme": themes.get(platform_id) or "", "filename": _expected_filename(pinyin),
                     "origin": "Lexique"})
    # Validated additions the platform doesn't have yet (or has without audio: listed above).
    for a in LexiconAddition.objects.filter(kind=LexiconAddition.KIND_WORD, status=LexiconAddition.STATUS_VALIDATED):
        if a.platform_id in platform_words:
            continue
        rows.append({"hanzi": "".join(a.hanzi.split()), "pinyin": "".join(a.pinyin.split()), "french": a.french,
                     "theme": a.themes, "filename": _expected_filename(a.pinyin), "origin": "Ajout validé"})
    rows.sort(key=lambda r: (r["theme"].lower(), r["pinyin"]))
    return rows, (snapshot.timestamp if snapshot else None)


def page(request):
    """Logged-in members (readers included: they may be the ones recording)."""
    if not request.user.is_authenticated:
        return redirect_to_login(request.get_full_path())
    rows, snapshot_date = words_to_record()
    return render(request, "hakkadbapp/recordings.html", {
        "title": "Mots à enregistrer", "page": "recordings", "rows": rows, "snapshot_date": snapshot_date,
        "themes": sorted({r["theme"] for r in rows if r["theme"]}, key=str.lower),
        "from_lexicon": sum(1 for r in rows if r["origin"] == "Lexique"),
        "from_additions": sum(1 for r in rows if r["origin"] != "Lexique"),
    })
