"""Transcription (romanization) systems for the stored Wenfa notation.

The mappings themselves live in romanization.json (hand-edited, see its
`_readme`); this module only loads/validates them and applies them. The
browser does the exact same thing in static/hakkadbapp/js/Romanization.js
from the same JSON (embedded in every page by the context processor below),
so the two must stay algorithmically identical -- tests/romanization.test.js
and `manage.py check_romanization` cover that.
"""
import hashlib
import json
import unicodedata
from pathlib import Path

from django.utils.html import format_html_join

CONFIG_PATH = Path(__file__).with_name("romanization.json")

_SYSTEM_KEYS = {"id", "label", "source", "initials", "finals", "tones", "rules", "syllables", "input_tones", "input_syllables"}
_WHEN_KEYS = {"initial", "final", "final_startswith", "final_not"}
_THEN_KEYS = {"initial", "final"}


class RomanizationConfigError(ValueError):
    pass


def _public(d):
    """Drops `_comment`-style keys so they never reach the conversion."""
    return {k: v for k, v in d.items() if not k.startswith("_")}


def _as_list(value):
    if value is None:
        return None
    return [value] if isinstance(value, str) else list(value)


def validate(config):
    """Raises RomanizationConfigError with a precise location on any
    structural mistake -- a typo in a hand-edited file should fail loudly
    at startup/check time, not silently render the wrong pinyin."""
    def fail(where, msg):
        raise RomanizationConfigError(f"romanization.json, {where}: {msg}")

    systems = config.get("systems")
    if not isinstance(systems, list) or not systems:
        fail("systems", "doit être une liste non vide")
    if not isinstance(config.get("tones", {}), dict):
        fail("tones", "doit être un objet")

    seen = set()
    for n, system in enumerate(systems):
        where = f"systems[{n}]"
        sid = system.get("id")
        if not sid or not isinstance(sid, str) or not sid.replace("_", "").isalnum():
            fail(where, f"'id' manquant ou invalide ({sid!r}) : lettres, chiffres et _ seulement")
        if sid in seen:
            fail(where, f"id '{sid}' en double")
        seen.add(sid)
        where = f"système '{sid}'"
        unknown = set(_public(system)) - _SYSTEM_KEYS
        if unknown:
            fail(where, f"clé(s) inconnue(s) {sorted(unknown)}")
        if not system.get("label"):
            fail(where, "'label' manquant")
        for key in ("initials", "finals", "tones", "syllables"):
            table = system.get(key, {})
            if not isinstance(table, dict):
                fail(f"{where}.{key}", "doit être un objet")
            for k, v in _public(table).items():
                if not isinstance(v, str):
                    fail(f"{where}.{key}['{k}']", f"la valeur doit être une chaîne, pas {v!r}")
        input_tones = system.get("input_tones", {})
        if not isinstance(input_tones, dict):
            fail(f"{where}.input_tones", "doit être un objet")
        for k, v in _public(input_tones).items():
            if not isinstance(v, list) or not all(isinstance(t, str) for t in v):
                fail(f"{where}.input_tones['{k}']", "doit être une liste de tons stockés, ex. [\"3\", \"4\"]")
        input_syllables = system.get("input_syllables", {})
        if not isinstance(input_syllables, dict):
            fail(f"{where}.input_syllables", "doit être un objet")
        for k, v in _public(input_syllables).items():
            if not isinstance(v, list) or not all(isinstance(x, str) and "+" in x for x in v):
                fail(f"{where}.input_syllables['{k}']", "doit être une liste de syllabes stockées 'initiale+finale'")
        for k in _public(system.get("syllables", {})):
            if "+" not in k:
                fail(f"{where}.syllables['{k}']", "la clé doit être 'initiale+finale' (ex. 'z+i', '+an')")
        rules = system.get("rules", [])
        if not isinstance(rules, list):
            fail(f"{where}.rules", "doit être une liste")
        for r, rule in enumerate(rules):
            rwhere = f"{where}.rules[{r}]"
            when, then = rule.get("when"), rule.get("then")
            if not isinstance(when, dict) or not _public(when):
                fail(rwhere, "'when' manquant ou vide")
            if not isinstance(then, dict) or not _public(then):
                fail(rwhere, "'then' manquant ou vide")
            if set(_public(when)) - _WHEN_KEYS:
                fail(rwhere, f"condition(s) inconnue(s) {sorted(set(_public(when)) - _WHEN_KEYS)}")
            if set(_public(then)) - _THEN_KEYS:
                fail(rwhere, f"'then' ne peut contenir que {sorted(_THEN_KEYS)}")

    if config.get("default_system") not in seen:
        fail("default_system", f"{config.get('default_system')!r} n'est pas un id de système")
    return config


