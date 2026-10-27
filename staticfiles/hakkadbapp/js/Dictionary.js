function isPunctuation(ch) {
    // This covers most ASCII punctuation
    return /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~、。]$/.test(ch);
}

function isHanzi(ch) {
    // Covers CJK Unified Ideographs, Extension A, and B (including \u3400-\u4DBF, \u4E00-\u9FFF, \u20000-\u2A6DF)
    return /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(ch);
}

class Dictionary {
    constructor ({containerId, itemSelector}) {
        this.pronItems = Array.from(document.querySelectorAll(`${containerId} > ${itemSelector}`));
        this.lexiconPronunciations = this.pronItems.map(el => this.parsePronunciation(el));
        this.unknowns = new Set();
        this.wordItems = Array.from(document.querySelectorAll(`#word-list > ${itemSelector}`))
        this.lexiconWords = this.wordItems.map(el => new Word(el.dataset));
        // Pronunciation sources in use: the Supabase lexicon (Wenfa, with
        // words and translations) and/or dictionary indexes, see useSources().
        this.useLexicon = true;
        this.sources = [];
        this.rebuild();
    }

    // Older names, kept for callers and tests.
    get dbPronunciations() { return this.lexiconPronunciations; }
    get dbWords() { return this.lexiconWords; }

    rebuild() {
        this.unknowns.clear();
        this.pronunciations = [
            ...(this.useLexicon ? this.lexiconPronunciations : []),
            ...this.sources.flatMap((s) => s.prons),
        ];
        // Words (and their translations) only exist in the lexicon.
        this.words = this.useLexicon ? this.lexiconWords : [];
    }

    /** Which pronunciations to use: the lexicon (`lexicon`) and/or
     *  dictionary indexes (`sources`: [{id, label, short, system, prons}],
     *  each spelled in a romanization.json system). Any combination works,
     *  "Toutes les sources" being the lexicon plus every dictionary. */
    useSources({ lexicon = true, sources = [] } = {}) {
        this.useLexicon = lexicon;
        this.sources = sources.map((s) => ({ ...s, index: null }));
        // Readings must know their source's system (display, Wenfa equivalent);
        // fetchSourcePronunciations() sets it, prons built elsewhere get it here.
        this.sources.forEach((source) => source.prons.forEach((p) => {
            if (p.system === null || p.system === undefined) p.system = source.system;
            if (!p.source) { p.source = source.id; p.sourceLabel = source.label; }
        }));
        this.rebuild();
    }

    /** Single-source shortcut: `null` = the lexicon alone, else one
     *  dictionary's readings (spelled in `system`) without the lexicon. */
    useSource(pronunciations, { system = null } = {}) {
        if (!pronunciations) this.useSources({ lexicon: true });
        else this.useSources({ lexicon: false, sources: [{ id: system || 'source', label: system || 'source', system, prons: pronunciations }] });
    }

    /** Suggestions for one typed syllable, from every source in use:
     *  [{pron, sources: [short labels]}]. `inputSystem` is the system the
     *  syllable is typed in ("Je tape en"). The lexicon is matched in Wenfa
     *  (converted back first when typed in another system); a dictionary is
     *  matched in its own spelling when typed in its system, else through
     *  the Wenfa equivalents of its readings. The same character with the
     *  same Wenfa reading from several sources is one suggestion. */
    suggestionsFor(syl, inputSystem = null) {
        const R = typeof Romanization !== 'undefined' && Romanization.systems().length ? Romanization : null;
        const typed = String(syl || '').replace(/’/g, "'");
        const plain = typed.split('_')[0];
        const stored = !R || !inputSystem || inputSystem === R.storedSystem();
        const found = [];
        if (this.useLexicon) {
            const prons = stored
                ? Dictionary.matchSpelling(this.lexiconPronunciations, plain)
                : this.lexiconMatchesForStored(R.toStored(typed, inputSystem));
            prons.forEach((pron) => found.push({ pron, source: 'L' }));
        }
        this.sources.forEach((source) => {
            const prons = !R || !source.system || inputSystem === source.system
                ? Dictionary.matchSpelling(source.prons, plain)
                : this.sourceMatchesForStored(source, R.typedToStored(typed, inputSystem || R.storedSystem()));
            prons.forEach((pron) => found.push({ pron, source: source.short || source.label }));
        });
        const merged = new Map();
        found.forEach(({ pron, source }) => {
            // simp + trad: 傢 and 家 share the simplified form but are two characters.
            const key = `${pron.simp}|${pron.trad}|${pron.storedKey ? pron.storedKey() : pron.abstractPinyin()}`;
            if (!merged.has(key)) merged.set(key, { pron, sources: [] });
            const entry = merged.get(key);
            if (!entry.sources.includes(source)) entry.sources.push(source);
        });
        return [...merged.values()];
    }

