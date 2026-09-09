from io import StringIO
import json
from django.db.models import Prefetch, Count, Q
from django.http import HttpResponse
from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse
from django.views.decorators.http import require_POST
from .forms import PronunciationForm, WordForm
from django.db.models import F, Value, CharField
from django.db.models.functions import Concat
from .models import ExpressionWord, Pronunciation, Tone, Initial, Final, WordPronunciation, Word, Traces, Expression
import csv
from collections import Counter, defaultdict
from urllib.parse import unquote
from django.db.models import Case, When, IntegerField, Value
import random
from opencc import OpenCC
from django.db import transaction

from django.http import JsonResponse
from .text_to_words import (
    build_all_words_for_tokens,
    convert_phrase_to_word_data,
)

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
        "secondary": w.tahitian, "theme": w.category or "", "status": w.status or "",
    }


def _dup_expression_entry(e):
    return {
        "id": e.id, "french": e.french, "hakka": e.rendering,
        "secondary": e.english, "theme": e.category or "", "status": e.status or "",
    }


def _duplicate_groups(items, key_fn, entry_fn):
    """Group items sharing a key (french / hakka / tahitian-english), normalized
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

    return [
        {
            "key": "words-french", "category": "words",
            "title": "Mots -- même français", "secondary_label": "Tahitien",
            "groups": _duplicate_groups(words_for_dup, lambda w: w.french, _dup_word_entry),
        },
        {
            "key": "words-hakka", "category": "words",
            "title": "Mots -- même hakka", "secondary_label": "Tahitien",
            "groups": _duplicate_groups(words_for_dup, lambda w: f"{w.pinyin()} {w.char()}", _dup_word_entry),
        },
        {
            "key": "words-tahitian", "category": "words",
            "title": "Mots -- même tahitien", "secondary_label": "Tahitien",
            "groups": _duplicate_groups(words_for_dup, lambda w: w.tahitian, _dup_word_entry),
        },
        {
            "key": "expressions-french", "category": "expressions",
            "title": "Expressions -- même français", "secondary_label": "Anglais",
            "groups": _duplicate_groups(expressions_for_dup, lambda e: e.french, _dup_expression_entry),
        },
        {
            "key": "expressions-hakka", "category": "expressions",
            "title": "Expressions -- même hakka", "secondary_label": "Anglais",
            "groups": _duplicate_groups(expressions_for_dup, lambda e: e.rendering, _dup_expression_entry),
        },
        {
            "key": "expressions-english", "category": "expressions",
            "title": "Expressions -- même anglais", "secondary_label": "Anglais",
            "groups": _duplicate_groups(expressions_for_dup, lambda e: e.english, _dup_expression_entry),
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

    # ---- doublons : même français / même hakka / même tahitien-anglais ----
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
        'title': "Recherche de mots",
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
        'title': "Recherche de mots",
        "categories": Word.objects.values_list('category', flat=True).distinct(),
        "expressions": expressions,
        "expressions_count": expressions.count(),
    }
    return context 

def pinyin_converter(request):
    return render(request, "hakkadbapp/converter.html", get_all_data())

def transcripter(request):
    return render(request, "hakkadbapp/transcripter.html", get_all_data())

def caracters(request):
    context = {"page": "caracters"}
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


def flashcards(request, category=None):
    # Get all word IDs
    if category:
        word_ids = Word.objects.filter(category=category).values_list('id', flat=True)
    else:
        word_ids = Word.objects.values_list('id', flat=True)

    if not word_ids:
        return render(request, "hakkadbapp/flashcards.html", {"word": None, "title": "Aucun mot"})

    max_attempts = 10  # Prevent infinite loop
    word = None

    for _ in range(max_attempts):
        random_id = random.choice(word_ids)
        word = Word.objects.get(id=random_id)
        if str(word).strip():  # Check that __str__() is not empty
            break
    else:
        word = None  # No valid word found after N tries

    context = {
        "page": "flashcards",
        "word": word,
        "title": f"Flashcard - {category}" if category else "Flashcard",
        "categories": Word.objects.values_list('category', flat=True).distinct(),
        "category": category,
    }

    print(word)
    return render(request, "hakkadbapp/flashcards.html", context)


def hanzi(request, hanzi_char):
    hanzi_char = unquote(hanzi_char)
    context = {}
    # Get all pronunciations for this character
    prons = Pronunciation.objects.filter(hanzi=hanzi_char)

    # Get all related words that include one of those pronunciations
    related_words = Word.objects.filter(pronunciations__in=prons).distinct()

    # Prepare data
    context = {
        'hanzi': hanzi_char,
        'simp': t2s.convert(hanzi_char),
        'trad': s2t.convert(hanzi_char),
        'pronunciations': prons,
        'related_words': related_words,
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
        'title': "Tableau des phonèmes"
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
        words = Word.objects.filter(pronunciations__in=prons_list).distinct()
        hanzi_data.append({
            'hanzi': hanzi_char,
            'simp': t2s.convert(hanzi_char),
            'trad': s2t.convert(hanzi_char),
            'pronunciations': prons_list,
            'related_words': words,
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
    """Maps each platform expression's concatenated hanzi (no spaces, same
    shape as Expression.text.replace(" ", "")) to the raw platform fields the
    expressions page compares against Vercel/the DB's own computation: its
    french/english translations, its "pinyin hanzi" target text as recorded
    (no recomputation), and its `components` dict (word "pinyin hanzi" ->
    platform word id). This is the key the expressions page uses client-side
    to line up a Vercel Expression with its platform counterpart and flag
    fields (or individual words) that differ from what the platform has on
    file."""
    snapshot = get_latest_platform_snapshot()
    if not snapshot:
        return {}, None

    platform_expressions = (snapshot.platform_data or {}).get("expressions", {}) or {}
    by_hanzi_concat = {}
    for payload in platform_expressions.values():
        translations = payload.get("translations") or {}
        target = translations.get("target", "")
        _, hanzi_concat = split_target(target)
        if hanzi_concat:
            by_hanzi_concat[hanzi_concat] = {
                "primary": translations.get("primary", ""),
                "secondary": translations.get("secondary", ""),
                "target": target,
                "components": payload.get("components") or {},
            }
    return by_hanzi_concat, snapshot.timestamp


def expressions(request):
    context = get_all_data()
    components_by_hanzi, snapshot_timestamp = build_expression_platform_components()
    context["platform_components_json"] = json.dumps(components_by_hanzi, ensure_ascii=False)
    context["platform_snapshot_timestamp"] = snapshot_timestamp
    return render(request, "hakkadbapp/expressions.html", context)

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