# Cached, but keyed on the file's modification time: `runserver` only reloads
# on .py changes, so a plain lru_cache kept serving the old mappings after
# romanization.json was edited or regenerated, until a manual restart.
_cache = {"mtime": None, "config": None}


def load_config():
    mtime = CONFIG_PATH.stat().st_mtime_ns
    if _cache["config"] is None or _cache["mtime"] != mtime:
        _cache["config"] = _read_config()
        _cache["mtime"] = mtime
    return _cache["config"]


def _clear_config_cache():
    _cache["config"] = None


load_config.cache_clear = _clear_config_cache  # same API the commands already use


def _read_config():
    with CONFIG_PATH.open(encoding="utf-8") as fh:
        raw = fh.read()
    try:
        config = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RomanizationConfigError(f"romanization.json : JSON invalide ({exc})") from exc
    validate(config)
    # Short content hash: lets client-side caches holding pre-rendered
    # pinyin (flashcards' localStorage) notice a mapping edit.
    config["_version"] = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]
    return config


def systems():
    return load_config()["systems"]


def default_system_id():
    return load_config()["default_system"]


def get_system(system_id=None):
    system_id = system_id or default_system_id()
    for system in systems():
        if system["id"] == system_id:
            return system
    raise KeyError(f"Unknown romanization system {system_id!r}")


def _matches(when, initial, final):
    initials = _as_list(when.get("initial"))
    if initials is not None and initial not in initials:
        return False
    finals = _as_list(when.get("final"))
    if finals is not None and final not in finals:
        return False
    prefixes = _as_list(when.get("final_startswith"))
    if prefixes is not None and not any(final.startswith(p) for p in prefixes):
        return False
    excluded = _as_list(when.get("final_not"))
    if excluded is not None and final in excluded:
        return False
    return True


def romanize(initial, final, tone="", system_id=None):
    """One stored syllable (Wenfa initial/final/tone) -> display string in
    `system_id`. Algorithm documented in romanization.json's `_readme`."""
    system = get_system(system_id)
    initial = initial or ""
    final = final or ""
    tone = "" if tone is None else str(tone)

    tones = {**_public(load_config().get("tones", {})), **_public(system.get("tones", {}))}
    tone_str = tones.get(tone, tone)

    syllable = _public(system.get("syllables", {})).get(f"{initial}+{final}")
    if syllable is not None:
        return syllable + tone_str

    out_i = system.get("initials", {}).get(initial, initial)
    out_f = system.get("finals", {}).get(final, final)
    for rule in system.get("rules", []):
        if _matches(rule["when"], initial, final):
            out_i = rule["then"].get("initial", out_i)
            out_f = rule["then"].get("final", out_f)
    return out_i + out_f + tone_str


def romanize_all_html(initial, final, tone=""):
    """One <span class="rom" data-rom="..."> per system; base.html's CSS
    shows only the one matching <html data-rom>, so switching systems is
    instant and also applies to markup inserted later by JS."""
    return format_html_join(
        "",
        '<span class="rom" data-rom="{}">{}</span>',
        ((s["id"], romanize(initial, final, tone, s["id"])) for s in systems()),
    )


# -- Reverse direction: a spelling in some system -> stored readings ---------
# Python twin of Romanization.js's toStored()/sourceToStored(), used to
# compare dictionary readings with the lexicon (pronunciation_sources.py).

_SUPERSCRIPT_DIGITS = {"¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8"}
_reverse_cache = {}