    /** Readings whose own spelling is `syl` (with or without tone). */
    static matchSpelling(prons, syl) {
        return prons.filter(p => {
            const pinyin = p.abstractPinyin();
            const lowerTone = p.initial + p.final + p.tone;
            return syl == [p.initial, p.final].join('')
                    || syl == pinyin
                    || syl == lowerTone
                    || p.simp === syl
                    || p.trad === syl;
        });
    }

    /** Lexicon readings for stored-notation candidates, as returned by
     *  Romanization.toStored() for a syllable typed in another system:
     *  [{initial, final, tones}] (tones null = any tone). */
    lexiconMatchesForStored(candidates) {
        if (!candidates?.length) return [];
        return this.lexiconPronunciations.filter(p => candidates.some(c =>
            p.initial === c.initial && p.final === c.final
            && (!c.tones || c.tones.includes(String(p.tone ?? '')))
        ));
    }

    /** A dictionary's readings for stored-notation candidates: each reading
     *  is mapped once to its Wenfa equivalents (Romanization.sourceToStored,
     *  e.g. Bao'an tsai3 -> zai/zhai/jai in tone 3 or 4), and matches when
     *  initial/final agree and the tones overlap (typed tone null = any). */
    sourceMatchesForStored(source, candidates) {
        if (!candidates?.length || !source.system || typeof Romanization === 'undefined') return [];
        if (!source.index) {
            source.index = new Map();
            source.prons.forEach((pron) => {
                Romanization.sourceToStored(pron.initial + pron.final, pron.tone, source.system).forEach((c) => {
                    const key = `${c.initial}|${c.final}`;
                    if (!source.index.has(key)) source.index.set(key, []);
                    source.index.get(key).push({ pron, tones: c.tones });
                });
            });
        }
        const found = new Set();
        candidates.forEach((c) => {
            (source.index.get(`${c.initial}|${c.final}`) || []).forEach((entry) => {
                if (!c.tones || !entry.tones || entry.tones.some((t) => c.tones.includes(t))) found.add(entry.pron);
            });
        });
        return [...found];
    }

    // Older entry points (tests, other callers): every source at once.
    getMatchesForStored(candidates) { return this.lexiconMatchesForStored(candidates); }
    getSourceMatchesForStored(candidates) { return this.sources.flatMap((s) => this.sourceMatchesForStored(s, candidates)); }
    getMatchesForSyllable(syl) { return Dictionary.matchSpelling(this.pronunciations, syl); }

