class Pronunciation {
    // 7/8: entering tones of the Bao'an dictionary notation (SourcePronunciation).
    static toneMap = {"1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "":""};

    constructor ({simp, trad, initial, final, tone}){
        this.simp = simp;
        this.trad = trad;
        this.initial = initial;
        this.final = final;
        this.tone = tone;
        this.origin = "lexique-wenfa"
    }

    abstractPinyin() {
        return this.initial + this.final + (Pronunciation.toneMap[this.tone] ?? this.tone ?? '');
    }

    /** This reading in the stored notation (Wenfa): what pinned readings,
     *  pinyin lines and comparisons use. A lexicon reading already is. */
    storedPinyin() {
        return this.abstractPinyin();
    }

    /** Same, as a plain key ("sen1"), to compare readings across sources. */
    storedKey() {
        return `${this.initial}${this.final}${this.tone ?? ''}`;
    }

    // -----------------------------------------------------------------
    // Display, in the transcription system picked in the header menu.
    //
    // These static helpers are the one entry point every page's JS should
    // use to *show* pinyin (Romanization.js does the conversion from
    // romanization.json). Anything compared, matched or exported keeps the
    // stored Wenfa notation instead: abstractPinyin(),
    // Sentence.renderPinyinLine(), the `pinyin` fields of API payloads.
    // Without Romanization loaded (unit tests, pages not extending
    // base.html) they fall back to the stored notation, tones superscripted.
    // -----------------------------------------------------------------

    static romanizationActive() {
        return typeof Romanization !== 'undefined' && Romanization.systems().length > 0;
    }

    /** One stored syllable -> display text. */
    static format(initial, final, tone) {
        if (Pronunciation.romanizationActive()) return Romanization.convert(initial, final, tone);
        return (initial || '') + (final || '') + (Pronunciation.toneMap[tone ?? ''] ?? tone ?? '');
    }

    /** A stored pinyin string ("ba1ba1", "ba¹ba¹", "ngai2 / ngoi2"...) ->
     *  display text; whatever isn't a stored syllable is kept as is. */
    static formatStored(stored) {
        if (Pronunciation.romanizationActive()) return Romanization.fromPinyin(stored);
        return String(stored ?? '').replace(/[1-8]/g, (d) => Pronunciation.toneMap[d]);
    }

    /** Same as formatStored(), as HTML that follows later switches of the
     *  header menu on its own (Romanization.refresh() rewrites every
     *  [data-py] element) -- for content that isn't re-rendered on change.
     *  Don't use it where the text gets copied/exported as plain text. */
    static span(stored, className = '') {
        const attr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const cls = className ? ` class="${attr(className)}"` : '';
        return `<span${cls} data-py="${attr(stored)}">${attr(Pronunciation.formatStored(stored))}</span>`;
    }

    /** Display form of this reading (see format()). */
    displayPinyin() {
        return Pronunciation.format(this.initial, this.final, this.tone);
    }

    /** Self-updating HTML for this reading (see span()). */
    pinyinSpan(className = '') {
        return Pronunciation.span(this.initial + this.final + (this.tone ?? ''), className);
    }

    diacriticsPinyin() {
        const pron =  this.initial + this.final + this.tone;

        return pron.replace(
            /(\D*[aeo]|\D*i(?=u\d)|\D*u(?=i\d)|\D*[iu]|\D*[mn])(\D*)(\d)/g,
            (_, nucleus, tail, tone) => {
                // Convert tone number (string) → integer index
                return nucleus +  " ́̄̆̀̆̀"[+tone] + tail + "\u{2009}";
            }
        );
    }

    char() {
        // hasAttribute() alone is wrong here: the button ships with
        // aria-pressed="false" already in the markup, so the attribute is
        // *present* (just false-valued) before any click -- checking only
        // for presence made this return trad by default, before the user
        // ever touched the toggle. Compare the value instead, and don't
        // assume the button exists (this class is also usable standalone).
        const toggle = typeof document !== 'undefined' ? document.getElementById('toggle-hanzi') : null;
        const showingTrad = toggle?.getAttribute('aria-pressed') === 'true';
        return (showingTrad && this.trad) ? this.trad : this.simp;
    }
}

/** A reading from an external source (the Bao'an dictionary index, see
 *  Dictionary.useSource()) rather than the Supabase lexicon: its syllable
 *  isn't split into Wenfa initial/final, so it's kept whole in `initial`
 *  and always shown in the source's own notation -- the header's
 *  transcription-system menu only knows how to convert Wenfa syllables. */
class SourcePronunciation extends Pronunciation {
    /** `system`: the romanization.json system the dictionary is spelled in
     *  ("baoan", "mciver"); `source`/`sourceLabel`: which dictionary. */
    constructor({simp, trad, syllable, tone, system = null, source = null, sourceLabel = null}) {
        super({simp, trad, initial: syllable, final: '', tone: String(tone ?? '')});
        this.origin = "hakka-dict-index";
        this.system = system;
        this.source = source;
        this.sourceLabel = sourceLabel;
    }

