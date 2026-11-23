"""Applique aux analyses enregistrées la consigne « les fonctions aux groupes,
jamais aux mots » : un nom ou un pronom qui porte lui-même une fonction
devient un groupe nominal d'un seul mot ([GN:sujet 佢/PRO]).

    python manage.py grammaire_fonctions_aux_groupes             # montre, n'écrit rien
    python manage.py grammaire_fonctions_aux_groupes --appliquer # enregistre

Les mots d'une autre catégorie qui portent une fonction (un adverbe « mod »…)
sont seulement signalés, à revoir dans la page Grammaire.
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from hakkadbapp import grammar_analysis as ga
from hakkadbapp.models import SentenceAnalysis


class Command(BaseCommand):
    help = "Fonctions des noms et pronoms seuls reportées sur un GN d'un mot (aperçu sans --appliquer)."

    def add_arguments(self, parser):
        parser.add_argument("--appliquer", action="store_true", help="enregistrer les changements")

    def handle(self, *args, **options):
        tags = ga.Tags()
        apply = options["appliquer"]
        changed_analyses = changed_words = left_words = 0
        with transaction.atomic():
            for a in SentenceAnalysis.objects.order_by("id"):
                tokens, groups, changed, left = ga.wrap_word_functions(a.tokens or [], a.groups or [], tags)
                if not changed and not left:
                    continue
                self.stdout.write(f"\n{a.target_type}:{a.target_key}  {a.text}")
                self.stdout.write(f"  avant : {ga.bracketed(a.tokens or [], a.groups or [], tags)}")
                if changed:
                    cleaned = ga.check(tokens, groups, tags)
                    if isinstance(cleaned, str):
                        self.stdout.write(self.style.ERROR(f"  non modifiée : {cleaned}"))
                        continue
                    tokens, groups = cleaned
                    self.stdout.write(f"  après : {ga.bracketed(tokens, groups, tags)}")
                    changed_analyses += 1
                    changed_words += len(changed)
                    if apply:
                        a.tokens, a.groups = tokens, groups
                        a.save(update_fields=["tokens", "groups", "updated_at"])
                for i, why in left:
                    self.stdout.write(self.style.WARNING(f"  à revoir : {a.tokens[i]['t']} ({why})"))
                left_words += len(left)
        verb = "modifiées" if apply else "à modifier (aperçu, rien d'écrit)"
        self.stdout.write(f"\n{changed_analyses} analyses {verb}, {changed_words} mots repris, {left_words} à revoir.")