    /** The Wenfa reading to pin in the text for a picked pronunciation:
     *  pinned readings (生(sen1)) are always written in the stored notation,
     *  whatever the source. A lexicon reading already is Wenfa. A dictionary
     *  reading (Bao'an ka¹) is mapped to its Wenfa equivalents and one is
     *  chosen, in this order:
     *    1. a reading the Wenfa lexicon has for this very character;
     *    2. the syllable as typed (`typed`, in `inputSystem`), if it fits;
     *    3. the mapping's most likely equivalent (its exact tone first).
     *  Falls back to the source spelling only if nothing maps at all. */
    wenfaReadingFor(pron, typed = '', inputSystem = null) {
        const stored = (i, f, t) => `${i}${f}${t ?? ''}`;
        const R = typeof Romanization !== 'undefined' ? Romanization : null;
        const system = pron.system;
        if (!system || !R?.systems().length) {
            return stored(pron.initial, pron.final, pron.tone);
        }
        const tone = String(pron.tone ?? '');
        const candidates = R.sourceToStored(pron.initial + pron.final, tone, system);
        if (!candidates.length) return stored(pron.initial, pron.final, tone);
        const fits = (i, f, t) => candidates.some((c) => c.initial === i && c.final === f && (!c.tones || c.tones.includes(t)));
        const typedCandidates = typed ? R.typedToStored(typed, inputSystem || R.storedSystem()) : [];
        const wasTyped = (i, f, t) => typedCandidates.some((c) => c.initial === i && c.final === f && (!c.tones || c.tones.includes(t)));

        // 1. The lexicon's own reading of this character.
        const sameChar = (p) => [p.simp, p.trad].some((h) => h && (h === pron.simp || h === pron.trad));
        const lexicon = this.lexiconPronunciations.filter((p) => sameChar(p) && fits(p.initial, p.final, String(p.tone ?? '')));
        if (lexicon.length) {
            const p = lexicon.find((q) => wasTyped(q.initial, q.final, String(q.tone ?? ''))) || lexicon[0];
            return stored(p.initial, p.final, p.tone);
        }

        // 2. What was typed, when it's a complete (toned) fitting reading.
        for (const c of typedCandidates) {
            if (c.tones?.length === 1 && fits(c.initial, c.final, c.tones[0])) return stored(c.initial, c.final, c.tones[0]);
        }

        // 3. Most likely equivalent: typed initial/final if they fit, then
        //    the exact reverse of the tone map, then any allowed tone.
        const c = candidates.find((x) => typedCandidates.some((y) => y.initial === x.initial && y.final === x.final)) || candidates[0];
        const likely = R.exactStoredTones(tone, system);
        const t = likely.find((x) => !c.tones || c.tones.includes(x)) || c.tones?.[0] || tone;
        return stored(c.initial, c.final, t);
    }

    /** Fetches a compact dictionary file written by `manage.py
     *  build_dict_index` (rows of [trad, syllable, tone, simp?]); its
     *  readings are tagged with the dictionary (`source`) they come from. */
    static async fetchSourcePronunciations(url, source = {}) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        const data = await response.json();
        const prons = data.prons.map(([trad, syllable, tone, simp]) => new SourcePronunciation({
            trad, simp: simp || trad, syllable, tone,
            system: source.system || null, source: source.id || null, sourceLabel: source.label || null,
        }));
        return { meta: data.meta || {}, prons };
    }

    parsePronunciation(el) {
        const parts = el.dataset.search?.toLowerCase().split(',') || [];
        return new Pronunciation({
            simp: parts[0],
            trad: parts[1],
            initial: parts[2],
            final: parts[3],
            tone:parts[4]
        });
    }

    addPronunciations(newProns){
        newProns.forEach(newPron => {
            const exists = this.lexiconPronunciations.some(p =>
                p.simp === newPron.simp &&
                p.trad === newPron.trad &&
                p.initial === newPron.initial &&
                p.final === newPron.final &&
                p.tone === newPron.tone
            );
            if (!exists) {
                this.lexiconPronunciations.push(newPron);
            }
        });
        this.rebuild();
    }

    getMatchesForHanzi(char) {
        if (!isHanzi(char)) {
            return [new NoHanziToken({text:char})]
        }
        if (isPunctuation(char)) {
            return [new Punctuation({text:char})]
        }
        if (!char || char.length !== 1 || !isHanzi(char)) {
            return [new NoHanziToken({text:char})]
        }
        const matches = this.pronunciations.filter(p => {
            return p.simp == char || p.trad == char;
        });

        if (matches.length == 0) this.unknowns.add(char);
        return matches;
    }

    async handleImportProns(event){
        if (!window.showDirectoryPicker) {
            alert("Your browser does not support the File System Access API required for folder picking.");
            return;
        }
        try {
            const dirHandle = await window.showDirectoryPicker();
            const pronunciations = [];
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && entry.name == 'prons.csv' ) {
                    const file = await entry.getFile();
                    const text = await file.text();
                    const lines = text.split('\n').filter(line => line.trim());
                    // Skip header if present
                    let start = 0;
                    if (lines[0].toLowerCase().includes('char') && lines[0].toLowerCase().includes('initial')) start = 1;
                    for (let i = start; i < lines.length; i++) {
                        const [char, initial, final, tone] = lines[i].split(',');
                        const p = new Pronunciation({ simp: char, trad: char, initial, final, tone })
                        console.log(p);
                        pronunciations.push(p);
                    }
                    this.addPronunciations(pronunciations);
                    alert(`Loaded ${pronunciations.length} pronunciations from folder.`);
                }
            }

        } catch (err) {
            console.error(err);
            alert("Failed to import pronunciations.");
        }
    }
}