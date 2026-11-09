/* The (auto) lines of a transcript (see transcripter.js), and the readings
   still to choose in it.

   A transcript mixes, word by word (separated by spaces):
   - characters, with pinned readings: 吾(nga1) 爸爸，
   - syllables not converted yet, recognised by their tone (kiu3, shin_);
   - words that have no characters -- French, proper names (Raiatea, c'est):
     no tone, no character. They are copied as written in every line.

   TranscriptLines.derive(dico, text) ->
     { pinyin, hanzi (simplified), trad (traditional), mixed }
   TranscriptLines.ambiguous(dico, text) ->
     [{ char, pos, readings: ["go4", "guo4"] }]: characters read several ways
     with no reading pinned yet; pin(text, pos, reading) writes the choice. */
class TranscriptLines {
    static HAN = /\p{Script=Han}/u;
    static TONE = /[\d_⁰¹²³⁴⁵⁶⁷⁸]/;
    static LETTER = /\p{L}/u;
    static SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸';

    /** A word with no characters and no tone: French, a proper name. */
    static isTextWord(token) {
        return TranscriptLines.LETTER.test(token) && !TranscriptLines.HAN.test(token)
            && !TranscriptLines.TONE.test(token) && !token.includes('(');
    }

    /** « 佢看shin_ » -> ["佢看", "shin_"]; a pinned reading stays with its
     *  characters, a :constraint keeps the token whole. */
    static parts(token) {
        if (token.includes(':')) return [token];
        return [...token.matchAll(/(?:\p{Script=Han}|\([^()]*\)|-)+|[^\p{Script=Han}()]+/gu)].map((m) => m[0]);
    }

    /** {simp char -> trad char, trad char -> simp char} from the readings in use. */
    static charForms(dico) {
        const list = dico.pronunciations || dico.lexiconPronunciations || [];
        if (TranscriptLines._forms?.list !== list) {
            const toTrad = new Map();
            const toSimp = new Map();
            list.forEach((p) => {
                if (!p.simp || !p.trad) return;
                if (!toTrad.has(p.simp)) toTrad.set(p.simp, p.trad);
                if (!toSimp.has(p.trad)) toSimp.set(p.trad, p.simp);
            });
            TranscriptLines._forms = { list, toTrad, toSimp };
        }
        return TranscriptLines._forms;
    }

    static convert(text, map) {
        return [...String(text || '')].map((c) => map.get(c) || c).join('');
    }

    /** One part of a word in the three forms; `null` for a syllable left to convert. */
    static readPart(dico, part) {
        const forms = TranscriptLines.charForms(dico);
        if (!TranscriptLines.HAN.test(part) && part !== '-' && !part.startsWith('-(')) {
            const sentence = new Sentence(dico, '');
            return { pinyin: sentence.displayPinyin(part), simp: '', trad: '' };
        }
        const sentence = new Sentence(dico, part);
        const best = sentence.matches[0]?.[0];
        const data = best?.dataset || best || {};
        const typed = sentence.parseToken(part).hanzi;
        const known = best && !best.isUnknown;
        const simp = known && data.simp ? data.simp : typed;
        return {
            pinyin: sentence.renderDisplayPinyinLine(),
            simp: TranscriptLines.convert(simp, forms.toSimp),
            trad: known && data.trad ? data.trad : TranscriptLines.convert(TranscriptLines.convert(typed, forms.toSimp), forms.toTrad),
        };
    }

