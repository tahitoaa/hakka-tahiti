"""Persistent, human-editable per-expression data: a free-text comment and
the "maillage" -- the excel-format hanzi phrase (space per word) that
drives expressionCorpus.json's `components` (word linking) generation.

Why a plain text column is enough for the maillage: import_expressions.py's
own phrase syntax already supports disambiguation inline --
text_to_words.py's find_words_by_hanzi_with_disambiguation() reads a token
like "样般:comment" (hanzi + ":" + a hint matched against candidate words'
french/pinyin) to pick among several Words sharing the same hanzi, and
resolve_hanzi() strips that (and "(pinyin)" overrides) back down to plain
display hanzi. So editing the *text* -- adding ":comment" to break a tie,
fixing an unmatched token -- IS editing the mesh; there's no need for a
separate structured word_id-per-token table.

Row identity: Expression.platform_id -- the e_reo platform's own id for
this expression (expressionCorpus.json's dict key), carried through
verbatim by every `platform_to_vercel` import (see
models.Expression.platform_id). Unlike this row's Django pk, which a
reset+rebuild destroys and reassigns every run, platform_id is copied as-is
from the platform's own JSON every time, so it's the same value across
reimports -- the ExpressionNote row attached to it survives untouched. An
Expression without one yet (imported before this field existed) simply
can't be edited here until the next `platform_to_vercel --yes` populates
it.

Storage: models.ExpressionNote, an ordinary DB table in its own right --
NOT touched by import_expressions_from_df's reset=True (which only wipes
Expression/ExpressionWord). This deliberately isn't a local file: the app
is deployed to Vercel as a serverless function with a read-only
filesystem in production (see vercel.json), so a file under
hakkadbapp/data/ can only ever work against a local `manage.py runserver`
-- the DB (Postgres/Supabase, see settings.DATABASES) is the only thing
that actually persists across requests on the live site. Platform-id
lookups (to seed a new entry's excel_format from the platform's own
already-vetted text) still go through Traces.platform_data (a DB row,
same source the expressions page diffs against) rather than reading
../e_reo_json/ directly.
"""
import datetime
from pathlib import Path

from .models import ExpressionNote

# Column order for the CSV download/upload boundary (views.py) -- the
# bulk-review/Excel workflow, independent of how rows are actually stored.
FIELDNAMES = ["platform_id", "excel_format", "commentaire"]

DATE_FOLDER_FORMAT = "%d_%m_%Y"


def find_all_dated_corpus_dirs(base_dir):
    """Every base_dir/<dd_mm_yyyy>/ subfolder, most recent first -- same
    dated-snapshot convention platform_to_vercel.py reads the platform's
    reference corpus from. Reimplemented here (identical logic to
    export.py's own find_latest_dated_corpus_dir, generalized to return
    all of them instead of just the newest) rather than imported from it:
    importing export.py pulls in read_themes_corpus -> generate_images,
    which loads a TrueType font from a hardcoded path at *module import
    time* and crashes anywhere that path doesn't exist -- unsafe from
    request-serving code, only safe from a locally-run management
    command."""
    if not base_dir.is_dir():
        return []
    dated = []
    for child in base_dir.iterdir():
        if not child.is_dir():
            continue
        try:
            date = datetime.datetime.strptime(child.name, DATE_FOLDER_FORMAT).date()
        except ValueError:
            continue
        dated.append((date, child))
    dated.sort(key=lambda pair: pair[0], reverse=True)
    return [child for _date, child in dated]


def find_latest_dated_corpus_dir(base_dir):
    """The single most recent base_dir/<dd_mm_yyyy>/ subfolder, or None --
    what platform_to_vercel.py itself reads the reference corpus from."""
    dirs = find_all_dated_corpus_dirs(base_dir)
    return dirs[0] if dirs else None


