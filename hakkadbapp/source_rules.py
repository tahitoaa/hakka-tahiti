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
    return {"mandarin": entry[0].split(), "meaning": entry[1]} if entry else {}


def source_readings(source, char):
    """[(initial, final, tone)] for `char` in a source, split in its spelling."""
    maps = _cache.get("maps") or load_sources()
    if source["id"] == "mandarin":
        return [split_mandarin(r) for r in unihan_entry(char).get("mandarin", [])]
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

def table_payload():
    """{"rows": [[char, trad, wenfa, baoan, mciver, mandarin, english, guess]], "rules": ...}.
    `wenfa`: the lexicon's readings; `guess`: for a character the lexicon
    doesn't have, the Wenfa reading deduced from the best source available
    ("ga¹|Bao'an|72")."""
    load_sources()
    lexicon = lexicon_readings()
    rules = learn(lexicon)
    order = sorted(SOURCES, key=lambda s: -rules[s["id"]]["accuracy"]["all"])
    rows = []
    chars = sorted(all_chars() | set(lexicon))
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
        rows.append([
            char, trad if trad != char else "",
            " ".join(wenfa_text(r) for r in lexicon.get(char, [])),
            " ".join(source_text(SOURCES[0], r) for r in readings["baoan"]),
            " ".join(source_text(SOURCES[1], r) for r in readings["mciver"]),
            " ".join(info.get("mandarin", [])), info.get("meaning", ""), guess,
        ])
    # The lexicon's characters first (by Wenfa reading), then the others.
    rows.sort(key=lambda r: (not r[2], r[2], r[0]))
    for r in rules.values():
        r.pop("best", None)
    return {"rows": rows, "rules": rules, "order": [s["id"] for s in order]}


def cached_payload():
    """table_payload(), rebuilt at most every 10 minutes per server instance."""
    import time

    stamp, payload = _cache.get("payload", (0, None))
    if not payload or time.time() - stamp > 600:
        payload = table_payload()
        _cache["payload"] = (time.time(), payload)
    return payload
