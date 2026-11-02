"""The "Sources" page, rethought: every character of every source in one
table, and the correspondence rules from each source to Wenfa, inferred from
the data.

Sources: the lexicon (Wenfa), Bao'an and McIver (dictionary indexes,
pronunciation_sources), Mandarin (Unicode Unihan: pinyin + English).

Rules. A syllable is split into initial, final and tone in its own system:
- Bao'an, McIver: longest initial among that system's spellings
  (romanization.json "initials"), the rest is the final; the tone is given;
- Mandarin: the standard pinyin initials; the tone from the diacritic.
Learning pairs: the lexicon characters with exactly one Wenfa reading and
exactly one reading in the source (no guessing which reading goes with
which). For each part, the rule is the table "source value -> Wenfa value"
with its counts. Predicting a Wenfa reading from a source reading takes the
most frequent Wenfa value for each part; its accuracy is measured on the
learning pairs themselves (how often the three parts are all right).

Shown as a three-stage automaton (transducer): q0 --initial--> q1 --final-->
q2 --tone--> q3, each stage a set of weighted transitions "source : Wenfa"."""
import json
import unicodedata
from collections import Counter, defaultdict

from . import pronunciation_sources as ps
from . import romanization
from .models import Pronunciation

SUPERSCRIPT = str.maketrans("012345678", "⁰¹²³⁴⁵⁶⁷⁸")
MANDARIN_INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h",
                     "j", "q", "x", "r", "z", "c", "s", "y", "w"]
TONE_MARKS = {"̄": "1", "́": "2", "̌": "3", "̀": "4"}
SOURCES = [
    {"id": "baoan", "label": "Bao'an", "system": "baoan"},
    {"id": "mciver", "label": "McIver", "system": "mciver"},
    {"id": "cantonese", "label": "Cantonais", "system": None},
    {"id": "mandarin", "label": "Mandarin", "system": None},
]
_cache = {}


# ---- splitting syllables ----------------------------------------------------------------------

def _initials(system_id):
    """Every spelling of an initial in this system, longest first."""
    system = romanization.get_system(system_id)
    spellings = {romanization.fold_spelling(v) for v in system.get("initials", {}).values() if v}
    return sorted(spellings, key=len, reverse=True)


def split_source(syllable, tone, system_id, initials):
    """("k'a", "1") -> ("k'", "a", "1") in the source's own spelling."""
    folded = _cache.setdefault("folded", {})
    s = folded.get(syllable)
    if s is None:
        s = folded[syllable] = romanization.fold_spelling(syllable)
    for i in initials:
        if s.startswith(i) and len(s) > len(i):
            return i, s[len(i):], str(tone or "")
    return "", s, str(tone or "")


JYUTPING_INITIALS = ["gw", "kw", "ng", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "w", "z", "c", "s", "j"]


def split_cantonese(reading):
    """"gaa1" -> ("g", "aa", "1") in Jyutping; "m4", "ng5": no initial."""
    tone = reading[-1] if reading[-1:].isdigit() else ""
    base = reading[:-1] if tone else reading
    for i in JYUTPING_INITIALS:
        if base.startswith(i) and len(base) > len(i):
            return i, base[len(i):], tone
    return "", base, tone


def split_mandarin(reading):
    """"jiā" -> ("j", "ia", "1"); no tone mark -> tone "5" (neutral)."""
    decomposed = unicodedata.normalize("NFD", reading.lower())
    tone = next((TONE_MARKS[c] for c in decomposed if c in TONE_MARKS), "5")
    base = "".join(c for c in decomposed if not unicodedata.combining(c) or c == "̈")
    base = unicodedata.normalize("NFC", base).replace("ü", "ü")
    for i in MANDARIN_INITIALS:
        if base.startswith(i) and len(base) > len(i):
            return i, base[len(i):], tone
    return "", base, tone


# ---- the data ---------------------------------------------------------------------------------

_converted = {}


def convert_all(converter, chars):
    """{char: converted} for many characters in one OpenCC call (one per
    line, so no phrase is matched across characters), cached."""
    key = id(converter)
    done = _converted.setdefault(key, {})
    todo = [c for c in dict.fromkeys(chars) if c not in done]
    if todo:
        out = converter.convert("\n".join(todo)).split("\n")
        if len(out) != len(todo):
            out = [converter.convert(c) for c in todo]
        done.update(zip(todo, out))
    return done


