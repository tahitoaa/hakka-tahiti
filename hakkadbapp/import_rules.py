"""Reading documents without the AI (importer.py).

- Word tables: a .docx table is read as a spreadsheet.
- Line templates (« gabarits »): the layouts vocabulary lists use, recognised
  line by line --
    屋家 wuk5ka1 maison           characters · reading · meaning
    屋家 (wuk5ka1) maison         characters (reading) meaning
    šon2 tšak6 船隻 ‘ships’        reading characters ‘meaning’ (glossed examples)
    屋家 : maison                 characters : meaning
  A reading needs tone digits (or superscripts) to count, so a French word
  is never taken for one.
- The rest of a text: a short list of candidate words -- character runs
  the lexicon doesn't have, repeated in the text or made of characters it
  has no reading for -- each with the sentence it comes from. The AI only
  sees this list, and only when asked (importer.api_define).
"""
import io
import re
import zipfile
from collections import Counter

HAN = r"[㐀-鿿豈-﫿\U00020000-\U0002ffff]"
HAN_RUN = re.compile(f"{HAN}+")
# One syllable of a reading with its tone: wuk5, ka¹, k'ak7, šon2, ŋin2.
SYL = r"[a-zA-Zàâäéèêëïîôöùûüçŋɛɔəšüâ'’]+[0-9¹²³⁴⁵⁶⁷⁸]"
READING = rf"{SYL}(?:[\s\-]*{SYL})*"
SEP = r"[\s\t,;:：、|=–—\-]*"

TEMPLATES = [
    ("caractères (lecture) sens", re.compile(rf"^\s*(?P<hanzi>{HAN}+(?:\s{HAN}+)*)\s*[（(]\s*(?P<reading>{READING})\s*[)）]{SEP}(?P<meaning>.*)$")),
    ("caractères · lecture · sens", re.compile(rf"^\s*(?P<hanzi>{HAN}+(?:\s{HAN}+)*){SEP}(?P<reading>{READING}){SEP}(?P<meaning>.*)$")),
    ("lecture · caractères · sens", re.compile(rf"^\s*(?P<reading>{READING}){SEP}(?P<hanzi>{HAN}+(?:\s{HAN}+)*){SEP}(?P<meaning>[^{HAN[1:-1]}]*)$")),
    ("caractères : sens", re.compile(rf"^\s*(?P<hanzi>{HAN}{{1,8}})\s*[:：=\t—–]\s*(?P<meaning>[A-Za-zÀ-ÿ].*)$")),
]
# Glossed examples, several per line: « šon2 tšak6 船隻 ‘ships’ ».
GLOSSED = re.compile(rf"(?P<reading>{READING})\s+(?P<hanzi>{HAN}+)\s*[‘'\"«“(]\s*(?P<meaning>[^’'\"»”)]+?)\s*[’'\"»”)]")

FRENCH_WORDS = {"le", "la", "les", "un", "une", "des", "de", "du", "et", "est", "à", "en", "pour", "avec", "dans", "sur", "pas"}
ENGLISH_WORDS = {"the", "a", "an", "of", "to", "and", "is", "in", "for", "with", "on", "not", "be", "it"}


def meaning_language(text):
    """"french", "english" or "" (no Latin letters) -- from accents and
    common words, no AI. Undecided (« manger ») counts as French: the
    documents are mostly French, and the FR / EN check can still fix it."""
    words = re.findall(r"[a-zà-ÿ']+", text.lower())
    if not words:
        return ""
    if re.search(r"[àâäéèêëïîôöùûüç]", text.lower()):
        return "french"
    return "english" if sum(w in ENGLISH_WORDS for w in words) > sum(w in FRENCH_WORDS for w in words) else "french"


def _syllables(reading):
    return re.findall(SYL, reading)


