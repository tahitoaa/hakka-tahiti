from io import StringIO
import json
from django.db.models import Prefetch
from django.http import HttpResponse
from django.shortcuts import render, redirect, get_object_or_404
from django.views.decorators.http import require_POST
from .forms import PronunciationForm, WordForm
from django.db.models import F, Value, CharField
from django.db.models.functions import Concat
from .models import Pronunciation, Tone, Initial, Final, WordPronunciation, Word, Traces
import csv
from collections import defaultdict
from urllib.parse import unquote

import random

from opencc import OpenCC

# Create converter: 's2t' = Simplified to Traditional, 't2s' = Traditional to Simplified
s2t = OpenCC('s2t')
t2s = OpenCC('t2s')

from .management.commands import import_lexique

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
    traces = Traces.objects.all().order_by('-timestamp').first()
    context['traces'] = traces
    context['errors'] = traces.details.count('❌')    
    return render(request, "hakkadbapp/reports.html", context)


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
    }

    return render(request, "hakkadbapp/search.html", context)

def browse(request):
    context = {"page": "browse"}
    return render(request, "hakkadbapp/browse.html", context)

def pinyin_converter(request):
    context = {"title": "Méthode de saisie",
        'pronunciations': Pronunciation.objects.select_related('initial', 'final', 'tone').all(),
        'tones': Tone.objects.all(),
        'initials': Initial.objects.all(),
        'finals': Final.objects.all(),}
    return render(request, "hakkadbapp/converter.html", context)

def caracters(request):
    context = {"page": "caracters"}
    all_prons = Pronunciation.objects.select_related('initial', 'final', 'tone').order_by('initial', 'final', 'tone')
    context["all_prons"] = all_prons
    return render(request, "hakkadbapp/caracters.html", context)


def flashcards(request):
    # Get all word IDs
    word_ids = Word.objects.values_list('id', flat=True)

    if not word_ids:
        return render(request, "hakkadbapp/flashcards.html", {"word": None, "title": "Aucun mot"})

    # Pick a random one
    random_id = random.choice(word_ids)

    word = Word.objects.get(id=random_id)

    context = {
        "page": "flashcards",
        "word": word,
        "title": f"{word}",
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
    # All unique initials and finals in use
    initials = Initial.objects.filter(pronunciations__isnull=False).distinct().order_by('initial')
    finals = Final.objects.filter(pronunciations__isnull=False).distinct().order_by('final')

    # Get all unique (initial, final) pairs
    combos = Pronunciation.objects.values_list('initial_id', 'final_id').distinct()

    # Convert to set of tuples for fast lookup
    combo_set = set(combos)

    context = {
        'initials': initials,
        'finals': finals,
        'combo_set': combo_set,
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
