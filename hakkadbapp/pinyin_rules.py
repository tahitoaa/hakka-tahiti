"""The Wenfa romanization (« Système de pinyin hakka de Tahiti », Wen Fa's
pronunciation guide, February 2026 -- https://wenfa.fr/systeme-de-pinyin-hakka-de-tahiti/):
the rules the AI must follow, the readings checked against them, and what
can be corrected without a doubt in a reading that comes from elsewhere (a
document, a dictionary, the AI).

The guide, in short:
- 6 tones, 1 to 6 (阴平 1, 阳平 2, 上 3, 去 4, 阴入 5, 阳入 6); tones 5 and 6
  are the syllables ending in -p, -t or -k, and only they;
- the stops are written p, t, k (Meixian's pinfa writes b, d, g);
- x, j, q replace s, z, c before i (西 xi1, 姊 ji3, 七 qit5); sh, ch, zh
  are spelling variants of s, c, z (only sh is written before i: shit6);
- ü only after z, c, s (and zh, ch, sh): sü1, zü3, cü4;
- without an initial, i is written y (腰 yao1, 有 yu1, 衣 yi1);
- w, never v (Meixian's v); before i it is wui (围 wui2), never wi;
- e, never ê; no r.

    normalize("si1 sit7 ngin8 vun2")  -> ("xi1 xit5 ngin6 wun2", [...])
    violations("ju1")                 -> ["« ju1 » : j, q, x sont toujours suivis de i"]
"""
import re

RULES = """Wenfa romanization rules (Wen Fa's « Système de pinyin hakka de Tahiti »), always respected in every reading you write:
- six tones, written 1 to 6 (1 阴平, 2 阳平, 3 上, 4 去, 5 阴入, 6 阳入); never 7, 8 or 0: a source numbering the entering tones 7 and 8 (Bao'an, Hong Kong) is converted -- its 7 is Wenfa 5, its 8 is Wenfa 6, and its 5 (去) is Wenfa 4;
- tones 5 and 6 are exactly the syllables ending in -p, -t or -k (bak5, shit6); every other syllable takes tone 1 to 4;
- the stop finals are written p, t, k, never b, d, g (zhuk5, not zhug5);
- j, q, x are always followed by i (ji, qiu, xiong); s, z, c are never followed by i: before i write x, j, q (西 xi1, not si1; 七 qit5, not cit5); only sh may be followed by i (shi, shin, shit);
- ü only comes after z, zh, c, ch, s or sh (sü, zü, cü);
- a syllable without initial never starts with i: write y (yao1, yu1, yi1, yam2);
- w, never v (wun2, not vun2); before i write wui (wui2, not wi2);
- e, never ê; no r."""

SUPERSCRIPTS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")
SUPERSCRIPT_OF = dict(zip("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹"))
SYLLABLE = re.compile(r"([a-zü]+)([0-9]?)")
INITIALS = ("zh", "ch", "sh", "ng", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "z", "c", "s", "y", "w",
            "v", "r")
STOPS = ("p", "t", "k")
# One syllable with its tone, in a reading as written: letters (ê, ü, v as ü) then a digit or a superscript.
TONED = re.compile(r"(?<![A-Za-zÀ-ÿ])([A-Za-zêÊüÜ]+)([0-9⁰¹²³⁴⁵⁶⁷⁸⁹])")
# A «…» block is text written as is (Sentence.textBlock): never touched.
TEXT_BLOCK = re.compile(r"«[^»]*»?")


def split(syllable):
    """« xiong » -> ("x", "iong")."""
    for i in INITIALS:
        if syllable.startswith(i):
            return i, syllable[len(i):]
    return "", syllable


def syllables(pinyin):
    """« wuk5ka1 », « ngai2 oi4 » -> [("wuk", "5"), ("ka", "1"), ...]."""
    text = TEXT_BLOCK.sub(" ", (pinyin or "").lower()).translate(SUPERSCRIPTS).replace("u:", "ü").replace("ê", "e")
    return [(m.group(1), m.group(2)) for m in SYLLABLE.finditer(text)]


def violations(pinyin):
    """What breaks the rules in `pinyin`, one French sentence per problem."""
    out = []
    raw = TEXT_BLOCK.sub(" ", (pinyin or "").lower())
    if "ê" in raw:
        out.append("« ê » s'écrit e")
    for base, tone in syllables(pinyin):
        initial, final = split(base)
        shown = f"« {base}{tone} »"
        if tone in ("0", "7", "8", "9"):
            out.append(f"{shown} : les tons vont de 1 à 6 (pas de ton {tone})")
        if initial in ("j", "q", "x") and not final.startswith("i"):
            out.append(f"{shown} : j, q, x sont toujours suivis de i")
        if initial in ("z", "zh", "c", "ch", "s") and final.startswith("i"):
            out.append(f"{shown} : z, zh, c, ch, s ne sont jamais suivis de i (x, j, q devant i ; seul sh peut l'être)")
        if "ü" in final and initial not in ("z", "zh", "c", "ch", "s", "sh"):
            out.append(f"{shown} : ü vient toujours après z, zh, c, ch, s ou sh")
        if tone in ("5", "6") and not final.endswith(STOPS):
            out.append(f"{shown} : les tons 5 et 6 sont réservés aux finales en -p, -t, -k")
        if tone in ("1", "2", "3", "4") and final.endswith(STOPS) and len(final) > 1:
            out.append(f"{shown} : une finale en -p, -t, -k prend le ton 5 ou 6")
        if tone and re.search(r"[aeiouü](b|d|g)$", final) and not final.endswith("ng"):
            out.append(f"{shown} : les finales s'écrivent -p, -t, -k (pas -b, -d, -g)")
        if not initial and final.startswith("i"):
            out.append(f"{shown} : sans consonne initiale, i s'écrit y (yao, yu, yi)")
        if initial == "w" and final.startswith("i"):
            out.append(f"{shown} : w devant i s'écrit wui")
        if initial == "v":
            out.append(f"{shown} : w, jamais v")
        if initial == "r":
            out.append(f"{shown} : pas de r dans le pinyin Wenfa")
    return list(dict.fromkeys(out))


