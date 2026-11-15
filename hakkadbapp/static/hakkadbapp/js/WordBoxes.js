/* =========================================================================
   WordBoxes — the characters of a text in Sentence format, one box each,
   grouped by word, each word coloured by what the lexicon says of it.
   Replaces Sentence.js's old token badges on every page that edits such a
   text (Saisie, Écrire, Transcrire, Expressions):
   - a character read several ways: one button per reading, the chosen one
     pinned in the text (把(ba3));
   - between two boxes of a word: cut it; between two words: join them;
   - the words the lexicon knows, detected as the text is typed; when the
     text is cut otherwise, « ✂ Découper d'après le lexique » proposes it
     (SaisieEntry.segmentation), applied only on a tap;
   - under each word, its sense; tapped, every entry spelled so.
   The text is changed through a SaisieEntry; the page gets it back with
   onChange(text, what) and puts it in its own field.
   ========================================================================= */

const WORD_BOXES_CSS = `
.wb { display: flex; flex-direction: column; gap: 0.4rem; text-align: left; }
.wb-words { display: flex; flex-wrap: wrap; gap: 0.5rem 0.35rem; align-items: flex-start; }
.wb-break { flex-basis: 100%; height: 0; }
.wb-word { position: relative; display: inline-flex; flex-direction: column; align-items: stretch; gap: 2px; padding: 2px 2px 3px;
           border-radius: 0.5rem; background: #F6EFE4; border: 1px solid transparent; }
.wb-boxes { display: inline-flex; gap: 2px; align-items: flex-start; }
.wb-box { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; }
.wb-box small { font-size: 0.7rem; line-height: 1.1; color: #8C8478; white-space: nowrap; }
.wb-box .wb-char { display: flex; align-items: center; justify-content: center; width: 2.4rem; height: 2.4rem;
                   font-size: 1.35rem !important; line-height: 1; border: 1px solid #DDD0BD; border-radius: 0.375rem;
                   background: #fff; color: #261F1C; }
.wb-box.is-pinned small { color: #3A3430; font-weight: 700; }
.wb-box.is-punct .wb-char { width: 1.3rem; border-color: transparent; background: transparent; }
.wb-box input { width: 2.4rem; height: 2.4rem; text-align: center; font-size: 1.35rem; border: 1px dashed #DDD0BD;
                border-radius: 0.375rem; background: #fff7ed; }
.wb-box input:focus { outline: none; }
.wb-box.is-syl .wb-char { border-style: dashed; background: #fff7ed; color: #B5AA9B; font-size: 0.9rem !important; }
.wb-box.is-active input, .wb-box.is-active .wb-char { border-color: var(--color-brand-gold, #C9A227); box-shadow: 0 0 0 2px var(--color-brand-gold, #C9A227); }
.wb-box.is-text .wb-text { display: flex; align-items: center; min-height: 2.4rem; padding: 0 0.6rem; font-size: 1rem; font-style: italic;
                           border: 1px dashed #B8A98F; border-radius: 0.375rem; background: #fff; color: #261F1C; }
/* New character / new reading: the Suivi's colours (char_review.js). */
.wb-box.is-new-char .wb-char, .wb-legend .is-new-char { background: #fee2e2; color: #991b1b; box-shadow: inset 0 -2px #ef4444; }
.wb-box.is-new-reading .wb-char, .wb-legend .is-new-reading { background: #ffedd5; color: #9a3412; box-shadow: inset 0 -2px #f97316; }
.wb-box.is-new-reading small { color: #9a3412; font-weight: 700; }
/* Several readings: a warning in mauve, whatever the word's colour; one
   button per reading, the chosen one is pinned. */
.wb-box.is-ambiguous { position: relative; }
.wb-box.is-ambiguous .wb-char, .wb-legend .is-ambiguous { background: #fae8ff; color: #86198f; border: 2px solid #c026d3; box-shadow: inset 0 -2px #c026d3; }
.wb-box.is-ambiguous .wb-warn { position: absolute; top: -0.35rem; right: -0.3rem; z-index: 1; display: flex; align-items: center; justify-content: center;
                                width: 1rem; height: 1rem; border-radius: 9999px; background: #c026d3; color: #fff; font-size: 0.6rem; line-height: 1; }
.wb-word.has-ambiguous { outline: 2px dashed #c026d3; outline-offset: 1px; }
.wb-ambig { display: flex; flex-direction: column; gap: 3px; }
.wb-ambig button { min-height: 1.9rem; min-width: 2.6rem; padding: 0 0.35rem; border: 1px solid #e879f9; border-radius: 0.4rem;
                   background: #fdf4ff; color: #86198f; font-size: 0.8rem; font-weight: 700; }
.wb-ambig button:hover { background: #fae8ff; }
.wb-ambig button.is-hl { background: #c026d3; border-color: #a21caf; color: #fff; box-shadow: 0 0 0 2px #f0abfc; }
/* Cut a word between two boxes; join two words. */
.wb-gap { position: relative; flex: none; width: 0.8rem; align-self: stretch; min-height: 2.4rem; margin: 0 -0.2rem;
          border: 0; background: transparent; cursor: pointer; touch-action: manipulation; }
.wb-gap::after { content: ''; position: absolute; left: 50%; top: 0.3rem; height: 1.8rem; border-left: 2px dotted #C9B99F; }
.wb-gap:hover::after, .wb-gap:focus-visible::after { border-left: 2px solid var(--color-brand-gold, #C9A227); }
.wb-gap.is-join { width: 1.2rem; margin: 0 -0.3rem; align-self: flex-start; }
.wb-gap.is-join::after { content: '⌒'; border: 0; left: 0; right: 0; top: 0.7rem; height: auto; text-align: center; color: #B8A98F; font-size: 1rem; line-height: 1; }
.wb-gap.is-join:hover::after, .wb-gap.is-join:focus-visible::after { color: var(--color-brand-gold, #C9A227); border: 0; }
/* The word against the lexicon. */
.wb-gloss { display: block; max-width: 100%; min-height: 1.2rem; padding: 0 0.3rem; border: 0; border-radius: 0.3rem; background: transparent;
            font-size: 0.7rem; line-height: 1.2rem; text-align: center; color: inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.wb-gloss b { font-weight: 700; margin-left: 0.15rem; }
.wb-word.is-known { background: #dcfce7; border-color: #86efac; color: #14532d; }
.wb-word.is-multi { background: #dbeafe; border-color: #93c5fd; color: #1e3a8a; }
.wb-word.is-sense, .wb-word.is-reading { background: #fef3c7; border-color: #fcd34d; color: #92400e; }
/* Words of the additions (Saisie), by status: not in the lexicon yet. */
.wb-word.is-add-draft { background: #f1f5f9; border: 1px dashed #94a3b8; color: #334155; }
.wb-word.is-add-review { background: #e0e7ff; border-color: #a5b4fc; color: #3730a3; }
.wb-word.is-add-validated { background: #ccfbf1; border-color: #5eead4; color: #115e59; }
.wb-gloss .wb-tag { margin-right: 0.2rem; padding: 0 0.25rem; border-radius: 0.25rem; background: rgb(255 255 255 / .7); font-size: 0.6rem; font-weight: 700; }
.wb-pop a { color: #9B1C1C; font-weight: 600; text-decoration: underline; }
.wb-propose { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; margin: 0.35rem 0.2rem 0.15rem; }
.wb-propose input { flex: 1 1 8rem; min-width: 0; min-height: 2rem; padding: 0.15rem 0.45rem; border: 1px solid #DDD0BD; border-radius: 0.375rem; font-size: 0.85rem; }
.wb-propose button { min-height: 2rem; padding: 0 0.6rem; border-radius: 0.375rem; background: #9B1C1C; color: #fff; font-weight: 700; font-size: 0.8rem; }
.wb-propose button:disabled { opacity: 0.5; }
.wb-propose-msg { flex-basis: 100%; font-size: 0.75rem; }
.wb-propose-msg.is-error { color: #b91c1c; }
.wb-word.is-unknown { background: #fee2e2; border-color: #fca5a5; color: #991b1b; }
.wb-word.is-text { background: #F8F5F0; border-color: #E8DFD2; color: #6E655C; }
.wb-word.is-punct { background: transparent; }
.wb-word.is-incomplete { background: #F6EFE4; color: #8C8478; }
.wb-pop { position: absolute; top: 100%; left: 0; z-index: 25; margin-top: 2px; min-width: 12rem; max-width: min(20rem, 90vw);
          padding: 0.35rem; border: 1px solid #E8DFD2; border-radius: 0.5rem; background: #fff; color: #261F1C;
          box-shadow: 0 6px 16px rgb(0 0 0 / .12); font-size: 0.8rem; line-height: 1.3; }
.wb-pop[hidden] { display: none; }
.wb-pop p { margin: 0.15rem 0.2rem; color: #6E655C; }
.wb-pop ul { display: grid; gap: 0.1rem; margin: 0; padding: 0; list-style: none; }
.wb-pop li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.1rem 0.45rem; padding: 0.25rem 0.3rem; border-radius: 0.3rem; }
.wb-pop li + li { border-top: 1px solid #F1EBE2; }
.wb-pop .hanzi { font-size: 1.05rem !important; font-weight: 600; }
.wb-pop i { color: #6E655C; }
.wb-pop .wb-cat { font-size: 0.65rem; padding: 0 0.3rem; border-radius: 0.25rem; background: #F1EBE2; color: #6E655C; }
.wb-segment { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem 0.6rem; padding: 0.35rem 0.6rem; border-radius: 0.5rem;
              background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a; font-size: 0.85rem; }
.wb-segment .hanzi { font-size: 1.05rem !important; letter-spacing: 0.02em; }
.wb-segment button { min-height: 2rem; padding: 0.15rem 0.7rem; border-radius: 0.4rem; background: #1d4ed8; color: #fff; font-weight: 700; font-size: 0.8rem; }
.wb-legend { display: flex; flex-wrap: wrap; gap: 0.15rem 0.7rem; font-size: 0.72rem; color: #6E655C; }
.wb-legend span { display: inline-flex; align-items: center; gap: 0.25rem; }
.wb-legend i { display: inline-block; width: 0.75rem; height: 0.75rem; border-radius: 0.2rem; border: 1px solid; }
.wb-legend .is-new-char, .wb-legend .is-new-reading, .wb-legend .is-ambiguous { padding: 0 0.15rem; border-radius: 0.2rem; }
.wb-keys { font-size: 0.68rem; color: #8C8478; }
@media (hover: none) and (pointer: coarse) { .wb-keys { display: none; } }
.wb-empty { font-size: 0.85rem; color: #9ca3af; }
@media (max-width: 640px) { .wb-ambig button { min-height: 2.5rem; min-width: 3.4rem; font-size: 0.9rem; } }
`;

