"""Export du lexique (lecture seule) pour le guide de la notation Wenfa.

Usage, depuis la racine du projet (le .env doit pointer vers la base) :

    python manage.py shell < tools/export_lexique.py

Écrit tools/lexique_export.json :
  - "readings" : chaque caractère avec ses lectures Wenfa (initiale, finale, ton)
  - "words"    : chaque mot, ses syllabes dans l'ordre, son français et son statut
Aucune écriture en base.
"""
import json
from pathlib import Path

from hakkadbapp.models import Pronunciation, Word

readings = [
    {"hanzi": p.hanzi,
     "initial": p.initial.initial or "",
     "final": p.final.final or "",
     "tone": p.tone.tone_number if p.tone else None}
    for p in Pronunciation.objects.select_related("initial", "final", "tone")
]

words = []
for w in Word.objects.prefetch_related(
        "wordpronunciation_set__pronunciation__initial",
        "wordpronunciation_set__pronunciation__final",
        "wordpronunciation_set__pronunciation__tone"):
    sylls = []
    for wp in w.wordpronunciation_set.all():
        p = wp.pronunciation
        sylls.append({"hanzi": p.hanzi,
                      "initial": p.initial.initial or "",
                      "final": p.final.final or "",
                      "tone": p.tone.tone_number if p.tone else None})
    words.append({"french": w.french, "english": w.english,
                  "category": w.category, "status": w.status, "syllables": sylls})

out = Path("tools/lexique_export.json")
out.write_text(json.dumps({"readings": readings, "words": words}, ensure_ascii=False), encoding="utf-8")
print(f"{out} : {len(readings)} lectures, {len(words)} mots")
