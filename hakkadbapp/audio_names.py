"""Noms des fichiers audio : uniquement des lettres et chiffres courants
(sans accents) et des caractères chinois -- aucun signe (espace,
apostrophe, trait d'union, ponctuation chinoise ou autre), puisque c'est
un nom de fichier.

Un mot : son pinyin avec les tons en chiffres (« on1lok6.wav ») ;
une expression : ses caractères (« 我爱屋家.wav »)."""
import re
import unicodedata

HAN_RE = re.compile(r"[㐀-鿿豈-﫿𠀀-𯿿]")


def safe_stem(text):
    """`text` réduit aux lettres et chiffres ASCII et aux caractères
    chinois : les accents sont ôtés (ü → u), les exposants deviennent des
    chiffres (¹ → 1), tout le reste disparaît."""
    out = []
    for ch in unicodedata.normalize("NFKD", str(text or "")):
        if (ch.isascii() and ch.isalnum()) or HAN_RE.match(ch):
            out.append(ch)
    return "".join(out)


def wav_name(text):
    """« <safe_stem>.wav », ou "" s'il ne reste rien."""
    stem = safe_stem(text)
    return f"{stem}.wav" if stem else ""
