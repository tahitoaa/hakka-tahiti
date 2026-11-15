/* =========================================================================
   SaisieEntry — a text in Sentence format (characters with pinned readings,
   syllables still to convert, «text» blocks, words separated by spaces)
   and what can be done to it: pick a suggestion, pin a reading, cut or
   join words, re-segment it after the lexicon. Shared by the Saisie form
   (Saisie.js) and the word boxes of every page that edits such a text
   (WordBoxes.js: Écrire, Transcrire, Expressions).
   ========================================================================= */

/** The form's content, without the page: text, readings, checks. */
class SaisieEntry {
    // A «text» block (group 1), a pending syllable (group 2, as
    // SyllableInputModel), whitespace (group 3), any other character
    // (group 4); comments, (pins) and :constraints are matched and skipped.
    static UNIT_RE = new RegExp(`(«[^»]*»?)|${SyllableInputModel.SYLLABLE_RE.source}|(\\s+)|([\\s\\S])`, 'gu');

    /** The lexicon readings of `char`: written so, else in another form
     *  of it (髮 for 发, 愛 for 爱: HanziForms.js). */
    static lexiconOf(list, char) {
        return (typeof HanziForms !== 'undefined' ? HanziForms.pick(list, char) : list.filter((p) => p.simp === char || p.trad === char));
    }

    /** Space-separated words, a «…» block being one (Sentence.splitWords). */
    static words(text) {
        return String(text || '').match(/«[^»]*»?\S*|\S+/gu) || [];
    }

    static isTextBlock(token) {
        return /^«[^»]*»?\S*$/u.test(String(token || ''));
    }

    /** The "Texte" button (Sentence.wrapText). */
    static wrapText(text, start, end) {
        return Sentence.wrapText(text, start, end);
    }

    constructor(dico) {
        this.dico = dico;
        this.model = new SyllableInputModel(dico);
        this.kind = 'word';
        this.setText('');
    }

    static romanization() {
        return typeof Romanization !== 'undefined' && Romanization.systems().length ? Romanization : null;
    }

    static inputSystem() {
        const R = SaisieEntry.romanization();
        return R ? R.inputSystem() : null;
    }

    /** Working text back from a stored addition: each word with its
     *  stored reading pinned (屋家(wuk5ka1)), so Sentence reads it as saved. */
    static textFromStored(hanzi, pinyin, kind, dico = null) {
        const plain = (t) => t.split(':')[0].replace(/\([^()]*\)/g, '');
        const hs = SaisieEntry.words(hanzi);
        const ps = SaisieEntry.words(pinyin);
        // With the lexicon: a word's reading is written only when the lexicon
        // can't give it by itself (a character with several readings, none,
        // or another one) -- same rule as picking a suggestion.
        const lexicon = dico?.lexiconPronunciations;
        const readingsOf = (char) => new Set(SaisieEntry.lexiconOf(lexicon, char)
            .map((p) => (p.storedKey ? p.storedKey() : `${p.initial}${p.final}${p.tone ?? ''}`)));
        const pinned = (word, reading) => {
            if (!lexicon) return `${word}(${reading})`;
            const chars = [...word];
            const syllables = String(reading).match(/[^\d\s]+\d?/g) || [];
            const clear = syllables.length === chars.length && chars.every((c, i) => {
                const rs = readingsOf(c);
                return rs.size === 1 && rs.has(syllables[i]);
            });
            return clear ? word : `${word}(${reading})`;
        };
        if (kind === 'word') {
            const h = hs.map(plain).join('');
            return ps.length ? pinned(h, ps.join('')) : h;
        }
        if (ps.length !== hs.length) return hs.join(' ');
        // A «…» block is stored as written, its own reading.
        return hs.map((h, i) => SaisieEntry.isTextBlock(h) ? h : `${pinned(plain(h), ps[i])}${h.includes(':') ? `:${h.split(':').slice(1).join(':')}` : ''}`).join(' ');
    }