def _norm(char):
    done = _converted.get(id(ps._t2s), {})
    return done[char] if char in done else convert_all(ps._t2s, [char])[char]


def lexicon_readings():
    """{simplified char: [(initial, final, tone)]} from the lexicon."""
    out = defaultdict(list)
    for p in Pronunciation.objects.select_related("initial", "final", "tone"):
        if not p.hanzi:
            continue
        reading = (p.initial.initial if p.initial else "" or "", p.final.final if p.final else "",
                   str(p.tone.tone_number) if p.tone else "")
        reading = tuple(x or "" for x in reading)
        if reading not in out[_norm(p.hanzi)]:
            out[_norm(p.hanzi)].append(reading)
    return out


def load_sources():
    """Everything the computation reads, loaded once: each dictionary's
    {char: [(syllable, tone)]}, each system's initials, Unihan."""
    maps = {s["id"]: ps._readings_by_char(s) for s in ps.SOURCES}
    maps["initials"] = {s["system"]: _initials(s["system"]) for s in SOURCES if s["system"]}
    ps.unihan("一")  # loads data/hanzi_info.json into ps._cache
    maps["unihan"] = ps._cache.get("unihan", (None, {}))[1]
    _cache["maps"] = maps
    return maps


def unihan_entry(char):
    chars = _cache["maps"]["unihan"]
    entry = chars.get(char) or chars.get(convert_all(ps._s2t, [char])[char])
    if not entry:
        return {}
    return {"mandarin": entry[0].split(), "meaning": entry[1], "cantonese": (entry[2] if len(entry) > 2 else "").split()}


def source_readings(source, char):
    """[(initial, final, tone)] for `char` in a source, split in its spelling."""
    maps = _cache.get("maps") or load_sources()
    if source["id"] == "mandarin":
        return [split_mandarin(r) for r in unihan_entry(char).get("mandarin", [])]
    if source["id"] == "cantonese":
        return [split_cantonese(r) for r in unihan_entry(char).get("cantonese", [])]
    readings = maps[source["id"]].get(char) or maps[source["id"]].get(convert_all(ps._s2t, [char])[char], [])
    return [split_source(syl, tone, source["system"], maps["initials"][source["system"]]) for syl, tone in readings]


def all_chars():
    """Every character of the lexicon and the dictionaries, simplified, once."""
    raw = []
    for s in ps.SOURCES:
        path = ps.DATA_DIR / s["file"]
        if path.exists():
            raw += [row[3] if len(row) > 3 and isinstance(row[3], str) else row[0]
                    for row in json.loads(path.read_text(encoding="utf-8"))["prons"]]
    simplified = convert_all(ps._t2s, raw)
    return {simplified[c] for c in raw}


def wenfa_text(reading):
    i, f, t = reading
    return f"{i}{f}{t.translate(SUPERSCRIPT)}"


def source_text(source, reading):
    i, f, t = reading
    return f"{i}{f}{t.translate(SUPERSCRIPT)}"


# ---- rules -------------------------------------------------------------------------------------

def learn(lexicon):
    """For each source: {"parts": {part: {src: {wenfa: count}}}, "examples":
    {part: {"src>wenfa": [chars]}}, "pairs": n, "accuracy": {...}}."""
    rules = {}
    for source in SOURCES:
        tables = {p: defaultdict(Counter) for p in ("initial", "final", "tone")}
        examples = {p: defaultdict(list) for p in tables}
        pairs = []
        for char, wenfa in lexicon.items():
            src = source_readings(source, char)
            if len(wenfa) != 1 or len(src) != 1:
                continue
            pairs.append((char, src[0], wenfa[0]))
            for k, part in enumerate(("initial", "final", "tone")):
                tables[part][src[0][k]][wenfa[0][k]] += 1
                key = f"{src[0][k]}>{wenfa[0][k]}"
                if len(examples[part][key]) < 4:
                    examples[part][key].append(char)
        best = {part: {s: c.most_common(1)[0][0] for s, c in table.items()} for part, table in tables.items()}
        right = Counter()
        for _char, s, w in pairs:
            guess = [best[p].get(s[k]) for k, p in enumerate(("initial", "final", "tone"))]
            for k, p in enumerate(("initial", "final", "tone")):
                right[p] += guess[k] == w[k]
            right["all"] += guess == list(w)
        n = len(pairs) or 1
        rules[source["id"]] = {
            "label": source["label"], "pairs": len(pairs),
            "parts": {p: {s: dict(c) for s, c in t.items()} for p, t in tables.items()},
            "examples": {p: dict(e) for p, e in examples.items()},
            "accuracy": {k: round(100 * right[k] / n) for k in ("initial", "final", "tone", "all")},
            "best": best,
        }
    return rules


