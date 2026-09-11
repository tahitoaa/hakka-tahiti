"""Automatic open-source illustrations for vocabulary words.

There is no artwork in the database, and no budget for a paid image API,
so instead of leaving every flashcard blank this maps common French
keywords to an emoji glyph and serves the matching Twemoji graphic
(Twitter's open-source emoji artwork, CC BY 4.0) straight from jsDelivr's
GitHub mirror -- no local asset storage, no API key.

Only words whose French gloss matches an entry get illustrated; anything
else falls back to the plain hanzi medallion. That is by design: a wrong
guess is worse than no picture, so the dictionary below only contains
keywords with an unambiguous, single-glyph emoji.
"""
import re
import unicodedata

TWEMOJI_TAG = "14.0.2"
TWEMOJI_BASE = f"https://cdn.jsdelivr.net/gh/twitter/twemoji@{TWEMOJI_TAG}/assets/svg/"
ILLUSTRATION_CREDIT = "Twemoji · CC BY 4.0"

# Normalized (accent-stripped, lowercased) French keyword -> emoji glyph.
# Matched against the word's whole `french` field first, then against each
# whitespace-separated token in it, so "Chat, chatte" and "Avoir faim" both
# resolve even though only one word in the phrase is a dictionary key.
EMOJI_KEYWORDS = {
    # politeness & greetings
    "bonjour": "\U0001F44B", "bonsoir": "\U0001F44B", "au revoir": "\U0001F44B",
    "a bientot": "\U0001F44B", "salut": "\U0001F44B", "enchante": "\U0001F91D",
    "merci": "\U0001F64F", "merci beaucoup": "\U0001F64F", "pardon": "\U0001F64F",
    "bienvenue": "\U0001F389", "oui": "✅", "non": "❌",
    "bon appetit": "\U0001F374",

    # numbers
    "zero": "0️⃣", "un": "1️⃣", "deux": "2️⃣",
    "trois": "3️⃣", "quatre": "4️⃣", "cinq": "5️⃣",
    "six": "6️⃣", "sept": "7️⃣", "huit": "8️⃣",
    "neuf": "9️⃣", "dix": "\U0001F51F",

    # colors
    "rouge": "\U0001F534", "orange": "\U0001F34A", "jaune": "\U0001F7E1",
    "vert": "\U0001F7E2", "bleu": "\U0001F535", "violet": "\U0001F7E3",
    "noir": "⚫", "blanc": "⚪", "marron": "\U0001F7E4",
    "rose": "\U0001F338",

    # family
    "papa": "\U0001F468", "pere": "\U0001F468", "maman": "\U0001F469",
    "mere": "\U0001F469", "grand-pere": "\U0001F474", "grand pere": "\U0001F474",
    "grang-pere": "\U0001F474", "grand-mere": "\U0001F475", "grand mere": "\U0001F475",
    "fils": "\U0001F466", "garcon": "\U0001F466", "fille": "\U0001F467",
    "bebe": "\U0001F476", "mari": "\U0001F470", "epouse": "\U0001F930",
    "femme": "\U0001F469", "ami": "\U0001F91D",

    # animals
    "chat": "\U0001F431", "chatte": "\U0001F431", "chien": "\U0001F436",
    "cochon": "\U0001F437", "porc": "\U0001F437", "vache": "\U0001F42E",
    "boeuf": "\U0001F402", "poule": "\U0001F414", "poulet": "\U0001F414",
    "coq": "\U0001F413", "canard": "\U0001F986", "oiseau": "\U0001F426",
    "souris": "\U0001F42D", "singe": "\U0001F412", "tigre": "\U0001F405",
    "cheval": "\U0001F434", "mouton": "\U0001F411", "chevre": "\U0001F410",
    "lapin": "\U0001F430", "tortue": "\U0001F422", "fourmi": "\U0001F41C",
    "abeille": "\U0001F41D", "papillon": "\U0001F98B", "araignee": "\U0001F577",
    "crevette": "\U0001F990", "crabe": "\U0001F980", "poisson": "\U0001F41F",
    "serpent": "\U0001F40D", "grenouille": "\U0001F438", "dragon": "\U0001F409",

    # food & drink
    "eau": "\U0001F4A7", "eau de coco": "\U0001F965", "the": "\U0001F375",
    "cafe": "☕", "alcool": "\U0001F37A", "biere": "\U0001F37A",
    "vin": "\U0001F377", "riz": "\U0001F35A", "nouilles": "\U0001F35C",
    "soupe": "\U0001F372", "pain": "\U0001F35E", "oeuf": "\U0001F95A",
    "lait": "\U0001F95B", "sucre": "\U0001F36C", "sel": "\U0001F9C2",
    "beurre": "\U0001F9C8", "viande": "\U0001F356", "boire": "\U0001F964",
    "manger": "\U0001F374", "avoir faim": "\U0001F374", "avoir soif": "\U0001F964",
    "legume": "\U0001F966", "carotte": "\U0001F955", "champignon": "\U0001F344",
    "pomme de terre": "\U0001F954", "mais": "\U0001F33D", "ail": "\U0001F9C4",
    "oignon": "\U0001F9C5", "cacahuete": "\U0001F95C", "miel": "\U0001F36F",
    "fruit": "\U0001F34E", "pomme": "\U0001F34E", "banane": "\U0001F34C",
    "ananas": "\U0001F34D", "mangue": "\U0001F96D", "orange (fruit)": "\U0001F34A",
    "citron": "\U0001F34B", "raisin": "\U0001F347", "pasteque": "\U0001F349",
    "gateau": "\U0001F370", "glace": "\U0001F368", "glace-ice cream": "\U0001F368",
    "chocolat": "\U0001F36B", "bonbon": "\U0001F36C",
    "baguettes": "\U0001F962", "bol": "\U0001F963", "assiette": "\U0001F374",
    "bouteille": "\U0001F37E", "tasse": "☕", "couteau": "\U0001F52A",
    "cuillere": "\U0001F944", "porc barbecue": "\U0001F356",
    "cuisine": "\U0001F373", "gout": "\U0001F60B",

    # objects & school
    "livre": "\U0001F4D6", "cahier": "\U0001F4D3", "stylo": "✍",
    "crayon": "✏", "ciseaux": "✂", "argent": "\U0001F4B0",
    "montre": "⌚", "telephone": "\U0001F4F1", "ordinateur": "\U0001F4BB",
    "sac": "\U0001F45C", "cle": "\U0001F511", "cadeau": "\U0001F381",
    "bague": "\U0001F48D", "poubelle": "\U0001F5D1", "robinet": "\U0001F6BF",
    "chaise": "\U0001FA91", "porte": "\U0001F6AA", "lit": "\U0001F6CF",

    # transport & places
    "voiture": "\U0001F697", "velo": "\U0001F6B2", "bus": "\U0001F68C",
    "avion": "✈", "bateau": "⛵", "train": "\U0001F682",
    "maison": "\U0001F3E0", "ecole": "\U0001F3EB", "hopital": "\U0001F3E5",
    "banque": "\U0001F3E6", "garage": "\U0001F3E0", "bibliotheque": "\U0001F4DA",
    "marche": "\U0001F6D2",

    # nature & weather
    "soleil": "☀", "lune": "\U0001F319", "etoile": "⭐",
    "pluie": "\U0001F327", "nuage": "☁", "neige": "❄",
    "vent": "\U0001F4A8", "feu": "\U0001F525", "montagne": "⛰",
    "arbre": "\U0001F333", "fleur": "\U0001F338", "herbe": "\U0001F33F",
    "mer": "\U0001F30A", "riviere": "\U0001F30A",

    # feelings & verbs
    "aimer": "❤", "rire": "\U0001F602", "pleurer": "\U0001F622",
    "courir": "\U0001F3C3", "marcher": "\U0001F6B6", "dormir": "\U0001F634",
    "parler": "\U0001F4AC", "ecrire": "✍", "lire": "\U0001F4D6",
    "chanter": "\U0001F3A4", "danser": "\U0001F483", "travailler": "\U0001F4BC",
    "etudier": "\U0001F4DA", "apprendre": "\U0001F4DA", "vendre": "\U0001F3F7",
    "acheter": "\U0001F6D2", "jouer": "\U0001F3AE",

    # misc
    "riche": "\U0001F4B0", "fete": "\U0001F389", "banquet": "\U0001F389",
}