def docx_tables(data):
    """[[row cells]] of every table of a .docx (one list for all of them)."""
    try:
        xml = zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode("utf-8")
    except (zipfile.BadZipFile, KeyError):
        return []
    rows = []
    for table in re.findall(r"<w:tbl>.*?</w:tbl>", xml, flags=re.S):
        for tr in re.findall(r"<w:tr[ >].*?</w:tr>", table, flags=re.S):
            cells = ["".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", tc)).strip()
                     for tc in re.findall(r"<w:tc>.*?</w:tc>", tr, flags=re.S)]
            if any(cells):
                rows.append(cells)
    return rows


def _entry(hanzi, reading, meaning, location, template):
    meaning = (meaning or "").strip(" \t-–—:;,.")
    lang = meaning_language(meaning)
    return {"hanzi": " ".join(hanzi.split()), "pinyin": " ".join(reading.split()) if reading else "",
            "french": meaning if lang == "french" else "", "english": meaning if lang == "english" else "",
            "themes": "", "source_sense": meaning if lang == "" and meaning else "", "remark": "",
            "type": "", "location": location, "template": template}


def read_lines(text):
    """(entries found by the templates, the other lines) of a text; each line
    with its location (page and line number)."""
    entries, rest, page = [], [], ""
    for n, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        m = re.fullmatch(r"\[page (\d+)\]", stripped)
        if m:
            page = f"p. {m.group(1)}, "
            continue
        if not re.search(HAN, stripped):
            continue
        location = f"{page}ligne {n}"
        glossed = [g for g in GLOSSED.finditer(stripped)
                   if len(_syllables(g.group("reading"))) == len(re.findall(HAN, g.group("hanzi")))]
        if glossed:
            entries += [_entry(g.group("hanzi"), g.group("reading"), g.group("meaning"), location, "lecture caractères ‘sens’")
                        for g in glossed]
            continue
        for name, pattern in TEMPLATES:
            m = pattern.match(stripped)
            if not m:
                continue
            reading = m.groupdict().get("reading") or ""
            if reading and len(_syllables(reading)) != len(re.findall(HAN, m.group("hanzi"))):
                continue
            entries.append(_entry(m.group("hanzi"), reading, m.groupdict().get("meaning", ""), location, name))
            break
        else:
            rest.append((location, stripped))
    return entries, rest


def shortlist(lines, known, readings, segment, norm, limit=80):
    """Candidate words in the lines no template read: runs of 2-4 characters
    the lexicon doesn't have and can't split into its own words, seen at
    least twice, and single characters it has no reading for -- most
    frequent first, each with its first context."""
    counts, contexts = Counter(), {}
    for location, line in lines:
        line = norm(line)
        for run in HAN_RUN.findall(line):
            run = norm(run)
            grams = {run[i:i + n] for n in range(2, 5) for i in range(len(run) - n + 1)}
            grams |= {c for c in run if c not in readings}
            for g in grams:
                counts[g] += 1
                if g not in contexts:
                    i = max(line.find(g), 0)
                    contexts[g] = (location, line[max(0, i - 15): i + len(g) + 15])
    kept = []
    for gram, n in sorted(counts.items(), key=lambda kv: (-len(kv[0]), -kv[1])):
        if gram in known:
            continue
        if len(gram) > 1:
            if n < 2 or all(tok in known for tok in segment(gram, known).split()):
                continue
            # A longer candidate seen as often already covers this one.
            if any(gram in k and counts[k] >= n for k in kept):
                continue
        kept.append(gram)
    kept.sort(key=lambda g: (-counts[g], -len(g)))
    out = []
    for gram in kept[:limit]:
        location, context = contexts[gram]
        out.append({"hanzi": gram, "pinyin": "", "french": "", "english": "", "themes": "", "source_sense": "",
                    "remark": f"contexte : « {context.strip()} »", "type": "", "context": context.strip(),
                    "location": f"{location} · ×{counts[gram]}", "template": "candidat", "frequency": counts[gram]})
    return out