def predict(rules, source_id, reading):
    """The most likely Wenfa reading for a source reading, and how sure:
    the share of the learning pairs that agree, part by part (product)."""
    r = rules[source_id]
    out, confidence = [], 1.0
    for k, part in enumerate(("initial", "final", "tone")):
        counts = r["parts"][part].get(reading[k])
        if not counts:
            return None, 0
        value, n = max(counts.items(), key=lambda kv: kv[1])
        out.append(value)
        confidence *= n / sum(counts.values())
    return tuple(out), round(100 * confidence)


# ---- the page's data -------------------------------------------------------------------------------

# What every source is, for the page (a click on a column header shows it).
SOURCE_INFO = [
    {"id": "lexique", "short": "Lexique", "sub": "Wenfa",
     "full": "Lexique hakka de l'association Wenfa (Tahiti)", "origin": "Base du site, saisie et validée par l'association.",
     "romanization": "Wenfa (tons 1 à 6)", "scan": False},
    {"id": "baoan", "short": "Bao'an", "sub": "陳志明",
     "full": "陳志明, 客家話大辭典（寶安腔）, index des caractères",
     "origin": "Transcrit à partir du PDF scanné de l'index (43 pages) : reconnaissance de texte (OCR) et relecture visuelle. "
               "Des erreurs de lecture restent possibles.",
     "romanization": "Romanisation du dictionnaire, accent de Bao'an (tons 1, 2, 3, 5, 7, 8)", "scan": True},
    {"id": "mciver", "short": "McIver", "sub": "1926",
     "full": "D. MacIver, A Chinese-English Dictionary, Hakka-Dialect as spoken in Kwang-tung Province (1926), index hakka",
     "origin": "Transcrit visuellement depuis le scan de l'index ; numéros recoupés par reconnaissance de texte (OCR). "
               "Des erreurs de lecture restent possibles.",
     "romanization": "Romanisation de MacIver (aspiration notée h : kh, th…)", "scan": True},
    {"id": "chappell", "short": "Chappell & Lamarre", "sub": "Bâle",
     "full": "H. Chappell et C. Lamarre, A Grammar and Lexicon of Hakka: Historical Materials from the Basel Mission Library",
     "origin": "Relevé dans le texte du PDF (HAL) : mots cités avec leur lecture et leur sens anglais.",
     "romanization": "Romanisation de la Mission de Bâle, dialecte de Sin-on (tš, š, ny…)", "scan": False},
    {"id": "cantonese", "short": "Cantonais", "sub": "Unihan",
     "full": "Unicode Unihan Database, champ kCantonese", "origin": "Base de données du consortium Unicode.",
     "romanization": "Jyutping (tons 1 à 6)", "scan": False},
    {"id": "mandarin", "short": "Mandarin", "sub": "Unihan",
     "full": "Unicode Unihan Database, champs kMandarin et kHanyuPinyin", "origin": "Base de données du consortium Unicode.",
     "romanization": "Pinyin (accents)", "scan": False},
    {"id": "english", "short": "Anglais", "sub": "Unihan",
     "full": "Unicode Unihan Database, champ kDefinition", "origin": "Base de données du consortium Unicode.",
     "romanization": "", "scan": False},
]


def doubtful(rules, lexicon, char, readings):
    """For the sources transcribed from scans (Bao'an, McIver): the indexes
    of their readings that agree with no other Hakka source -- read in
    Wenfa through the learnt rules, neither the initial nor the final of
    any lexicon reading or of the other dictionary's readings. A sign of a
    possible misreading of the scan (or of a real disagreement). Only
    flagged when there is something to compare with."""
    out = {}
    predicted = {sid: [predict(rules, sid, r)[0] for r in readings[sid]] for sid in ("baoan", "mciver")}
    for sid, other in (("baoan", "mciver"), ("mciver", "baoan")):
        others = list(lexicon.get(char, [])) + [p for p in predicted[other] if p]
        if not others:
            continue
        bad = [k for k, p in enumerate(predicted[sid])
               if p and all(p[0] != o[0] and p[1] != o[1] for o in others)]
        if bad:
            out[sid] = bad
    return out