class WordBoxes {
    /** Colours of the words, and what they mean (the legend). */
    static STATUS = {
        known: { label: 'dans le lexique', colour: '#86efac', bg: '#dcfce7' },
        multi: { label: 'plusieurs entrées : touchez pour voir', colour: '#93c5fd', bg: '#dbeafe' },
        reading: { label: 'dans le lexique, autre lecture', colour: '#fcd34d', bg: '#fef3c7' },
        sense: { label: 'nouveau sens', colour: '#fcd34d', bg: '#fef3c7' },
        'add-draft': { label: 'ajout en brouillon', colour: '#94a3b8', bg: '#f1f5f9', tag: 'brouillon' },
        'add-review': { label: 'ajout à valider', colour: '#a5b4fc', bg: '#e0e7ff', tag: 'à valider' },
        'add-validated': { label: 'ajout validé, pas encore au lexique', colour: '#5eead4', bg: '#ccfbf1', tag: 'validé' },
        unknown: { label: 'inconnu du lexique', colour: '#fca5a5', bg: '#fee2e2' },
        text: { label: 'texte gardé tel quel', colour: '#E8DFD2', bg: '#F8F5F0' },
    };

    static injectCss() {
        if (typeof document === 'undefined' || !document.head || document.getElementById('word-boxes-css')) return;
        const style = document.createElement('style');
        style.id = 'word-boxes-css';
        style.textContent = WORD_BOXES_CSS;
        document.head.appendChild(style);
    }

