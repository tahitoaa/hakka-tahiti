# Propositions d'amélioration (19/11/2026)

À relire à tête reposée. Chaque point se termine par une recommandation ;
rien de tout cela n'est fait, sauf la section « Fait cette nuit ».

## Fait cette nuit (commité, pas déployé)

1. **💬 Avis par WhatsApp sur un segment** (page « Écouter » d'une transcription
   publiée). Chaque segment a un bouton « 💬 Avis ». Il ouvre WhatsApp avec un
   message prêt à envoyer : le titre, la personne, l'heure, les hanzi, le pinyin,
   la traduction proposée et un lien `…/ecouter/<id>/?seg=N`. Ce lien ouvre la
   page sur le segment, encadré, avec un bouton « ▶ Écouter le passage » qui ne
   joue que ce segment.
   **Limite :** la personne qui reçoit le lien doit avoir un compte (la page est
   réservée aux membres). Voir la proposition 3.
2. **Heures à l'heure de Tahiti.** Avant, les dates « mis à jour le … à 14:05 »
   s'affichaient en UTC, avec 10 h d'écart.
3. **Faille XSS bouchée.** Trois blocs JSON (tableau de bord, doublons,
   expressions) étaient injectés tels quels dans la page. Un texte contenant
   `</script>` pouvait casser la page ou y injecter du code.
4. **Formulaire de mot plus léger.** Il chargeait toutes les prononciations sans
   s'en servir.

Les tests passent (117 JS, 55 Python). Rien n'a été vérifié dans un navigateur.

---

## A. Page « Rechercher dans les sources » (todo dictionnaires)

**Constat.** Les sources existent déjà, mais elles sont réparties sur plusieurs
pages : Recherche du lexique, Dictionnaire des caractères, 🔎 Sources, Rey,
hakkadictionary.com. Chacune a son propre champ de recherche.

**Ce qu'on peut interroger, et à quel prix :**

| Source | Ce qu'elle donne | Mot ou sens ? | Coût |
|---|---|---|---|
| Lexique Wenfa (mots, expressions) | hanzi, pinyin, FR, EN | les deux | gratuit |
| Ajouts (brouillons, à valider, validés) | idem | les deux | gratuit |
| Documents importés (ImportedDocument) | les lignes citant le mot | surtout le mot | gratuit |
| Rey 1926 (pages déjà lues, ReyPage) | lecture, sens en français | les deux | gratuit |
| Index Bao'an, McIver, Chappell & Lamarre, Hakka Made Easy, Sung Him Tong | lectures et pages PDF | caractère seulement | gratuit |
| Transcriptions publiées | segments hanzi, pinyin, FR | les deux | gratuit |
| hakkadictionary.com | sens en anglais, mots composés | caractère | gratuit (appel web) |
| 🔎 Sources (web et IA, SourceLookup) | réponse sourcée, avec citations | les deux | payant, gardé en cache |

**Proposition.** Une page `/rechercher/` avec un seul champ, qui reconnaît
seule ce qui a été tapé :
- des hanzi : on cherche le mot et chaque caractère ;
- du pinyin : on cherche par lecture, avec « zen lao » → zen1lao1, comme dans la
  recherche actuelle ;
- du français ou de l'anglais : on cherche par sens, dans les FR / EN du lexique,
  des ajouts, de Rey et des transcriptions.

Les résultats sont groupés par source, en blocs repliables qui se chargent les
uns après les autres. Les sources gratuites répondent tout de suite ; un bouton
« ✨ Demander aussi à l'IA (web) » lance le 🔎 existant (payant, résultat gardé).
Chaque résultat donne un lien vers sa page d'origine (Rey p. X, PDF p. Y…) et
un bouton « ＋ Brouillon » vers la Saisie.

**Recommandation :** commencer sans IA (lexique, ajouts, Rey, documents,
transcriptions), en réutilisant les fonctions qui existent déjà
(`sources.document_quotes`, `rey.search`, `pronunciation_sources`). Ajouter le
bouton IA ensuite. La recherche « par sens » dans les index de prononciation
n'est pas possible : ces index n'ont pas de sens.