def find_platform_audio_dirs():
    """Every local `../e_reo_json/<date>/` folder, most recent first --
    where the platform's own audio recordings actually live, verified
    against a real pull: each word/expression's "audio" field in
    wordCorpus.json/expressionCorpus.json is a bare UUID (no extension)
    that names a WAV file sitting *directly* in a dated folder, right
    alongside that snapshot's own wordCorpus.json/expressionCorpus.json/
    themeCorpus.json -- there is no separate "audio/" subfolder. Not every
    pull re-includes every recording, so a UUID missing from the latest
    snapshot can still be sitting in an older one -- find_audio_path
    searches all of these, newest first, rather than only the latest.
    Empty when there's no filesystem access to ../e_reo_json/ at all (the
    deployed Vercel instance) -- callers treat that as "no audio
    available" and skip it, never as an error, since bundling audio is a
    local-only, best-effort extra."""
    return find_all_dated_corpus_dirs(Path("../e_reo_json"))


def find_audio_path(audio_dirs, audio_id):
    """Path to <dir>/<audio_id> in the first of `audio_dirs` (searched in
    the order given -- pass find_platform_audio_dirs()'s newest-first
    list) where that file actually exists, or None. `audio_id` is the
    platform's own "audio" field value, used verbatim as the on-disk
    filename (no extension, see find_platform_audio_dirs)."""
    if not audio_id:
        return None
    for audio_dir in audio_dirs or []:
        path = Path(audio_dir) / audio_id
        if path.is_file():
            return path
    return None


class MissingPlatformId(Exception):
    """Raised when an Expression has no platform_id yet -- it needs a
    fresh `platform_to_vercel --yes` run to get one (see
    models.Expression.platform_id)."""


def reference_corpora():
    """(words, expressions) dicts from the platform snapshot -- the same
    Traces.platform_data (written by `platform_to_vercel --yes`) the
    expressions page already diffs against, rather than reading the local
    e_reo_json/ folder directly: that folder has no filesystem presence on
    the deployed site at all, while a Traces row is just DB data."""
    from .views import get_latest_platform_snapshot

    snapshot = get_latest_platform_snapshot()
    if not snapshot:
        return {}, {}
    data = snapshot.platform_data or {}
    return data.get("words", {}) or {}, data.get("expressions", {}) or {}


def excel_format_from_platform_target(target):
    """Reconstruct a space-per-word excel_format phrase from the
    platform's own raw "pinyin hanzi" target string.

    The platform's target has pinyin space-separated *per word* (a
    multi-syllable word's syllables run together with no space, e.g.
    "hak5ga1wa4 liong4men1 ham4 客家话样般喊" is three words of 3, 2 and 1
    syllables) but the trailing hanzi half has NO spaces at all -- every
    word's characters run together. Word boundaries in the hanzi are
    recovered by counting how many syllables each pinyin group splits into
    (the same compact-pinyin splitter the MOTS-sheet import itself uses)
    and consuming that many hanzi characters per group, in order. A group
    with no letters at all (an unresolved-pinyin placeholder like "~" or a
    literal passthrough like "...") is assumed to occupy exactly its own
    length in the hanzi half instead, since that's how resolve_pinyin()
    produces it in the first place (one output character per input
    character, no syllable expansion) -- see text_to_words.py.

    Returns None if the reconstruction doesn't fully account for the
    hanzi half (syllable/char counts didn't add up -- e.g. a group mixing
    a resolved and an unresolved syllable with no separator, which this
    deliberately doesn't try to disambiguate further), so callers can fall
    back to something else rather than trust a misaligned split.
    """
    from .management.commands.import_utils_v2 import split_compact_pinyin_into_syllables
    from .views import split_target, SUPERSCRIPT_TO_DIGIT

    pinyin_part, hanzi_concat = split_target(target)
    if not hanzi_concat:
        return None

    words = []
    pos = 0
    for group in pinyin_part.split():
        digits = group.translate(SUPERSCRIPT_TO_DIGIT)
        if any(ch.isalpha() for ch in digits):
            n = len(split_compact_pinyin_into_syllables(digits) or [digits])
        else:
            n = len(group)
        words.append(hanzi_concat[pos:pos + n])
        pos += n

    if pos != len(hanzi_concat):
        return None
    return " ".join(w for w in words if w)


