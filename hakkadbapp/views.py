from io import StringIO, BytesIO
import json
import zipfile
from django.db.models import Prefetch, Count, Q
from django.http import HttpResponse
from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse
from django.views.decorators.http import require_POST
from .forms import PronunciationForm, WordForm
from django.db.models import F, Value, CharField
from django.db.models.functions import Concat
from .models import (
    ExpressionWord, Pronunciation, Tone, Initial, Final, WordPronunciation, Word, Traces, Expression,
    ExpressionNote,
)
import csv
from collections import Counter, defaultdict
from urllib.parse import unquote
from django.db.models import Case, When, IntegerField, Value
import random
from opencc import OpenCC
from openpyxl import Workbook
from django.db import transaction

from django.http import JsonResponse
from .text_to_words import (
    build_all_words_for_tokens,
    convert_phrase_to_word_data,
    resolve_hanzi,
)
from .illustrations import illustration_for
from . import expression_mesh
from . import word_notes

# The rosace poster (components/hanzi_block.html) renders every syllable of
# every word (and every word of every expression) through pinyin_switch.html,
# which walks wp.pronunciation.initial/final/tone -- without prefetching
# those, a well-connected character like 水 or 食 fans out into hundreds of
# individual round trips to the (remote, Supabase-hosted) DB and the page
# times out. These prefetch paths keep it to a handful of queries no matter
# how many words/expressions come back.
_WORD_PRONUNCIATION_PREFETCH = (
    'wordpronunciation_set__pronunciation__initial',
    'wordpronunciation_set__pronunciation__final',
    'wordpronunciation_set__pronunciation__tone',
)


def _with_illustrations(words):
    """Attach `.illustration` to each Word for template use (see the rosace
    poster in components/hanzi_block.html)."""
    words = list(words.prefetch_related(*_WORD_PRONUNCIATION_PREFETCH))
    for word in words:
        word.illustration = illustration_for(word)
    return words


def _expressions_containing(hanzi_char):
    """Expressions built from a word that uses this character -- shown
    alongside single words in the rosace poster (components/hanzi_block.html)."""
    return (
        Expression.objects.filter(words__pronunciations__hanzi=hanzi_char)
        .distinct()
        .prefetch_related(
            *(f'expressionword_set__word__{path}' for path in _WORD_PRONUNCIATION_PREFETCH)
        )
    )


def _expression_segments(expr):
    """Every position of the original phrase, in order -- including tokens
    that didn't match any Word at import time. import_expressions.py skips
    creating an ExpressionWord row entirely for an unmatched token (see its
    "mot inconnu" branch), so those positions leave a silent gap in
    expressionword_set rather than a placeholder row: the rosace poster used
    to just drop them, which is why some characters were missing from an
    expression's rendering. expr.text is the untouched original phrase (one
    whitespace-separated token per position, same split import used) so it's
    the only place those tokens still exist -- resolve_hanzi() is the same
    function import_expressions.py uses to turn a raw token into displayable
    hanzi (stripping ":gloss"/"(pinyin)" annotations), reused here so a gap
    renders exactly as it would have if it had matched."""
    words_by_position = {
        ew.position: ew.word for ew in expr.expressionword_set.all() if ew.word
    }
    tokens = expr.text.split() if expr.text else []
    segments = []
    for pos, token in enumerate(tokens):
        word = words_by_position.get(pos)
        if word is not None:
            segments.append({'word': word, 'hanzi': None})
        else:
            hanzi = resolve_hanzi(token)
            if hanzi:
                segments.append({'word': None, 'hanzi': hanzi})
    return segments


def _with_segments(expressions):
    """Attach `.segments` to each Expression for template use (see the
    rosace poster in components/hanzi_block.html)."""
    expressions = list(expressions)
    for expr in expressions:
        expr.segments = _expression_segments(expr)
    return expressions


def _with_platform_target(expressions, components_by_platform_id):
    """Attach `.platform_target` (the platform's own raw "pinyin hanzi"
    string, e.g. "shit⁶ lang⁴ mi³ 食浪米") to each Expression, keyed by
    Expression.platform_id -- see the rosace poster in
    components/hanzi_block.html, which shows this next to `.text` (the
    excel-format string actually imported) so the two can be compared.

    Keyed by platform_id (not a hanzi-text match) so an expression whose
    excel_format carries a disambiguation annotation
    (segment_hanzi_by_pinyin's "-(pinyin)" override, see
    platform_to_vercel.py) still finds its platform counterpart -- see
    build_expression_platform_components()'s docstring for the same
    reasoning."""
    for expr in expressions:
        entry = components_by_platform_id.get(expr.platform_id) if expr.platform_id else None
        expr.platform_target = entry["target"] if entry else ""
    return expressions

# Create converter: 's2t' = Simplified to Traditional, 't2s' = Traditional to Simplified
s2t = OpenCC('s2t')
t2s = OpenCC('t2s')

from .management.commands import import_lexique
from django.db.models import Case, When, Value, IntegerField

