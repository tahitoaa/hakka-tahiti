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
        this.pronunciations = this.pronItems.map(el => this.parsePronunciation(el));
        this.unknowns = new Set();
        this.wordItems = Array.from(document.querySelectorAll(`#word-list > ${itemSelector}`))
        this.words = this.wordItems.map(el => new Word(el.dataset));
        // 'wenfa': Supabase lexicon (the default); 'source': an external
        // pronunciation list in its own notation, see useSource().
        this.notation = 'wenfa';
        this.dbPronunciations = this.pronunciations;
        this.dbWords = this.words;
    }

    /** Swaps the whole dictionary to another pronunciation source, or back
     *  to the Supabase lexicon with `useSource(null)`. An external source
     *  has no words (only character readings), so word matching is off and
     *  every hanzi is resolved character by character. */
    useSource(pronunciations, { system = null } = {}) {
        this.unknowns.clear();
        this.sourceIndex = null;
        if (!pronunciations) {
            this.pronunciations = this.dbPronunciations;
            this.words = this.dbWords;
            this.notation = 'wenfa';
            this.sourceSystem = null;
            return;
        }
        this.pronunciations = pronunciations;
        this.words = [];
        this.notation = 'source';
        // Transcription system (romanization.json id) the source is spelled
        // in, when there is one: lets it be typed in Wenfa too, see
        // getSourceMatchesForStored().
        this.sourceSystem = system;
    }

    /** External-source readings for stored-notation candidates (typed in
     *  Wenfa, or converted to it by Romanization.typedToStored): each
     *  source reading is mapped once to its Wenfa equivalents
     *  (Romanization.sourceToStored, e.g. Bao'an tsai3 -> zai/zhai/jai in
     *  tone 3 or 4), and matches when initial/final agree and the tones
     *  overlap (typed tone null = any). */
    getSourceMatchesForStored(candidates) {
        if (!candidates?.length || !this.sourceSystem || typeof Romanization === 'undefined') return [];
        if (!this.sourceIndex) {
            this.sourceIndex = new Map();
            this.pronunciations.forEach((pron) => {
                Romanization.sourceToStored(pron.initial + pron.final, pron.tone, this.sourceSystem).forEach((c) => {
                    const key = `${c.initial}|${c.final}`;
                    if (!this.sourceIndex.has(key)) this.sourceIndex.set(key, []);
                    this.sourceIndex.get(key).push({ pron, tones: c.tones });
                });
            });
        }
        const found = new Set();
        candidates.forEach((c) => {
            (this.sourceIndex.get(`${c.initial}|${c.final}`) || []).forEach((entry) => {
                if (!c.tones || !entry.tones || entry.tones.some((t) => c.tones.includes(t))) found.add(entry.pron);
            });
        });
        return [...found];
    }

    /** The Wenfa reading to pin in the text for a picked pronunciation:
     *  pinned readings (生(sen1)) are always written in the stored notation,
     *  whatever the source of the suggestions. A lexicon reading is already
     *  Wenfa. A reading of the external dictionary (Bao'an ka¹) is mapped to
     *  its Wenfa equivalents and one is chosen, in this order:
     *    1. a reading the Wenfa lexicon has for this very character;
     *    2. the syllable as typed (`typed`, in `inputSystem`), if it fits;
     *    3. the mapping's most likely equivalent (its exact tone first).
     *  Falls back to the source spelling only if nothing maps at all. */
    wenfaReadingFor(pron, typed = '', inputSystem = null) {
        const stored = (i, f, t) => `${i}${f}${t ?? ''}`;
        const R = typeof Romanization !== 'undefined' ? Romanization : null;
        if (this.notation !== 'source' || !this.sourceSystem || !R?.systems().length) {
            return stored(pron.initial, pron.final, pron.tone);
        }
        const tone = String(pron.tone ?? '');
        const candidates = R.sourceToStored(pron.initial + pron.final, tone, this.sourceSystem);
        if (!candidates.length) return stored(pron.initial, pron.final, tone);
        const fits = (i, f, t) => candidates.some((c) => c.initial === i && c.final === f && (!c.tones || c.tones.includes(t)));
        const typedCandidates = typed ? R.typedToStored(typed, inputSystem || R.storedSystem()) : [];
        const wasTyped = (i, f, t) => typedCandidates.some((c) => c.initial === i && c.final === f && (!c.tones || c.tones.includes(t)));

        // 1. The lexicon's own reading of this character.
        const sameChar = (p) => [p.simp, p.trad].some((h) => h && (h === pron.simp || h === pron.trad));
        const lexicon = (this.dbPronunciations || []).filter((p) => sameChar(p) && fits(p.initial, p.final, String(p.tone ?? '')));
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
        const likely = R.exactStoredTones(tone, this.sourceSystem);
        const t = likely.find((x) => !c.tones || c.tones.includes(x)) || c.tones?.[0] || tone;
        return stored(c.initial, c.final, t);
    }

    /** Readings of the external dictionary for `char` that a pinned Wenfa
     *  reading stands for (家 + "ga1" -> ka¹): how a Wenfa annotation is
     *  shown while the page displays the dictionary's own notation. */
    sourceReadingsFor(char, wenfaReading) {
        const R = typeof Romanization !== 'undefined' ? Romanization : null;
        if (this.notation !== 'source' || !this.sourceSystem || !R?.systems().length) return [];
        const [w] = R.typedToStored(wenfaReading, R.storedSystem());
        if (!w) return [];
        return this.pronunciations.filter((p) => (p.simp === char || p.trad === char)
            && R.sourceToStored(p.initial + p.final, p.tone, this.sourceSystem).some((c) =>
                c.initial === w.initial && c.final === w.final
                && (!c.tones || !w.tones || c.tones.some((t) => w.tones.includes(t)))));
    }

    /** Fetches the compact Bao'an dictionary file written by
     *  `manage.py build_dict_index`: rows of [trad, syllable, tone, simp?]. */
    static async fetchSourcePronunciations(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        const data = await response.json();
        const prons = data.prons.map(([trad, syllable, tone, simp]) =>
            new SourcePronunciation({ trad, simp: simp || trad, syllable, tone }));
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
            const exists = this.pronunciations.some(p =>
                p.simp === newPron.simp &&
                p.trad === newPron.trad &&
                p.initial === newPron.initial &&
                p.final === newPron.final &&
                p.tone === newPron.tone
            );
            if (!exists) {
                this.pronunciations.push(newPron);
            }
        });
    }

    /** Pronunciations for stored-notation candidates, as returned by
     *  Romanization.toStored() for a syllable typed in another system:
     *  [{initial, final, tones}] (tones null = any tone). */
    getMatchesForStored(candidates) {
        if (!candidates?.length) return [];
        return this.pronunciations.filter(p => candidates.some(c =>
            p.initial === c.initial && p.final === c.final
            && (!c.tones || c.tones.includes(String(p.tone ?? '')))
        ));
    }

    getMatchesForSyllable(syl) {
        return this.pronunciations.filter(p => {
            const pinyin = p.abstractPinyin();
            const lowerTone = p.initial + p.final + p.tone;
            return syl == [p.initial, p.final].join('') 
                    // || syl == [p.initial+'h', p.final].join('') 
                    // || syl == [p.initial.replace('h',''), p.final].join('') 
                    || syl == pinyin
                    || syl == lowerTone
                    || p.simp === syl
                    || p.trad === syl 
                    ; 
        });
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