def get_or_create_entry(expr, reference_expressions=None):
    """Ensure an ExpressionNote exists for this expression's platform_id,
    creating one if missing. Returns (note, created).

    Single-item version, used by the per-expression editor (one request,
    one expression -- the query-per-call cost is fine here). Bulk callers
    (export_corpus, sync_entries) use _seed_notes_for() instead, which
    does the same seeding logic but batched across every expression in one
    pass -- see its docstring for why that distinction matters."""
    if not expr.platform_id:
        raise MissingPlatformId(
            "Cette expression n'a pas encore de platform_id -- relancez "
            "`platform_to_vercel --yes` pour le renseigner."
        )

    return ExpressionNote.objects.get_or_create(
        platform_id=expr.platform_id,
        defaults={"excel_format": _seed_excel_format(expr, reference_expressions), "commentaire": ""},
    )


def _seed_excel_format(expr, reference_expressions):
    """The "platform state" for an expression's maillage: its target text
    reconstructed from the platform's own already-vetted decomposition
    when this platform_id is in the reference snapshot, else verbatim
    expr.text (the raw excel import) as a fallback -- see
    excel_format_from_platform_target's docstring for why the platform
    text is preferred. Shared by every place that needs "what the mesh
    should read absent any local edit": seeding a brand new
    ExpressionNote, and resetting an existing one back to it."""
    ref_target = (reference_expressions.get(expr.platform_id, {}).get("translations") or {}).get("target", "")
    return excel_format_from_platform_target(ref_target) or expr.text or ""


def reset_entry(expr, reference_expressions=None):
    """Reset one expression's maillage (excel_format) back to "the platform
    state" -- discards any hand edit, without touching commentaire or
    use_in_export. Creates the ExpressionNote first if it didn't exist yet
    (nothing to discard, but the caller still gets a note back). Returns
    the note."""
    if not expr.platform_id:
        raise MissingPlatformId(
            "Cette expression n'a pas encore de platform_id -- relancez "
            "`platform_to_vercel --yes` pour le renseigner."
        )
    if reference_expressions is None:
        _reference_words, reference_expressions = reference_corpora()

    note, _created = ExpressionNote.objects.get_or_create(platform_id=expr.platform_id)
    note.excel_format = _seed_excel_format(expr, reference_expressions)
    note.save(update_fields=["excel_format", "updated_at"])
    return note


def _seed_notes_for(expressions, reference_expressions):
    """Same seeding as get_or_create_entry, but for a whole list of
    Expressions in 2 queries total instead of one get_or_create() per
    expression -- that per-row round trip to the (remote, Supabase-hosted)
    DB is exactly what made export_corpus/sync_entries time out on a
    corpus of any real size. Returns {platform_id: ExpressionNote}."""
    platform_ids = [e.platform_id for e in expressions]
    notes_by_id = {n.platform_id: n for n in ExpressionNote.objects.filter(platform_id__in=platform_ids)}

    to_create = []
    for expr in expressions:
        if expr.platform_id in notes_by_id:
            continue
        note = ExpressionNote(
            platform_id=expr.platform_id,
            excel_format=_seed_excel_format(expr, reference_expressions),
            commentaire="",
        )
        to_create.append(note)
        notes_by_id[expr.platform_id] = note

    if to_create:
        ExpressionNote.objects.bulk_create(to_create)

    return notes_by_id


class _CachedPronsByHanzi:
    """Drop-in replacement for the `all_prons` queryset that
    text_to_words.resolve_pinyin() expects (`.filter(hanzi=...).exists()`/
    `.first()`), backed by one upfront query instead of one per call.

    resolve_pinyin()'s own _lookup_first_pron() does a fresh
    `all_prons.filter(hanzi=hanzi)` query *every time it's asked about a
    character* -- fine for rendering a single phrase at import time
    (import_expressions_v2.py), but export_corpus() calls it once per raw
    (unmatched-word) hanzi character across the *entire* corpus, which
    fans out into hundreds of round trips to the DB and was the other half
    of the export timing out, alongside the per-expression ExpressionNote
    lookups _seed_notes_for() above already fixes."""

    def __init__(self):
        from .models import Pronunciation

        self._by_hanzi = {}
        for p in Pronunciation.objects.select_related("initial", "final", "tone").order_by("id"):
            self._by_hanzi.setdefault(p.hanzi, []).append(p)

    def filter(self, hanzi):
        return _CachedPronsQuerySet(self._by_hanzi.get(hanzi, []))