    static escape(text) {
        return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    }

    /** `onChange(text, what)`: the text rewritten ('pin', 'split', 'join',
     *  'segment'). `slotInputs`: a syllable left to convert is a field
     *  where its character can be typed (the page listens to [data-slot]).
     *  `readOnly`: no button, no gap -- what the text says, nothing more. */
    // ---- the additions (Saisie): words proposed, not in the lexicon yet -----

    static ADDITIONS_API = '/api/ajouts/';
    static SAISIE_URL = '/saisie/';
    static additions = null;     // [] until loaded (or for a reader: the API is for editors)

    /** Loads the additions once for the page; every WordBoxes re-renders. */
    static loadAdditions() {
        if (WordBoxes._loading || typeof fetch === 'undefined') return;
        WordBoxes._loading = fetch(WordBoxes.ADDITIONS_API, { credentials: 'same-origin' })
            .then((r) => (r.ok ? r.json() : { additions: [] }))
            .then((data) => { WordBoxes.setAdditions(data.additions || []); })
            .catch(() => {});
    }

    static setAdditions(list) {
        WordBoxes.additions = list.filter((a) => a.status !== 'rejected');
        if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
            document.dispatchEvent?.(new CustomEvent('word-additions-change'));
        }
    }

    static async post(url, payload) {
        const token = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
        const response = await fetch(url, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': decodeURIComponent(token) },
            body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
        return data;
    }

    /** `propose`: an unknown word's popup offers « ＋ Brouillon » (its
     *  French typed there), a word addition saved as a draft for the Saisie;
     *  `from`: its observation (« Depuis Transcrire »).
     *  `additions: false`: the page gives its own (Saisie). */
    constructor(container, { onChange, slotInputs = false, readOnly = false, legend = true, propose = false, from = '', additions = true } = {}) {
        WordBoxes.injectCss();
        this.container = container;
        this.onChange = onChange;
        this.slotInputs = slotInputs;
        this.readOnly = readOnly;
        this.legend = legend;
        this.propose = propose && !readOnly;
        this.from = from;
        this.words = [];          // per word box: what « ＋ Brouillon » saves
        this.lastOptions = {};
        if (additions) WordBoxes.loadAdditions();
        this.entry = null;
        this.open = -1;           // word whose entries are shown
        this.proposal = null;     // the text cut after the lexicon
        this.choice = -1;         // reading button highlighted from the keyboard (Tab)
        this.dismissed = false;   // Échap: Tab back to its usual role
        container.classList.add('wb');

        // Tapping a button never takes the focus (and the caret) from the field typed in.
        ['mousedown', 'pointerdown'].forEach((type) => container.addEventListener(type, (event) => {
            if (event.target.closest('button')) event.preventDefault();
        }));
        container.addEventListener('click', (event) => this.handleClick(event));
        // Entrée in the French of « ＋ Brouillon »: saved.
        container.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || !event.target.matches?.('[data-propose-fr]')) return;
            event.preventDefault();
            event.stopPropagation();
            this.proposeDraft(Number(event.target.closest('[data-propose]').dataset.propose));
        });
        if (typeof document !== 'undefined') {
            // (An editor closed since -- off the page -- stays as it is.)
            document.addEventListener('word-additions-change', () => {
                if (this.entry && this.container.isConnected !== false) this.render(this.entry, this.lastOptions);
            });
            document.addEventListener('click', (event) => {
                if (this.open >= 0 && !container.contains(event.target)) this.toggle(-1);
            });
        }
    }

    handleClick(event) {
        const entry = this.entry;
        if (!entry) return;
        const target = event.target;
        if (target.closest('[data-segment]')) {
            if (this.proposal) this.onChange?.(this.proposal, 'segment');
            return;
        }
        const gap = target.closest('[data-split], [data-join-from]');
        if (gap) {
            const done = gap.dataset.split !== undefined
                ? entry.splitAt([Number(gap.dataset.split)])
                : entry.joinAt(Number(gap.dataset.joinFrom), Number(gap.dataset.joinTo));
            if (done) this.onChange?.(entry.text, gap.dataset.split !== undefined ? 'split' : 'join');
            return;
        }
        const pin = target.closest('[data-pin]');
        if (pin) {
            if (entry.pinAt(Number(pin.dataset.pin), pin.dataset.reading)) this.onChange?.(entry.text, 'pin');
            return;
        }
        const go = target.closest('[data-propose-go]');
        if (go) { this.proposeDraft(Number(go.closest('[data-propose]').dataset.propose)); return; }
        const gloss = target.closest('[data-gloss]');
        if (gloss) this.toggle(Number(gloss.dataset.gloss) === this.open ? -1 : Number(gloss.dataset.gloss));
    }

    // ---- keyboard (WordBoxes.bindKeys) ------------------------------------

    /** The reading buttons, in text order. */
    choices() {
        return [...(this.container.querySelectorAll?.('[data-pin]') || [])];
    }

    get active() {
        return !this.dismissed && this.choices().length > 0;
    }

    /** Tab / Maj+Tab: the next / previous reading highlighted. */
    moveChoice(delta) {
        const n = this.choices().length;
        if (!n) return;
        this.choice = this.choice < 0 ? (delta > 0 ? 0 : n - 1) : (this.choice + delta + n) % n;
        this.paintChoice();
    }

    paintChoice() {
        this.choices().forEach((b, i) => {
            b.classList.toggle('is-hl', i === this.choice);
            if (i === this.choice) b.scrollIntoView?.({ block: 'nearest' });
        });
    }

    /** Entrée: the highlighted reading pinned. False when none is. */
    applyChoice() {
        const b = this.choices()[this.choice];
        if (!b || !this.entry?.pinAt(Number(b.dataset.pin), b.dataset.reading)) return false;
        this.onChange?.(this.entry.text, 'pin');
        return true;
    }

    /** Ctrl+Entrée: the lexicon's segmentation applied. */
    applySegment() {
        if (!this.proposal) return false;
        this.onChange?.(this.proposal, 'segment');
        return true;
    }

    /** Keys of a field typed in (or of the fields `accepts` takes), as in a
     *  Chinese input method:
     *  - suggestions shown: Tab / Maj+Tab move the highlighted tile, Entrée
     *    picks it (`pick(index)`), Échap closes them;
     *  - then, characters with several readings: Tab / Maj+Tab go from
     *    reading to reading, Entrée pins the highlighted one, Échap gives
     *    Tab back its usual role;
     *  - Ctrl+Entrée: « Découper ainsi » (the lexicon's segmentation).
     *  Maj+Entrée is never taken (new line). */
    static bindKeys(target, { bar, boxes, pick, accepts = null }) {
        target.addEventListener('keydown', (event) => {
            if (event.isComposing || event.altKey || event.metaKey) return;
            if (accepts && !accepts(event.target)) return;
            const tab = event.key === 'Tab' && !event.ctrlKey;
            const enter = event.key === 'Enter' && !event.shiftKey;
            const escape = event.key === 'Escape';
            if (enter && event.ctrlKey) {
                if (boxes?.applySegment()) event.preventDefault();
                return;
            }
            if (event.ctrlKey) return;
            const take = () => { event.preventDefault(); event.stopPropagation(); };
            if (bar?.active) {
                if (tab) { take(); bar.move(event.shiftKey ? -1 : 1); }
                else if (enter) { take(); pick(bar.highlight); }
                else if (escape) { take(); bar.dismiss(); }
                return;
            }
            if (boxes?.active) {
                if (tab) { take(); boxes.moveChoice(event.shiftKey ? -1 : 1); }
                else if (enter && boxes.choice >= 0) { take(); boxes.applyChoice(); }
                else if (escape && boxes.choice >= 0) { take(); boxes.dismissed = true; boxes.choice = -1; boxes.paintChoice(); }
            }
        });
        // Typing again: Tab back on the readings.
        target.addEventListener('input', () => { if (boxes) boxes.dismissed = false; });
    }

    /** « ＋ Brouillon »: the word saved as a draft addition (the Saisie
     *  completes it later: English, theme…). */
    async proposeDraft(g) {
        const word = this.words[g];
        const box = this.container.querySelector?.(`[data-propose="${g}"]`);
        if (!word || !box) return;
        const input = box.querySelector('[data-propose-fr]');
        const button = box.querySelector('[data-propose-go]');
        const msg = box.querySelector('.wb-propose-msg');
        const french = (input?.value || '').trim();
        const say = (text, error = false) => { msg.textContent = text; msg.classList.toggle('is-error', error); };
        if (!french) { say('Indiquez le français.', true); input?.focus(); return; }
        button.disabled = true;
        say('Enregistrement…');
        try {
            const data = await WordBoxes.post(WordBoxes.ADDITIONS_API, {
                kind: 'word', status: 'draft', hanzi: word.hanzi, pinyin: word.pinyin, french,
                input_text: word.token, observations: this.from,
            });
            WordBoxes.setAdditions([...(WordBoxes.additions || []), data.addition]);
        } catch (err) {
            button.disabled = false;
            say(`Échec : ${err.message}`, true);
        }
    }

    toggle(index) {
        this.open = index;
        this.container.querySelectorAll('.wb-pop').forEach((pop) => { pop.hidden = Number(pop.dataset.pop) !== index; });
        this.container.querySelectorAll('[data-gloss]').forEach((b) => b.setAttribute('aria-expanded', String(Number(b.dataset.gloss) === index)));
    }

    /** Stored reading (tone digits) in the "J'affiche en" system. */
    display(reading) {
        const s = this.entry?.sentence;
        return s ? s.displayPinyin(reading) : String(reading || '');
    }

    /** The lexicon's readings of a character (stored notation, tone digits). */
    lexiconReadings(char) {
        const list = this.entry?.dico?.lexiconPronunciations || [];
        const key = (p) => (p.storedKey ? p.storedKey() : `${p.initial}${p.final}${p.tone ?? ''}`);
        return [...new Set(list.filter((p) => p.simp === char || p.trad === char).map(key))];
    }

    /** 'new-char' (absent from the lexicon), 'new-reading' (a reading it
     *  doesn't give that character) or ''. */
    charState(char, reading) {
        if (!/\p{Script=Han}/u.test(char || '') || !this.entry?.dico?.lexiconPronunciations) return '';
        const known = this.lexiconReadings(char);
        if (!known.length) return 'new-char';
        if (!reading || reading.includes('/')) return '';
        return known.includes(reading) ? '' : 'new-reading';
    }

    /** `active`: the syllable whose suggestions are shown; `additions`:
     *  the words already proposed (Saisie). */
    render(entry, options = {}) {
        const { active = -1, additions = WordBoxes.additions || [] } = options;
        this.entry = entry;
        this.lastOptions = options;
        this.words = [];
        const tokens = entry.tokens();
        const esc = WordBoxes.escape;
        const groups = entry.units();
        const checks = entry.text.trim() ? entry.check(additions) : [];
        this.proposal = this.readOnly ? null : entry.segmentation();
        if (!groups.length) {
            this.container.innerHTML = '<span class="wb-empty">Les cases apparaissent quand vous tapez le texte.</span>';
            return;
        }
        const label = (u) => (u.type === 'char' ? u.char : u.type === 'syl' ? u.syl : u.text);
        const seen = new Set();
        let newReadings = [];

        const box = (u) => {
            if (u.type === 'text') {
                return `<span class="wb-box is-text" title="Texte gardé tel quel"><span class="wb-text">${esc(u.text || '…')}</span></span>`;
            }
            if (u.type === 'syl') {
                const cls = `wb-box is-syl${u.index === active ? ' is-active' : ''}`;
                return this.slotInputs && !this.readOnly
                    ? `<label class="${cls}"><input class="hanzi" data-slot="${u.index}" value="" inputmode="text" aria-label="Caractère pour ${esc(u.syl)}">`
                      + `<small>${esc(this.display(u.syl))}</small></label>`
                    : `<span class="${cls}" title="Syllabe à convertir"><span class="wb-char">?</span><small>${esc(u.syl)}</small></span>`;
            }
            if (!/\p{Script=Han}/u.test(u.char) && u.char !== '-') {
                return `<span class="wb-box is-punct"><span class="hanzi wb-char">${esc(Sentence.hanPunct(u.char))}</span><small> </small></span>`;
            }
            if (u.reading.includes('/') && !this.readOnly) {
                seen.add('ambiguous');
                return `<span class="wb-box is-ambiguous" title="Lecture ambiguë : choisissez la bonne">`
                    + `<span class="wb-warn" aria-hidden="true">⚠</span>`
                    + `<span class="hanzi wb-char">${esc(u.char)}</span><span class="wb-ambig">`
                    + u.reading.split('/').map((r) => `<button type="button" data-pin="${u.pos}" data-reading="${esc(r)}"`
                        + ` aria-label="Lire ${esc(u.char)} ${esc(this.display(r))}">${esc(this.display(r))}</button>`).join('')
                    + '</span></span>';
            }
            const state = this.charState(u.char, u.reading);
            if (state) seen.add(state);
            const title = state === 'new-char' ? 'Caractère absent du lexique'
                : state === 'new-reading' ? `Lecture nouvelle — le lexique lit ce caractère : ${this.lexiconReadings(u.char).map((r) => this.display(r)).join(', ')}`
                : u.pinned ? 'Lecture choisie' : '';
            if (state === 'new-reading') newReadings.push(`${u.char} : ${this.lexiconReadings(u.char).map((r) => this.display(r)).join(', ')}`);
            const shown = u.char === '-' ? '?' : u.char;
            return `<span class="wb-box${state ? ` is-${state}` : ''}${u.pinned ? ' is-pinned' : ''}"${title ? ` title="${esc(title)}"` : ''}>`
                + `<span class="hanzi wb-char">${esc(shown)}</span><small>${esc(u.reading ? this.display(u.reading) : ' ')}</small></span>`;
        };
        const splitGap = (prev, u) => (this.readOnly || prev.type === 'text' || u.type === 'text' ? ''
            : `<button type="button" class="wb-gap" data-split="${u.pos}" title="Couper ici"
                aria-label="Couper entre ${esc(label(prev))} et ${esc(label(u))}"></button>`);
        const between = (prev, next) => this.entry.text.slice(prev[prev.length - 1].end, next[0].pos);
        const joinGap = (prev, next) => (this.readOnly || !prev?.length || /\n/.test(between(prev, next))
            || prev.some((u) => u.type === 'text') || next.some((u) => u.type === 'text') ? ''
            : `<button type="button" class="wb-gap is-join" data-join-from="${prev[prev.length - 1].end}" data-join-to="${next[0].pos}"
                title="Recoller ces deux mots" aria-label="Recoller ${esc(prev.map(label).join(''))} et ${esc(next.map(label).join(''))}"></button>`);

        const words = groups.map((group, g) => {
            const c = checks[group.token] || null;
            const status = this.status(c);
            if (status && status !== 'punct' && status !== 'incomplete') seen.add(status);
            const lead = g && /\n/.test(between(groups[g - 1], group)) ? '<span class="wb-break"></span>' : joinGap(groups[g - 1], group);
            const boxes = group.map((u, k) => (k ? splitGap(group[k - 1], u) : '') + box(u)).join('');
            const gloss = this.gloss(c, status);
            if (c) this.words[g] = { hanzi: c.hanzi, pinyin: c.pinyin, token: tokens[group.token]?.token || '' };
            const ambiguous = !this.readOnly && group.some((u) => u.type === 'char' && u.reading.includes('/'));
            return `${lead}<span class="wb-word${status ? ` is-${status}` : ''}${ambiguous ? ' has-ambiguous' : ''}">`
                + `<span class="wb-boxes">${boxes}</span>`
                + (gloss ? `<button type="button" class="wb-gloss" data-gloss="${g}" aria-expanded="${g === this.open}" title="${esc(gloss.title)}">${gloss.html}</button>`
                    + `<div class="wb-pop" data-pop="${g}"${g === this.open ? '' : ' hidden'}>${this.details(c, status, g)}</div>` : '')
                + '</span>';
        }).join('');

        const proposal = this.proposal
            ? `<div class="wb-segment">✂ Découpage d’après le lexique : <span class="hanzi">${esc(this.proposal.replace(/\([^()]*\)/g, '').replace(/[«»]/g, ''))}</span>
                <button type="button" data-segment title="Ctrl+Entrée">Découper ainsi</button><span class="wb-keys">Ctrl+Entrée</span></div>` : '';
        this.container.innerHTML = `${proposal}<div class="wb-words">${words}</div>${this.legend ? this.renderLegend(seen, newReadings) : ''}`;
        // The highlighted reading stays where it was (after a pin: the next one).
        const n = this.choices().length;
        if (!n) this.choice = -1;
        else if (this.choice >= n) this.choice = n - 1;
        if (this.choice >= 0) this.paintChoice();
    }

    /** A word's colour: its check status, 'multi' for a word with several
     *  entries and no :sense to choose among them. */
    status(c) {
        if (!c) return '';
        if (c.status === 'known' && !c.sense && (c.entries?.length || 0) > 1) return 'multi';
        if (c.status === 'proposed') return `add-${c.addition?.status || 'draft'}`;
        return c.status;
    }

    gloss(c, status) {
        if (!c || status === 'punct') return null;
        const esc = WordBoxes.escape;
        const short = (s, max = 16) => (s.length > max ? `${s.slice(0, max)}…` : s);
        if (status === 'known' || status === 'multi') {
            const fr = c.sense || c.entry?.french || '?';
            const more = status === 'multi' ? c.entries.length - 1 : 0;
            return { html: `${esc(short(fr))}${more ? `<b>+${more}</b>` : ''}`, title: fr };
        }
        if (status.startsWith('add-')) {
            const tag = WordBoxes.STATUS[status]?.tag || '';
            const fr = c.addition?.french || '?';
            return { html: `<span class="wb-tag">${esc(tag)}</span>${esc(short(fr, 12))}`, title: `${WordBoxes.STATUS[status]?.label} : ${fr}` };
        }
        const text = { reading: 'autre lecture', sense: `« ${c.sense} » ?`,
            unknown: c.sense ? `« ${c.sense} »` : 'inconnu', text: 'texte', incomplete: '…' }[status] || '';
        return text ? { html: esc(short(text)), title: WordBoxes.STATUS[status]?.label || text } : null;
    }

    /** The popup of a word: every entry spelled so, or what is missing. */
    details(c, status, g = -1) {
        const esc = WordBoxes.escape;
        const entries = (list) => `<ul>${list.map((d) => `<li><span class="hanzi">${esc((typeof pickHanzi === 'function' ? pickHanzi(d) : d.simp) || d.simp || '?')}</span>
            <span>${esc(this.display(Sentence.wordSyllables(d).join('') || d.pinyin || ''))}</span>
            <span>${esc(d.french || '?')}</span>${d.english ? `<i lang="en">${esc(d.english)}</i>` : ''}
            ${d.category ? `<span class="wb-cat">${esc(d.category)}</span>` : ''}</li>`).join('')}</ul>`;
        if (status === 'known' || status === 'multi') {
            return `${status === 'multi' ? `<p>${c.entries.length} entrées pour ${esc(c.hanzi)} : précisez le sens avec « : » (${esc(c.hanzi)}:sens) si besoin.</p>` : ''}${entries(c.entries || [c.entry])}`;
        }
        const propose = this.proposeForm(c, g);
        if (status === 'reading') return `<p>Dans le lexique avec une autre lecture que ${esc(this.display(c.pinyin))} :</p>${entries(c.entries)}${propose}`;
        if (status === 'sense') return `<p>Sens « ${esc(c.sense)} » absent ; le lexique a :</p>${entries(c.entries)}${propose}`;
        if (status.startsWith('add-')) {
            const a = c.addition || {};
            return `<p>${esc(WordBoxes.STATUS[status]?.label || '')} : <span class="hanzi">${esc(a.hanzi)}</span> ${esc(this.display(a.pinyin))}
                « ${esc(a.french || '?')} »${a.english ? ` <i lang="en">${esc(a.english)}</i>` : ''}${a.created_by ? ` — ${esc(a.created_by)}` : ''}</p>
                ${a.id ? `<p><a href="${WordBoxes.SAISIE_URL}?modifier=${a.id}">Ouvrir dans la Saisie</a></p>` : ''}`;
        }
        if (status === 'unknown') return `<p>${esc(c.hanzi)} ${esc(this.display(c.pinyin))} : absent du lexique.</p>${propose}`;
        if (status === 'text') return '<p>Texte entre « » : recopié tel quel dans le pinyin et les caractères.</p>';
        return '<p>Des syllabes restent à convertir.</p>';
    }

    /** « ＋ Brouillon » in a popup (`propose`), once the reading is sure. */
    proposeForm(c, g) {
        if (!this.propose || g < 0 || !c) return '';
        const esc = WordBoxes.escape;
        if (!c.pinyin || /[/?]/.test(c.pinyin)) return '<p>Choisissez d’abord la lecture pour le proposer en brouillon.</p>';
        return `<div class="wb-propose" data-propose="${g}">
            <input type="text" data-propose-fr value="${esc(c.sense || '')}" placeholder="Français" aria-label="Français de ${esc(c.hanzi)}">
            <button type="button" data-propose-go title="Enregistrer ce mot en brouillon dans la Saisie">＋ Brouillon</button>
            <span class="wb-propose-msg" aria-live="polite"></span></div>`;
    }

    renderLegend(seen, newReadings) {
        const esc = WordBoxes.escape;
        const items = Object.entries(WordBoxes.STATUS).filter(([key]) => seen.has(key))
            .map(([, s]) => `<span><i style="background:${s.bg};border-color:${s.colour}"></i>${esc(s.label)}</span>`);
        if (seen.has('new-char')) items.push('<span><span class="hanzi is-new-char">字</span> caractère absent du lexique</span>');
        if (seen.has('new-reading')) items.push(`<span><span class="hanzi is-new-reading">字</span> lecture que le lexique ne donne pas (${esc(newReadings.join(' · '))})</span>`);
        if (seen.has('ambiguous')) items.push('<span><span class="hanzi is-ambiguous">字</span> ⚠ lecture ambiguë : touchez la bonne sous le caractère'
            + '<span class="wb-keys">(clavier : Tab puis Entrée)</span></span>');
        return items.length ? `<div class="wb-legend">${items.join('')}</div>` : '';
    }
}