def chappell():
    """{simplified char: (["sang¹", ...], "生 sang1 life; ...")} from
    data/chappell_prons.json (manage.py build_chappell_index): readings and
    example words from Chappell & Lamarre's grammar. Shown, not learnt from."""
    path = ps.DATA_DIR / "chappell_prons.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    by_char = defaultdict(lambda: ([], ""))
    raw = [row[0] for row in data["prons"]]
    simplified = convert_all(ps._t2s, raw)
    for char, syllable, tone in data["prons"]:
        key = simplified[char]
        texts, _ = by_char[key]
        text = f"{syllable}{str(tone or '').translate(SUPERSCRIPT)}"
        if text not in texts:
            texts.append(text)
        examples = " ; ".join(f"{w} {r} « {g} »" for w, r, g in data.get("examples", {}).get(char, []))
        by_char[key] = (texts, examples)
    return dict(by_char)


def table_payload():
    """{"rows": [[char, trad, wenfa, baoan, mciver, mandarin, english, guess, cantonese,
    chappell, chappell_examples, doubtful]], "rules": ..., "sources": SOURCE_INFO + counts}.
    `doubtful`: {"baoan": [indexes], ...} of readings that may be misread scans.
    `wenfa`: the lexicon's readings; `guess`: for a character the lexicon
    doesn't have, the Wenfa reading deduced from the best source available
    ("ga¹|Bao'an|72")."""
    load_sources()
    lexicon = lexicon_readings()
    rules = learn(lexicon)
    order = sorted(SOURCES, key=lambda s: -rules[s["id"]]["accuracy"]["all"])
    rows = []
    basel = chappell()
    flagged = Counter()
    chars = sorted(all_chars() | set(lexicon) | set(basel))
    traditional = convert_all(ps._s2t, chars)
    for char in chars:
        info = unihan_entry(char)
        readings = {s["id"]: source_readings(s, char) for s in SOURCES}
        guess = ""
        if char not in lexicon:
            for s in order:
                if readings[s["id"]]:
                    reading, confidence = predict(rules, s["id"], readings[s["id"]][0])
                    if reading:
                        guess = f"{wenfa_text(reading)}|{s['label']}|{confidence}"
                        break
        trad = traditional[char]
        flags = doubtful(rules, lexicon, char, readings)
        for sid, ks in flags.items():
            flagged[sid] += len(ks)
        rows.append([
            char, trad if trad != char else "",
            " ".join(wenfa_text(r) for r in lexicon.get(char, [])),
            " ".join(source_text(SOURCES[0], r) for r in readings["baoan"]),
            " ".join(source_text(SOURCES[1], r) for r in readings["mciver"]),
            " ".join(info.get("mandarin", [])), info.get("meaning", ""), guess,
            " ".join(source_text(SOURCES[2], r) for r in readings["cantonese"]),
            " ".join(basel.get(char, ([], ""))[0]), basel.get(char, ([], ""))[1],
            flags,
        ])
    # The lexicon's characters first (by Wenfa reading), then the others.
    rows.sort(key=lambda r: (not r[2], r[2], r[0]))
    for r in rules.values():
        r.pop("best", None)
    counts = {"lexique": sum(1 for r in rows if r[2]), "baoan": sum(1 for r in rows if r[3]),
              "mciver": sum(1 for r in rows if r[4]), "chappell": sum(1 for r in rows if r[9]),
              "cantonese": sum(1 for r in rows if r[8]), "mandarin": sum(1 for r in rows if r[5]),
              "english": sum(1 for r in rows if r[6])}
    sources = [{**s, "chars": counts.get(s["id"], 0), "doubtful": flagged.get(s["id"], 0)} for s in SOURCE_INFO]
    return {"rows": rows, "rules": rules, "order": [s["id"] for s in order], "sources": sources}


def cached_payload():
    """table_payload(), rebuilt at most every 10 minutes per server instance."""
    import time

    stamp, payload = _cache.get("payload", (0, None))
    if not payload or time.time() - stamp > 600:
        payload = table_payload()
        _cache["payload"] = (time.time(), payload)
    return payload