    /** A word is one token whatever spaces were typed; an expression has
     *  one token per space-separated word. */
    sentenceText() {
        return this.kind === 'word' ? this.text.replace(/\s+/g, '') : this.text.trim();
    }

    setText(text, kind = this.kind) {
        this.kind = kind;
        this.model.parse(String(text || ''));
        this.text = this.model.text;
        this.sentence = typeof Sentence !== 'undefined' ? new Sentence(this.dico, this.sentenceText()) : null;
    }

    /** Typed syllables not converted yet. */
    get syllables() {
        return this.model.syllables;
    }

    /** Suggestions for one pending syllable, with their index in the
     *  model's list (what pick() takes). */
    suggestions(sylIndex) {
        return this.model.suggestions.map((s, index) => ({ ...s, index })).filter((s) => s.for === sylIndex);
    }

    /** A suggestion picked, exactly as on the "Écrire" page. */
    pick(index) {
        this.model.select(index);
        this.setText(this.model.text);
    }

    /** A character read several ways (ba3/pa3): its reading chosen, written
     *  in the text right after it -- 把(ba3) -- so it is the one saved. */
    pinAt(pos, reading) {
        const char = [...this.text.slice(pos)][0];
        if (!char || !/\p{Script=Han}/u.test(char)) return false;
        const after = pos + char.length;
        this.setText(`${this.text.slice(0, after)}(${reading})${this.text.slice(after)}`);
        return true;
    }