class _CachedPronsQuerySet:
    def __init__(self, prons):
        self._prons = prons

    def exists(self):
        return bool(self._prons)

    def first(self):
        return self._prons[0] if self._prons else None


def reference_theme_map():
    """theme name (lowercased) -> platform theme id, from the same
    Traces.platform_data snapshot reference_corpora() reads -- lets
    export_corpus() turn a Word's `category` (a plain name, e.g. "Animaux")
    back into the platform's own theme id without needing export.py's own
    theme-corpus loader (which imports a module that loads TrueType fonts
    from a hardcoded path at import time and crashes anywhere that path
    doesn't exist -- unsafe to import at views.py's module load time)."""
    from .views import get_latest_platform_snapshot

    snapshot = get_latest_platform_snapshot()
    if not snapshot:
        return {}
    themes = (snapshot.platform_data or {}).get("themes", {}) or {}
    return {
        (payload.get("translations", {}) or {}).get("primary", "").strip().lower(): theme_id
        for theme_id, payload in themes.items()
        if (payload.get("translations", {}) or {}).get("primary", "").strip()
    }


def reference_theme_payloads():
    """Raw theme_id -> full platform payload (translations dict, exactly
    as themeCorpus.json stores it), from the same Traces.platform_data
    snapshot the other reference_* helpers read. Used to build a
    themeCorpus.json covering just the themes an export actually
    references, without needing export.py's font-loading theme module."""
    from .views import get_latest_platform_snapshot

    snapshot = get_latest_platform_snapshot()
    if not snapshot:
        return {}
    return (snapshot.platform_data or {}).get("themes", {}) or {}


def reference_theme_names():
    """theme id -> display name (original casing), from the same snapshot
    reference_theme_map() reads -- lets a caller render the human-readable
    name for a theme id (e.g. for the expression review spreadsheet)."""
    return {
        theme_id: (payload.get("translations", {}) or {}).get("primary", "") or theme_id
        for theme_id, payload in reference_theme_payloads().items()
    }


def _token_data_resolver(tokens):
    """Build a memoized token_data_for(token) callable over every token in
    `tokens`, resolving each maillage token (ExpressionNote.excel_format,
    e.g. "样般" or "样般:comment") to the Word it matches -- or, when
    unmatched, a raw hanzi/pinyin guess (resolve_hanzi/resolve_pinyin) so
    the caller still has *something* to render for it. Shared by
    export_corpus() and compute_split_platform_diffs(), which both need to
    turn a maillage phrase into the same "pinyin hanzi" target text."""
    from .text_to_words import (
        build_all_words_for_tokens,
        find_words_by_hanzi_with_disambiguation,
        resolve_hanzi,
        resolve_pinyin,
    )

    all_words = list(build_all_words_for_tokens(tokens))
    cached_prons = _CachedPronsByHanzi()
    token_match_cache = {}

    def match_token(token):
        if token not in token_match_cache:
            token_match_cache[token] = find_words_by_hanzi_with_disambiguation(token, all_words)
        return token_match_cache[token]

    token_data_cache = {}

    def token_data_for(token):
        if token in token_data_cache:
            return token_data_cache[token]
        matches = match_token(token)
        word = matches[0]
        if word is None:
            data = {
                "word": None, "hanzi": resolve_hanzi(token),
                "pinyin": resolve_pinyin(token, cached_prons), "matched": False, "ambiguous": False,
            }
        else:
            data = {
                "word": word, "hanzi": token.split(":", 1)[0], "pinyin": word.pinyin(),
                "matched": True, "ambiguous": len(matches) > 1 and ":" not in token,
            }
        token_data_cache[token] = data
        return data

    return token_data_for