_PUNCT_RE = re.compile(r"[‘’'’,;:/()\-–—…?!.\"«»]+")
_SPACE_RE = re.compile(r"\s+")

# Short function words that would otherwise collide with dictionary keys
# once a phrase is split into single tokens -- e.g. "Un feu rouge" (a red
# light) must not match the number keyword "un" just because the
# indefinite article happens to precede the real subject.
_STOPWORDS = {
    "un", "une", "le", "la", "les", "de", "du", "des", "et", "ou",
    "a", "au", "aux", "ce", "cette", "se", "si", "on", "il", "elle",
    "je", "tu", "nous", "vous", "ils", "elles",
}


def _normalize(text):
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.lower().strip()


def _candidates(french):
    norm = _normalize(french)
    if not norm:
        return []
    cleaned = _SPACE_RE.sub(" ", _PUNCT_RE.sub(" ", norm)).strip()
    tokens = [t for t in cleaned.split(" ") if t not in _STOPWORDS]

    candidates = [norm, cleaned, *tokens]
    seen = set()
    out = []
    for c in candidates:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def _codepoints(emoji):
    # Twemoji filenames drop the variation-selector-16 (U+FE0F) that many
    # emoji carry to force color-emoji presentation, but keep every other
    # combining code point (e.g. U+20E3 for keycap digits like 7️⃣).
    return "-".join(f"{ord(c):x}" for c in emoji if c != "️")


def _build(emoji):
    return {
        "emoji": emoji,
        "url": f"{TWEMOJI_BASE}{_codepoints(emoji)}.svg",
        "credit": ILLUSTRATION_CREDIT,
    }


def illustration_for_text(french):
    """Return {emoji, url, credit} for the first matching keyword in
    `french`, or None if nothing in EMOJI_KEYWORDS matches."""
    for token in _candidates(french):
        emoji = EMOJI_KEYWORDS.get(token)
        if emoji:
            return _build(emoji)
    return None


def illustration_for(word):
    """Convenience wrapper for a Word instance (or None)."""
    if word is None:
        return None
    return illustration_for_text(getattr(word, "french", "") or "")
