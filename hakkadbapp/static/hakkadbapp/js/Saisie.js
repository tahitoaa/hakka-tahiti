/* =========================================================================
   Saisie — new words/expressions (LexiconAddition, see additions.py).
   Same algorithm as the "Écrire" page (converter.js): the text field holds
   the working text in Sentence format -- romanized syllables typed in the
   "Je tape en" system, replaced one by one by characters picked from the
   suggestions (SyllableInputModel.select, which pins the reading of a
   polyphone: 生(sen1)), words separated by spaces. Sentence then reads it
   like any sentence: the stored (Wenfa) pinyin of each word, the mixed
   pinyin + hanzi line, and the lexicon words it matches -- the unknown
   ones can be added as new words along with the expression.
   The characters are also shown one per box (pending syllables as empty
   boxes to fill), spaced by word.
   ========================================================================= */

/** The form's content, without the page: text, readings, checks. */
class SaisieEntry {
    // A «text» block (group 1), a pending syllable (group 2, as
    // SyllableInputModel), whitespace (group 3), any other character
    // (group 4); comments, (pins) and :constraints are matched and skipped.
    static UNIT_RE = new RegExp(`(«[^»]*»?)|${SyllableInputModel.SYLLABLE_RE.source}|(\\s+)|([\\s\\S])`, 'gu');

    /** Space-separated words, a «…» block being one (Sentence.splitWords). */
    static words(text) {
        return String(text || '').match(/«[^»]*»?\S*|\S+/gu) || [];
    }

    static isTextBlock(token) {
        return /^«[^»]*»?\S*$/u.test(String(token || ''));
    }