    /** Spaces put before the characters (or syllables) at text positions
     *  `positions`, all in one word: it becomes several. A reading pinned
     *  for several characters (屋家(wuk5ka1)) is first spread one per
     *  character, so each part keeps its own; a :sense stays at the end. */
    splitAt(positions) {
        const ps = [...new Set([].concat(positions))].sort((a, b) => a - b);
        const text = this.text;
        if (!ps.length) return false;
        let start = ps[0];
        while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
        let end = ps[0];
        while (end < text.length && !/\s/.test(text[end])) end += 1;
        if (ps.some((p) => p <= start || p >= end)) return false;
        const token = text.slice(start, end);
        const cut = token.indexOf(':');
        const base = cut === -1 ? token : token.slice(0, cut);
        const sense = cut === -1 ? '' : token.slice(cut);
        // One piece per character, its own reading pinned after it.
        const pieces = [];
        let run = [];
        const isRun = (ch) => ch === '-' || /\p{Script=Han}/u.test(ch);
        for (const m of base.matchAll(/\(([^()]*)\)|([\s\S])/gu)) {
            if (m[2] !== undefined) {
                pieces.push({ at: m.index, text: m[2] });
                if (isRun(m[2])) run.push(pieces.length - 1);
                else run = [];
                continue;
            }
            const syllables = m[1].match(/[a-zü][a-zü'’]*[0-8_]?/gi) || [];
            if (run.length > 1 && syllables.length) {
                // Fewer syllables than characters pin the last ones (Sentence.pinnedReadings).
                const targets = syllables.length < run.length ? run.slice(run.length - syllables.length) : run;
                targets.forEach((idx, k) => { pieces[idx].text += `(${syllables[k]})`; });
            } else if (pieces.length) {
                pieces[pieces.length - 1].text += m[0];
            } else {
                pieces.push({ at: m.index, text: m[0] });
            }
            run = [];
        }
        const cuts = new Set(ps.map((p) => p - start));
        const out = pieces.map((p, i) => `${i && cuts.has(p.at) ? ' ' : ''}${p.text}`).join('') + sense;
        this.setText(`${text.slice(0, start)}${out}${text.slice(end)}`);
        return true;
    }

    /** The spaces between text positions `from` and `to` removed: two
     *  words become one. */
    joinAt(from, to) {
        const mid = this.text.slice(from, to);
        if (!(from < to) || !/\s/.test(mid)) return false;
        this.setText(`${this.text.slice(0, from)}${mid.replace(/\s+/g, '')}${this.text.slice(to)}`);
        return true;
    }

    /** Where the lexicon's words start in a text of one word, longest
     *  first: 我爱屋家 -> before 爱 and before 屋. [] when there is nothing
     *  to cut (several words already, syllables still to convert). */
    lexiconCuts() {
        if (!this.sentence || /\s/.test(this.text.trim())) return [];
        const groups = this.units();
        if (groups.length !== 1 || groups[0].some((u) => u.type !== 'char')) return [];
        const units = groups[0];
        const isWord = (hanzi) => this.sentence.findMatches(hanzi, null, null).length > 0;
        const cuts = [];
        let i = 0;
        while (i < units.length) {
            let length = 1;
            for (let n = Math.min(6, units.length - i); n > 1; n -= 1) {
                if (isWord(units.slice(i, i + n).map((u) => u.char).join(''))) { length = n; break; }
            }
            i += length;
            if (i < units.length) cuts.push(units[i].pos);
        }
        return cuts;
    }

    /** No character for a pending syllable: it becomes a placeholder with
     *  its reading pinned, -(man4) (stored notation when the typed syllable
     *  converts to one), which the site reads as « unknown character ». */
    unknown(sylIndex) {
        const syl = this.model.syllables[sylIndex];
        if (syl === undefined) return false;
        const reading = this.readingFor('', syl) || String(syl).replace(/’/g, "'").toLowerCase();
        this.model.replace(sylIndex, `-(${reading})`);
        this.setText(this.model.text);
        return true;
    }

    /** A character typed for a pending syllable (one no source knows):
     *  written with its reading pinned, unless that is the character's
     *  only lexicon reading. False when the reading stays ambiguous. */
    type(sylIndex, char) {
        const syl = this.model.syllables[sylIndex];
        if (syl === undefined || !char) return false;
        const reading = this.readingFor(char, syl);
        if (!reading) return false;
        const known = new Set(this.dico.lexiconPronunciations
            .filter((p) => SaisieEntry.lexiconOf([p], char).length)
            .map((p) => `${p.initial}${p.final}${p.tone ?? ''}`));
        this.model.replace(sylIndex, known.size === 1 && known.has(reading) ? char : `${char}(${reading})`);
        this.setText(this.model.text);
        return true;
    }

    /** Stored (Wenfa) reading of `typed` for `char`: the lexicon's reading
     *  of that character when the typed syllable can stand for it, else
     *  the typed syllable's only stored equivalent; '' when it stays
     *  ambiguous. Typed in Wenfa, the syllable itself. */
    readingFor(char, typed) {
        const R = SaisieEntry.romanization();
        const system = SaisieEntry.inputSystem();
        const plain = String(typed || '').replace(/’/g, "'").toLowerCase();
        if (!R) return /[0-8]$/.test(plain) ? plain : '';
        const candidates = R.typedToStored(plain, system);
        if (char) {
            const fits = SaisieEntry.lexiconOf(this.dico.lexiconPronunciations, char).filter((p) => candidates.some((c) => c.initial === p.initial && c.final === p.final
                    && (!c.tones || c.tones.includes(String(p.tone ?? '')))));
            const exact = fits.find((p) => candidates.some((c) => c.tones?.length === 1 && c.tones[0] === String(p.tone ?? '')));
            const p = exact || (fits.length === 1 ? fits[0] : null);
            if (p) return `${p.initial}${p.final}${p.tone ?? ''}`;
        }
        if (candidates.length === 1 && candidates[0].tones?.length === 1) {
            return `${candidates[0].initial}${candidates[0].final}${candidates[0].tones[0]}`;
        }
        // Wenfa spelling the inventory doesn't split: kept as typed.
        if (system === R.storedSystem() && !candidates.length && /[0-8]$/.test(plain)) return plain;
        return '';
    }

    /** The words as Sentence reads them: [{token, hanzi (maillage token,
     *  pins removed), pinyin (stored notation, tone digits), pending, match}]. */
    tokens() {
        if (!this.sentence) return [];
        // A character's own reading comes with superscript tones (ngai¹).
        const digits = (p) => String(p || '').replace(/[¹²³⁴⁵⁶⁷⁸]/g, (c) => String('¹²³⁴⁵⁶⁷⁸'.indexOf(c) + 1));
        return this.sentence.words.map((token, i) => {
            const best = this.sentence.matches[i]?.[0];
            const data = best?.dataset || best || {};
            const known = best && !best.isUnknown;
            const pending = [...token.matchAll(SyllableInputModel.SYLLABLE_RE)].some((m) => m[1]);
            if (best?.isText) {
                // «ma'a tinito»: stored as typed in both fields.
                const [core, tail] = Sentence.splitPunct(token);
                const block = `«${Sentence.textBlock(core)}»`;
                return { token, hanzi: `${block}${tail}`, plain: Sentence.textBlock(core), text: true,
                    pinyin: `${block}${Sentence.latinPunct(tail)}`, pending: false, match: null };
            }
            return {
                token,
                hanzi: token.replace(/\([^()]*\)/g, ''),
                plain: this.sentence.parseToken(token).hanzi,
                pinyin: `${digits(known ? (Sentence.wordSyllables(data).join('') || data.pinyin) : this.sentence.resolveUnknownPinyin(token))}${Sentence.latinPunct(Sentence.splitPunct(token)[1])}`,
                pending,
                match: known ? data : null,
            };
        });
    }

    /** Stored shape: a word's hanzi as one block, an expression's as its
     *  maillage (one space-separated token per word), pinyin in Wenfa. */
    values() {
        const tokens = this.tokens();
        return {
            kind: this.kind,
            hanzi: tokens.map((t) => t.hanzi).join(' '),
            pinyin: tokens.map((t) => t.pinyin).join(' '),
        };
    }

    /** The mixed line, as the transcriber's Mixed tier: the pinyin (in the
     *  "J'affiche en" system) then the hanzi. */
    mixed() {
        if (!this.sentence || !this.sentence.words.length) return { pinyin: '', hanzi: '' };
        return { pinyin: this.sentence.renderDisplayPinyinLine(), hanzi: this.sentence.renderHanziLine() };
    }

    /** What still blocks saving, as a message ('' when complete). */
    problem() {
        if (!this.text.trim()) return 'Tapez d’abord le texte.';
        if (this.syllables.length) {
            return `Il reste à convertir : ${this.syllables.join(', ')} — choisissez les caractères dans les suggestions.`;
        }
        const tokens = this.tokens().filter((t) => !t.text);
        if (this.kind === 'word' && tokens.length < this.tokens().length) {
            return 'Un mot s’écrit en caractères : le texte entre « » n’a sa place que dans une expression.';
        }
        const unknown = tokens.filter((t) => !t.pinyin || t.pinyin.includes('?'));
        if (unknown.length) {
            return `Lecture inconnue pour ${unknown.map((t) => t.plain).join(', ')} : retapez la syllabe et choisissez le caractère, `
                + 'ou indiquez la lecture entre parenthèses (三(sam1)).';
        }
        const ambiguous = tokens.filter((t) => t.pinyin.includes('/'));
        if (ambiguous.length) {
            return `Plusieurs lectures pour ${ambiguous.map((t) => `${t.plain} (${t.pinyin})`).join(', ')} : `
                + 'touchez la bonne lecture sous le caractère (en mauve ⚠).';
        }
        return '';
    }

    /** Each word against the lexicon, as Sentence matched it (same
     *  characters, pinned readings agreeing). `additions`: the words
     *  already proposed (not rejected), not to propose again.
     *  status: 'known' | 'reading' (in the lexicon, read otherwise) |
     *  'proposed' | 'unknown' | 'incomplete'. */
    // A token of punctuation only, Latin or Chinese (as text_to_words._PUNCT_ONLY_TOKEN_RE).
    static PUNCT_RE = /^[\uFF0C\u3002\u3001\uFF1B\uFF1A\uFF1F\uFF01\uFF08\uFF09\u3010\u3011\uFF5B\uFF5D\u2018\u2019\u201C\u201D\u2014\u2026,.;:?!()[\]{}'"]+$/;

    /** The senses of a translation, as addition_duplicates.senses() reads
     *  them: « la maison, le foyer (familial) » -> {maison, foyer}; English
     *  without to / a / the. */
    static senses(text, lang = 'fr') {
        const articles = lang === 'en' ? /^(?:to |a |an |the )/ : /^(?:le |la |les |l'|l’|un |une |des |du |de la |se |s'|s’)/;
        const out = new Set();
        String(text || '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
            .split(/[,;/|]| ou | or /).forEach((part) => {
                const s = part.replace(/…/g, ' ').split(/\s+/).join(' ').trim().replace(/^[ .!?]+|[ .!?]+$/g, '').replace(articles, '');
                if (s.length > 1) out.add(s);
            });
        return out;
    }

    check(additions = []) {
        return this.tokens().map((t, i) => {
            const w = { hanzi: t.plain, pinyin: t.pinyin };
            // «ma'a»: text written as is, no word to add.
            if (t.text) return { ...w, pinyin: t.plain, status: 'text' };
            if (t.pending || !t.plain) return { ...w, hanzi: t.token, status: 'incomplete' };
            // Every entry spelled so (homographs: several senses, or readings).
            if (t.match) return { ...w, status: 'known', entry: t.match,
                entries: (this.sentence.matches[i] || []).map((m) => m.dataset || m),
                sense: (this.sentence.parseToken(t.token).constraints || []).join(', ') };
            // Same characters and reading; a reading still unsure (« / », « ? »): same characters.
            const unsure = /[/?]/.test(t.pinyin || '');
            const word = (a) => a.kind === 'word' && a.status !== 'rejected' && a.hanzi === t.plain;
            const proposed = additions.find((a) => word(a) && a.pinyin.replace(/\s+/g, '') === t.pinyin)
                || (unsure ? additions.find(word) : null);
            if (proposed) return { ...w, status: 'proposed', addition: proposed };
            // Punctuation (, 。 ? ...) is not a word to add.
            if (SaisieEntry.PUNCT_RE.test(t.plain)) return { ...w, status: 'punct' };
            const same = this.sentence.findMatches(t.plain, null, null).map((m) => m.dataset || m);
            // 把:prendre while the lexicon only has 把 « classificateur »: a new sense to add.
            const sense = (this.sentence.parseToken(t.token).constraints || []).join(', ');
            if (same.length && sense) return { ...w, status: 'sense', sense, entries: same };
            if (same.length) return { ...w, status: 'reading', entries: same };
            return { ...w, status: 'unknown', sense };
        });
    }

    /** Boxes to show, grouped by word: [[{type: 'char', char, reading} |
     *  {type: 'syl', index, syl}]]. A character's reading: pinned in the
     *  text, else the lexicon word it belongs to, else its own. */
    units() {
        const groups = [];
        let group = null;
        let syl = 0;
        const tokens = this.tokens();
        // Where each word of the text stands, to give each group its word
        // (a word of comments or pins only has no box).
        const spans = this.kind === 'word' ? [] : [...this.text.matchAll(Sentence.WORDS_RE)]
            .map((m) => ({ start: m.index, end: m.index + m[0].length }));
        let tokenIndex = -1;
        let hanIndex = 0;
        let pins = [];
        let charIndex = 0;
        let words = [];
        const digits = (p) => String(p || '').replace(/[¹²³⁴⁵⁶⁷⁸]/g, (c) => String('¹²³⁴⁵⁶⁷⁸'.indexOf(c) + 1));
        const startGroup = (pos) => {
            group = [];
            groups.push(group);
            tokenIndex = this.kind === 'word' ? 0 : spans.findIndex((s) => s.start <= pos && pos < s.end);
            group.token = tokenIndex;
            hanIndex = 0;
            charIndex = 0;
            const token = this.kind === 'word' ? this.sentenceText() : (tokens[tokenIndex]?.token || '');
            pins = Sentence.pinnedReadings(token.split(':')[0]);
            // Every lexicon entry the word matches: homographs read otherwise
            // (把 ba3 « prendre », pa3 « poignée ») leave the reading to choose.
            const t = tokens[tokenIndex];
            words = t?.match && this.sentence
                ? (this.sentence.matches[this.kind === 'word' ? 0 : tokenIndex] || [])
                    .map((w) => Sentence.wordSyllables(w.dataset || w).map(digits))
                : [];
        };
        for (const m of this.text.matchAll(SaisieEntry.UNIT_RE)) {
            if (m[3] !== undefined) {
                if (this.kind !== 'word' && group?.length) group = null;
                continue;
            }
            if (m[1] !== undefined) {
                if (!group) startGroup(m.index);
                group.push({ type: 'text', text: Sentence.textBlock(m[1]), pos: m.index, end: m.index + m[1].length });
                continue;
            }
            if (m[2] === undefined && m[4] === undefined) continue; // (pin), :constraint, *comment*
            if (!group) startGroup(m.index);
            if (m[2] !== undefined) {
                group.push({ type: 'syl', index: syl++, syl: m[2], pos: m.index, end: m.index + m[2].length });
                charIndex += [...m[2]].length;
                continue;
            }
            const char = m[4];
            const pinned = pins[charIndex] || '';
            let reading = pinned;
            if (!reading && /\p{Script=Han}/u.test(char)) {
                const fromWords = [...new Set(words.map((s) => s[hanIndex]).filter(Boolean))];
                reading = fromWords.length ? fromWords.join('/') : digits(this.sentence?.resolveUnknownPinyin(char) || '');
            }
            if (/\p{Script=Han}/u.test(char)) hanIndex += 1;
            charIndex += 1;
            group.push({ type: 'char', char, reading, pinned, pos: m.index, end: m.index + char.length });
        }
        return groups;
    }

    /** Every spelling of the lexicon's words (simplified and traditional),
     *  read once per word list: a quick « no » before Sentence.findMatches,
     *  which goes through the whole lexicon. */
    static spellings(dico) {
        const words = dico?.words || [];
        if (SaisieEntry._spellings?.words !== words || SaisieEntry._spellings.size !== words.length) {
            const set = new Set();
            words.forEach((w) => {
                const d = w.dataset || w;
                if (d.simp) set.add(d.simp);
                if (d.trad) set.add(d.trad);
                // Another form typed (頭髮 for 頭发): found by its simplified form.
                if (d.simp && typeof HanziForms !== 'undefined') set.add(HanziForms.canon(d.simp));
            });
            SaisieEntry._spellings = { words, size: words.length, set };
        }
        return SaisieEntry._spellings.set;
    }

    /** The text cut after the lexicon's words, or null when it already is:
     *  longest words first, over each run of characters (across the spaces
     *  of a line, never across a :sense, punctuation, a «text» or a syllable
     *  left to convert). A word of several characters the lexicon knows is
     *  never cut; characters that make no word stay together as typed. */
    segmentation() {
        if (!this.sentence || this.kind === 'word') return null;
        const groups = this.units();
        const tokens = this.tokens();
        const isHan = (u) => u.type === 'char' && /\p{Script=Han}/u.test(u.char);
        const spellings = SaisieEntry.spellings(this.dico);
        const isWord = (units) => {
            const hanzi = units.map((u) => u.char).join('');
            const known = spellings.has(hanzi) || (typeof HanziForms !== 'undefined' && spellings.has(HanziForms.canon(hanzi)));
            return known && this.sentence.findMatches(hanzi, null,
                units.some((u) => u.pinned) ? units.map((u) => u.pinned || null) : null).length > 0;
        };
        // Runs of characters, each one knowing its group.
        const runs = [];
        let run = [];
        const close = () => { if (run.length) runs.push(run); run = []; };
        groups.forEach((group, g) => {
            const token = tokens[group.token]?.token || '';
            const fixed = token.includes(':') || group.some((u) => u.type !== 'char');
            const prev = groups[g - 1];
            const between = prev ? this.text.slice(prev[prev.length - 1].end, group[0].pos) : '';
            if (fixed || /\n/.test(between) || /\S/.test(between)) close();
            if (fixed) return;
            group.forEach((u) => {
                if (isHan(u)) run.push({ ...u, g });
                else { close(); }
            });
        });
        close();

        const cuts = [];      // text positions where a word must start
        const joins = [];     // [from, to] spans whose spaces must go
        // Words of several characters the lexicon knows: never cut.
        const size = (g) => groups[g].filter(isHan).length;
        const known = new Set(groups.map((group, g) => (size(g) > 1 && tokens[group.token]?.match ? g : -1)).filter((g) => g >= 0));
        runs.forEach((units) => {
            const pieces = [];
            let i = 0;
            while (i < units.length) {
                let length = 0;
                for (let n = Math.min(6, units.length - i); n > 1 && !length; n -= 1) {
                    const piece = units.slice(i, i + n);
                    // A known word is taken whole or left alone.
                    const breaks = [...known].some((g) => {
                        const inside = piece.filter((u) => u.g === g).length;
                        return inside && inside !== size(g);
                    }) || (known.has(units[i - 1]?.g) && units[i - 1].g === units[i].g)
                        || (known.has(units[i + n]?.g) && units[i + n].g === units[i + n - 1].g);
                    if (!breaks && isWord(piece)) length = n;
                }
                if (!length && known.has(units[i].g)) length = size(units[i].g);
                pieces.push({ units: units.slice(i, i + (length || 1)), word: !!length || isWord([units[i]]) });
                i += length || 1;
            }
            // Characters making no word, typed together, stay together.
            const merged = [];
            pieces.forEach((p) => {
                const last = merged[merged.length - 1];
                if (last && !last.word && !p.word && last.units[last.units.length - 1].g === p.units[0].g) last.units.push(...p.units);
                else merged.push({ ...p, units: [...p.units] });
            });
            merged.forEach((p, k) => {
                const first = p.units[0];
                const prev = merged[k - 1];
                if (prev && prev.units[prev.units.length - 1].g === first.g) cuts.push(first.pos);
                p.units.slice(1).forEach((u, j) => {
                    const before = p.units[j];
                    if (before.g !== u.g) joins.push([before.end, u.pos]);
                });
            });
        });
        if (!cuts.length && !joins.length) return null;
        // Applied from the end, so the positions before stay right.
        const edits = [...cuts.map((p) => ({ at: p, cut: true })), ...joins.map(([from, to]) => ({ at: from, to }))]
            .sort((a, b) => b.at - a.at);
        const copy = new SaisieEntry(this.dico);
        copy.setText(this.text, this.kind);
        // Cuts within one word go together (splitAt spreads the readings once).
        const byWord = new Map();
        edits.filter((e) => e.cut).forEach((e) => {
            let start = e.at;
            while (start > 0 && !/\s/.test(this.text[start - 1])) start -= 1;
            byWord.set(start, [...(byWord.get(start) || []), e.at]);
        });
        const ops = [
            ...[...byWord.entries()].map(([start, ps]) => ({ at: start, run: () => { copy.splitAt(ps); } })),
            ...edits.filter((e) => !e.cut).map((e) => ({ at: e.at, run: () => { copy.joinAt(e.at, e.to); } })),
        ].sort((a, b) => b.at - a.at);
        ops.forEach((op) => op.run());
        return copy.text === this.text ? null : copy.text;
    }
}