def compute_split_platform_diffs(expressions):
    """For every given Expression that has a non-empty maillage
    (ExpressionNote.excel_format) and a platform_id present in the latest
    platform snapshot, recompute its hakka target from that maillage --
    the same resolution export_corpus() uses -- and compare it to the
    platform's current target for that same expression.

    Returns {platform_id: {"computed": str, "platform": str}} for every
    expression where the two differ. Unlike export_corpus(), this isn't
    restricted to ExpressionNote.use_in_export: the point here is to warn
    about a hand-entered Split *before* it's ever selected for export,
    wherever expressions are shown for review (duplicates.html).

    A platform_id showing up here is exactly what export_corpus()'s own
    hakka_changes warning flags: if the platform's own import matches
    expressions by this hakka text rather than by id, exporting this one
    as-is creates a brand new row next to the existing one instead of
    updating it in place -- an orphaned duplicate that needs manual
    cleanup on the platform afterwards.
    """
    from .text_to_words import render_expression_from_token_data

    platform_ids = [e.platform_id for e in expressions if e.platform_id]
    if not platform_ids:
        return {}
    notes_by_id = {
        n.platform_id: n
        for n in ExpressionNote.objects.filter(platform_id__in=platform_ids).exclude(excel_format="")
    }
    relevant = [e for e in expressions if e.platform_id in notes_by_id]
    if not relevant:
        return {}

    _reference_words, reference_expressions = reference_corpora()
    all_tokens = [tok for e in relevant for tok in notes_by_id[e.platform_id].excel_format.split()]
    token_data_for = _token_data_resolver(all_tokens)

    diffs = {}
    for expr in relevant:
        platform_expr = reference_expressions.get(expr.platform_id)
        if platform_expr is None:
            continue
        tokens = notes_by_id[expr.platform_id].excel_format.split()
        target = render_expression_from_token_data([token_data_for(tok) for tok in tokens])
        old_target = (platform_expr.get("translations") or {}).get("target", "")
        if old_target.strip() != target.strip():
            diffs[expr.platform_id] = {"computed": target, "platform": old_target}
    return diffs


def _summarize_export_readiness(tokens, token_data_for):
    """{"ok", "has_unresolved", "has_ambiguous", "target"} for one Split
    phrase (already-tokenized), given a token_data_for resolver (from
    _token_data_resolver). Shared by compute_export_readiness (one phrase)
    and compute_export_readiness_map (many, sharing one resolver) below."""
    from .text_to_words import render_expression_from_token_data

    if not tokens:
        return {"ok": False, "has_unresolved": False, "has_ambiguous": False, "target": ""}
    token_data = [token_data_for(tok) for tok in tokens]
    target = render_expression_from_token_data(token_data)
    has_ambiguous = any(item["ambiguous"] for item in token_data)
    # "~" is resolve_pinyin's own placeholder (text_to_words._lookup_first_pron)
    # for a hanzi with literally no Pronunciation row at all -- it can only
    # end up in `target` via an unmatched token's fallback pinyin, never via
    # a matched Word (which always has a real word.pinyin()).
    has_unresolved = "~" in target
    return {
        "ok": not has_ambiguous and not has_unresolved,
        "has_unresolved": has_unresolved,
        "has_ambiguous": has_ambiguous,
        "target": target,
    }


def compute_export_readiness(excel_format):
    """Whether this Split text is safe to mark "Utiliser dans l'export":
    every token must resolve to exactly one Word (no ":gloss"-less
    ambiguity -- a "blue token" in the Split preview, see Sentence.js'
    renderToken) and the recomputed hakka target must not contain "~" (a
    hanzi with no Pronunciation entry at all). Either one left as-is means
    expressionCorpus.json would carry an incomplete or arbitrarily-chosen
    reading for this expression. Single-phrase version, used by
    expression_mesh_entry's own POST validation; see
    compute_export_readiness_map for the batched, whole-page version."""
    tokens = (excel_format or "").split()
    token_data_for = _token_data_resolver(tokens)
    return _summarize_export_readiness(tokens, token_data_for)