    /** The "Texte" button: the selection put between « » (or « » inserted,
     *  the caret inside). Returns {text, caret}. */
    static wrapText(text, start, end) {
        const before = text.slice(0, start);
        const inner = text.slice(start, end).trim();
        const after = text.slice(end);
        const lead = before && !/\s$/.test(before) ? ' ' : '';
        const trail = after && !/^\s/.test(after) ? ' ' : '';
        const out = `${before}${lead}«${inner}»${trail}${after}`;
        const caret = before.length + lead.length + 1 + inner.length + (inner ? 1 : 0);
        return { text: out, caret };
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
        const readingsOf = (char) => new Set(lexicon.filter((p) => p.simp === char || p.trad === char)
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
            .filter((p) => p.simp === char || p.trad === char)
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
            const fits = this.dico.lexiconPronunciations.filter((p) => (p.simp === char || p.trad === char)
                && candidates.some((c) => c.initial === p.initial && c.final === p.final
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
                + 'touchez la bonne lecture sous le caractère (en orange).';
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
        return this.tokens().map((t) => {
            const w = { hanzi: t.plain, pinyin: t.pinyin };
            // «ma'a»: text written as is, no word to add.
            if (t.text) return { ...w, pinyin: t.plain, status: 'text' };
            if (t.pending || !t.plain) return { ...w, hanzi: t.token, status: 'incomplete' };
            if (t.match) return { ...w, status: 'known', entry: t.match };
            const proposed = additions.find((a) => a.kind === 'word' && a.status !== 'rejected'
                && a.hanzi === t.plain && a.pinyin.replace(/\s+/g, '') === t.pinyin);
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
        let tokenIndex = -1;
        let hanIndex = 0;
        let pins = [];
        let charIndex = 0;
        const startGroup = () => {
            group = [];
            groups.push(group);
            tokenIndex += 1;
            hanIndex = 0;
            charIndex = 0;
            const token = this.kind === 'word' ? this.sentenceText() : (tokens[tokenIndex]?.token || '');
            pins = Sentence.pinnedReadings(token.split(':')[0]);
        };
        for (const m of this.text.matchAll(SaisieEntry.UNIT_RE)) {
            if (m[3] !== undefined) {
                if (this.kind !== 'word' && group?.length) group = null;
                continue;
            }
            if (m[1] !== undefined) {
                if (!group) startGroup();
                group.push({ type: 'text', text: Sentence.textBlock(m[1]), pos: m.index, end: m.index + m[1].length });
                continue;
            }
            if (m[2] === undefined && m[4] === undefined) continue; // (pin), :constraint, *comment*
            if (!group) startGroup();
            if (m[2] !== undefined) {
                group.push({ type: 'syl', index: syl++, syl: m[2], pos: m.index, end: m.index + m[2].length });
                charIndex += [...m[2]].length;
                continue;
            }
            const char = m[4];
            const t = tokens[this.kind === 'word' ? 0 : tokenIndex];
            let reading = pins[charIndex] || '';
            if (!reading && /\p{Script=Han}/u.test(char)) {
                const fromWord = t?.match ? Sentence.wordSyllables(t.match)[hanIndex] : '';
                reading = (fromWord || this.sentence?.resolveUnknownPinyin(char) || '')
                    .replace(/[¹²³⁴⁵⁶⁷⁸]/g, (c) => String('¹²³⁴⁵⁶⁷⁸'.indexOf(c) + 1));
            }
            if (/\p{Script=Han}/u.test(char)) hanIndex += 1;
            charIndex += 1;
            group.push({ type: 'char', char, reading, pos: m.index, end: m.index + char.length });
        }
        return groups;
    }
}


(function () {
    const { API, escapeHtml, superscriptTones, displayPinyin, request, whileBusy } = typeof AdditionList !== 'undefined'
        ? AdditionList : {};

    const AI_API = '/api/ia/suggestion';

    const CHECK_LABELS = {
        known: 'dans le lexique',
        reading: 'dans le lexique, autre lecture',
        sense: 'nouveau sens',
        punct: 'ponctuation',
        text: 'texte, gardé tel quel',
        proposed: 'déjà proposé',
        unknown: 'inconnu du lexique',
        incomplete: 'à compléter',
    };

    /* The form, and the drafts under it. What is proposed is handled on
       the "Validation" page (AdditionList.js). */
    class SaisiePage {
        constructor() {
            this.dico = new Dictionary({ containerId: '#pron-list', itemSelector: 'li' });
            this.entry = new SaisieEntry(this.dico);
            this.editingId = null;
            this.editingStatus = null;
            this.kind = 'word';
            this.active = 0;          // pending syllable whose suggestions are shown
            this.visible = [];        // those suggestions, with their model index
            // Unknown words of the expression to add with it, by
            // "hanzi|pinyin": what was typed for them survives re-renders.
            this.newWords = new Map();
            this.statusLabels = AdditionList.statusLabels();

            const $ = (id) => document.getElementById(id);
            this.el = {
                form: $('saisie-form'), title: $('saisie-form-title'), text: $('saisie-pinyin'),
                slots: $('saisie-slots'), suggestions: $('saisie-suggestions'),
                french: $('saisie-french'), english: $('saisie-english'), themes: $('saisie-themes'),
                observations: $('saisie-observations'), preview: $('saisie-preview'),
                check: $('saisie-check'), newWords: $('saisie-new-words'),
                status: $('saisie-status'), cancel: $('saisie-cancel'),
                ai: $('saisie-ai'), aiBtn: $('saisie-ai-btn'), aiResult: $('saisie-ai-result'),
            };
            this.aiSuggestion = null;   // last AI proposal, and the entry it was for
            this.aiFor = '';
            this.validationUrl = this.el.form.dataset.validationUrl || '';
            // Every addition is loaded (for "déjà proposé"); only the drafts are listed.
            this.list = new AdditionList({
                list: $('saisie-list'), search: $('saisie-search'), filter: 'draft',
                // The AI's drafts are sorted on the « Suggestions IA » page.
                scope: (a) => !a.by_ai,
                empty: 'Aucun brouillon.',
                onEdit: (a) => this.edit(a),
                onLoad: () => this.afterLoad(),
                onRemove: (id) => { if (this.editingId === id) this.resetForm(); },
            });
            this.kindButtons = [...this.el.form.querySelectorAll('[data-kind]')];
            // Opened from Suivi (✎): the rows of that table, to go through.
            try { this.reviewNav = JSON.parse(sessionStorage.getItem(AdditionList.REVIEW_KEY) || 'null'); } catch (e) { this.reviewNav = null; }
            document.getElementById('saisie-review-nav')?.addEventListener('click', (event) => {
                const b = event.target.closest('[data-nav]');
                if (b) this.go(Number(b.dataset.nav));
            });
            document.addEventListener('keydown', (event) => this.onKey(event));
            this.suggestionBar = new SuggestionBar(this.el.suggestions, {
                onSelect: (index) => this.pickSuggestion(index),
                onUnknown: () => { if (this.entry.unknown(this.active)) this.afterChange(); },
            });

            // "Lectures" (components/reading_settings.html): the same sources
            // as the "Écrire" and "Transcrire" pages.
            if ($('source-switch') && typeof ReadingSourceSwitch !== 'undefined') {
                window.readingSources = new ReadingSourceSwitch({
                    root: $('source-switch'), status: $('source-status'), summary: $('settings-summary'),
                    dico: this.dico, onChange: () => this.updateText(),
                });
            }
            // Pending syllables are read in the new "Je tape en" system; a
            // new display system only changes what is shown.
            document.addEventListener('romanization-input-change', () => this.setKind(this.kind));
            document.addEventListener('romanization-change', () => this.renderAll());
            document.addEventListener('hanzi-mode-change', () => this.renderAll());

            this.bind();
            this.setKind('word');
            this.list.load();
        }

        get additions() {
            return this.list.additions;
        }

        bind() {
            this.el.text.addEventListener('input', () => this.updateText());
            this.el.newWords.addEventListener('input', (event) => this.onNewWordInput(event));
            this.el.newWords.addEventListener('change', (event) => this.onNewWordInput(event));
            this.kindButtons.forEach((btn) => btn.addEventListener('click', () => this.switchKind(btn.dataset.kind)));
            this.el.slots.addEventListener('focusin', (event) => {
                const index = event.target.dataset?.slot;
                if (index !== undefined) this.setActive(Number(index));
            });
            // A character typed in an empty box, for a syllable no source
            // knows. A Chinese IME fires `input` with latin letters while
            // composing; only the composed character counts.
            const onSlotInput = (event) => {
                const index = event.target.dataset?.slot;
                if (index === undefined || event.isComposing) return;
                const char = [...event.target.value.trim()].filter((c) => /\p{Script=Han}/u.test(c)).pop();
                if (!char) return;
                if (!this.entry.type(Number(index), char)) {
                    event.target.value = '';
                    this.setStatus(`Lecture ambiguë pour ${char} (${this.entry.syllables[index]}) : tapez la syllabe en Wenfa avec son ton, `
                        + 'ou choisissez le caractère dans les suggestions.', true);
                    return;
                }
                this.setStatus('');
                this.afterChange();
            };
            this.el.slots.addEventListener('input', onSlotInput);
            // A reading chosen for an ambiguous character; a word cut or two
            // words joined between their boxes (no caret to place on a phone).
            this.el.slots.addEventListener('mousedown', (event) => { if (event.target.closest('[data-pin], [data-split], [data-join-from]')) event.preventDefault(); });
            this.el.slots.addEventListener('click', (event) => {
                const gap = event.target.closest('[data-split], [data-join-from]');
                if (gap) {
                    const done = gap.dataset.split !== undefined
                        ? this.entry.splitAt([Number(gap.dataset.split)])
                        : this.entry.joinAt(Number(gap.dataset.joinFrom), Number(gap.dataset.joinTo));
                    if (!done) return;
                    this.el.text.value = this.entry.text;
                    // A word cut in two is an expression.
                    if (this.kind === 'word') this.setKind('expression');
                    else this.updateText();
                    return;
                }
                const b = event.target.closest('[data-pin]');
                if (b && this.entry.pinAt(Number(b.dataset.pin), b.dataset.reading)) {
                    this.el.text.value = this.entry.text;
                    this.updateText();
                }
            });
            this.el.slots.addEventListener('compositionend', onSlotInput);
            this.el.form.addEventListener('submit', (event) => {
                event.preventDefault();
                // Enter in a field submits with the first button, "Enregistrer".
                const button = event.submitter || this.el.form.querySelector('button[type="submit"]');
                this.save(button?.dataset.status || 'draft', button);
            });
            this.el.cancel.addEventListener('click', () => this.resetForm());
            // « Texte » : the selection (or the caret) between « », for words
            // written without characters (ma'a tinito).
            const textBtn = document.getElementById('saisie-text-btn');
            textBtn?.addEventListener('mousedown', (event) => event.preventDefault());
            textBtn?.addEventListener('click', () => this.wrapSelectionAsText());
            this.el.aiBtn?.addEventListener('click', () => this.suggest());
            // « Demander à l'IA »: a free request on the entry (ask_ai.py).
            const askInput = document.getElementById('saisie-ask');
            document.getElementById('saisie-ask-btn')?.addEventListener('click', (event) => this.ask(event.currentTarget));
            askInput?.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') { event.preventDefault(); this.ask(document.getElementById('saisie-ask-btn')); }
            });
            document.getElementById('saisie-ask-result')?.addEventListener('click', (event) => {
                if (event.target.closest('[data-ask-use]')) this.useAsked();
            });
            this.el.aiResult?.addEventListener('click', (event) => {
                const btn = event.target.closest('[data-ai-use]');
                if (btn) this.useSuggestion(btn.dataset.aiUse);
            });
            // A field the AI filled stays tinted until the editor changes it.
            [this.el.french, this.el.english, this.el.themes].forEach((input) =>
                input.addEventListener('input', () => input.classList.remove('is-ai')));
            // « Même sens » (renderMeaning) follows the translations as they are typed.
            [this.el.french, this.el.english].forEach((input) => input.addEventListener('input', () => {
                clearTimeout(this.meaningTimer);
                this.meaningTimer = setTimeout(() => this.renderMeaning(), 250);
            }));
            document.getElementById('saisie-kind-warning')?.addEventListener('click', (event) => {
                const b = event.target.closest('[data-switch-kind]');
                if (b) this.switchKind(b.dataset.switchKind);
            });
            // 📋 Copy what the form holds (characters, reading, senses, theme).
            document.getElementById('saisie-copy')?.addEventListener('click', (event) =>
                AdditionList.copy(AdditionList.clipboardText(this.values()), event.currentTarget));
            // Shift+1..9 picks a suggestion, as on the "Écrire" page.
            this.el.form.addEventListener('keydown', (event) => {
                if (!event.shiftKey || !/^[1-9]$/.test(event.key)) return;
                if (event.target !== this.el.text && event.target.dataset?.slot === undefined) return;
                const index = Number(event.key) - 1;
                if (index >= this.visible.length) return;
                event.preventDefault();
                this.pickSuggestion(index);
            });
        }

        /** The additions are in: "déjà proposé" can be checked, and an
         *  addition opened from the Validation page (?modifier=id) loaded. */
        afterLoad() {
            this.renderPreview();
            const params = new URLSearchParams(window.location.search);
            const id = Number(params.get('modifier'));
            if (!id) return;
            const addition = this.additions.find((a) => a.id === id);
            if (addition) this.edit(addition);
            else this.setStatus('Cet ajout n’existe plus.', true);
            params.delete('modifier');
            const query = params.toString();
            window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
        }

        // ---- form ---------------------------------------------------------

        setKind(kind) {
            this.kind = kind;
            this.kindButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
            this.el.form.classList.toggle('is-word', kind === 'word');
            this.el.form.classList.toggle('is-expression', kind === 'expression');
            const example = typeof ReadingSourceSwitch !== 'undefined' && ReadingSourceSwitch.inputExample
                ? ReadingSourceSwitch.inputExample() : '';
            this.el.text.placeholder = example ? `ex. ${example}` : (kind === 'word' ? 'ex. wuk5ka1' : 'ex. ngai2 oi4 wuk5ka1');
            this.updateText();
        }

        /** A kind button touched. A word becoming an expression is cut
         *  where the lexicon's words start (我爱屋家 -> 我 爱 屋家); the boxes'
         *  gaps fix the rest. */
        switchKind(kind) {
            if (kind === 'expression' && this.kind === 'word') {
                this.entry.setText(this.el.text.value, 'word');
                const cuts = this.entry.lexiconCuts();
                if (cuts.length && this.entry.splitAt(cuts)) {
                    this.el.text.value = this.entry.text;
                    this.setStatus('Découpé d’après le lexique : touchez entre deux cases pour couper, entre deux mots pour recoller.');
                }
            }
            this.setKind(kind);
        }

        /** The text field changed (typed, or the sources/system did). */
        updateText() {
            this.entry.setText(this.el.text.value, this.kind);
            this.active = Math.max(0, Math.min(this.active, this.entry.syllables.length - 1));
            this.renderAll();
        }

        /** A word never has a space; an expression has at least two words.
         *  Said at once, with the switch one tap away. */
        renderKindWarning() {
            const box = document.getElementById('saisie-kind-warning');
            if (!box) return;
            const text = this.el.text.value.trim();
            let message = '';
            let other = '';
            if (this.kind === 'word' && /\s/.test(text)) {
                message = 'Un mot ne contient jamais d’espace (ils seront retirés).';
                other = 'expression';
            } else if (this.kind === 'expression' && text && !/\s/.test(text) && !this.entry.syllables.length) {
                message = 'Une expression contient au moins deux mots séparés par un espace.';
                other = 'word';
            }
            box.innerHTML = message ? `<div class="saisie-kind-warning">⚠ ${message}
                <button type="button" data-switch-kind="${other}">${other === 'word' ? '📝 C’est un mot' : '💬 C’est une expression'}</button></div>` : '';
        }

        wrapSelectionAsText() {
            const input = this.el.text;
            const { text, caret } = SaisieEntry.wrapText(input.value, input.selectionStart ?? input.value.length,
                input.selectionEnd ?? input.value.length);
            input.value = text;
            input.focus();
            input.setSelectionRange(caret, caret);
            // Text between « » makes an expression.
            if (this.kind === 'word') this.setKind('expression');
            else this.updateText();
        }

        /** The model rewrote the text (suggestion picked, character typed). */
        afterChange() {
            const focusText = document.activeElement === this.el.text;
            this.el.text.value = this.entry.text;
            // The syllable converted disappears: the next one takes its index.
            this.active = Math.max(0, Math.min(this.active, this.entry.syllables.length - 1));
            this.renderAll();
            // Keep typing where you were; never move the focus to a box
            // (on a tablet that would also open the keyboard).
            if (focusText) this.el.text.focus();
        }

        setActive(index) {
            this.active = index;
            this.renderSlotStates();
            this.renderSuggestions();
        }

        pickSuggestion(index) {
            const suggestion = this.visible[index];
            if (!suggestion) return;
            this.entry.pick(suggestion.index);
            this.afterChange();
        }

        renderAll() {
            this.renderKindWarning();
            this.renderSlots();
            this.renderPreview();
            // A proposal made for other characters no longer applies.
            if (this.aiSuggestion && this.aiFor !== this.aiEntryKey()) this.clearSuggestion();
            // 🔎 Sources (Sources.js) follows the characters typed.
            const sources = document.getElementById('saisie-sources');
            if (sources) {
                const v = this.entry.values();
                sources.dataset.sources = this.entry.syllables.length ? '' : v.hanzi.replace(/\s+/g, '');
                sources.dataset.reading = v.pinyin;
                sources.hidden = !sources.dataset.sources;
            }
        }

        // ---- AI suggestions (ai.py) ------------------------------------------

        aiEntryKey() {
            const v = this.entry.values();
            return `${v.kind}|${v.hanzi}|${v.pinyin}`;
        }

        clearSuggestion() {
            this.aiSuggestion = null;
            this.aiFor = '';
            if (this.el.aiResult) this.el.aiResult.innerHTML = '';
        }

        /** Asks the server for French, English and theme; shows them to accept. */
        async suggest() {
            const problem = this.entry.problem();
            if (problem) return this.setStatus(problem, true);
            const values = this.values();
            const key = this.aiEntryKey();
            this.setStatus('');
            await whileBusy(this.el.aiBtn, 'L’IA réfléchit…', async () => {
                try {
                    const data = await request(AI_API, {
                        kind: values.kind, hanzi: values.hanzi, pinyin: values.pinyin,
                        french: values.french, english: values.english,
                        // With what the editor already typed for them, if anything.
                        new_words: this.kind === 'expression'
                            ? this.newWordCandidates().map((c) => {
                                const state = this.newWords.get(this.newWordKey(c)) || {};
                                const typed = (name) => (state.ai?.[name] ? '' : (state[name] || '').trim());
                                return { hanzi: c.hanzi, pinyin: c.pinyin, french: typed('french'),
                                    english: typed('english'), themes: typed('themes') };
                            }) : [],
                    });
                    this.aiSuggestion = data.suggestion;
                    this.aiFor = key;
                    this.renderSuggestion();
                } catch (err) {
                    this.clearSuggestion();
                    this.el.aiResult.innerHTML = `<p class="text-sm text-red-700">${escapeHtml(err.message)}</p>`;
                }
            });
        }

        /** The request typed beside « Demander », about what the form holds. */
        async ask(button) {
            const input = document.getElementById('saisie-ask');
            const box = document.getElementById('saisie-ask-result');
            const instruction = input?.value.trim();
            if (!instruction) { input?.focus(); return; }
            const v = this.values();
            this.asked = null;
            await whileBusy(button, 'L’IA réfléchit…', async () => {
                try {
                    const data = await request('/api/ia/demander', { instruction, entry: {
                        kind: v.kind, hanzi: v.hanzi, pinyin: v.pinyin, french: v.french, english: v.english, themes: v.themes } });
                    this.asked = data.proposal;
                    box.innerHTML = AdditionList.askedHtml(data, 'data-ask-use');
                } catch (err) {
                    box.innerHTML = `<p class="text-sm text-red-700">${escapeHtml(err.message)}</p>`;
                }
            });
        }

        /** « Utiliser »: the AI's new version in the form (text, kind, French, English), to check before saving. */
        useAsked() {
            const p = this.asked;
            if (!p) return;
            this.el.text.value = SaisieEntry.textFromStored(p.hanzi, p.pinyin, p.kind, this.dico);
            this.setKind(p.kind);
            [['french', p.french], ['english', p.english]].forEach(([field, value]) => {
                if (!value) return;
                this.el[field].value = value;
                this.el[field].classList.add('is-ai');
            });
            document.getElementById('saisie-ask-result').innerHTML = '';
            this.asked = null;
            this.setStatus('Proposition de l’IA reprise : vérifiez-la avant d’enregistrer.');
            this.el.text.focus();
        }

        renderSuggestion() {
            const s = this.aiSuggestion;
            if (!s) return this.clearSuggestion();
            const rows = [['french', 'Français'], ['english', 'Anglais'], ['themes', 'Thème']]
                .filter(([field]) => s[field])
                .map(([field, label]) => `<div class="saisie-ai-row">
                    <b>${label}</b><span>${escapeHtml(s[field])}</span>
                    <button type="button" class="saisie-btn saisie-btn-neutral" data-ai-use="${field}">Utiliser</button>
                  </div>`);
            (s.words || []).forEach((w, i) => {
                const parts = [w.french && escapeHtml(w.french), w.english && `<i>${escapeHtml(w.english)}</i>`,
                    w.themes && escapeHtml(w.themes)].filter(Boolean);
                rows.push(`<div class="saisie-ai-row">
                    <b>Mot <span class="hanzi">${escapeHtml(w.hanzi)}</span></b>
                    <span>${parts.join(' · ')}</span>
                    <button type="button" class="saisie-btn saisie-btn-neutral" data-ai-use="word:${i}">Utiliser</button>
                  </div>`);
            });
            if (!rows.length) {
                this.el.aiResult.innerHTML = '<p class="text-sm">L’IA n’a rien proposé pour cette entrée.</p>';
                return;
            }
            const based = s.based_on.length ? ` D’après : <span class="hanzi">${s.based_on.map(escapeHtml).join('、')}</span>.` : '';
            this.el.aiResult.innerHTML = `${rows.join('')}
                <div class="flex flex-wrap items-center gap-2">
                  <button type="button" class="saisie-btn saisie-btn-ai" data-ai-use="all">Tout utiliser</button>
                  <span class="saisie-ai-meta"><span class="saisie-ai-conf saisie-ai-conf-${escapeHtml(s.confidence)}">Confiance ${escapeHtml(s.confidence)}</span>
                    ${escapeHtml(s.explanation)}${based}</span>
                </div>`;
        }

        /** An unknown word's proposal into its row (ticked, fields tinted). */
        useWordSuggestion(w) {
            const c = this.newWordCandidates().find((x) => x.hanzi === w.hanzi);
            const state = c && this.newWords.get(this.newWordKey(c));
            if (!state) return;
            state.checked = true;
            // Never over what the editor typed: only empty fields (or ones
            // the AI filled before) take the proposal.
            ['french', 'english', 'themes'].forEach((name) => {
                const typedByEditor = (state[name] || '').trim() && !state.ai[name];
                if (w[name] && !typedByEditor) { state[name] = w[name]; state.ai[name] = true; }
            });
            this.renderNewWords();
        }

        /** Copies one proposed field (or all of them) into the form. */
        useSuggestion(field) {
            const s = this.aiSuggestion;
            if (!s) return;
            const inputs = { french: this.el.french, english: this.el.english, themes: this.el.themes };
            if (field === 'all' || field.startsWith('word:')) {
                const words = field === 'all' ? (s.words || []) : [s.words?.[Number(field.slice(5))]];
                words.filter(Boolean).forEach((w) => this.useWordSuggestion(w));
                if (field !== 'all') {
                    this.setStatus('Suggestion reprise : vérifiez-la avant d’enregistrer.');
                    return;
                }
            }
            const fields = field === 'all' ? Object.keys(inputs) : [field];
            fields.filter((f) => s[f] && inputs[f]).forEach((f) => {
                inputs[f].value = s[f];
                inputs[f].classList.add('is-ai');
            });
            this.setStatus('Suggestion reprise : vérifiez-la avant d’enregistrer.');
            this.renderMeaning();
            inputs[fields[0]]?.focus();
        }

        renderSlots() {
            const groups = this.entry.units();
            const label = (u) => (u.type === 'char' ? u.char : u.type === 'syl' ? u.syl : u.text);
            // Between two boxes of a word: cut there. Between two words: join them.
            const splitGap = (prev, u) => (prev.type === 'text' || u.type === 'text' ? ''
                : `<button type="button" class="saisie-gap" data-split="${u.pos}" title="Couper ici"
                    aria-label="Couper entre ${escapeHtml(label(prev))} et ${escapeHtml(label(u))}"></button>`);
            const joinGap = (prev, next) => (!prev?.length || prev.some((u) => u.type === 'text') || next.some((u) => u.type === 'text') ? ''
                : `<button type="button" class="saisie-gap is-join" data-join-from="${prev[prev.length - 1].end}" data-join-to="${next[0].pos}"
                    title="Recoller ces deux mots" aria-label="Recoller ${escapeHtml(prev.map(label).join(''))} et ${escapeHtml(next.map(label).join(''))}"></button>`);
            this.el.slots.innerHTML = groups.map((group, g) => `${joinGap(groups[g - 1], group)}<span class="saisie-word">${group.map((u, k) => (k ? splitGap(group[k - 1], u) : '') + (u.type === 'text'
                ? `<span class="saisie-slot is-text" title="Texte gardé tel quel"><span class="saisie-text">${escapeHtml(u.text || '…')}</span><small>texte</small></span>`
                : u.type === 'syl'
                ? `<label class="saisie-slot"><input class="hanzi" data-slot="${u.index}" value="" inputmode="text" `
                    + `aria-label="Caractère pour ${escapeHtml(u.syl)}"><small>${escapeHtml(superscriptTones(u.syl))}</small></label>`
                : u.reading.includes('/')
                    // Several readings: one button each; the chosen one is pinned.
                    ? `<span class="saisie-slot is-char is-ambiguous" title="Plusieurs lectures : choisissez la bonne">`
                        + `<span class="hanzi saisie-char">${escapeHtml(u.char)}</span><span class="saisie-ambig">`
                        + u.reading.split('/').map((r) => `<button type="button" data-pin="${u.pos}" data-reading="${escapeHtml(r)}"`
                            + ` aria-label="Lire ${escapeHtml(u.char)} ${escapeHtml(displayPinyin(r))}">${escapeHtml(displayPinyin(r))}</button>`).join('')
                        + '</span></span>'
                    : `<span class="saisie-slot is-char"><span class="hanzi saisie-char">${escapeHtml(u.char)}</span>`
                    + `<small>${escapeHtml(u.reading ? displayPinyin(u.reading) : ' ')}</small></span>`)).join('')}</span>`).join('')
                || '<span class="text-sm text-gray-400">Les cases apparaissent quand vous tapez le texte.</span>';
            this.renderSlotStates();
            this.renderSuggestions();
        }

        renderSlotStates() {
            this.el.slots.querySelectorAll('[data-slot]').forEach((input) => {
                input.closest('.saisie-slot').classList.toggle('is-active', Number(input.dataset.slot) === this.active);
                input.closest('.saisie-slot').classList.add('is-empty');
            });
        }

        renderSuggestions() {
            this.visible = this.entry.syllables.length ? this.entry.suggestions(this.active) : [];
            this.suggestionBar.render(this.visible, { unknown: this.entry.syllables[this.active] || '' });
        }

        values() {
            return {
                ...this.entry.values(),
                french: this.el.french.value,
                english: this.el.english.value,
                themes: this.el.themes.value,
                observations: this.el.observations.value,
            };
        }

        /** « Même sens » under the translations: the lexicon words and the
         *  additions (same kind, not rejected) sharing a French or English
         *  sense with the entry -- possible duplicates written otherwise
         *  (same rule as the Suivi's « Doublons », addition_duplicates.py). */
        renderMeaning() {
            const el = document.getElementById('saisie-meaning');
            if (!el) return;
            const fr = SaisieEntry.senses(this.el.french.value, 'fr');
            const en = SaisieEntry.senses(this.el.english.value, 'en');
            if (!fr.size && !en.size) { el.innerHTML = ''; return; }
            const own = (this.entry.values?.().hanzi || '').replace(/\s+/g, '');
            // Senses of the lexicon words, read once.
            this.lexiconSenses ||= this.dico.lexiconWords.map((w) => ({
                hanzi: w.dataset.simp || '', pinyin: w.dataset.pinyin || '', french: w.dataset.french || '', english: w.dataset.english || '',
                fr: SaisieEntry.senses(w.dataset.french, 'fr'), en: SaisieEntry.senses(w.dataset.english, 'en'),
            }));
            const hits = [];
            const consider = (item, where) => {
                if (!item.hanzi || item.hanzi.replace(/\s+/g, '') === own) return;
                const f = [...(item.fr || SaisieEntry.senses(item.french, 'fr'))].filter((s) => fr.has(s));
                const e = [...(item.en || SaisieEntry.senses(item.english, 'en'))].filter((s) => en.has(s));
                if (f.length || e.length) hits.push({ item, where, f, e });
            };
            if (this.kind === 'word') this.lexiconSenses.forEach((w) => consider(w, 'Lexique'));
            (this.additions || []).filter((a) => a.id !== this.editingId && a.status !== 'rejected' && a.kind === this.kind)
                .forEach((a) => consider(a, `Ajout · ${this.statusLabels[a.status] || a.status}`));
            if (!hits.length) { el.innerHTML = ''; return; }
            hits.sort((x, y) => (y.f.length > 0) + (y.e.length > 0) - (x.f.length > 0) - (x.e.length > 0));
            const shown = hits.slice(0, 6);
            el.innerHTML = `<div class="saisie-meaning"><b>⧉ Même sens déjà présent</b> — doublon ? (${hits.length})
                <ul>${shown.map(({ item, where, f, e }) => `<li><span class="saisie-meaning-where">${escapeHtml(where)}</span>
                  <span class="hanzi">${escapeHtml(AdditionList.platformHanzi(item.hanzi))}</span>
                  <span>${escapeHtml(superscriptTones(item.pinyin))}</span>
                  <span>« ${escapeHtml(item.french || '?')} »${item.english ? ` <i lang="en">${escapeHtml(item.english)}</i>` : ''}</span>
                  <span class="saisie-meaning-why">${[...f, ...e].map((s) => `<mark>${escapeHtml(s)}</mark>`).join(' ')}</span></li>`).join('')}</ul></div>`;
        }

        /** The mixed line (pinyin + hanzi, as Sentence renders it). */
        renderPreview() {
            this.renderCheck();
            this.renderMeaning();
            const mixed = this.entry.mixed();
            this.el.preview.innerHTML = mixed.hanzi
                ? `${escapeHtml(mixed.pinyin)} <span class="hanzi">${escapeHtml(mixed.hanzi)}</span>` : '';
        }

        // ---- check against the lexicon --------------------------------------

        /** Each word against the lexicon (SaisieEntry.check); for an
         *  expression, its unknown words can be added with it. */
        renderCheck() {
            this.checks = this.entry.text.trim() ? this.entry.check(this.additions) : [];
            const lexiconPinyin = (d) => displayPinyin(Sentence.wordSyllables(d).join('') || d.pinyin || '');
            const describe = (c) => {
                if (c.status === 'known') return `${escapeHtml(lexiconPinyin(c.entry))} « ${escapeHtml(c.entry.french || '?')} »`;
                if (c.status === 'reading') return `lu ${c.entries.map((d) => `${escapeHtml(lexiconPinyin(d))} « ${escapeHtml(d.french || '?')} »`).join(', ')}`;
                if (c.status === 'sense') return `« ${escapeHtml(c.sense)} » absent ; le lexique a : ${c.entries.map((d) => `« ${escapeHtml(d.french || '?')} »`).join(', ')}`;
                if (c.status === 'proposed') return `${escapeHtml(this.statusLabels[c.addition.status] || c.addition.status)} : « ${escapeHtml(c.addition.french || '?')} »`;
                return '';
            };
            if (this.kind === 'word') {
                const c = this.checks[0];
                const message = !c || c.status === 'incomplete' ? ''
                    : c.status === 'known' ? `Ce mot est déjà dans le lexique : ${describe(c)}.`
                    : c.status === 'proposed' ? `Ce mot est déjà proposé (${describe(c)}).`
                    : c.status === 'reading' ? `Ces caractères sont dans le lexique avec une autre lecture (${describe(c)}) : vérifiez la lecture.`
                    : c.status === 'sense' ? `Nouveau sens : ${describe(c)}.`
                    : 'Nouveau mot : absent du lexique.';
                this.el.check.innerHTML = message ? `<p class="saisie-check-${c.status}">${message}</p>` : '';
                this.el.newWords.innerHTML = '';
                return;
            }
            this.el.check.innerHTML = this.checks.length ? `<ul class="saisie-check-list">${this.checks.map((c) => `
                <li class="saisie-check-${c.status}"><span class="hanzi">${escapeHtml(c.hanzi || '…')}</span>
                  <span>${c.status === 'incomplete' ? '' : escapeHtml(displayPinyin(c.pinyin))}</span>
                  <b>${CHECK_LABELS[c.status]}</b> ${describe(c)}</li>`).join('')}</ul>` : '';
            this.renderNewWords();
        }

        newWordKey(c) {
            return `${c.hanzi}|${c.pinyin}${c.sense ? `|${c.sense}` : ''}`;
        }

        /** The words to add with the expression: the unknown ones (checked
         *  by default) and the ones the lexicon reads otherwise (unchecked),
         *  once their reading is settled. */
        newWordCandidates() {
            return (this.checks || [])
                .filter((c) => ['unknown', 'reading', 'sense'].includes(c.status) && c.pinyin && !/[?/]/.test(c.pinyin))
                .filter((c, i, all) => all.findIndex((x) => this.newWordKey(x) === this.newWordKey(c)) === i);
        }

        renderNewWords() {
            const candidates = this.newWordCandidates();
            if (!candidates.length) { this.el.newWords.innerHTML = ''; return; }
            this.el.newWords.innerHTML = `
                <div class="text-sm font-semibold text-gray-700 mb-1">Mots à ajouter avec l'expression</div>
                <p class="text-xs text-gray-500 mb-2">Ils sont enregistrés comme nouveaux mots, avec le même statut que l'expression.</p>
                ${candidates.map((c) => {
                    const key = this.newWordKey(c);
                    if (!this.newWords.has(key)) {
                        // A sense given with « : » (把:prendre) is the new word's French.
                        this.newWords.set(key, { checked: c.status !== 'reading', french: c.sense || '', english: '', themes: '', ai: {} });
                    }
                    const state = this.newWords.get(key);
                    const field = (name, placeholder, extra = '') => `<input type="text" data-nw="${name}" value="${escapeHtml(state[name])}"
                        placeholder="${placeholder}" ${extra} aria-label="${placeholder} de ${escapeHtml(c.hanzi)}"
                        class="min-h-10 px-2 py-1 border border-gray-300 rounded-md text-sm${state.ai[name] ? ' is-ai' : ''}" ${state.checked ? '' : 'disabled'}>`;
                    return `<div class="saisie-new-word" data-key="${escapeHtml(key)}">
                        <label class="inline-flex items-center gap-2 min-w-0">
                          <input type="checkbox" data-nw="checked" ${state.checked ? 'checked' : ''}>
                          <span class="hanzi text-lg">${escapeHtml(c.hanzi)}</span>
                          <span class="text-sm text-gray-600">${escapeHtml(displayPinyin(c.pinyin))}</span>
                        </label>
                        ${field('french', 'Français')}${field('english', 'Anglais')}${field('themes', 'Thème', 'list="saisie-theme-list"')}
                      </div>`;
                }).join('')}`;
        }

        onNewWordInput(event) {
            const row = event.target.closest('[data-key]');
            const state = row && this.newWords.get(row.dataset.key);
            if (!state) return;
            const name = event.target.dataset.nw;
            if (name === 'checked') {
                state.checked = event.target.checked;
                row.querySelectorAll('input[type="text"]').forEach((input) => { input.disabled = !state.checked; });
            } else if (['french', 'english', 'themes'].includes(name)) {
                state[name] = event.target.value;
                state.ai[name] = false;
                event.target.classList.remove('is-ai');
            }
        }

        /** Words checked to be added: [{hanzi, pinyin, french}]. */
        newWordsPayload() {
            if (this.kind !== 'expression') return [];
            return this.newWordCandidates()
                .map((c) => ({ c, state: this.newWords.get(this.newWordKey(c)) }))
                .filter(({ state }) => state?.checked)
                .map(({ c, state }) => ({ hanzi: c.hanzi, pinyin: c.pinyin, french: state.french.trim(),
                    english: state.english.trim(), themes: state.themes.trim() }));
        }

        /** `link`: optional {href, label} shown after the message. */
        setStatus(message, isError = false, link = null) {
            this.el.status.textContent = message;
            this.el.status.className = `text-sm ${isError ? 'text-red-700' : 'text-green-700'}`;
            if (link?.href) {
                const a = document.createElement('a');
                a.href = link.href;
                a.textContent = link.label;
                a.className = 'ml-2 underline font-semibold';
                this.el.status.append(a);
            }
        }

        async save(status, button = null) {
            const problem = this.entry.problem();
            if (problem) return this.setStatus(problem, true);
            if (this.entry.values().pinyin.includes('/')) {
                return this.setStatus('Choisissez la lecture des caractères en orange (plusieurs lectures possibles).', true);
            }
            if (!this.el.french.value.trim()) return this.setStatus('Indiquez la traduction en français.', true);
            const newWords = this.newWordsPayload();
            const untranslated = newWords.filter((w) => !w.french);
            if (untranslated.length) {
                return this.setStatus(`Indiquez le français des mots à ajouter (${untranslated.map((w) => w.hanzi).join(', ')}), ou décochez-les.`, true);
            }

            const payload = { ...this.values(), input_text: this.el.text.value.trim(), status, new_words: newWords };
            const buttons = [...this.el.form.querySelectorAll('button[type="submit"]'), this.el.cancel];
            this.setStatus('');
            await whileBusy(button, status === 'review' ? 'Envoi pour validation…' : 'Enregistrement…', async () => {
                try {
                    const data = this.editingId
                        ? await request(`${API}${this.editingId}`, payload)
                        : await request(API, payload);
                    (data.words || []).forEach((w) => this.list.upsert(w));
                    this.list.upsert(data.addition);
                    this.list.flash([data.addition, ...(data.words || [])].map((a) => a.id));
                    // Going through a Suivi table: on to its next row, or back to it after the last.
                    const r = this.review(data.addition.id);
                    if (r) {
                        const what = status === 'validated' ? 'Validé' : 'Enregistré';
                        if (this.go(1, { force: true })) {
                            this.setStatus(`✓ ${what}. Élément suivant (${r.index + 2} / ${r.ids.length}).`);
                        } else {
                            this.setStatus(`✓ ${what}. C’était le dernier : retour au tableau…`);
                            setTimeout(() => { window.location.href = r.back; }, 700);
                        }
                        return;
                    }
                    const proposed = status === 'review' && this.editingStatus !== 'review';
                    this.resetForm();
                    const added = (data.words || []).length;
                    const words = added ? ` (+ ${added} mot${added > 1 ? 's' : ''})` : '';
                    if (status === 'draft') {
                        this.setStatus(`✓ Enregistré${words} dans les brouillons.`);
                    } else {
                        this.setStatus(proposed ? `✓ Enregistré${words} et proposé à la validation.` : `✓ Modifications enregistrées${words}.`,
                            false, { href: this.validationUrl, label: 'Voir l’onglet Validation →' });
                    }
                } catch (err) {
                    this.setStatus(`Échec : ${err.message}`, true);
                }
            }, buttons);
        }

        edit(addition) {
            this.editingId = addition.id;
            this.editingStatus = addition.status;
            const label = this.statusLabels[addition.status] || addition.status;
            this.el.title.textContent = addition.status === 'draft' ? 'Modifier l’ajout' : `Modifier l’ajout (${label})`;
            this.el.cancel.hidden = false;
            // An addition already proposed (opened from the Validation tab)
            // keeps its status when saved; a draft can still be proposed.
            this.setSaveButtons(addition.status);
            // The text as it was typed; else (imports, AI, older additions)
            // rebuilt with a reading only where the lexicon needs one.
            this.el.text.value = addition.input_text
                || SaisieEntry.textFromStored(addition.hanzi, addition.pinyin, addition.kind, this.dico);
            this.newWords.clear();
            this.setKind(addition.kind);
            [this.el.french, this.el.english, this.el.themes].forEach((input) => input.classList.remove('is-ai'));
            this.el.french.value = addition.french;
            this.el.english.value = addition.english;
            this.el.themes.value = addition.themes;
            this.el.observations.value = addition.observations;
            this.renderMeaning();
            this.setStatus('');
            // A validator relisting « À valider » validates from here.
            const validate = document.getElementById('saisie-validate');
            if (validate) validate.hidden = !(addition.status === 'review' && AdditionList.canValidate());
            this.renderReviewNav();      // (after the validate button: the keys shown follow it)
            this.openedState = this.formState();
            this.el.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this.el.text.focus();
        }

        /** The Suivi rows this addition is one of: {ids, back, label, index}, or null. */
        review(id = this.editingId) {
            const nav = this.reviewNav;
            const index = nav && id ? nav.ids.indexOf(id) : -1;
            return index >= 0 ? { ...nav, index } : null;
        }

        renderReviewNav() {
            const box = document.getElementById('saisie-review-nav');
            if (!box) return;
            const r = this.review();
            box.hidden = !r;
            if (!r) { box.innerHTML = ''; return; }
            const esc = escapeHtml;
            box.innerHTML = `<a href="${esc(r.back)}" title="Alt+T">← Retour au tableau${r.label ? ` (${esc(r.label)})` : ''}</a>
                <span class="rn-pos">${r.index + 1} / ${r.ids.length}</span>
                <button type="button" data-nav="-1" ${r.index ? '' : 'disabled'} title="Élément précédent (Alt+↑)">‹ Précédent</button>
                <button type="button" data-nav="1" ${r.index < r.ids.length - 1 ? '' : 'disabled'} title="Élément suivant (Alt+↓)">Suivant ›</button>
                <span class="rn-keys" aria-hidden="true"><kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> précédent / suivant ·
                  <kbd>Ctrl</kbd>+<kbd>S</kbd> enregistrer${document.getElementById('saisie-validate')?.hidden === false
                    ? ' · <kbd>Alt</kbd>+<kbd>V</kbd> valider' : ''} · <kbd>Alt</kbd>+<kbd>T</kbd> tableau</span>`;
        }

        /** Keys (computer): Ctrl+S saves (« Enregistrer », the first button),
         *  Alt+V saves and validates (validators, « À valider »); from Suivi,
         *  Alt+↓ / Alt+Page↓ next, Alt+↑ / Alt+Page↑ previous, Alt+T back to
         *  the table. Not Alt+← →: the browser's back and forward. */
        onKey(event) {
            if (event.repeat) return;
            const submit = (button) => {
                if (!button || button.hidden || button.disabled) return;
                event.preventDefault();
                this.el.form.requestSubmit(button);
            };
            if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyS') {
                submit(this.el.form.querySelector('button[type="submit"]'));
                return;
            }
            if (!event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.code === 'KeyV') { submit(document.getElementById('saisie-validate')); return; }
            const r = this.review();
            if (!r) return;
            const step = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }[event.key];
            if (step) { event.preventDefault(); this.go(step); return; }
            if (event.code === 'KeyT') {
                event.preventDefault();
                if (this.openedState && this.formState() !== this.openedState
                    && !confirm('Les modifications de cet ajout ne sont pas enregistrées : les abandonner ?')) return;
                window.location.href = r.back;
            }
        }

        /** What the form holds, to tell whether it changed since opened. */
        formState() {
            return JSON.stringify([this.el.text.value, this.el.french.value, this.el.english.value, this.el.themes.value,
                this.el.observations.value, this.kind]);
        }

        /** The previous / next row of the Suivi table (the ones deleted since skipped). */
        go(delta, { force = false } = {}) {
            const r = this.review();
            if (!r) return false;
            if (!force && this.openedState && this.formState() !== this.openedState
                && !confirm('Les modifications de cet ajout ne sont pas enregistrées : les abandonner ?')) return false;
            for (let i = r.index + delta; i >= 0 && i < r.ids.length; i += delta) {
                const a = this.additions.find((x) => x.id === r.ids[i]);
                if (a) {
                    this.edit(a);
                    window.history.replaceState(null, '', `${window.location.pathname}?modifier=${a.id}`);
                    return true;
                }
            }
            return false;
        }

        /** "Enregistrer" saves with `status`; "proposer" only for a draft. */
        setSaveButtons(status) {
            const [save, propose] = this.el.form.querySelectorAll('button[type="submit"]');
            save.dataset.label ||= save.innerHTML;
            save.dataset.status = status;
            // An addition already proposed keeps its status: the button only saves the changes.
            save.innerHTML = status === 'draft' ? save.dataset.label
                : `✓ Enregistrer les modifications <small class="font-normal opacity-80">(statut inchangé : ${escapeHtml(this.statusLabels[status] || status)})</small>`;
            if (propose) propose.hidden = status !== 'draft';
        }

        resetForm() {
            this.editingId = null;
            this.openedState = null;
            const validate = document.getElementById('saisie-validate');
            if (validate) validate.hidden = true;
            this.editingStatus = null;
            this.el.title.textContent = 'Nouvel ajout';
            this.el.cancel.hidden = true;
            this.setSaveButtons('draft');
            this.el.form.reset();
            [this.el.french, this.el.english, this.el.themes].forEach((input) => input.classList.remove('is-ai'));
            this.clearSuggestion();
            this.newWords.clear();
            this.active = 0;
            this.updateText();
            this.renderReviewNav();
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('saisie-form')) window.saisiePage = new SaisiePage();
    });
})();