TONE_SUPERSCRIPT = {1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶"}
SUPERSCRIPT_TO_DIGIT = str.maketrans("¹²³⁴⁵⁶", "123456")


def split_target(target):
    """target is "<space-separated pinyin words> <concatenated hanzi>" -- the
    hanzi block has no internal spaces, so it's always the trailing token.
    Duplicated from management/commands/platform_to_vercel.py rather than
    imported: that module (via export.py -> read_themes_corpus ->
    generate_images) loads TrueType fonts from a hardcoded Windows path at
    *import time*, which crashes every request in production the moment
    anything in views.py imports it -- this view module is loaded on every
    request/cold start, unlike a management command run standalone by hand."""
    target = target or ""
    idx = target.rfind(" ")
    if idx == -1:
        return target, ""
    return target[:idx], target[idx + 1:]

# Fields shown in the duplicates "compared fields" table, in display order.
DUP_FIELDS = ["french", "hakka", "secondary", "theme", "status"]


def _dup_word_entry(w):
    return {
        "id": w.id, "french": w.french, "hakka": f"{w.char()} {w.pinyin()}".strip(),
        "secondary": w.english, "theme": w.category or "", "status": w.status or "",
    }


def _dup_expression_entry(e, split_diffs=None):
    entry = {
        "id": e.id, "french": e.french, "hakka": e.rendering,
        "secondary": e.english, "theme": e.category or "", "status": e.status or "",
    }
    if split_diffs and e.platform_id in split_diffs:
        entry["split_diff"] = split_diffs[e.platform_id]
    return entry


def _duplicate_groups(items, key_fn, entry_fn):
    """Group items sharing a key (french / hakka / english), normalized
    into comparable dicts.

    Divergent fields are computed per-group, never against an arbitrary
    "first" entry: queryset order carries no meaning, so treating one row as
    the reference and the rest as "changed" would bias the display toward
    whichever entry the DB happened to return first. Instead a field is
    flagged when the group's entries don't all agree on it, and every entry's
    cell for that field is highlighted the same way -- nobody is presumed
    correct, the reader decides.
    """
    groups = defaultdict(list)
    for item in items:
        key = (key_fn(item) or "").strip().lower()
        if key:
            groups[key].append(entry_fn(item))
    result = []
    for key, entries in groups.items():
        if len(entries) < 2:
            continue
        entries = sorted(entries, key=lambda e: e["id"])
        divergent_fields = [f for f in DUP_FIELDS if len({e[f] for e in entries}) > 1]
        for entry in entries:
            entry["diffs"] = divergent_fields
        search_blob = " ".join(
            f"{e['id']} {e['french']} {e['hakka']} {e['secondary']} {e['theme']} {e['status']}" for e in entries
        )
        result.append({
            "value": key, "entries": entries, "divergent_fields": divergent_fields,
            "search": f"{key} {search_blob}".lower(),
        })
    result.sort(key=lambda g: -len(g["entries"]))
    return result


def get_latest_platform_snapshot():
    """Most recent Traces row carrying a platform_data JSON payload (written
    by `platform_to_vercel --yes`). Reading this instead of the local
    e_reo_json/ folder is what makes platform-vs-Vercel checks (missing
    audio, component/pronunciation mismatches) safe to run from a view that
    also has to work on the deployed instance, which has no filesystem
    access to that folder at all."""
    return Traces.objects.exclude(platform_data__isnull=True).order_by("-timestamp").first()


def _expression_hanzi_tokens():
    """Bare hanzi tokens (the part before an optional ":gloss") that appear
    anywhere across all expressions -- either in the raw imported
    Expression.text or in a hand-entered ExpressionNote.excel_format
    (the "Split" field). Used to tell whether a words-hakka duplicate's
    hanzi is actually used in some expression at all, instead of offering
    "Désambiguïser" for every same-hanzi duplicate regardless of whether
    it's ever referenced by an expression."""
    tokens = set()
    for text in Expression.objects.exclude(text__isnull=True).exclude(text="").values_list("text", flat=True):
        tokens.update(text.split())
    for excel_format in ExpressionNote.objects.exclude(excel_format="").values_list("excel_format", flat=True):
        tokens.update(tok.split(":", 1)[0] for tok in excel_format.split())
    return tokens


def build_duplicate_sections():
    words_for_dup = list(
        Word.objects.prefetch_related(
            Prefetch(
                "wordpronunciation_set",
                queryset=WordPronunciation.objects.select_related(
                    "pronunciation__initial", "pronunciation__final", "pronunciation__tone"
                ),
            )
        )
    )
    expressions_for_dup = list(Expression.objects.all())

    words_hakka_groups = _duplicate_groups(words_for_dup, lambda w: f"{w.pinyin()} {w.char()}", _dup_word_entry)
    expression_hanzi_tokens = _expression_hanzi_tokens()
    for group in words_hakka_groups:
        hanzi = group["entries"][0]["hakka"].split(" ")[0] if group["entries"] else ""
        group["used_in_expressions"] = bool(hanzi) and hanzi in expression_hanzi_tokens

    # Per-expression: does its current Split (ExpressionNote.excel_format)
    # recompute a hakka target different from what the platform already has
    # for it? If so, exporting it as-is won't update the existing platform
    # row -- it'll create a new one next to it (the platform almost
    # certainly matches by this hakka text, not by id), leaving an orphaned
    # duplicate to clean up by hand. Surfaced per entry below rather than
    # only in export_corpus()'s warnings, so it's visible while reviewing
    # duplicates -- before anyone actually runs an export.
    split_platform_diffs = expression_mesh.compute_split_platform_diffs(expressions_for_dup)
    expression_entry_fn = lambda e: _dup_expression_entry(e, split_platform_diffs)

    return [
        {
            "key": "words-french", "category": "words",
            "title": "Mots -- même français", "secondary_label": "Anglais",
            "groups": _duplicate_groups(words_for_dup, lambda w: w.french, _dup_word_entry),
        },
        {
            "key": "words-hakka", "category": "words",
            "title": "Mots -- même hakka", "secondary_label": "Anglais",
            "groups": words_hakka_groups,
        },
        {
            "key": "words-english", "category": "words",
            "title": "Mots -- même anglais", "secondary_label": "Anglais",
            "groups": _duplicate_groups(words_for_dup, lambda w: w.english, _dup_word_entry),
        },
        {
            "key": "expressions-french", "category": "expressions",
            "title": "Expressions -- même français", "secondary_label": "Anglais",
            "groups": _duplicate_groups(expressions_for_dup, lambda e: e.french, expression_entry_fn),
        },
        {
            "key": "expressions-hakka", "category": "expressions",
            "title": "Expressions -- même hakka", "secondary_label": "Anglais",
            "groups": _duplicate_groups(expressions_for_dup, lambda e: e.rendering, expression_entry_fn),
        },
        {
            "key": "expressions-english", "category": "expressions",
            "title": "Expressions -- même anglais", "secondary_label": "Anglais",
            "groups": _duplicate_groups(expressions_for_dup, lambda e: e.english, expression_entry_fn),
        },
    ]

def static(request):
    context = {
        'pronunciations': Pronunciation.objects.all(),
        'tones': Tone.objects.all(),
        'initials': Initial.objects.all(),
        'finals': Final.objects.all(),
        'words': Word.objects.all(),
        'word_pronunciations': WordPronunciation.objects.select_related('word', 'pronunciation').all()
    }
    return render(request, "hakkadbapp/static.html", context)



def index(request):
    # Optimize WordPronunciation → Pronunciation → (Initial, Final, Tone)
    word_pron_qs = WordPronunciation.objects.select_related(
        'pronunciation__initial',
        'pronunciation__final',
        'pronunciation__tone'
    )

    # Prefetch the optimized WordPronunciation set into Word
    words = Word.objects.prefetch_related(
        Prefetch('wordpronunciation_set', queryset=word_pron_qs)
    )

    context = {
        'pronunciations': Pronunciation.objects.select_related('initial', 'final', 'tone').all(),
        'tones': Tone.objects.all(),
        'initials': Initial.objects.all(),
        'finals': Final.objects.all(),
        'words': words,
    }

    return render(request, "hakkadbapp/index.html", context)

def newPronunciation(request):
    if request.method == "POST":
        form = PronunciationForm(request.POST)
        if form.is_valid():
            form.save()
            return redirect('index')
    else:
        form = PronunciationForm()

    return render(request, "hakkadbapp/pronunciation_form.html", {'form': form})

@require_POST
def delete_pronunciation(request, pk):
    pronunciation = get_object_or_404(Pronunciation, pk=pk)
    pronunciation.delete()
    return redirect('')  # Replace with your list view name

def edit_pronunciation(request, pk):
    pronunciation = get_object_or_404(Pronunciation, pk=pk)
    if request.method == "POST":
        form = PronunciationForm(request.POST, instance=pronunciation)
        if form.is_valid():
            form.save()
            return redirect('index')
    else:
        form = PronunciationForm(instance=pronunciation)

    # Filter WordPronunciation where hanzi length is 1
    wps = WordPronunciation.objects.filter(pronunciation__hanzi=pronunciation.hanzi)

    return render(request, "hakkadbapp/pronunciation_form.html", {'form': form, "wps": wps})


def new_word(request):
    if request.method == 'POST':
        form = WordForm(request.POST)
        if form.is_valid():
            word = form.save(commit=False)
            hanzi_input = form.cleaned_data['hanzi_input']
            word.save()

            for position, char in enumerate(hanzi_input):
                matching_prons = Pronunciation.objects.filter(hanzi=char)
                if matching_prons.exists():
                    # If multiple, just pick the first one for now — or handle selection logic
                    WordPronunciation.objects.create(
                        word=word,
                        pronunciation=matching_prons.first(),
                        position=position
                    )
            return redirect('index')
    else:
        form = WordForm()

    # Pass all pronunciations to template for optional display
    context = {
        'form': form,
        'all_pronunciations': json.dumps(list(Pronunciation.objects.values('id', 'hanzi', 'initial', 'final', 'tone')), indent = 6),
        'initials' : json.dumps(list(Initial.objects.values('id', 'initial'))),
        'finals': json.dumps(list(Final.objects.values('id', 'final'))),
    }
    return render(request, 'hakkadbapp/word_form.html', context)



def edit_word(request, pk):
    word = get_object_or_404(Word, pk=pk)

    # Pre-populate hanzi_input based on current pronunciations
    initial_data = {
        'hanzi_input': ''.join([wp.pronunciation.hanzi for wp in word.wordpronunciation_set.all()])
    }

    print(initial_data)

    if request.method == 'POST':
        form = WordForm(request.POST, instance=word)
        
        if form.is_valid():
            word = form.save(commit=False)
            hanzi_input = form.cleaned_data['hanzi_input']
            print(word)

            word.save()

            # Remove old WordPronunciation entries
            WordPronunciation.objects.filter(word=word).delete()

            for idx, char in enumerate(hanzi_input):
                    p_key = f"char_{idx}"
                    p_id = request.POST.get(p_key)

                    if p_id:
                        pronunciation = Pronunciation.objects.get(id=p_id)
                        WordPronunciation.objects.update_or_create(
                            word=word,
                            position=idx,
                            pronunciation=pronunciation
                        )
                        print(word, idx, pronunciation)
                    else:
                        # Optionally handle missing or new pronunciation input
                        pass

            return redirect('index')
    else:
        form = WordForm(instance=word, initial=initial_data)
    context ={
        'form': form,
        'editing': True,
        'all_pronunciations': json.dumps(list(Pronunciation.objects.values('id', 'hanzi', 'initial', 'final', 'tone')), indent = 6),
        'initials' : json.dumps(list(Initial.objects.values('id', 'initial'))),
        'finals': json.dumps(list(Final.objects.values('id', 'final'))),
    }
    return render(request, 'hakkadbapp/word_form.html', context)




def word_csv(request):
    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = 'attachment; filename="words.csv"'
    response.write('\ufeff')  # Add BOM for Excel UTF-8 compatibility

    writer = csv.writer(response)
    writer.writerow(['hanzi', 'pinyin', 'fr'])

    for word in Word.objects.all():
        writer.writerow([
            word.char(),
            word.pinyin(),
            word.french,
        ])

    return response

def pronunciation_csv(request):
    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = 'attachment; filename="pronunciations.csv"'
    response.write('\ufeff')  # Add BOM for Excel UTF-8 compatibility


    writer = csv.writer(response)
    writer.writerow(['Hanzi', 'Initial', 'Final', 'Tone'])

    for p in Pronunciation.objects.select_related('initial', 'final', 'tone'):
        writer.writerow([
            p.hanzi,
            p.initial.initial,
            p.final.final,
            p.tone.tone_number,
        ])

    return response

def reports(request):
    """ Generates several reports about the lexicon.
    - Stats : number of words, number of caracters, number of vocab lists etc.
    - Caracters check : 
        * list of homophones (same py for many cars)
        * sort cars by initial
        * sort cars by final
        * sort cars by tone ?
    - List all parsing errors (py mismatch etc.)
    Args:
        request (_type_): _description_
    """
    context = {}
    context["stats"] = []
    context["stats"].append({
        'title' : 'Mots',
        'value' :  Word.objects.count(),
        'description' : "Nombre de mots qui ont été correctement analysés à partir du lexique."
    })
    context["stats"].append({
        'title' : 'Caractères',
        'value' : Pronunciation.objects.count(),
        'description' : "Nombre de lectures différentes de caractères."
    })

    context['title'] = "Rapports"
    context['page'] = "reports"
    # cmd = import_lexique.Command()
    # cmd.parse_sheets("1-MMXRTQ8_0r7jfqmFf6WIS4FMVNHIqMCFbV6JdMT-SQ")
    traces = Traces.objects.order_by('-timestamp')[:2]
    context['traces'] = {
        'last': traces[0] if traces else None,
        'errors': traces[0].details.count('❌') if traces else 0,
        'previous': traces[1] if len(traces) > 1 else None,
        'diff' : {
            'words': traces[1].word_count - traces[0].word_count,
            'chars': traces[1].char_count - traces[0].char_count,
            'errors': traces[1].details.count('❌') - traces[0].details.count('❌') if len(traces) > 1 else 0
        }
    }

    context["stats"].append({
        "title" : 'Dernière importation',
        "value" : traces[0].timestamp,
        "description" : "Date et heure de la dernière importation du lexique."
    })

    context["stats"].append({
        "title" : 'Nouveaux mots',
        "value" : context['traces']['diff']['words'],
        "description" : "Nombre de mots importés lors de la dernière importation."
    })

    context["stats"].append({
        "title" : 'Nouveaux caractères',
        "value" : context['traces']['diff']['chars'],
        "description" : "Nombre de caractères importés lors de la dernière importation."
    })

    context["stats"].append({
        "title" : 'Erreurs de parsing',
        "value" : context['traces']['errors'],
        "description" : "Nombre d'erreurs de parsing lors de la dernière importation."
    })

    context["stats"].append({
        "title" : 'Erreurs corrigées',
        "value" : context['traces']['diff']['errors'],
        "description" : "Nombre d'erreurs de parsing corrigées lors de la dernière importation."
    })

    context["stats"].append({
        'title': 'Expressions',
        'value': Expression.objects.count(),
        'description': "Nombre d'expressions dans la base.",
    })

    # ---- couverture des mots par les expressions ---------------------------

    words_total = Word.objects.count()
    words_in_expressions = Word.objects.filter(expressionword__isnull=False).distinct().count()
    coverage_pct = round(100 * words_in_expressions / words_total, 1) if words_total else 0

    context["stats"].append({
        'title': 'Couverture par les expressions',
        'value': f"{words_in_expressions} / {words_total} ({coverage_pct}%)",
        'description': "Nombre de mots qui apparaissent dans au moins une expression.",
    })

    # ---- statistiques par thème (live) -------------------------------------

    context["words_by_category"] = list(
        Word.objects.exclude(category__isnull=True).exclude(category="")
        .values("category").annotate(n=Count("id")).order_by("-n")
    )

    # Expression.category is comma-separated (an expression can carry several
    # themes), unlike Word.category which only ever holds one -- so counting
    # "by theme" means exploding on the comma, not grouping the raw string.
    expr_theme_counts = Counter()
    for raw_category in Expression.objects.exclude(category__isnull=True).exclude(category="").values_list("category", flat=True):
        for theme in raw_category.split(","):
            theme = theme.strip()
            if theme:
                expr_theme_counts[theme] += 1
    context["expressions_by_category"] = [
        {"category": name, "n": n} for name, n in sorted(expr_theme_counts.items(), key=lambda kv: -kv[1])
    ]

    # ---- doublons : même français / même hakka / même anglais ----
    # (base actuelle uniquement -- pas de comparaison avec la plateforme)
    # Le détail interactif vit sur sa propre page (/doublons) ; ici on ne
    # garde qu'un compteur et un lien.
    duplicates_count = sum(len(section["groups"]) for section in build_duplicate_sections())
    context["stats"].append({
        'title': 'Doublons',
        'value': duplicates_count,
        'description': "Groupes d'entrées en doublon dans la base actuelle.",
        'link': reverse('duplicates'),
        'link_label': 'Voir le détail →',
    })

    # ---- erreurs de format, en direct sur la base actuelle -----------------
    # (par opposition au log de la dernière importation ci-dessus, qui peut
    # être obsolète si la base a été modifiée depuis)

    format_errors = []

    entering_tone_violations = (
        Pronunciation.objects.filter(tone__tone_number__in=[5, 6])
        .exclude(final__final__iregex=r"[ptk]$")
        .select_related("initial", "final", "tone")
    )
    for pron in entering_tone_violations:
        format_errors.append(
            f"{pron.hanzi} {pron.pinyin()} : ton 5/6 réservé aux finales en p/t/k, "
            f"finale actuelle \"{pron.final}\""
        )

    incomplete_words = Word.objects.filter(
        Q(category__isnull=True) | Q(category="") | Q(status__isnull=True) | Q(status="")
    )
    for word in incomplete_words:
        format_errors.append(f"mot incomplet (catégorie ou statut manquant) : {word.french} / {word.char()}")

    incomplete_expressions = Expression.objects.filter(
        Q(rendering__contains="~") | Q(status__icontains="KO")
    )
    for expr in incomplete_expressions:
        format_errors.append(f"expression incomplète : {expr.french} | {expr.rendering}")

    context["format_errors"] = format_errors
    context["format_errors_count"] = len(format_errors)

    # ---- audio manquant, d'après le dernier instantané plateforme ---------
    # Whether a recording exists is metadata on the *platform* side (an
    # "audio" id on each word/expression payload) -- Vercel doesn't store
    # audio at all, so this reads the platform_data JSON snapshotted onto
    # the latest platform_to_vercel Traces row, never the local filesystem.
    snapshot = get_latest_platform_snapshot()
    if snapshot:
        platform_words = (snapshot.platform_data or {}).get("words", {}) or {}
        platform_expressions = (snapshot.platform_data or {}).get("expressions", {}) or {}

        def missing_audio(payloads, kind):
            # Expected filename mirrors export.py's own convention exactly
            # (see Command.handle_words / handle_expressions there): a word's
            # recording is named after its digit-tone pinyin (concatenated
            # across syllables, e.g. "on1lok6.wav"); an expression's is named
            # after its concatenated hanzi instead -- pinyin isn't a stable,
            # human-friendly filename for a whole phrase, hanzi is exactly
            # what the recording is made from.
            out = []
            for payload in payloads.values():
                if payload.get("audio"):
                    continue
                tr = payload.get("translations", {}) or {}
                target = tr.get("target", "")
                pinyin, hanzi = split_target(target)
                if kind == "word":
                    expected_filename = f"{pinyin.translate(SUPERSCRIPT_TO_DIGIT)}.wav" if pinyin else ""
                else:
                    expected_filename = f"{hanzi}.wav" if hanzi else ""
                out.append({
                    "french": tr.get("primary", ""), "target": target,
                    "expected_filename": expected_filename,
                })
            out.sort(key=lambda e: e["target"])
            return out

        missing_audio_words = missing_audio(platform_words, "word")
        missing_audio_expressions = missing_audio(platform_expressions, "expression")
        context["audio_snapshot"] = {
            "timestamp": snapshot.timestamp,
            "total_words": len(platform_words),
            "total_expressions": len(platform_expressions),
            "missing_words": missing_audio_words,
            "missing_expressions": missing_audio_expressions,
        }
    else:
        context["audio_snapshot"] = None

    return render(request, "hakkadbapp/reports.html", context)


def duplicates_view(request):
    """Dedicated, interactive duplicates page (live DB, no platform diff).

    Data is embedded as JSON and rendered client-side (search/filter/copy/
    "resolved" state all happen instantly with no round-trip), same
    architecture as management/commands/corpus_diff_dashboard_template.html.
    "Resolved" is tracked per-browser in localStorage only -- this page never
    writes to the database, it's a triage aid while editing happens on the
    e-reo platform itself.
    """
    sections = build_duplicate_sections()
    payload = {
        "sections": [
            {
                "key": section["key"],
                "title": section["title"],
                "category": section["category"],
                "secondary_label": section["secondary_label"],
                "groups": [
                    {
                        "id": f"{section['key']}:{group['value']}",
                        "value": group["value"],
                        "divergent_fields": group["divergent_fields"],
                        "search": group["search"],
                        "entries": group["entries"],
                        "used_in_expressions": group.get("used_in_expressions", False),
                    }
                    for group in section["groups"]
                ],
            }
            for section in sections
        ],
    }
    context = {
        "title": "Doublons",
        "diff_data_json": json.dumps(payload, ensure_ascii=False),
        "duplicates_count": sum(len(s["groups"]) for s in sections),
    }
    return render(request, "hakkadbapp/duplicates.html", context)


def search(request):
    # Same word/expression "card" as the hanzi rosace poster (see
    # components/word_card.html / expression_card.html) -- reuses its
    # helpers so both pages render identically and stay in sync.
    words = _with_illustrations(Word.objects.all())

    expressions_qs = Expression.objects.all().prefetch_related(
        *(f'expressionword_set__word__{path}' for path in _WORD_PRONUNCIATION_PREFETCH)
    )
    components_by_hanzi, _snapshot_timestamp = build_expression_platform_components()
    expressions = _with_platform_target(_with_segments(expressions_qs), components_by_hanzi)

    context = {
        'pronunciations': Pronunciation.objects.select_related('initial', 'final', 'tone').all(),
        'tones': Tone.objects.all(),
        'initials': Initial.objects.all(),
        'finals': Final.objects.all(),
        'words': words,
        'expressions': expressions,
        'title': "Recherche de mots",
        'page': "search",
        "categories": Word.objects.values_list('category', flat=True).distinct(),
    }

    return render(request, "hakkadbapp/search.html", context)

def browse(request):
    context = {"page": "browse"}
    return render(request, "hakkadbapp/browse.html", context)


def get_all_data():
    expressions = (
        Expression.objects
        .prefetch_related(
            "expressionword_set__word",
            "expressionword_set__word__wordpronunciation_set__pronunciation"
        )
        .all()
    )

    word_pron_qs = WordPronunciation.objects.select_related(
        'pronunciation__initial',
        'pronunciation__final',
        'pronunciation__tone'
    )

    # Prefetch the optimized WordPronunciation set into Word
    words = Word.objects.prefetch_related(
        Prefetch('wordpronunciation_set', queryset=word_pron_qs)
    )

    context = {
        'pronunciations': Pronunciation.objects.select_related('initial', 'final', 'tone').all(),
        'tones': Tone.objects.all(),
        'initials': Initial.objects.all(),
        'finals': Final.objects.all(),
        'words': words,
        # No default 'title'/'page' here on purpose -- this context is shared
        # by three different nav pages (converter, transcripter, expressions)
        # that each need their own; a hardcoded default here previously leaked
        # "Recherche de mots" (this function's original, single caller) into
        # all three, and none of them set 'page' at all, so their nav link
        # never highlighted as active either.
        "categories": Word.objects.values_list('category', flat=True).distinct(),
        "expressions": expressions,
        "expressions_count": expressions.count(),
    }
    return context

def pinyin_converter(request):
    context = get_all_data()
    context["title"] = "Écrire"
    context["page"] = "converter"
    return render(request, "hakkadbapp/converter.html", context)

def transcripter(request):
    context = get_all_data()
    context["title"] = "Transcrire"
    context["page"] = "transcripter"
    return render(request, "hakkadbapp/transcripter.html", context)

def caracters(request):
    context = {"page": "caracters", "title": "Caractères"}
    all_prons = Pronunciation.objects.order_by('initial__initial', 'final__final', 'tone__tone_number').select_related('initial', 'final', 'tone')
    context["all_prons"] = all_prons

    multi_pron_hanzi = (
        Pronunciation.objects
        .values('hanzi')
        .annotate(count=Count('id'))
        .filter(count__gt=1)
        .values_list('hanzi', flat=True)
    )
    all_prons_by_car = (
        Pronunciation.objects
        .filter(hanzi__in=multi_pron_hanzi)
        .order_by('hanzi', 'initial__initial', 'final__final', 'tone__tone_number')
        .select_related('initial', 'final', 'tone')
    )
    context["all_prons_by_car"] = all_prons_by_car
    return render(request, "hakkadbapp/caracters.html", context)


def api_words_data(request):
    """Dumps the entire word catalog as JSON, once, so flashcards.html can
    cache it client-side (localStorage) and render every subsequent card --
    and the hanzi links on it -- instantly instead of round-tripping to the
    server (often a slow remote/serverless DB connection) on every click.

    Reuses pinyin_switch.html (rendered once per syllable here) rather than
    re-implementing the 4 transcription systems in JS, so there's a single
    source of truth for that markup."""
    from django.template.loader import get_template

    pinyin_switch_tpl = get_template("hakkadbapp/components/pinyin_switch.html")

    word_pron_qs = WordPronunciation.objects.select_related(
        "pronunciation__initial", "pronunciation__final", "pronunciation__tone"
    ).order_by("position")
    words = Word.objects.prefetch_related(Prefetch("wordpronunciation_set", queryset=word_pron_qs))

    payload = []
    for word in words:
        wps = list(word.wordpronunciation_set.all())
        hanzi = "".join(wp.pronunciation.hanzi for wp in wps)
        if not hanzi.strip():
            continue  # matches flashcards()'s own "skip words with an empty __str__()" guard
        chars = list(dict.fromkeys(wp.pronunciation.hanzi for wp in wps if wp.pronunciation.hanzi))
        pinyin_html = "".join(
            pinyin_switch_tpl.render({
                "i": wp.pronunciation.initial.initial,
                "f": wp.pronunciation.final.final,
                "t": wp.pronunciation.tone.tone_number,
            })
            for wp in wps
        )
        payload.append({
            "id": word.id,
            "hanzi": hanzi,
            "chars": chars,
            "french": word.french,
            "category": word.category or "",
            "pinyin_html": pinyin_html,
            "illustration": illustration_for(word),
        })

    return JsonResponse({"version": str(len(payload)), "words": payload})


def flashcards(request, category=None):
    # A rosace poster (see the `hanzi` view) can hand off into flashcard
    # mode for just the words built around one character, so the two
    # features stay connected instead of being dead ends.
    hanzi_filter = unquote(request.GET.get('hanzi', '') or '')

    # Get all word IDs
    word_ids = Word.objects.all()
    if category:
        word_ids = word_ids.filter(category=category)
    if hanzi_filter:
        word_ids = word_ids.filter(pronunciations__hanzi=hanzi_filter)
    # Materialized once up front -- random.choice() on a bare QuerySet works
    # (it supports __len__/__getitem__) but issues a fresh SQL query for the
    # length AND for every single indexed access, so the retry loop below
    # used to cost up to 11 round trips to the DB instead of 1.
    word_ids = list(word_ids.values_list('id', flat=True).distinct())

    if not word_ids:
        return render(request, "hakkadbapp/flashcards.html", {"word": None, "title": "Aucun mot", "page": "flashcards"})

    max_attempts = 10  # Prevent infinite loop
    word = None

    for _ in range(max_attempts):
        random_id = random.choice(word_ids)
        word = Word.objects.get(id=random_id)
        if str(word).strip():  # Check that __str__() is not empty
            break
    else:
        word = None  # No valid word found after N tries

    word_chars = []
    if word:
        seen_chars = set()
        for wp in word.wordpronunciation_set.all():
            char = wp.pronunciation.hanzi
            if char and char not in seen_chars:
                seen_chars.add(char)
                word_chars.append(char)

    context = {
        "page": "flashcards",
        "word": word,
        "illustration": illustration_for(word),
        "word_chars": word_chars,
        "title": f"Flashcard - {category}" if category else "Flashcard",
        "categories": Word.objects.values_list('category', flat=True).distinct(),
        "category": category,
        "hanzi_filter": hanzi_filter,
    }

    return render(request, "hakkadbapp/flashcards.html", context)


def hanzi(request, hanzi_char):
    hanzi_char = unquote(hanzi_char)
    context = {}
    # Get all pronunciations for this character
    prons = Pronunciation.objects.filter(hanzi=hanzi_char)

    # Get all related words that include one of those pronunciations
    related_words = _with_illustrations(
        Word.objects.filter(pronunciations__in=prons).distinct()
    )
    related_expressions = _with_segments(_expressions_containing(hanzi_char))
    components_by_hanzi, _snapshot_timestamp = build_expression_platform_components()
    related_expressions = _with_platform_target(related_expressions, components_by_hanzi)

    # Prepare data
    context = {
        'hanzi': hanzi_char,
        'simp': t2s.convert(hanzi_char),
        'trad': s2t.convert(hanzi_char),
        'pronunciations': prons,
        'related_words': related_words,
        'related_expressions': related_expressions,
        'title': f"{hanzi_char}"
    }
    return render(request, "hakkadbapp/hanzi.html", context)

def phonemes(request):
    custom_order = ['b', 'p', 'm', 'f',
                'd', 't', 'n', 'l',
                'g', 'k', 'h',
                'j', 'q', 'x',
                'zh', 'ch', 'sh', 'r',
                'z', 'c', 's',
                '']  # for null initial

    # hakka_finals = sorted([
    #     'a', 'e', 'i', 'o', 'u', 'ai', 'oi', 'ui', 'iu', 'eu', 'am', 'em', 'im', 'an', 'in', 'un',
    #     'ang', 'ing', 'ung', 'ong', 'ap', 'ip', 'at', 'it', 'ut', 'ak', 'uk', 'ok', 'et', 'on',
    #     'iap', 'iung', 'ot', 'iong', 'au', 'ao', 'io', 'uo', 'iuk', 'en', 'iok', 'iun', 'ia',
    #     'iang', 'ep', 'ian', 'iam', 'iao', 'iak'
    # ])

    # Build a Case/When expression for ordering
    order_cases = Case(
        *[When(initial=val, then=Value(idx)) for idx, val in enumerate(custom_order)],
        default=Value(len(custom_order)),  # Items not in list go last
        output_field=IntegerField()
    )

    # Apply the custom order in the query
    initials = (
        Initial.objects
        .filter(pronunciations__isnull=False)
        .distinct()
        .annotate(ordering=order_cases)
        .order_by('ordering')
    )

    # # Build the ordering Case
    # ordering_case = Case(
    #     *[When(final=val, then=Value(idx)) for idx, val in enumerate(hakka_finals)],
    #     default=Value(len(hakka_finals)),  # Place unknown finals last
    #     output_field=IntegerField()
    # )

    # Query with custom ordering
    finals = (
        Final.objects
        .filter(pronunciations__isnull=False)
        .distinct()
        .order_by('final')
    )
    # All unique initials and finals in use
    # initials = Initial.objects.filter(pronunciations__isnull=False).distinct().order_by('initial')
    # finals = Final.objects.filter(pronunciations__isnull=False).distinct().order_by('final')

    # Get all unique (initial, final) pairs
    combos = Pronunciation.objects.values_list('initial_id', 'final_id').distinct()

    # Convert to set of tuples for fast lookup
    combo_set = set(combos)

    # Distinct hanzi per (initial, final) combo, ignoring tone -- lets the
    # "show matching characters" toggle reveal them inline instead of just
    # linking out to the hanzi_by_pinyin page.
    combo_hanzi = defaultdict(list)
    seen = defaultdict(set)
    for initial_id, final_id, hanzi_char in Pronunciation.objects.values_list(
        'initial_id', 'final_id', 'hanzi'
    ).order_by('hanzi'):
        key = (initial_id, final_id)
        if hanzi_char not in seen[key]:
            seen[key].add(hanzi_char)
            combo_hanzi[key].append(hanzi_char)

    context = {
        'initials': initials,
        'finals': finals,
        'combo_set': combo_set,
        'combo_hanzi': dict(combo_hanzi),
        'title': "Tableau des phonèmes",
        'page': "phonemes",
    }
    return render(request, 'hakkadbapp/phonemes.html', context)


def hanzi_by_pinyin(request, syllable):
    # Filter all relevant pronunciations
    prons = Pronunciation.objects.annotate(
        combined=Concat(
            F('initial__initial'),
            F('final__final'),
            output_field=CharField()
        )
    ).filter(combined=syllable)

    # Group by hanzi character
    hanzi_map = defaultdict(list)
    for p in prons:
        hanzi_map[p.hanzi].append(p)

    # Prepare full data per hanzi
    hanzi_data = []
    for hanzi_char, prons_list in hanzi_map.items():
        words = _with_illustrations(
            Word.objects.filter(pronunciations__in=prons_list).distinct()
        )
        hanzi_data.append({
            'hanzi': hanzi_char,
            'simp': t2s.convert(hanzi_char),
            'trad': s2t.convert(hanzi_char),
            'pronunciations': prons_list,
            'related_words': words,
            'related_expressions': _with_segments(_expressions_containing(hanzi_char)),
        })

    context = {
        'syllable': syllable,
        'title': f"{syllable}",
        'hanzi_data': hanzi_data
    }

    return render(request, "hakkadbapp/hanzi_by_pinyin.html", context)

def hanzi_by_tone(request, tone):
    # Filter all relevant pronunciations, prefetch related fields for efficiency
    prons = Pronunciation.objects.filter(tone__tone_number=tone).select_related('initial', 'final', 'tone')

    context = {
        'tone_number': tone,
        'title': f"Tone {tone}",
        'pronunciations': prons,
    }

    return render(request, "hakkadbapp/hanzi_by_tone.html", context)

def pronunciation(request):
    custom_order = ['b', 'p', 'm', 'f',
            'd', 't', 'n', 'l',
            'g', 'k', 'h',
            'j', 'q', 'x',
            'zh', 'ch', 'sh', 'r',
            'z', 'c', 's',
            '']  # for null initial

    hakka_finals = sorted([
        'a', 'e', 'i', 'o', 'u', 'ai', 'oi', 'ui', 'iu', 'eu', 'am', 'em', 'im', 'an', 'in', 'un',
        'ang', 'ing', 'ung', 'ong', 'ap', 'ip', 'at', 'it', 'ut', 'ak', 'uk', 'ok', 'et', 'on',
        'iap', 'iung', 'ot', 'iong', 'au', 'ao', 'io', 'uo', 'iuk', 'en', 'iok', 'iun', 'ia',
        'iang', 'ep', 'ian', 'iam', 'iao', 'iak','ü'
    ])
    # Build a Case/When expression for ordering
    order_cases = Case(
        *[When(initial=val, then=Value(idx)) for idx, val in enumerate(custom_order)],
        default=Value(len(custom_order)),  # Items not in list go last
        output_field=IntegerField()
    )

    # Apply the custom order in the query
    initials = (
        Initial.objects
        .filter(pronunciations__isnull=False)
        .distinct()
        .annotate(ordering=order_cases)
        .order_by('ordering')
    )

    # Build the ordering Case
    ordering_case = Case(
        *[When(final=val, then=Value(idx)) for idx, val in enumerate(hakka_finals)],
        default=Value(len(hakka_finals)),  # Place unknown finals last
        output_field=IntegerField()
    )

    # Query with custom ordering
    finals = (
        Final.objects
        .filter(pronunciations__isnull=False)
        .distinct()
        .order_by('final')
    )
    # All unique initials and finals in use
    # initials = Initial.objects.filter(pronunciations__isnull=False).distinct().order_by('initial')
    # finals = Final.objects.filter(pronunciations__isnull=False).distinct().order_by('final')

    tones = (
        Tone.objects.all()
    )

    # Get all unique (initial, final) pairs
    combos = Pronunciation.objects.values_list('initial_id', 'final_id').distinct()

    # Convert to set of tuples for fast lookup
    combo_set = set(combos)

    context = {  
        'initials': initials,
        'finals': finals,
        'combo_set': combo_set,
        'tones': tones,
        'title': "Prononciation",
        'page': "pronunciation",
    }
    return render(request, "hakkadbapp/pronunciation.html", context)

def create_expression_from_hanzi(sentence, french_translation=""):
    tokens = sentence.strip().split()

    # Create the expression
    expr = Expression.objects.create(french=french_translation)

    # Preload all words with pronunciations to avoid repeated DB queries
    all_words = (
        Word.objects
        .prefetch_related("wordpronunciation_set__pronunciation")
        .all()
    )

    with transaction.atomic():
        for pos, token in enumerate(tokens):

            # Find first Word whose full hanzi == token
            match = next(
                (w for w in all_words if w.char() == token),
                None
            )

            # Create ExpressionWord row
            ExpressionWord.objects.create(
                expression=expr,
                word=match,   # may be None only if your FK allows it
                position=pos
            )

    return expr

def build_expression_platform_components():
    """Maps each platform expression's own id (the same key
    Expression.platform_id carries through verbatim from wordCorpus.json/
    expressionCorpus.json -- see models.Expression.platform_id) to the raw
    platform fields the expressions page compares against Vercel/the DB's
    own computation: its french/english translations, its "pinyin hanzi"
    target text as recorded (no recomputation), and its `components` dict
    (word "pinyin hanzi" -> platform word id).

    Previously keyed by the expression's concatenated hanzi instead, joined
    against Expression.text client-side -- but Expression.text can carry
    disambiguation annotations (segment_hanzi_by_pinyin's "-(pinyin)"
    overrides, see platform_to_vercel.py) that the platform's own raw hanzi
    never has, so a perfectly round-tripped expression could still fail
    that exact-string match and show up as "introuvable" on the platform
    even though it plainly came from there. Matching by platform_id instead
    is a direct, always-correct join -- same fix as everywhere else in this
    app that used to match text instead of the real id.
    """
    snapshot = get_latest_platform_snapshot()
    if not snapshot:
        return {}, None

    platform_expressions = (snapshot.platform_data or {}).get("expressions", {}) or {}
    by_platform_id = {}
    for obj_id, payload in platform_expressions.items():
        translations = payload.get("translations") or {}
        by_platform_id[obj_id] = {
            "primary": translations.get("primary", ""),
            "secondary": translations.get("secondary", ""),
            "target": translations.get("target", ""),
            "components": payload.get("components") or {},
        }
    return by_platform_id, snapshot.timestamp


def expressions(request):
    context = get_all_data()
    context["title"] = "Expressions"
    context["page"] = "expressions"
    components_by_hanzi, snapshot_timestamp = build_expression_platform_components()
    context["platform_components_json"] = json.dumps(components_by_hanzi, ensure_ascii=False)
    context["platform_snapshot_timestamp"] = snapshot_timestamp

    # The single comparison table (expressions.js) needs each expression's
    # persistent ExpressionNote (commentaire/excel_format/use_in_export) --
    # batched into one query rather than looked up per row, same reasoning
    # as expression_mesh.py's own _seed_notes_for(). Not auto-created here:
    # a GET request shouldn't write rows just from being viewed, so an
    # expression with none yet just renders empty/off defaults, and gets
    # its ExpressionNote lazily on first save via expression_mesh_entry.
    expressions = list(context["expressions"])
    notes_by_id = {
        n.platform_id: n
        for n in ExpressionNote.objects.filter(
            platform_id__in=[e.platform_id for e in expressions if e.platform_id]
        )
    }
    effective_excel_format_by_id = {}
    for expr in expressions:
        expr.note = notes_by_id.get(expr.platform_id)
        # Reconstructed here (Python) rather than in expressions.js: turning
        # the platform's raw "pinyin hanzi" target into a space-per-word
        # hanzi phrase Sentence.js can actually decompose needs
        # expression_mesh.excel_format_from_platform_target's syllable-
        # counting logic, and duplicating that in JS would be one more
        # place for the two to quietly drift apart. Used by expressions.js
        # as the Vercel/base decomposition source only when this
        # expression's own Split field is still empty (see its docstring
        # comment) -- "" when there's no platform match or the
        # reconstruction couldn't fully account for the hanzi.
        platform_entry = components_by_hanzi.get(expr.platform_id) if expr.platform_id else None
        expr.platform_split = (
            expression_mesh.excel_format_from_platform_target(platform_entry["target"])
            if platform_entry else None
        ) or ""
        if expr.platform_id:
            # The Split text that would actually end up on this expression's
            # ExpressionNote the moment anyone saves anything on it (see
            # expression_mesh.get_or_create_entry/_seed_excel_format) -- an
            # existing note's own excel_format, or this same platform/text
            # seed if there's no note yet. Used below to decide up front
            # whether "Utiliser dans l'export" may be turned on for a row
            # that doesn't even have a note row yet.
            effective_excel_format_by_id[expr.platform_id] = (
                expr.note.excel_format if expr.note else (expr.platform_split or expr.text or "")
            )

    # Gates "Utiliser dans l'export": only an expression whose Split resolves
    # with no ambiguous term and no unresolved ("~") hanzi may have it turned
    # on -- see expression_mesh.compute_export_readiness's docstring. Batched
    # for the whole page at once, same reasoning as notes_by_id above.
    export_readiness = expression_mesh.compute_export_readiness_map(effective_excel_format_by_id)
    for expr in expressions:
        readiness = export_readiness.get(expr.platform_id) if expr.platform_id else None
        expr.export_ok = bool(readiness and readiness["ok"])
        reasons = []
        if readiness and readiness["has_unresolved"]:
            reasons.append("le hakka calculé contient un caractère non résolu (« ~ »)")
        if readiness and readiness["has_ambiguous"]:
            reasons.append("un ou plusieurs termes du Split restent ambigus (aucun « :précision »)")
        expr.export_block_reason = " ; ".join(reasons)

    context["expressions"] = expressions
    return render(request, "hakkadbapp/expressions.html", context)


# ---------------------------------------------------------------------------
# Expression mesh: a per-expression {excel_format, commentaire} row
# (models.ExpressionNote, see expression_mesh.py), keyed by
# Expression.platform_id, editable from duplicates/expressions/the hanzi
# rosace, and used to generate a proper expressionCorpus.json (components
# mesh) for the platform import. The excel_format text itself carries any
# disambiguation needed (":gloss" hints, same syntax import_expressions.py
# already understands) -- there is no separate word_id table to keep in
# sync.
# ---------------------------------------------------------------------------

def _expression_mesh_preview(excel_format):
    """Per-token resolution of `excel_format` against the DB, for the
    editor to show what a save would actually produce: which Word (if any)
    each token resolves to, and whether it's ambiguous without a ":gloss"
    hint -- same function (find_words_by_hanzi_with_disambiguation) the
    generator itself uses, run here on just this one phrase's tokens."""
    from .text_to_words import build_all_words_for_tokens, find_words_by_hanzi_with_disambiguation

    tokens = excel_format.split()
    all_words = list(build_all_words_for_tokens(tokens))
    preview = []
    for token in tokens:
        matches = find_words_by_hanzi_with_disambiguation(token, all_words)
        word = matches[0]
        entry = {"token": token, "word": None, "ambiguous": False, "candidates": []}
        if word:
            entry["word"] = {"char": word.char(), "pinyin": word.pinyin(), "french": word.french}
            if len(matches) > 1 and ":" not in token:
                entry["ambiguous"] = True
                entry["candidates"] = [
                    {"char": m.char(), "pinyin": m.pinyin(), "french": m.french} for m in matches if m
                ]
        preview.append(entry)
    return preview


def expression_mesh_download(request):
    buf = StringIO()
    writer = csv.DictWriter(buf, fieldnames=expression_mesh.FIELDNAMES)
    writer.writeheader()
    for note in ExpressionNote.objects.order_by("platform_id"):
        writer.writerow({
            "platform_id": note.platform_id,
            "excel_format": note.excel_format,
            "commentaire": note.commentaire,
        })
    bom = chr(0xFEFF)
    # Leading BOM so Excel recognizes this as UTF-8 and renders hanzi
    # correctly on double-click open, instead of guessing the system
    # codepage and showing mojibake -- same reasoning as save_mesh's
    # utf-8-sig.
    response = HttpResponse(bom + buf.getvalue(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="expression_mesh.csv"'
    return response


@require_POST
def expression_mesh_upload(request):
    uploaded = request.FILES.get("file")
    if not uploaded:
        return JsonResponse({"error": "Aucun fichier reçu."}, status=400)
    try:
        text = uploaded.read().decode("utf-8-sig")  # tolerate a BOM from Excel's own CSV export
    except UnicodeDecodeError as exc:
        return JsonResponse({"error": f"Encodage invalide : {exc}"}, status=400)

    reader = csv.DictReader(StringIO(text))
    required = {"platform_id", "excel_format"}
    if reader.fieldnames is None or required - set(reader.fieldnames):
        return JsonResponse(
            {"error": f"Colonnes attendues : {', '.join(expression_mesh.FIELDNAMES)}."}, status=400
        )
    rows = []
    for row in reader:
        platform_id = (row.get("platform_id") or "").strip()
        if not platform_id:
            return JsonResponse({"error": "Chaque ligne doit avoir un platform_id non vide."}, status=400)
        rows.append({
            "platform_id": platform_id,
            "excel_format": row.get("excel_format") or "",
            "commentaire": row.get("commentaire") or "",
        })

    for row in rows:
        ExpressionNote.objects.update_or_create(
            platform_id=row["platform_id"],
            defaults={"excel_format": row["excel_format"], "commentaire": row["commentaire"]},
        )
    return JsonResponse({"ok": True, "count": len(rows)})


def _expression_note_json(expr, note):
    return {
        "platform_id": expr.platform_id,
        "excel_format": note.excel_format,
        "commentaire": note.commentaire,
        "use_in_export": note.use_in_export,
        "preview": _expression_mesh_preview(note.excel_format),
    }


def expression_mesh_entry(request, expr_id):
    """GET: return (creating -- seeded from the platform's own published
    text where matched, see expression_mesh.get_or_create_entry -- if
    needed) this Expression's ExpressionNote, plus a per-token preview of
    what its excel_format currently resolves to. POST: save an edited
    excel_format and/or commentaire and/or use_in_export for that same
    expression -- each field only touched when present in the payload, so
    a caller can flip just use_in_export without resending the others."""
    expr = get_object_or_404(Expression, id=expr_id)
    _reference_words, reference_expressions = expression_mesh.reference_corpora()

    try:
        if request.method == "POST":
            try:
                payload = json.loads(request.body.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                return JsonResponse({"error": "JSON invalide."}, status=400)

            note, _created = expression_mesh.get_or_create_entry(expr, reference_expressions)

            if "excel_format" in payload:
                excel_format = payload.get("excel_format")
                if not isinstance(excel_format, str) or not excel_format.strip():
                    return JsonResponse({"error": "'excel_format' est requis."}, status=400)
                note.excel_format = excel_format
            if "commentaire" in payload:
                commentaire = payload.get("commentaire")
                if not isinstance(commentaire, str):
                    return JsonResponse({"error": "'commentaire' doit être une chaîne."}, status=400)
                note.commentaire = commentaire
            if "use_in_export" in payload:
                use_in_export = payload.get("use_in_export")
                if not isinstance(use_in_export, bool):
                    return JsonResponse({"error": "'use_in_export' doit être un booléen."}, status=400)
                # Enforced here too, not just in the UI (which just disables
                # the checkbox): a stale page or a direct API call must not
                # be able to mark an expression exportable while its Split
                # still has an unresolved ("~") hanzi or an undisambiguated
                # term -- see expression_mesh.compute_export_readiness.
                if use_in_export and not note.use_in_export:
                    readiness = expression_mesh.compute_export_readiness(note.excel_format)
                    if not readiness["ok"]:
                        reasons = []
                        if readiness["has_unresolved"]:
                            reasons.append("le hakka calculé contient un caractère non résolu (« ~ »)")
                        if readiness["has_ambiguous"]:
                            reasons.append("un ou plusieurs termes du Split restent ambigus (aucun « :précision »)")
                        return JsonResponse({
                            "error": "Export impossible tant que " + " et que ".join(reasons) + ".",
                        }, status=400)
                note.use_in_export = use_in_export
            note.save()
            return JsonResponse({"ok": True, **_expression_note_json(expr, note)})

        note, _created = expression_mesh.get_or_create_entry(expr, reference_expressions)
        return JsonResponse(_expression_note_json(expr, note))
    except expression_mesh.MissingPlatformId as exc:
        return JsonResponse({"error": str(exc)}, status=409)


@require_POST
def expression_mesh_reset(request, expr_id):
    """Reset one expression's maillage (excel_format) back to the platform
    state (see expression_mesh.reset_entry) -- leaves commentaire and
    use_in_export untouched."""
    expr = get_object_or_404(Expression, id=expr_id)
    _reference_words, reference_expressions = expression_mesh.reference_corpora()
    try:
        note = expression_mesh.reset_entry(expr, reference_expressions)
    except expression_mesh.MissingPlatformId as exc:
        return JsonResponse({"error": str(exc)}, status=409)
    return JsonResponse({"ok": True, **_expression_note_json(expr, note)})


def export_corpus_generate(request):
    """Runs the DB -> corpus export (expression_mesh.export_corpus: only
    the words/expressions explicitly marked "use in export", recomputing
    each selected expression's "hakka" target + `components`, and every
    referenced word's `in_expression`, from its current maillage) and
    returns a single .zip attachment containing wordCorpus.json,
    expressionCorpus.json, themeCorpus.json (covering just the referenced
    themes), any matching local audio recordings, and -- only if there
    were any -- warnings.txt. Audio sits flat at the zip's root, alongside
    the JSON files, mirroring the platform's own dated corpus folder
    exactly rather than inventing an "audio/" subfolder it doesn't have.

    Each word/expression's own "audio" field is already a bare UUID naming
    a file that sits directly in a platform dated corpus folder (see
    expression_mesh.find_platform_audio_dirs -- verified against a real
    pull: no separate "audio" subfolder, no extension, no hanzi-based
    filename). Not every pull re-includes every recording, so this checks
    every dated snapshot under ../e_reo_json/, newest first, not just the
    latest. Bundled only when this happens to run somewhere with
    filesystem access to that folder (a local `manage.py runserver`, never
    the deployed Vercel instance) -- silently skipped otherwise, never an
    error. Counts travel as response headers (read by the front end before
    the blob is saved) so the toolbar can report them without having to
    parse the archive back open."""
    result = expression_mesh.export_corpus()
    word_corpus = result["words"]
    expression_corpus = result["expressions"]
    theme_corpus = result["themes"]
    warnings = result["warnings"]

    audio_dirs = expression_mesh.find_platform_audio_dirs()
    audio_included = 0

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("wordCorpus.json", json.dumps(word_corpus, ensure_ascii=False, indent=2, sort_keys=True))
        zf.writestr("expressionCorpus.json", json.dumps(expression_corpus, ensure_ascii=False, indent=2, sort_keys=True))
        zf.writestr("themeCorpus.json", json.dumps(theme_corpus, ensure_ascii=False, indent=2, sort_keys=True))
        for payload in (*word_corpus.values(), *expression_corpus.values()):
            audio_path = expression_mesh.find_audio_path(audio_dirs, payload.get("audio"))
            if not audio_path:
                continue
            zf.write(audio_path, arcname=audio_path.name)
            audio_included += 1
        if warnings:
            zf.writestr("warnings.txt", "\n".join(warnings))

    response = HttpResponse(buffer.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = 'attachment; filename="corpus_export.zip"'
    response["X-Export-Word-Count"] = str(len(word_corpus))
    response["X-Export-Expression-Count"] = str(len(expression_corpus))
    response["X-Export-Theme-Count"] = str(len(theme_corpus))
    response["X-Export-Audio-Count"] = str(audio_included)
    response["X-Export-Warning-Count"] = str(len(warnings))
    return response


def export_expressions_spreadsheet(request):
    """Companion export: a .zip containing a single .xlsx reviewing just
    the exported expressions (français, anglais, hanzi, pinyin+hanzi,
    thèmes) plus whether that expression's own recording (its "audio" uuid,
    see export_corpus_generate) was actually found on disk -- so this
    doubles as a recording checklist (blank/"MANQUANT" cells are the ones
    still missing a recording)."""
    result = expression_mesh.export_corpus()
    expression_rows = result["expression_rows"]
    warnings = result["warnings"]

    audio_dirs = expression_mesh.find_platform_audio_dirs()

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "EXPRESSIONS"
    sheet.append(["FRANCAIS", "ANGLAIS", "SINOGRAMME", "PINYIN HANZI", "THEMES", "AUDIO"])
    for row in expression_rows:
        audio_path = expression_mesh.find_audio_path(audio_dirs, row["audio_id"])
        sheet.append([
            row["french"], row["english"], row["hanzi"], row["target"], row["theme_names"],
            row["audio_id"] if audio_path else "MANQUANT",
        ])

    xlsx_buffer = BytesIO()
    workbook.save(xlsx_buffer)

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("expressions.xlsx", xlsx_buffer.getvalue())
        if warnings:
            zf.writestr("warnings.txt", "\n".join(warnings))

    response = HttpResponse(buffer.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = 'attachment; filename="expressions_export.zip"'
    response["X-Export-Expression-Count"] = str(len(expression_rows))
    response["X-Export-Warning-Count"] = str(len(warnings))
    return response


@require_POST
def expression_mesh_sync(request):
    """Ensure every current DB expression (with a platform_id) has an
    ExpressionNote (creating any missing ones verbatim from expr.text)
    without running the full generator -- lets someone review/annotate
    new expressions before generating, rather than only discovering them
    mid-generate."""
    added, skipped = expression_mesh.sync_entries()
    return JsonResponse({
        "added": added,
        "total": ExpressionNote.objects.count(),
        "skipped_no_platform_id": skipped,
    })


def _word_note_json(word, note):
    return {
        "platform_id": word.platform_id,
        "commentaire": note.commentaire if note else "",
        "use_in_export": note.use_in_export if note else False,
    }


def word_note_entry(request, word_id):
    """GET/POST a single Word's persistent commentaire and use_in_export
    flag (see word_notes.py), keyed by Word.platform_id so it survives a
    platform_to_vercel reset+rebuild. Each field is only touched when
    present in the POST payload, same pattern as expression_mesh_entry."""
    word = get_object_or_404(Word, id=word_id)

    if request.method == "POST":
        try:
            payload = json.loads(request.body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return JsonResponse({"error": "JSON invalide."}, status=400)

        try:
            note = word_notes.get_or_create_note(word)
        except word_notes.MissingPlatformId as exc:
            return JsonResponse({"error": str(exc)}, status=409)

        if "commentaire" in payload:
            commentaire = payload.get("commentaire")
            if not isinstance(commentaire, str):
                return JsonResponse({"error": "'commentaire' doit être une chaîne."}, status=400)
            note.commentaire = commentaire
        if "use_in_export" in payload:
            use_in_export = payload.get("use_in_export")
            if not isinstance(use_in_export, bool):
                return JsonResponse({"error": "'use_in_export' doit être un booléen."}, status=400)
            note.use_in_export = use_in_export
        note.save()
        return JsonResponse({"ok": True, **_word_note_json(word, note)})

    return JsonResponse(_word_note_json(word, word_notes.get_note(word)))


def api_convert_text(request):
    text = (request.GET.get("text") or "").strip()

    if not text:
        return JsonResponse(
            {"error": "Missing 'text' query parameter."},
            status=400
        )

    tokens = text.split()
    all_words = build_all_words_for_tokens(tokens)
    token_data = convert_phrase_to_word_data(
        phrase=text,
        all_words=all_words,
        all_prons=Pronunciation.objects.all(),
    )

    words = []
    whole_pinyin_parts = []
    mixed_parts = []
    unmatched_parts = []   # <-- NEW

    for item in token_data:
        word = item["word"]
        hanzi = (item["hanzi"] or "").strip()
        pinyin = (item["pinyin"] or "").strip()

        whole_pinyin_parts.append(pinyin)
        mixed_parts.append(f"{pinyin} {hanzi}".strip())

        if word is None:
            words.append({
                "token": hanzi,
                "matched": False,
                "hanzi": hanzi,
                "pinyin": pinyin,
                "french": None,
                "trad": None,
            })

            # ---- NEW: collect unmatched (skip punctuation/noise) ----
            if hanzi and hanzi not in {",", ".", "?", "!", "，", "。", "？", "！"}:
                unmatched_parts.append(f"{hanzi}({pinyin})" if pinyin else hanzi)
        else:
            words.append({
                "token": hanzi,
                "matched": True,
                "id": word.id,
                "hanzi": word.char(),
                "trad": word.trad(),
                "pinyin": word.pinyin(),
                "french": word.french,
                "category": word.category,
                "status": word.status,
            })

    return JsonResponse({
        "input": text,
        "words": words,
        "whole_pinyin": " ".join(whole_pinyin_parts).strip(),
        "mixed": " | ".join(mixed_parts).strip(),
        "unmatched": " | ".join(unmatched_parts),   # <-- NEW
        "unmatched_count": len(unmatched_parts),    # optional but useful
    }, json_dumps_params={"ensure_ascii": False})