def compute_export_readiness_map(excel_format_by_platform_id):
    """Same check as compute_export_readiness, batched across every given
    {platform_id: excel_format} pair at once (one shared Word/Pronunciation
    resolution instead of one per expression) -- for the expressions page,
    which needs this for every row up front to decide whether its "Utiliser
    dans l'export" checkbox may be turned on at all. Returns
    {platform_id: {"ok", "has_unresolved", "has_ambiguous", "target"}}."""
    tokens_by_id = {pid: (ef or "").split() for pid, ef in excel_format_by_platform_id.items()}
    all_tokens = [tok for tokens in tokens_by_id.values() for tok in tokens]
    token_data_for = _token_data_resolver(all_tokens)
    return {
        pid: _summarize_export_readiness(tokens, token_data_for)
        for pid, tokens in tokens_by_id.items()
    }


def export_corpus():
    """Generate BOTH wordCorpus.json and expressionCorpus.json from the DB
    -- but only for the words and expressions explicitly marked "use in
    export" (ExpressionNote.use_in_export / WordNote.use_in_export, both
    off by default). Everything else in the DB is left out entirely: this
    is a curated, incremental export, not a full corpus dump.

    For an included expression, its "hakka" target field, `components`
    dict, and every linked word's `in_expression` list are all computed
    from its current maillage (ExpressionNote.excel_format) -- never from
    the original import (Expression.rendering / the DB's own ExpressionWord
    rows), which would go stale the moment someone hand-edits the maillage.

    Restricting to the selected subset isn't just the requested behavior --
    it's also what keeps this fast: no more scanning every Expression's
    ExpressionWord/Word/WordPronunciation chain or every Word in the
    catalog (the previous "export everything, maillage or not" version did
    exactly that for whatever wasn't opted in, which is the common case
    since the flag defaults off -- that fallback path was the actual
    remaining slow part after _seed_notes_for()/_CachedPronsByHanzi below
    fixed the first round of timeouts). Now there's only ever as much work
    as there are selected rows.

    Also returns a themeCorpus.json covering just the themes referenced by
    the exported words/expressions, and one "row" per exported expression
    with a few extra fields (concatenated hanzi, theme names) that aren't
    part of expressionCorpus.json's own shape but are needed to locate that
    expression's audio file on disk and to build the review spreadsheet --
    see views.export_corpus_generate / export_expressions_spreadsheet.

    Returns {"words", "expressions", "themes", "expression_rows", "warnings"}.
    """
    from .models import Expression, Word, WordNote, WordPronunciation
    from django.db.models import Prefetch
    from .text_to_words import render_expression_from_token_data

    reference_words, reference_expressions = reference_corpora()
    theme_payloads = reference_theme_payloads()
    theme_name_by_id = reference_theme_names()
    # Used to fill in themes for a word/expression that has no platform
    # counterpart yet (nothing to copy from) -- everything that DOES have
    # one keeps its platform themes verbatim instead, see below.
    theme_id_by_name = reference_theme_map()
    warnings = []
    words_missing_platform_id = set()
    all_theme_ids = set()

    # ---- 1. Only expressions explicitly selected for export ---------------
    selected_notes = {
        n.platform_id: n
        for n in ExpressionNote.objects.filter(use_in_export=True).exclude(platform_id="")
    }
    expressions = list(Expression.objects.filter(platform_id__in=selected_notes.keys()))
    if not selected_notes:
        warnings.append(
            "Aucune expression n'a \"Utiliser dans l'export\" activé -- expressionCorpus.json est vide."
        )

    # ---- 2. Resolve every selected maillage token to a Word, memoized -----
    all_tokens = [tok for note in selected_notes.values() for tok in note.excel_format.split()]
    token_data_for = _token_data_resolver(all_tokens)

    expression_corpus = {}
    expression_rows = []
    word_in_expression = {}  # word.platform_id -> set(expr.platform_id)
    hakka_changes = []  # expressions whose recomputed target differs from the platform's current one

    for expr in expressions:
        note = selected_notes[expr.platform_id]
        tokens = note.excel_format.split()
        token_data = [token_data_for(tok) for tok in tokens]

        components = {}
        ambiguous_tokens = [tok for tok, item in zip(tokens, token_data) if item["ambiguous"]]
        for item in token_data:
            word = item["word"]
            if word is None:
                continue
            if not word.platform_id:
                words_missing_platform_id.add(word.char())
                continue
            own_target = f"{word.pinyin()} {word.char()}".strip()
            components[own_target] = word.platform_id
            word_in_expression.setdefault(word.platform_id, set()).add(expr.platform_id)

        if ambiguous_tokens:
            warnings.append(
                f"« {note.excel_format} » : ambigu sans précision pour "
                f"{', '.join(ambiguous_tokens)} -- un mot a été choisi par défaut ; "
                f"ajoutez \"terme:précision\" (ex. \"样般:comment\") dans la table pour forcer un choix."
            )

        # Themes/audio/level: preserved exactly as the platform already has
        # them for this expression -- this exporter doesn't manage any of
        # the three itself, so overwriting them with empty/zero defaults
        # would silently erase real platform data on every export. A
        # not-yet-published expression (no reference entry at all) falls
        # back to deriving themes from Expression.category, since there's
        # nothing to preserve.
        platform_expr = reference_expressions.get(expr.platform_id)
        if platform_expr is not None:
            themes = list(platform_expr.get("themes") or [])
            existing_audio = platform_expr.get("audio", "")
            level = platform_expr.get("level", 0)
        else:
            themes = []
            for name in (expr.category or "").split(","):
                theme_id = theme_id_by_name.get(name.strip().lower())
                if theme_id and theme_id not in themes:
                    themes.append(theme_id)
            existing_audio = ""
            level = 0

        all_theme_ids.update(themes)
        target = render_expression_from_token_data(token_data)
        hanzi_only = "".join(item["hanzi"] for item in token_data).strip()

        # The platform's own import almost certainly matches expressions by
        # this "hakka" target string rather than by platform_id (the same
        # fragile matching this app itself used to do before platform_id
        # existed -- see reference_corpora()'s docstring history). So a
        # target that changed here doesn't update the existing platform
        # row in place -- it creates a brand new one next to it, leaving
        # the old row an orphaned duplicate that needs manual cleanup on
        # the platform after import. Anything on this list is exactly
        # that: expected new duplicates, not a bug in the export itself.
        if platform_expr is not None:
            old_target = (platform_expr.get("translations") or {}).get("target", "")
            if old_target.strip() != target.strip():
                hakka_changes.append({
                    "platform_id": expr.platform_id,
                    "french": expr.french or "",
                    "old": old_target,
                    "new": target,
                })

        expression_corpus[expr.platform_id] = {
            "translations": {
                "primary": expr.french or "",
                "secondary": expr.english or "",
                "target": target,
            },
            "themes": themes,
            "level": level,
            "components": dict(sorted(components.items())),
            "audio": existing_audio,
        }
        # Extra fields not part of expressionCorpus.json itself, for the
        # spreadsheet export -- audio_id is the exact same value just
        # written into expression_corpus[...]["audio"] above (a bare UUID
        # naming a file in a platform dated corpus folder, see
        # find_platform_audio_dirs), reused here rather than re-derived so
        # the two can never disagree about which recording an expression
        # has.
        expression_rows.append({
            "platform_id": expr.platform_id,
            "french": expr.french or "",
            "english": expr.english or "",
            "target": target,
            "hanzi": hanzi_only,
            "theme_names": ", ".join(theme_name_by_id.get(t, t) for t in themes),
            "audio_id": existing_audio,
        })

    if words_missing_platform_id:
        warnings.append(
            f"{len(words_missing_platform_id)} mot(s) référencé(s) dans un maillage n'ont pas "
            f"encore de platform_id ({', '.join(sorted(words_missing_platform_id))}) -- relancez "
            "`platform_to_vercel --yes` pour les inclure dans les composants."
        )

    if hakka_changes:
        lines = [
            f"  - [{c['platform_id']}] {c['french']} : "
            f"« {c['old']} » -> « {c['new']} »"
            for c in hakka_changes
        ]
        warnings.append(
            f"{len(hakka_changes)} expression(s) exportée(s) ont un hakka différent de celui déjà "
            "présent sur la plateforme -- si l'import de la plateforme matche par ce texte plutôt "
            "que par id, chacune créera un doublon à nettoyer manuellement au lieu de mettre à jour "
            "l'entrée existante :\n" + "\n".join(lines)
        )

    # ---- 3. wordCorpus.json: words explicitly selected for export, plus --
    # every word a selected expression's maillage actually resolved to --
    # an expression's `components` dict already points at these words'
    # platform ids (step 2 above), so leaving one out of wordCorpus.json
    # would ship an expression referencing a word the export doesn't
    # contain. A word can therefore end up exported either because someone
    # explicitly checked "Utiliser dans l'export" on it, or simply because
    # a selected expression is built from it -- never solely at the
    # exporter's discretion.
    selected_word_platform_ids = set(
        WordNote.objects.filter(use_in_export=True).exclude(platform_id="").values_list("platform_id", flat=True)
    ) | set(word_in_expression.keys())
    if not selected_word_platform_ids:
        warnings.append("Aucun mot n'a \"Utiliser dans l'export\" activé -- wordCorpus.json est vide.")

    words = Word.objects.filter(platform_id__in=selected_word_platform_ids).prefetch_related(
        Prefetch(
            "wordpronunciation_set",
            queryset=WordPronunciation.objects.select_related(
                "pronunciation__initial", "pronunciation__final", "pronunciation__tone"
            ).order_by("position"),
        )
    )

    word_corpus = {}
    for word in words:
        ref = reference_words.get(word.platform_id, {}) or {}
        # Preserve the platform's own themes verbatim when this word has a
        # reference entry -- same reasoning as the expression themes above.
        # Only a not-yet-published word (no reference entry) falls back to
        # deriving a theme from Word.category.
        if "themes" in ref:
            themes = list(ref.get("themes") or [])
        else:
            theme_id = theme_id_by_name.get((word.category or "").strip().lower())
            themes = [theme_id] if theme_id else []
        all_theme_ids.update(themes)

        word_corpus[word.platform_id] = {
            "audio": ref.get("audio", ""),
            "gloss_code": ref.get("gloss_code", []),
            "image": ref.get("image", ""),
            "in_expression": sorted(word_in_expression.get(word.platform_id, ())),
            "level": ref.get("level", 0),
            "part_of_speech": ref.get("part_of_speech", "n"),
            "themes": themes,
            "translations": {
                "primary": word.french or "",
                "secondary": word.english or "",
                "target": f"{word.pinyin()} {word.char()}".strip(),
            },
            "variants": ref.get("variants", {}),
        }

    theme_corpus = {
        theme_id: theme_payloads[theme_id]
        for theme_id in all_theme_ids
        if theme_id in theme_payloads
    }
    missing_theme_ids = all_theme_ids - theme_corpus.keys()
    if missing_theme_ids:
        warnings.append(
            f"{len(missing_theme_ids)} identifiant(s) de thème référencé(s) sont absents du dernier "
            f"instantané plateforme ({', '.join(sorted(missing_theme_ids))}) -- absents de themeCorpus.json."
        )

    return {
        "words": word_corpus,
        "expressions": expression_corpus,
        "themes": theme_corpus,
        "expression_rows": expression_rows,
        "warnings": warnings,
    }


def sync_entries():
    """Ensure every current DB expression (that has a platform_id) has an
    ExpressionNote (creating any missing ones, seeded from the platform's
    own published text where matched, else verbatim from expr.text --
    batched via _seed_notes_for, same as export_corpus), without running
    the full generator: lets someone open the table and add disambiguation
    hints/comments before generating, rather than only discovering new
    expressions mid-generate. Returns (added, skipped_no_platform_id)."""
    from .models import Expression

    _reference_words, reference_expressions = reference_corpora()

    expressions = list(Expression.objects.exclude(platform_id__isnull=True).exclude(platform_id=""))
    existing_ids = set(
        ExpressionNote.objects.filter(
            platform_id__in=[e.platform_id for e in expressions]
        ).values_list("platform_id", flat=True)
    )
    notes_by_id = _seed_notes_for(expressions, reference_expressions)
    added = len(notes_by_id) - len(existing_ids)
    skipped = Expression.objects.count() - len(expressions)

    return added, skipped