def fold_spelling(text):
    """Spelling as typed on a plain keyboard (same as Romanization.js)."""
    text = unicodedata.normalize("NFD", text or "")
    text = "".join(c for c in text if not 0x300 <= ord(c) <= 0x36F)
    return (text.replace("ŋ", "ng").replace("ε", "e").replace("ɔ", "o").replace("š", "s")
            .replace("’", "'").lower())


def _reverse_index(system_id, attested=True):
    key = (load_config()["_version"], system_id, attested)
    if key not in _reverse_cache:
        system = get_system(system_id)
        initials = list(system.get("initials", {}))
        finals = list(system.get("finals", {}))
        for k in _public(system.get("syllables", {})):
            i, f = k.split("+", 1)
            if i not in initials:
                initials.append(i)
            if f not in finals:
                finals.append(f)
        index = {}
        for i in initials:
            for f in finals:
                if i or f:
                    index.setdefault(fold_spelling(romanize(i, f, "", system_id)), []).append((i, f))
        for spelling, stored in (_public(system.get("input_syllables", {})) if attested else {}).items():
            pairs = index.setdefault(fold_spelling(spelling), [])
            for s in stored:
                pair = tuple(s.split("+", 1))
                if pair not in pairs:
                    pairs.append(pair)
        _reverse_cache[key] = index
    return _reverse_cache[key]


def exact_stored_tones(digit, system_id):
    """Stored tones whose display in `system_id` is exactly `digit`."""
    tones = {**_public(load_config().get("tones", {})), **_public(get_system(system_id).get("tones", {}))}
    return [t for t, out in tones.items() if t and (out == digit or _SUPERSCRIPT_DIGITS.get(out) == digit)]


def stored_tones(digit, system_id):
    """Stored tones a tone of `system_id` can stand for (its input_tones,
    else the exact reverse of its tones map)."""
    explicit = _public(get_system(system_id).get("input_tones", {}))
    return list(explicit[digit]) if digit in explicit else exact_stored_tones(digit, system_id)


def _split_stored(letters):
    """Split a stored-notation spelling into (initial, final), longest
    initial first, against the initials/finals the systems know."""
    initials, finals = set(), set()
    for system in systems():
        initials.update(system.get("initials", {}))
        finals.update(system.get("finals", {}))
    for initial in sorted(initials, key=len, reverse=True):
        if letters.startswith(initial) and letters[len(initial):] in finals:
            return initial, letters[len(initial):]
    return None


def source_to_stored(syllable, tone, system_id, attested=True):
    """A reading spelled in `system_id` ("ka", 1 in "baoan") -> its stored
    equivalents: [(initial, final, tones or None)]. Falls back to reading the
    spelling as stored notation when the mapping has no inverse for it.
    attested=False leaves out the system's input_syllables: those are typing
    tolerances learnt from the very characters being compared, so a
    comparison using them would mostly agree with itself."""
    tone = "" if tone is None else str(tone)
    tones = stored_tones(tone, system_id) if tone else None
    found = [(i, f, tones) for i, f in _reverse_index(system_id, attested).get(fold_spelling(syllable), [])]
    found = [c for c in found if c[2] is None or c[2]]
    if found:
        return found
    parts = _split_stored(fold_spelling(syllable))
    if not parts:
        return []
    return [(parts[0], parts[1], tones if tones else ([tone] if tone else None))]


def missing_entries(inventory):
    """{system_id: {"initials": [...], "finals": [...]}} for every stored
    initial/final with no explicit mapping (they'd be copied verbatim)."""
    report = {}
    initials = sorted({i for i, _ in inventory})
    finals = sorted({f for _, f in inventory})
    for system in systems():
        mi = [i for i in initials if i not in system.get("initials", {})]
        mf = [f for f in finals if f not in system.get("finals", {})]
        if mi or mf:
            report[system["id"]] = {"initials": mi, "finals": mf}
    return report


def context_processor(request):
    config = load_config()
    return {
        "romanization_config": config,
        "romanization_systems": config["systems"],
        "romanization_default": config["default_system"],
        "romanization_version": config["_version"],
    }