    /** Most likely Wenfa equivalent of this reading through the system's
     *  mapping ({initial, final, tone}), or null when it doesn't map.
     *  Dictionary.wenfaReadingFor() refines the choice when pinning (lexicon
     *  reading, what was typed); this is the context-free guess. */
    storedReading() {
        if (this._stored !== undefined) return this._stored;
        this._stored = null;
        if (typeof Romanization === 'undefined' || !this.system || !Romanization.systems().length) return null;
        const candidates = Romanization.sourceToStored(this.initial, this.tone, this.system);
        if (!candidates.length) return null;
        const c = candidates[0];
        const likely = Romanization.exactStoredTones(this.tone, this.system);
        const tone = likely.find((t) => !c.tones || c.tones.includes(t)) || c.tones?.[0] || '';
        this._stored = { initial: c.initial, final: c.final, tone };
        return this._stored;
    }

    storedPinyin() {
        const s = this.storedReading();
        return s ? s.initial + s.final + (Pronunciation.toneMap[s.tone] ?? s.tone) : this.abstractPinyin();
    }

    storedKey() {
        const s = this.storedReading();
        return s ? `${s.initial}${s.final}${s.tone}` : `${this.source || ''}:${this.initial}${this.tone}`;
    }

    /** Shown in the dictionary's own spelling when that's the displayed
     *  system, else its Wenfa equivalent converted to the displayed system
     *  (tones then follow the mapping, so they can be approximate). */
    displayPinyin() {
        const R = typeof Romanization !== 'undefined' && Romanization.systems().length ? Romanization : null;
        const stored = this.storedReading();
        if (!R || !stored || R.current() === this.system) return this.abstractPinyin();
        return Pronunciation.format(stored.initial, stored.final, stored.tone);
    }

    pinyinSpan(className = '') {
        const cls = className ? ` class="${className}"` : '';
        const title = `${this.sourceLabel || 'Dictionnaire'} : ${this.abstractPinyin()}`;
        return `<span${cls} title="${title.replace(/"/g, '&quot;')}">${this.displayPinyin()}</span>`;
    }
}

class NoHanziToken extends Pronunciation {
    constructor ({text}) {
        super({simp:text, trad:text, initial:"", final:"", tone:""})
        this.text = text;
    }

    abstractPinyin() {
        return this.text;
    }

    displayPinyin() {
        return this.text;
    }

    storedKey() {
        return this.text;
    }

    pinyinSpan() {
        return String(this.text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    }
}

class Punctuation extends NoHanziToken {
    constructor ({text}) {
        super({text});
    }
}

class UnknownHanzi extends Pronunciation {
    constructor ({initial, final, tone}) {
        super({simp:"", trad:"", initial:"", final:"", tone:""})
        this.text = text;
        this.simp = ["(",initial, final, tone, ")"].join('');
        this.trad = this.simp;
    }
}
