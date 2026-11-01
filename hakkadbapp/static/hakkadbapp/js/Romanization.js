// Transcription (romanization) systems, client side.
//
// Same JSON (hakkadbapp/romanization.json, embedded in every page by
// base.html as <script id="romanization-config">) and same algorithm as
// hakkadbapp/romanization.py -- keep the two in sync; tests/romanization.test.js
// checks this file against the Python output.
//
// Words are stored in Wenfa notation; everything here is display only.
// Comparisons/exports (expressions.js, EAF/pinyin.txt) keep using the
// stored notation via Sentence.renderPinyinLine().
var Romanization = (function () {
    'use strict';

    var STORAGE_KEY = 'hakka-romanization';
    var INPUT_STORAGE_KEY = 'hakka-romanization-input';
    // null = not chosen yet: type in the stored notation (Wenfa), whatever
    // the header displays -- following the display by default made Wenfa
    // typing silently find nothing as soon as another system was displayed.
    // 'auto' = type in the displayed system; else a system id.
    var inputSetting = null;
    // Every <select> bound to a setting (header + page panels), kept in sync.
    var displayMenus = [];
    var inputMenus = [];
    var reverseIndexes = {};   // system id -> {folded toneless spelling: [[i, f], ...]}
    var config = null;
    var current = null;
    var inventory = null; // {initials: [...longest first], finals: Set}

    function pub(obj) {
        var out = {};
        Object.keys(obj || {}).forEach(function (k) {
            if (k.charAt(0) !== '_') out[k] = obj[k];
        });
        return out;
    }

    function asList(v) {
        if (v === undefined || v === null) return null;
        return typeof v === 'string' ? [v] : v;
    }

    function load(cfg) {
        config = cfg;
        inventory = null;
        reverseIndexes = {};
        if (!current || !getSystem(current)) current = cfg.default_system;
        return api;
    }

    function getSystem(id) {
        if (!config) return null;
        for (var n = 0; n < config.systems.length; n++) {
            if (config.systems[n].id === id) return config.systems[n];
        }
        return null;
    }

    function matches(when, initial, final) {
        var l = asList(when.initial);
        if (l && l.indexOf(initial) === -1) return false;
        l = asList(when.final);
        if (l && l.indexOf(final) === -1) return false;
        l = asList(when.final_startswith);
        if (l && !l.some(function (p) { return final.indexOf(p) === 0; })) return false;
        l = asList(when.final_not);
        if (l && l.indexOf(final) !== -1) return false;
        return true;
    }

    /** One stored syllable -> display string. Mirrors romanization.romanize(). */
    function convert(initial, final, tone, systemId) {
        initial = initial || '';
        final = final || '';
        tone = tone === undefined || tone === null ? '' : String(tone);
        var system = getSystem(systemId || current);
        if (!system) return initial + final + tone;

        var tones = Object.assign({}, pub(config.tones), pub(system.tones));
        var toneStr = Object.prototype.hasOwnProperty.call(tones, tone) ? tones[tone] : tone;

        var syllables = pub(system.syllables);
        var key = initial + '+' + final;
        if (Object.prototype.hasOwnProperty.call(syllables, key)) return syllables[key] + toneStr;

        var initials = system.initials || {};
        var finals = system.finals || {};
        var outI = Object.prototype.hasOwnProperty.call(initials, initial) ? initials[initial] : initial;
        var outF = Object.prototype.hasOwnProperty.call(finals, final) ? finals[final] : final;
        (system.rules || []).forEach(function (rule) {
            if (!matches(rule.when, initial, final)) return;
            if (rule.then.initial !== undefined) outI = rule.then.initial;
            if (rule.then.final !== undefined) outF = rule.then.final;
        });
        return outI + outF + toneStr;
    }

    function getInventory() {
        if (inventory) return inventory;
        var initials = {};
        var finals = {};
        config.systems.forEach(function (s) {
            Object.keys(s.initials || {}).forEach(function (k) { initials[k] = true; });
            Object.keys(s.finals || {}).forEach(function (k) { finals[k] = true; });
            Object.keys(pub(s.syllables)).forEach(function (k) {
                var parts = k.split('+');
                initials[parts[0]] = true;
                finals[parts.slice(1).join('+')] = true;
            });
        });
        inventory = {
            initials: Object.keys(initials).sort(function (a, b) { return b.length - a.length; }),
            finals: finals,
        };
        return inventory;
    }

    /** Splits a letters-only stored syllable ("ngiong") into [initial, final],
     *  longest initial first; null when it isn't a known combination. */
    function splitSyllable(letters) {
        var inv = getInventory();
        for (var n = 0; n < inv.initials.length; n++) {
            var i = inv.initials[n];
            if (letters.indexOf(i) !== 0) continue;
            var f = letters.slice(i.length);
            if (inv.finals[f]) return [i, f];
        }
        return null;
    }

    var SUPERSCRIPT_DIGITS = { '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6' };

    /** Converts a stored pinyin string such as "ba1ba1", "ba¹ba¹" (what
     *  Python's Pronunciation.pinyin() returns), "ngai2 / ngoi2" or "zi3?"
     *  syllable by syllable; anything it can't parse (punctuation, "?",
     *  unknown spellings) is left untouched. */
    function fromPinyin(text, systemId) {
        if (!config) return text;
        return String(text || '').replace(/([a-zü]+)([1-6¹²³⁴⁵⁶]?)/gi, function (whole, letters, tone) {
            var parts = splitSyllable(letters.toLowerCase());
            return parts ? convert(parts[0], parts[1], SUPERSCRIPT_DIGITS[tone] || tone, systemId) : whole;
        });
    }

    /** Rewrites every element carrying a stored pinyin in `data-py` (see
     *  Pronunciation.span()) in the current system. Runs on every switch,
     *  so JS-rendered content that isn't re-rendered still follows it. */
    function refresh(root) {
        var scope = root || (typeof document !== 'undefined' ? document : null);
        if (!config || !scope) return;
        scope.querySelectorAll('[data-py]').forEach(function (el) {
            el.textContent = fromPinyin(el.getAttribute('data-py'));
        });
    }

    /** Display pinyin for a Dictionary word dataset (data-initials /
     *  data-finals / data-tones, space-terminated per syllable -- see
     *  components/data.html), falling back to parsing data.pinyin. */
    function fromDataset(data, systemId) {
        if (!data) return '';
        if (data.initials !== undefined && data.finals !== undefined) {
            var is = String(data.initials).split(' ');
            var fs = String(data.finals).split(' ');
            var ts = String(data.tones || '').split(' ');
            // Each syllable ends with a space, so the last element is the empty tail.
            is.pop(); fs.pop(); ts.pop();
            if (is.length && is.length === fs.length) {
                return is.map(function (i, n) { return convert(i, fs[n], ts[n] || '', systemId); }).join('');
            }
        }
        return fromPinyin(data.pinyin || '', systemId);
    }

    // -----------------------------------------------------------------
    // Input: typing in another system. The lexicon is stored in the
    // default system (Wenfa), so a typed syllable is converted back into
    // the stored (initial, final, tone) candidates it can stand for. This
    // is the forward mapping run backwards over every initial x final the
    // system knows: no extra table to maintain. Several stored syllables
    // can share one spelling (ts'am <- cam / cham): all are returned.
    // -----------------------------------------------------------------

    var SUPERSCRIPT_TO_DIGIT = { '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8' };

    /** Spelling as typed on a plain keyboard: no diacritics, ŋ/ε/ɔ/š
     *  spelled ng/e/o/s, one kind of apostrophe, lower case. */
    function foldSpelling(text) {
        return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/ŋ/g, 'ng').replace(/ε/g, 'e').replace(/ɔ/g, 'o').replace(/š/g, 's')
            .replace(/’/g, "'").toLowerCase();
    }

    function storedSystem() {
        return config ? config.default_system : null;
    }

    function reverseIndex(systemId) {
        if (reverseIndexes[systemId]) return reverseIndexes[systemId];
        var system = getSystem(systemId);
        var index = {};
        var initials = Object.keys(system.initials || {});
        var finals = Object.keys(system.finals || {});
        Object.keys(pub(system.syllables)).forEach(function (k) {
            var parts = k.split('+');
            if (initials.indexOf(parts[0]) === -1) initials.push(parts[0]);
            if (finals.indexOf(parts.slice(1).join('+')) === -1) finals.push(parts.slice(1).join('+'));
        });
        initials.forEach(function (i) {
            finals.forEach(function (f) {
                if (!i && !f) return;
                var key = foldSpelling(convert(i, f, '', systemId));
                (index[key] = index[key] || []).push([i, f]);
            });
        });
        // Spellings attested in the source for a stored syllable but not
        // produced by the mapping (lexical splits: Wenfa z -> McIver ts or
        // ch), so typing them still finds the character.
        var attested = pub(system.input_syllables);
        Object.keys(attested).forEach(function (spelling) {
            var key = foldSpelling(spelling);
            attested[spelling].forEach(function (stored) {
                var parts = stored.split('+');
                var pair = [parts[0], parts.slice(1).join('+')];
                var list = (index[key] = index[key] || []);
                if (!list.some(function (p) { return p[0] === pair[0] && p[1] === pair[1]; })) list.push(pair);
            });
        });
        reverseIndexes[systemId] = index;
        return index;
    }

    /** Stored tones a typed tone digit can stand for in `systemId`: the
     *  system's `input_tones` when given (hand-tuned or derived, e.g. for
     *  Bao'an where tones are lexical), else the exact reverse of its
     *  `tones` map. */
    function storedTones(digit, systemId) {
        var system = getSystem(systemId);
        var explicit = pub(system.input_tones);
        if (Object.prototype.hasOwnProperty.call(explicit, digit)) return explicit[digit].slice();
        return exactStoredTones(digit, systemId);
    }

    /** Stored tones whose display in `systemId` is exactly `digit` (the
     *  reverse of its `tones` map, ignoring `input_tones`): for Bao'an
     *  ³ -> ["3"] although typing 3 also finds Wenfa 4 -- i.e. the most
     *  likely stored tone, used to pick one when a choice must be made. */
    function exactStoredTones(digit, systemId) {
        var system = getSystem(systemId);
        var tones = Object.assign({}, pub(config.tones), pub(system.tones));
        return Object.keys(tones).filter(function (t) {
            if (!t) return false;
            var out = String(tones[t]);
            return out === digit || (SUPERSCRIPT_TO_DIGIT[out] || '') === digit;
        });
    }

    /** One syllable typed in `systemId` ("ts'am1", "ngai_", "pɑ") -> the
     *  stored readings it can stand for: [{initial, final, tones}], where
     *  `tones` is null when no tone was typed (any tone). */
    function toStored(typed, systemId) {
        if (!config || !getSystem(systemId)) return [];
        var m = String(typed || '').match(/^([\s\S]*?)([_0-8¹²³⁴⁵⁶⁷⁸]?)$/);
        var letters = m[1];
        var digit = SUPERSCRIPT_TO_DIGIT[m[2]] || m[2];
        var tones = digit && digit !== '_' ? storedTones(digit, systemId) : null;
        return (reverseIndex(systemId)[foldSpelling(letters)] || []).map(function (pair) {
            return { initial: pair[0], final: pair[1], tones: tones };
        });
    }

    /** A typed syllable -> stored candidates, whatever system it's typed
     *  in: split directly when typed in the stored notation itself
     *  ("cam1" -> c + am, tone 1), else toStored(). */
    function typedToStored(typed, systemId) {
        if (!config) return [];
        if (systemId !== storedSystem()) return toStored(typed, systemId);
        var m = String(typed || '').match(/^([\s\S]*?)([_0-8]?)$/);
        var parts = splitSyllable(foldSpelling(m[1]));
        if (!parts) return [];
        return [{ initial: parts[0], final: parts[1], tones: m[2] && m[2] !== '_' ? [m[2]] : null }];
    }

    /** A reading from an external source written in `systemId`'s spelling
     *  (the Bao'an dictionary: "tsai", tone 3) -> its stored-notation
     *  equivalents, so it can be found by typing Wenfa. Falls back to
     *  reading the spelling as stored notation when the mapping has no
     *  inverse for it (Bao'an keeps the i of ngiet, which Wenfa -> Bao'an
     *  drops), keeping the source tone if it has no mapping either. */
    function sourceToStored(syllable, tone, systemId) {
        if (!config || !getSystem(systemId)) return [];
        tone = tone === undefined || tone === null ? '' : String(tone);
        var found = toStored(syllable + tone, systemId).filter(function (c) { return !c.tones || c.tones.length; });
        if (found.length) return found;
        var parts = splitSyllable(foldSpelling(syllable));
        if (!parts) return [];
        var tones = tone ? storedTones(tone, systemId) : null;
        return [{ initial: parts[0], final: parts[1], tones: tones && tones.length ? tones : (tone ? [tone] : null) }];
    }

    function inputSystem() {
        if (inputSetting === 'auto') return current;
        return getSystem(inputSetting) ? inputSetting : storedSystem();
    }

    function setInput(setting) {
        inputSetting = setting === 'auto' || getSystem(setting) ? setting : null;
        inputMenus.forEach(function (m) { m.value = inputSetting || storedSystem(); });
        if (typeof document === 'undefined') return;
        try { localStorage.setItem(INPUT_STORAGE_KEY, inputSetting); } catch (e) { /* private mode */ }
        document.dispatchEvent(new CustomEvent('romanization-input-change', { detail: { system: inputSystem() } }));
    }

    /** The "Saisie en…" menu of the converter/transcriber pages. */
    function bindInputMenu(menu) {
        if (!menu || !config) return;
        inputMenus.push(menu);
        menu.value = inputSetting || storedSystem();
        menu.addEventListener('change', function () { setInput(menu.value); });
    }

    function set(id) {
        if (!getSystem(id) || id === current) return;
        current = id;
        displayMenus.forEach(function (m) { m.value = id; });
        if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('data-rom', id);
            try { localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* private mode */ }
            refresh();
            document.dispatchEvent(new CustomEvent('romanization-change', { detail: { system: id } }));
        }
    }

    /** Reads the embedded config and restores the saved choice. Called from
     *  base.html's <head>, before first paint. */
    function init() {
        var el = document.getElementById('romanization-config');
        if (!el) return api;
        load(JSON.parse(el.textContent));
        var saved = null;
        try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* private mode */ }
        if (saved && getSystem(saved)) current = saved;
        var savedInput = null;
        try { savedInput = localStorage.getItem(INPUT_STORAGE_KEY); } catch (e) { /* private mode */ }
        if (savedInput === 'auto' || getSystem(savedInput)) inputSetting = savedInput;
        document.documentElement.setAttribute('data-rom', current);
        return api;
    }

    function bindMenu(menu) {
        refresh(); // [data-py] rendered before the saved choice was known
        if (!menu || !config) return;
        displayMenus.push(menu);
        menu.value = current;
        menu.addEventListener('change', function () { set(menu.value); });
    }

    var api = {
        load: load,
        init: init,
        bindMenu: bindMenu,
        set: set,
        current: function () { return current; },
        label: function (id) { var s = getSystem(id); return s ? s.label : id; },
        systems: function () { return config ? config.systems : []; },
        version: function () { return config ? config._version : ''; },
        convert: convert,
        splitSyllable: splitSyllable,
        fromPinyin: fromPinyin,
        refresh: refresh,
        fromDataset: fromDataset,
        storedSystem: storedSystem,
        foldSpelling: foldSpelling,
        toStored: toStored,
        typedToStored: typedToStored,
        sourceToStored: sourceToStored,
        exactStoredTones: exactStoredTones,
        inputSystem: inputSystem,
        inputSetting: function () { return inputSetting; },
        setInput: setInput,
        bindInputMenu: bindInputMenu,
    };
    return api;
})();