def _fix(base, tone, baoan):
    """One syllable (lowercase letters, tone digit) set right where the
    rule leaves no doubt. `baoan`: the reading numbers its entering tones
    7 and 8 (Bao'an, Hong Kong), so its 5 is the departing tone (Wenfa 4)."""
    base = base.replace("ê", "e")
    # Meixian's stops b, d, g -> p, t, k (a checked syllable: tone 5 to 8).
    if tone in ("5", "6", "7", "8") and re.search(r"[aeiouü][bdg]$", base) and not base.endswith("ng"):
        base = base[:-1] + {"b": "p", "d": "t", "g": "k"}[base[-1]]
    initial, final = split(base)
    stop = final.endswith(STOPS) and len(final) > 1
    # The entering tones numbered 7 and 8 -> 5 and 6; that numbering's 5 (去) -> 4.
    if tone in ("7", "8") and stop:
        tone = "5" if tone == "7" else "6"
    elif baoan and tone == "5" and not stop:
        tone = "4"
    # v -> w; then w before i -> wui.
    if initial == "v" and final[:1] in ("a", "e", "o", "u", "i"):
        initial = "w"
    if initial == "w" and final.startswith("i"):
        final = "u" + final
    # s, z, c (and zh, ch) before i -> x, j, q; and back: j, q, x without i -> z, c, s.
    if final.startswith("i") and initial in ("s", "z", "zh", "c", "ch"):
        initial = {"s": "x", "z": "j", "zh": "j", "c": "q", "ch": "q"}[initial]
    elif initial in ("j", "q", "x") and final and not final.startswith("i"):
        initial = {"j": "z", "q": "c", "x": "s"}[initial]
    # No initial: i is written y (iao -> yao, iu -> yu, i -> yi, in -> yin).
    if not initial and final.startswith("i") and len(final) > 1 and final[1] in "aeouü":
        initial, final = "y", final[1:]
    elif not initial and final.startswith("i"):
        initial = "y"
    return initial + final, tone


def fix_parts(initial, final, tone):
    """A reading as (initial, final, tone) -- the lexicon's own split, y and w
    being initials -- set right like normalize() does: ("s", "in", "1") ->
    ("x", "in", "1"), ("", "iao", "1") -> ("y", "ao", "1"). Used on the
    readings deduced from the dictionaries (source_rules.predict)."""
    before = f"{initial}{final}".lower()
    base, tone = _fix(before, str(tone or ""), False)
    if base == before:
        return initial, final, tone          # spelling unchanged: the lexicon's split kept (ng2, m2)
    new_initial, new_final = split(base)
    return new_initial, new_final, tone


def normalize(pinyin):
    """(`pinyin` with every syllable set right where the rule leaves no
    doubt, [French notes « si1 → xi1 »]). Only syllables written with a
    tone are touched -- a word without one may be French or Tahitian --
    and never a «…» block. Spaces, punctuation, superscript tones and the
    first capital letter are kept; what can't be decided is left for
    violations() to report."""
    if not pinyin:
        return pinyin or "", []
    text = str(pinyin)
    baoan = bool(re.search(r"[A-Za-zêü][78⁷⁸](?![0-9])", TEXT_BLOCK.sub(" ", text)))
    notes = []

    def one(m):
        letters, tone_char = m.group(1), m.group(2)
        tone = tone_char.translate(SUPERSCRIPTS)
        fixed, new_tone = _fix(letters.lower(), tone, baoan)
        if letters[:1].isupper():
            fixed = fixed[:1].upper() + fixed[1:]
        out_tone = SUPERSCRIPT_OF[new_tone] if tone_char in SUPERSCRIPT_OF.values() else new_tone
        if fixed.lower() != letters.lower() or new_tone != tone:
            note = f"{letters}{tone_char} → {fixed}{out_tone}"
            if note not in notes:
                notes.append(note)
        return f"{fixed}{out_tone}"

    parts, last = [], 0
    for block in TEXT_BLOCK.finditer(text):
        parts.append(TONED.sub(one, text[last:block.start()]))
        parts.append(block.group(0))
        last = block.end()
    parts.append(TONED.sub(one, text[last:]))
    return "".join(parts), notes


def normalize_note(notes):
    """« Lecture mise en pinyin Wenfa : si1 → xi1, sit7 → xit5 » ('' when nothing changed)."""
    return f"lecture mise en pinyin Wenfa : {', '.join(notes)}" if notes else ""