    static derive(dico, text) {
        const lines = { pinyin: [], simp: [], trad: [] };
        // Added to a line: text words stand apart, characters follow each other, punctuation sticks.
        const add = (key, value, kind) => {
            if (!value) return;
            const line = lines[key];
            const last = line[line.length - 1];
            const glued = kind === 'punct' || (key !== 'pinyin' && kind === 'han' && (last?.kind === 'han' || last?.kind === 'punct'));
            if (last && glued) { last.value += value; if (kind !== 'punct') last.kind = kind; } else line.push({ value, kind });
        };
        // One mark in the transcript: the Latin one in the pinyin, the Chinese one in the characters.
        const punct = (mark) => {
            add('pinyin', Sentence.latinPunct(mark), 'punct');
            add('simp', Sentence.hanPunct(mark), 'punct');
            add('trad', Sentence.hanPunct(mark), 'punct');
        };

        String(text || '').split('\n').forEach((row) => {
            // A «…» block is one word, written as is (Sentence.splitWords).
            Sentence.splitWords(row).forEach((raw) => {
                const token = raw.replace(/\*/g, '');
                if (!token) return;
                const [core, tail] = Sentence.splitPunct(token);
                const block = Sentence.textBlock(core);
                if (block !== null || TranscriptLines.isTextWord(core)) {
                    const text = block !== null ? block : core;
                    if (!text) { if (tail) punct(tail); return; }
                    add('pinyin', text.replace(/[，。、；：？！]/g, (m) => `${Sentence.latinPunct(m)} `), 'text');
                    const han = text.replace(/[,;?!]/g, (m) => Sentence.hanPunct(m));
                    add('simp', han, 'text');
                    add('trad', han, 'text');
                } else if (core) {
                    TranscriptLines.parts(core).forEach((part) => {
                        const read = TranscriptLines.readPart(dico, part);
                        add('pinyin', read.pinyin, 'hak');
                        add('simp', read.simp, 'han');
                        add('trad', read.trad, 'han');
                    });
                }
                if (tail) punct(tail);
            });
        });
        const join = (key) => lines[key].map((x) => x.value).join(' ').trim();
        const pinyin = join('pinyin');
        const hanzi = join('simp');
        const trad = join('trad');
        return { pinyin, hanzi, trad, mixed: pinyin === hanzi ? pinyin : [pinyin, hanzi].filter(Boolean).join(' ') };
    }

    /** Every reading of each character of `token` (one Set per slot of its
     *  hanzi): from the lexicon words spelled so, else the character's own. */
    static options(dico, sentence, hanzi, constraints, pins) {
        const chars = [...hanzi];
        const words = sentence.findMatches(hanzi, constraints, pins)
            .map((w) => Sentence.wordSyllables(w.dataset || w)).filter((s) => s.length === chars.length);
        return chars.map((char, k) => {
            if (words.length) return new Set(words.map((s) => TranscriptLines.digits(s[k])));
            if (!TranscriptLines.HAN.test(char)) return new Set();
            return new Set(dico.getMatchesForHanzi(char)
                .map((p) => (p.storedPinyin ? p.storedPinyin() : p.abstractPinyin?.()))
                .filter(Boolean).map(TranscriptLines.digits));
        });
    }

    static digits(pinyin) {
        return String(pinyin || '').replace(/[⁰¹²³⁴⁵⁶⁷⁸]/g, (c) => String(TranscriptLines.SUPERSCRIPTS.indexOf(c)));
    }

    static ambiguous(dico, text) {
        const out = [];
        const sentence = new Sentence(dico, '');
        for (const m of String(text || '').matchAll(/\S+/g)) {
            if (!TranscriptLines.HAN.test(m[0])) continue;
            const offset = m.index;
            // Each run of characters of the word, on its own (« 佢看shin_ »).
            let at = 0;
            TranscriptLines.parts(m[0]).forEach((part) => {
                const start = m[0].indexOf(part, at);
                at = start + part.length;
                if (!TranscriptLines.HAN.test(part)) return;
                const clean = Sentence.splitPunct(part)[0].split(':')[0];
                const { hanzi, constraints } = sentence.parseToken(Sentence.splitPunct(part)[0]);
                const pins = Sentence.pinnedReadings(clean);
                const options = TranscriptLines.options(dico, sentence, hanzi, constraints, pins);
                // Walk the text to know where each character stands.
                let k = 0;
                for (const c of clean.matchAll(/\(([^()]*)\)|([\s\S])/gu)) {
                    if (c[2] === undefined) continue;
                    if (TranscriptLines.HAN.test(c[2]) && !pins[k] && options[k]?.size > 1) {
                        out.push({ char: c[2], pos: offset + start + c.index, readings: [...options[k]] });
                    }
                    k++;
                }
            });
        }
        return out;
    }

    /** The reading written right after the character at `pos`: 把(ba3). */
    static pin(text, pos, reading) {
        const char = [...text.slice(pos)][0];
        if (!char || !TranscriptLines.HAN.test(char)) return text;
        const after = pos + char.length;
        return `${text.slice(0, after)}(${reading})${text.slice(after)}`;
    }
}
