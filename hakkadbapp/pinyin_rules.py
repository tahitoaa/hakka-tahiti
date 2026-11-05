"""Rules of the Wenfa romanization the AI must follow (and that its
readings are checked against, since a prompt is no guarantee):

1. j, q, x are always followed by i;
2. without a following i, it is z, zh, c, ch, s or sh instead -- so z, zh,
   c, ch, s are never followed by i ...
3. ... except sh, which may be (shi, shin, shit);
4. ü only after z, zh, c, ch, s, sh;
5. tones 5 and 6 only for syllables with a stop final (-p, -t, -k).

    violations("ju1")  -> ["« ju1 » : j, q, x sont toujours suivis de i"]
"""
import re

RULES = """Wenfa romanization rules, always respected in every reading you write:
- j, q, x are always followed by i (ji, qiu, xiong); without a following i, write z, zh, c, ch, s or sh instead;
- z, zh, c, ch, s are never followed by i; only sh may be (shi, shin);
- ü only comes after z, zh, c, ch, s or sh (sü, zü);
- tones 5 and 6 are only for syllables ending in -p, -t or -k (bak5, shit6); every other syllable takes tone 1 to 4."""

SUPERSCRIPTS = str.maketrans("¹²³⁴⁵⁶⁷⁸", "12345678")
SYLLABLE = re.compile(r"([a-zü]+)([0-9]?)")
INITIALS = ("zh", "ch", "sh", "ng", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "z", "c", "s", "y", "w")


def split(syllable):
    """« xiong » -> ("x", "iong")."""
    for i in INITIALS:
        if syllable.startswith(i):
            return i, syllable[len(i):]
    return "", syllable


def syllables(pinyin):
    """« wuk5ka1 », « ngai2 oi4 » -> [("wuk", "5"), ("ka", "1"), ...]."""
    text = (pinyin or "").lower().translate(SUPERSCRIPTS).replace("v", "ü").replace("u:", "ü")
    return [(m.group(1), m.group(2)) for m in SYLLABLE.finditer(text)]


def violations(pinyin):
    """What breaks the rules in `pinyin`, one French sentence per problem."""
    out = []
    for base, tone in syllables(pinyin):
        initial, final = split(base)
        shown = f"« {base}{tone} »"
        if initial in ("j", "q", "x") and not final.startswith("i"):
            out.append(f"{shown} : j, q, x sont toujours suivis de i")
        if initial in ("z", "zh", "c", "ch", "s") and final.startswith("i"):
            out.append(f"{shown} : z, zh, c, ch, s ne sont jamais suivis de i (seul sh peut l'être)")
        if "ü" in final and initial not in ("z", "zh", "c", "ch", "s", "sh"):
            out.append(f"{shown} : ü vient toujours après z, zh, c, ch, s ou sh")
        if tone in ("5", "6") and not final.endswith(("p", "t", "k")):
            out.append(f"{shown} : les tons 5 et 6 sont réservés aux finales en -p, -t, -k")
    return list(dict.fromkeys(out))