**Questions pour toi :** la page est-elle ouverte à tous, ou réservée aux
membres (Rey et les documents importés le sont aujourd'hui) ? Faut-il un onglet
dans « Recherche », ou une page à part ?

---

## B. Section « Grammaire » : premières réflexions

**Ce qui existe déjà dans `ws/hakka` :**
- `grammar/grammar.md` : 5 chapitres rédigés (négation, particules aspectuelles,
  possession, interrogatifs et démonstratifs, verbes de mouvement), avec des
  renvois `{{word:ng²}}` et `{{expr:…}}` vers le corpus ;
- `hakka-grammar/` : une grammaire et une méthode en LaTeX, générées depuis le
  même corpus JSON (mots, expressions, thèmes) ;
- `proto_grammar/gf/` : un essai en Grammatical Framework (arbres
  `PredVP (UseN …) (UseV …)` sur 19 phrases).

Le principe commun (des exemples tirés du corpus, une seule source de vérité)
est le bon : la section du site peut le reprendre.

**Proposition de modèle** (à spécifier ensemble) :
- **une règle** (GrammarRule) = un nœud d'arbre : titre (« La négation au
  présent »), parent (le chapitre « La négation »), ordre, explication en
  Markdown, schéma (« Sujet + ng² + Verbe (+ Compl.) ») et statut (brouillon,
  validée) ;
- **des exemples rattachés** à une règle : des liens vers des expressions du
  lexique, des ajouts ou des segments de transcription. Ce ne sont pas des
  copies : corriger la phrase corrige l'exemple. Le mot qui illustre la règle
  (ng²) peut être mis en évidence ;
- **un éditeur en arbre** : glisser-déposer pour réorganiser, ✎ pour éditer,
  « ＋ sous-règle ».

**« À l'aide des phrases existantes »**, trois niveaux possibles :
1. *Rechercher des exemples* pour une règle : toutes les expressions qui
   contiennent ng², 了, 嘅… On utilise le maillage des expressions (déjà
   découpées en mots), sans IA.
2. *Proposer des règles* : pour un mot-outil fréquent dans les expressions,
   l'IA propose un schéma et une explication à partir de 10 à 20 exemples,
   comme les « Suggestions IA ». Un humain valide.
3. *Retrouver ce qui n'est rattaché à aucune règle* : une liste des expressions
   qu'aucune règle n'utilise encore, pour savoir ce qui reste à décrire.

**Recommandation :** commencer par l'arbre des règles et le niveau 1. Importer
les 5 chapitres de `grammar.md` comme premières règles, puis lancer le niveau 2
à la demande. Laisser GF de côté pour l'instant : c'est trop formel pour une
édition par l'équipe.

**Questions pour toi :** qui édite (les membres, les validateurs, toi
seulement) ? Les règles sont-elles publiques ? Faut-il pouvoir exporter vers
`hakka-grammar` (LaTeX) ?

---

## C. Autres améliorations repérées

1. **Django 5.1 n'est plus maintenu** (fin des correctifs de sécurité en
   décembre 2025). → Passer à Django 5.2 LTS (maintenu jusqu'en avril 2028).
   C'est un petit saut, à tester sur une preview Vercel.
2. **Cookies et HTTPS.** Les réglages `SESSION_COOKIE_SECURE`,
   `CSRF_COOKIE_SECURE` et HSTS sont commentés dans `settings.py`. Vercel est
   toujours en HTTPS. → Les activer quand `DEBUG` est faux : sans risque en
   ligne, aucun effet en local.
3. **Lien WhatsApp pour une personne sans compte.** → Un lien de partage signé
   (jeton), valable N jours et limité à une transcription, ouvrirait la page en
   lecture seule. À décider : on ouvre alors la page à des non-membres.
4. **Mois en anglais.** `LANGUAGE_CODE = 'en-us'` fait afficher « 17 November
   2026 » sur les pages Rapports, Expressions et Transcriptions. → Passer à
   `'fr'`, mais vérifier d'abord qu'aucun nombre décimal n'est écrit dans du JS
   par un gabarit (avec `'fr'`, 0.5 s'écrirait 0,5).
5. **Tâche IA de nuit et limite de 60 s.** `api/ia/nuit` fait trois appels IA à
   la suite (relecture des ajouts, relecture du lexique, suggestions) dans une
   seule requête Vercel limitée à 60 s. → Vérifier dans les logs Vercel qu'elle
   aboutit. Sinon, faire un appel par nuit en alternance, ou passer
   `maxDuration` à 300 (Fluid Compute).
6. **Gros fichiers.** `AdditionList.js` fait 2 364 lignes et `views.py` 2 000.
   → Les découper quand on y retravaille (par exemple : diaporama, doublons et
   filtres dans des fichiers séparés). Ce n'est pas urgent.
7. **Tests de la page d'écoute.** `listen.js` n'a pas de test. → Sortir
   `askMessage` et la lecture de `?seg=` dans `TranscriptDocument.js` pour les
   tester comme le reste.
8. **Dossier `ws/hakka` encombré.** Il contient six `platform_sheet_*.xlsx`
   (des doublons à quelques secondes d'écart) et un `full (2) (2).eaf`. → Les
   ranger dans un dossier `exports/` ou les supprimer, si ce sont des copies.
