# Todos du site Hakka

Liste des demandes en cours. Les propositions d'amélioration sont dans
[PROPOSITIONS.md](PROPOSITIONS.md).

## Nouvelles demandes (19/11/2026)

- [ ] **Transcriptions publiées : demander un avis par WhatsApp sur un segment.**
  Un lien qui mène directement à l'audio du segment, avec la transcription et
  les traductions proposées dans le message.
- [ ] **Dictionnaires : une page de recherche unique** pour chercher un mot ou
  un sens dans toutes les sources (avec ou sans IA). Esquisse dans PROPOSITIONS.md.
- [ ] **Section « Grammaire » :** des règles de grammaire éditables sous forme
  d'arbre, construites à partir des phrases existantes. À spécifier plus tard ;
  premières pistes dans PROPOSITIONS.md.

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
