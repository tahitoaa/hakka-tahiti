# Todos du site Hakka

Liste des demandes en cours. Les propositions d'amélioration sont dans
[PROPOSITIONS.md](PROPOSITIONS.md).

## Nouvelles demandes (19/11/2026)

- [x] **Transcriptions publiées : demander un avis par WhatsApp sur un segment.** Fait (commit e32a56d), pas encore déployé.
  Un lien qui mène directement à l'audio du segment, avec la transcription et
  les traductions proposées dans le message.
- [x] **Dictionnaires : une page de recherche unique** (« Rechercher », /rechercher/),
  ouverte à tous, sans IA. Fait (commit ae51ae4), pas encore déployé. Transcriptions
  pour les membres connectés, documents importés et ajouts en cours pour les éditeurs.
- [ ] **Section « Grammaire » :** déployée (f05a9d0) : arbre de règles, exemples liés.
  Ajouté le 21/11 (pas encore déployé ; migration 0036) : étiquettes (catégories, groupes,
  fonctions), analyse des exemples linéaire puis en arbre, proposition IA, schémas lus avec
  les étiquettes (exemples conformes, recherche par schéma), saisie assistée dans la
  recherche, import des cahiers (notebook, grammar.md, hakka-grammar ; 21 exemples reliés,
  42 phrases du cahier à saisir). Reste : saisir les phrases du cahier (en brouillons
  Saisie ?), propositions de règles par l'IA, export vers `hakka-grammar`, ouverture
  aux éditeurs, aide « repères » (références, questionnaire).
  22/11 : repères des étiquettes (tests, UD) déployés ; parcours d'analyse (onglet « Analyser »,
  consignes pas à pas, « Enregistrer et suivante », phrases des documents « à saisir » → brouillon
  Saisie) et règles induites (onglet « Induites » : constructions comptées, inventaire des catégories,
  « Créer la règle ») commités, pas déployés.

## En attente d'une action ou d'une décision

- [ ] **OCR de nuit des documents scannés** (`tools/ocr_nuit.py`, 02:00-08:00) :
  il faut ajouter ANTHROPIC_API_KEY dans `.env` et créer la tâche planifiée.
- [ ] **Retours d'un membre sur la Saisie** (03/11) : suggestions « d'après le
  mandarin », lignes « sens de ce mot seul », aides de saisie. Réponse au 11/11 :
  « rien pour l'instant ».
- [ ] **Corrections e-reo, propositions non faites :** mots inconnus de la
  plateforme dans les expressions ; #27 (stepfather → father-in-law) en vraie
  correction ; #10-13 mis de côté ; « transcription phonétique » dans les sens
  (à déplacer dans les notes ?) ; consigne majuscule/minuscule pour la relecture IA.
- [ ] **Import avec moins d'IA, propositions non retenues :** contrôle FR/EN à la
  demande, OCR gratuit (Tesseract), adaptateurs web (Wiktionary, MOE Taïwan),
  cache des traductions, estimation du coût avant chaque appel IA.
- [ ] **À vérifier en ligne :** la recherche hakkadictionary.com (Vercel atteint-il
  le site ?), les « Suggestions IA, source d'inspiration », les doublons des ajouts.
- [ ] **UI compacte, en continu :** les aides se replient dans « ⓘ ».
