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
    // A pending syllable (group 1, as SyllableInputModel), whitespace
    // (group 2), any other character (group 3); comments, (pins) and
    // :constraints are matched and skipped.
    static UNIT_RE = new RegExp(`${SyllableInputModel.SYLLABLE_RE.source}|(\\s+)|([\\s\\S])`, 'gu');

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
    static textFromStored(hanzi, pinyin, kind) {
        const plain = (t) => t.split(':')[0].replace(/\([^()]*\)/g, '');
        const hs = String(hanzi || '').trim().split(/\s+/).filter(Boolean);
        const ps = String(pinyin || '').trim().split(/\s+/).filter(Boolean);
        if (kind === 'word') {
            const h = hs.map(plain).join('');
            return ps.length ? `${h}(${ps.join('')})` : h;
        }
        if (ps.length !== hs.length) return hs.join(' ');
        return hs.map((h, i) => `${plain(h)}(${ps[i]})${h.includes(':') ? `:${h.split(':').slice(1).join(':')}` : ''}`).join(' ');
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
            return {
                token,
                hanzi: token.replace(/\([^()]*\)/g, ''),
                plain: this.sentence.parseToken(token).hanzi,
                pinyin: digits(known ? (Sentence.wordSyllables(data).join('') || data.pinyin) : this.sentence.resolveUnknownPinyin(token)),
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
        const tokens = this.tokens();
        const unknown = tokens.filter((t) => !t.pinyin || t.pinyin.includes('?'));
        if (unknown.length) {
            return `Lecture inconnue pour ${unknown.map((t) => t.plain).join(', ')} : retapez la syllabe et choisissez le caractère, `
                + 'ou indiquez la lecture entre parenthèses (三(sam1)).';
        }
        const ambiguous = tokens.filter((t) => t.pinyin.includes('/'));
        if (ambiguous.length) {
            return `Plusieurs lectures pour ${ambiguous.map((t) => `${t.plain} (${t.pinyin})`).join(', ')} : `
                + 'indiquez la bonne entre parenthèses (生(sen1)), ou retapez la syllabe et choisissez le caractère.';
        }
        return '';
    }

    /** Each word against the lexicon, as Sentence matched it (same
     *  characters, pinned readings agreeing). `additions`: the words
     *  already proposed (not rejected), not to propose again.
     *  status: 'known' | 'reading' (in the lexicon, read otherwise) |
     *  'proposed' | 'unknown' | 'incomplete'. */
    check(additions = []) {
        return this.tokens().map((t) => {
            const w = { hanzi: t.plain, pinyin: t.pinyin };
            if (t.pending || !t.plain) return { ...w, hanzi: t.token, status: 'incomplete' };
            if (t.match) return { ...w, status: 'known', entry: t.match };
            const proposed = additions.find((a) => a.kind === 'word' && a.status !== 'rejected'
                && a.hanzi === t.plain && a.pinyin.replace(/\s+/g, '') === t.pinyin);
            if (proposed) return { ...w, status: 'proposed', addition: proposed };
            const same = this.sentence.findMatches(t.plain, null, null).map((m) => m.dataset || m);
            if (same.length) return { ...w, status: 'reading', entries: same };
            return { ...w, status: 'unknown' };
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
            if (m[2] !== undefined) {
                if (this.kind !== 'word' && group?.length) group = null;
                continue;
            }
            if (m[1] === undefined && m[3] === undefined) continue; // (pin), :constraint, *comment*
            if (!group) startGroup();
            if (m[1] !== undefined) {
                group.push({ type: 'syl', index: syl++, syl: m[1] });
                charIndex += [...m[1]].length;
                continue;
            }
            const char = m[3];
            const t = tokens[this.kind === 'word' ? 0 : tokenIndex];
            let reading = pins[charIndex] || '';
            if (!reading && /\p{Script=Han}/u.test(char)) {
                const fromWord = t?.match ? Sentence.wordSyllables(t.match)[hanIndex] : '';
                reading = (fromWord || this.sentence?.resolveUnknownPinyin(char) || '')
                    .replace(/[¹²³⁴⁵⁶⁷⁸]/g, (c) => String('¹²³⁴⁵⁶⁷⁸'.indexOf(c) + 1));
            }
            if (/\p{Script=Han}/u.test(char)) hanIndex += 1;
            charIndex += 1;
            group.push({ type: 'char', char, reading });
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
                empty: 'Aucun brouillon.',
                onEdit: (a) => this.edit(a),
                onLoad: () => this.afterLoad(),
                onRemove: (id) => { if (this.editingId === id) this.resetForm(); },
            });
            this.kindButtons = [...this.el.form.querySelectorAll('[data-kind]')];
            this.suggestionBar = new SuggestionBar(this.el.suggestions, {
                onSelect: (index) => this.pickSuggestion(index),
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
            this.kindButtons.forEach((btn) => btn.addEventListener('click', () => this.setKind(btn.dataset.kind)));
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
            this.el.slots.addEventListener('compositionend', onSlotInput);
            this.el.form.addEventListener('submit', (event) => {
                event.preventDefault();
                // Enter in a field submits with the first button, "Enregistrer".
                const button = event.submitter || this.el.form.querySelector('button[type="submit"]');
                this.save(button?.dataset.status || 'draft', button);
            });
            this.el.cancel.addEventListener('click', () => this.resetForm());
            this.el.aiBtn?.addEventListener('click', () => this.suggest());
            this.el.aiResult?.addEventListener('click', (event) => {
                const btn = event.target.closest('[data-ai-use]');
                if (btn) this.useSuggestion(btn.dataset.aiUse);
            });
            // A field the AI filled stays tinted until the editor changes it.
            [this.el.french, this.el.english, this.el.themes].forEach((input) =>
                input.addEventListener('input', () => input.classList.remove('is-ai')));
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
            const example = typeof ReadingSourceSwitch !== 'undefined' && ReadingSourceSwitch.inputExample
                ? ReadingSourceSwitch.inputExample() : '';
            this.el.text.placeholder = example ? `ex. ${example}` : (kind === 'word' ? 'ex. wuk5ka1' : 'ex. ngai2 oi4 wuk5ka1');
            this.updateText();
        }

        /** The text field changed (typed, or the sources/system did). */
        updateText() {
            this.entry.setText(this.el.text.value, this.kind);
            this.active = Math.max(0, Math.min(this.active, this.entry.syllables.length - 1));
            this.renderAll();
        }

        /** The model rewrote the text (suggestion picked, character typed). */
        afterChange() {
            const focusText = document.activeElement === this.el.text;
            this.el.text.value = this.entry.text;
            // The syllable converted disappears: the next one takes its index.
            this.active = Math.max(0, Math.min(this.active, this.entry.syllables.length - 1));
            this.renderAll();
            const next = this.el.slots.querySelector(`[data-slot="${this.active}"]`);
            if (focusText) this.el.text.focus();
            else next?.focus();
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
                        new_words: this.kind === 'expression'
                            ? this.newWordCandidates().map((c) => ({ hanzi: c.hanzi, pinyin: c.pinyin })) : [],
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
            ['french', 'english', 'themes'].forEach((name) => {
                if (w[name]) { state[name] = w[name]; state.ai[name] = true; }
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
            inputs[fields[0]]?.focus();
        }

        renderSlots() {
            const groups = this.entry.units();
            this.el.slots.innerHTML = groups.map((group) => `<span class="saisie-word">${group.map((u) => u.type === 'syl'
                ? `<label class="saisie-slot"><input class="hanzi" data-slot="${u.index}" value="" inputmode="text" `
                    + `aria-label="Caractère pour ${escapeHtml(u.syl)}"><small>${escapeHtml(superscriptTones(u.syl))}</small></label>`
                : `<span class="saisie-slot is-char"><span class="hanzi saisie-char">${escapeHtml(u.char)}</span>`
                    + `<small>${escapeHtml(u.reading ? displayPinyin(u.reading) : ' ')}</small></span>`).join('')}</span>`).join('')
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
            this.suggestionBar.render(this.visible);
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

        /** The mixed line (pinyin + hanzi, as Sentence renders it). */
        renderPreview() {
            this.renderCheck();
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
                if (c.status === 'proposed') return `${escapeHtml(this.statusLabels[c.addition.status] || c.addition.status)} : « ${escapeHtml(c.addition.french || '?')} »`;
                return '';
            };
            if (this.kind === 'word') {
                const c = this.checks[0];
                const message = !c || c.status === 'incomplete' ? ''
                    : c.status === 'known' ? `Ce mot est déjà dans le lexique : ${describe(c)}.`
                    : c.status === 'proposed' ? `Ce mot est déjà proposé (${describe(c)}).`
                    : c.status === 'reading' ? `Ces caractères sont dans le lexique avec une autre lecture (${describe(c)}) : vérifiez la lecture.`
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
            return `${c.hanzi}|${c.pinyin}`;
        }

        /** The words to add with the expression: the unknown ones (checked
         *  by default) and the ones the lexicon reads otherwise (unchecked),
         *  once their reading is settled. */
        newWordCandidates() {
            return (this.checks || [])
                .filter((c) => (c.status === 'unknown' || c.status === 'reading') && c.pinyin && !/[?/]/.test(c.pinyin))
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
                        this.newWords.set(key, { checked: c.status === 'unknown', french: '', english: '', themes: '', ai: {} });
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
            if (!this.el.french.value.trim()) return this.setStatus('Indiquez la traduction en français.', true);
            const newWords = this.newWordsPayload();
            const untranslated = newWords.filter((w) => !w.french);
            if (untranslated.length) {
                return this.setStatus(`Indiquez le français des mots à ajouter (${untranslated.map((w) => w.hanzi).join(', ')}), ou décochez-les.`, true);
            }

            const payload = { ...this.values(), status, new_words: newWords };
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
            // Each word with its stored reading pinned: read back as saved.
            this.el.text.value = SaisieEntry.textFromStored(addition.hanzi, addition.pinyin, addition.kind);
            this.newWords.clear();
            this.setKind(addition.kind);
            [this.el.french, this.el.english, this.el.themes].forEach((input) => input.classList.remove('is-ai'));
            this.el.french.value = addition.french;
            this.el.english.value = addition.english;
            this.el.themes.value = addition.themes;
            this.el.observations.value = addition.observations;
            this.setStatus('');
            this.el.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this.el.text.focus();
        }

        /** "Enregistrer" saves with `status`; "proposer" only for a draft. */
        setSaveButtons(status) {
            const [save, propose] = this.el.form.querySelectorAll('button[type="submit"]');
            save.dataset.label ||= save.innerHTML;
            save.dataset.status = status;
            save.innerHTML = status === 'draft' ? save.dataset.label
                : `✓ Enregistrer (reste « ${escapeHtml(this.statusLabels[status] || status)} »)`;
            if (propose) propose.hidden = status !== 'draft';
        }

        resetForm() {
            this.editingId = null;
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
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('saisie-form')) window.saisiePage = new SaisiePage();
    });
})();
