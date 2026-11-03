/* =========================================================================
   CharacterInput — shared romanization -> hanzi suggestion engine + touch
   -friendly picker UI. Used by both the transcription editor
   (transcripter.js, one instance per label) and the standalone
   pinyin -> hanzi converter page (converter.js).
   ========================================================================= */

/** Parses a run of romanized syllables out of free text and looks up
 *  dictionary matches for each one. Subclasses (HakkaText, TextModel) layer
 *  page-specific fields (pinyin/french/sentences...) on top of this. */
class SyllableInputModel {
    // Settled text to skip (*comments*, (pinyin) annotations, :constraints),
    // or a typed syllable: letters of any script but Han (so ε, ɔ, ŋ, ṣ...
    // of other transcription systems count), combining marks, apostrophes
    // (aspiration: k'ak7), then an optional tone digit or "_" (no tone).
    static SYLLABLE_RE = /\*[^*]*\*|\([^()]*\)|:[^\s]+|((?:(?!\p{Script=Han})\p{L})(?:(?!\p{Script=Han})[\p{L}\p{M}'’])*[_0-8]?)/gu;

    constructor(dico) {
        this.dico = dico;
        this.text = '';
        this.syllables = [];
        this.suggestions = [];
    }

    parse(text) {
        // Romanized syllables still waiting to become hanzi -- skipping what
        // is already settled text: *comments*, (pinyin) annotations such as
        // 生(sen1), and :constraints such as 好:bon, which would otherwise be
        // re-read as fresh syllables. Positions are kept so replace() edits
        // the right occurrence, not the first identical one.
        // Apostrophe = aspiration in the Bao'an dictionary notation (k'ak7);
        // tones 7/8 = its entering tones. Neither occurs in Wenfa input.
        this.syllables = [];
        this.positions = [];
        for (const m of text.matchAll(SyllableInputModel.SYLLABLE_RE)) {
            if (!m[1]) continue;
            this.syllables.push(m[1]);
            this.positions.push(m.index);
        }
        this.suggestions = [];

        this.syllables.forEach((syl, i) => {
            this.suggestions.push(
                ...this.lookup(syl).map(({ pron, sources }) => ({
                    pron, sources, for: i, start: 0, end: 0,
                }))
            );
        });

        this.text = text;
    }

    /** Suggestions for one typed syllable ([{pron, sources}]), in the
     *  system picked in "Je tape en", from every pronunciation source in
     *  use (Dictionary.suggestionsFor). */
    lookup(syl) {
        const R = typeof Romanization !== 'undefined' && Romanization.systems().length ? Romanization : null;
        if (this.dico.suggestionsFor) return this.dico.suggestionsFor(syl, R ? R.inputSystem() : null);
        // Minimal dictionaries (tests): spelling match only.
        return this.dico.getMatchesForSyllable(syl.split('_')[0].replace(/’/g, "'")).map((pron) => ({ pron, sources: [] }));
    }

    /** What picking `pron` writes into the text: the bare character, or --
     *  when the dictionary knows several readings for it (生 sen1/sang1) --
     *  the character with the chosen reading pinned, 生(sen1), so the
     *  transcription keeps that reading instead of guessing between
     *  homophones later. Same (pinyin) syntax Sentence.parseToken() and the
     *  server's text_to_words.resolve_pinyin() read back. The pinned reading
     *  is always Wenfa (the stored notation), even when the suggestion came
     *  from the Bao'an dictionary (Dictionary.wenfaReadingFor); `typed` is
     *  the syllable that was typed, to help choose between equivalents. */
    textFor(pron, typed = '') {
        const char = pron.simp;
        if (!char || !this.dico?.getMatchesForHanzi) return char;
        // Whether the reading must be written is judged on the lexicon alone
        // (when the dictionary has one), whatever the « Lectures » mode: the
        // saved pinyin is Wenfa and the lexicon decides it, so the text means
        // the same in every mode. Pinned: a character the lexicon reads in
        // several ways, or doesn't know (a dictionary reading), or knows
        // with another reading than the one chosen.
        const key = (p) => (p.storedKey ? p.storedKey() : `${p.initial}${p.final}${p.tone ?? ''}`);
        const pool = this.dico.lexiconPronunciations
            ? this.dico.lexiconPronunciations.filter((p) => p.simp === char || p.trad === char)
            : this.dico.getMatchesForHanzi(char);
        const readings = new Set(pool.map(key));
        const R = typeof Romanization !== 'undefined' && Romanization.systems().length ? Romanization : null;
        const reading = this.dico.wenfaReadingFor
            ? this.dico.wenfaReadingFor(pron, typed, R ? R.inputSystem() : null)
            : key(pron);
        if (readings.size === 1 && readings.has(reading)) return char;
        if (!this.dico.lexiconPronunciations && readings.size < 2) return char;
        return `${char}(${reading})`;
    }

    select(selectionIndex) {
        const suggestion = this.suggestions[selectionIndex];
        if (!suggestion) return;
        this.replace(suggestion.for, this.textFor(suggestion.pron, this.syllables[suggestion.for]));
        this.parse(this.text);
    }

    replace(sylIndex, replaceValue) {
        const syllable = this.syllables[sylIndex];
        const position = this.positions?.[sylIndex];
        if (syllable === undefined) return;
        if (position === undefined) {
            this.text = this.text.replace(syllable, replaceValue);
            return;
        }
        this.text = this.text.slice(0, position) + replaceValue + this.text.slice(position + syllable.length);
    }
}

/** Keyboard hint for a suggestion index: 1-9, then A, B, C… Shown as a
 *  small label and title tooltip; purely a bonus for physical keyboards,
 *  ignored on touch devices where users just tap the character. */
function suggestionKeyHint(i) {
    return i < 9 ? String(i + 1) : String.fromCharCode(65 + i - 9);
}

/** Renders a grid of tappable hanzi suggestion buttons and handles selecting
 *  one, either by click/tap or via a delegated event on a shared ancestor.
 *  Compact for phones: narrow fixed-size tiles (still >= 44px tap targets)
 *  in a grid, the other hanzi variant as a small superscript, the keyboard
 *  hint tucked in a corner (hidden on touch screens) -- so a typical list
 *  fits in two rows without scrolling. Styles: SUGGESTION_BAR_CSS below.
 *
 *  Pass `anchorTo` (the textarea/input being typed into) to turn the bar
 *  into a floating popover docked just below that field (like a native IME
 *  candidate window) instead of a block sitting in the normal flow: it
 *  shows while the field has focus and there are suggestions, and hides on
 *  blur. It never overlaps the field itself, so the text being typed stays
 *  fully visible. The field's container must be `position: relative` for
 *  the overlay to anchor correctly. */
// Scoped styles, injected once. The `.sugg .sugg-hanzi` size needs
// !important to beat base.html's sitewide `.hanzi { font-size: 1.4em
// !important }`, which made every tile huge. `.sugg-bar.sugg-bar` (doubled
// for specificity) beats the container's Tailwind `flex` class, while the
// inline `display: none` set by updateVisibility() still hides it.
const SUGGESTION_BAR_CSS = `
.sugg-bar.sugg-bar {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(3rem, 1fr));
    gap: 0.25rem;
    max-height: min(40vh, 14rem);
    overflow-y: auto;
    overscroll-behavior: contain;
}
.sugg {
    position: relative;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 2.75rem; padding: 0.25rem 0.125rem 0.2rem;
    border: 1px solid #E8D9C2; border-radius: 0.5rem;
    background: #fff; color: #9B1C1C; line-height: 1;
    touch-action: manipulation; -webkit-tap-highlight-color: transparent;
}
.sugg:active { background: #E8D9C2; }
@media (hover: hover) { .sugg:hover { background: #F3E8D6; } }
.sugg .sugg-hanzi { font-size: 1.3rem !important; line-height: 1.1; letter-spacing: 0; white-space: nowrap; }
.sugg .sugg-alt { font-size: 0.6em; color: #8C8478; font-weight: 500; margin-left: 1px; }
.sugg .sugg-py {
    margin-top: 0.15rem; font-size: 0.82rem; color: #8C8478;
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sugg .sugg-key { position: absolute; top: 2px; left: 4px; font-size: 0.5rem; color: #B5AA9B; }
/* Source stripe along the bottom edge, one coloured segment per source
   (colours: ReadingSourceSwitch.injectColors); never covers the character. */
.sugg .sugg-src { position: absolute; left: 3px; right: 3px; bottom: 2px; height: 3px; display: flex; gap: 1px;
                  border-radius: 9999px; overflow: hidden; }
.sugg .src-bar { flex: 1 1 0; background: #B5AA9B; }
.sugg:has(.sugg-src) { padding-bottom: 0.5rem; }
.src-pill { display: inline-block; min-width: 0.8rem; padding: 0 0.2rem; border-radius: 9999px; background: #8C8478;
            color: #fff; font-size: 0.5rem; font-weight: 700; line-height: 0.8rem; text-align: center; }
@media (hover: none) and (pointer: coarse) { .sugg .sugg-key { display: none; } }
/* Unihan under the character: Mandarin reading, then a short English meaning. */
.sugg-bar.sugg-bar.has-uh { grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr)); max-height: min(45vh, 18rem); }
/* Line 2: Hakka in bold, Mandarin lighter; line 3: English. */
.sugg .sugg-py .sugg-hk { font-weight: 700; color: #3A3430; }
.sugg .sugg-py .sugg-man { font-weight: 400; font-size: 0.85em; color: #3730a3; margin-left: 0.2rem; }
.sugg .sugg-en { margin-top: 0.05rem; width: 100%; font-size: 0.72rem; line-height: 1.15; color: #6E655C; text-align: center;
                 white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sugg .sugg-uh { margin-top: 0.15rem; width: 100%; font-size: 0.6rem; line-height: 1.15; color: #6E655C; text-align: center;
                 display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sugg .sugg-uh b { color: #3730a3; font-weight: 600; }
.sugg.sugg-unknown { border-style: dashed; color: #8C8478; background: #FDFAF5; }
`;

function injectSuggestionBarCss() {
    if (typeof document === 'undefined' || !document.head || document.getElementById('sugg-bar-css')) return;
    const style = document.createElement('style');
    style.id = 'sugg-bar-css';
    style.textContent = SUGGESTION_BAR_CSS;
    document.head.appendChild(style);
}

class SuggestionBar {
    constructor(container, { onSelect, onUnknown, anchorTo, shortcutLabel = 'Maj' } = {}) {
        injectSuggestionBarCss();
        this.container = container;
        this.shortcutLabel = shortcutLabel; // modifier shown in the tooltips
        this.container.classList.add('sugg-bar');
        this.onSelect = onSelect;
        // « ? » tile: the character is unknown, keep the reading as -(man4).
        this.onUnknown = onUnknown;
        this.unknown = '';
        this.anchorTo = anchorTo;
        this.suggestions = [];

        this.container.addEventListener('click', (event) => this.handleClick(event));
        // Tapping a suggestion must not take the focus (and the caret) away
        // from the field being typed in: the button never gets the focus.
        ['mousedown', 'pointerdown'].forEach((type) => this.container.addEventListener?.(type, (event) => {
            if (event.target.closest?.('button')) event.preventDefault();
        }));
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('hanzi-info-ready', () => { if (this.suggestions.length) this.render(this.suggestions); });
        }

        if (this.anchorTo) {
            // (The focus stays in the field: see the mousedown handler above.)

            this.container.classList.add(
                'absolute', 'z-30', 'top-full', 'left-1', 'right-1', 'mt-1',
                'p-1', 'rounded-lg', 'bg-white/95', 'border', 'shadow-lg',
            );

            this.anchorTo.addEventListener('focus', () => this.updateVisibility());
            this.anchorTo.addEventListener('blur', () => this.updateVisibility());
        }

        this.updateVisibility();
    }

    updateVisibility() {
        if (!this.anchorTo) return;
        const show = document.activeElement === this.anchorTo && (this.suggestions.length > 0 || !!this.unknown);
        // Inline style rather than a `hidden` class: this element also
        // carries `flex`, and Tailwind's utility ordering doesn't reliably
        // guarantee `display: none` wins over `display: flex` when both
        // classes are present on the same element.
        this.container.style.display = show ? '' : 'none';
    }

    handleClick(event) {
        if (event.target.closest('[data-suggestion-unknown]')) { this.onUnknown?.(); return; }
        const btn = event.target.closest('[data-suggestion-index]');
        if (!btn) return;
        this.onSelect?.(parseInt(btn.dataset.suggestionIndex, 10));
    }

    /** `unknown`: the pending syllable (as typed) when the bar offers the
     *  « ? » tile (onUnknown given) -- shown even with no suggestion. */
    render(suggestions, { unknown = '' } = {}) {
        this.suggestions = suggestions || [];
        this.unknown = this.onUnknown ? unknown : '';
        const unknownTile = this.unknown
            ? `<button type="button" data-suggestion-unknown class="sugg sugg-unknown" title="Caractère inconnu : garder seulement la lecture, -(${escapeSugg(this.unknown)})">`
              + `<span class="hanzi sugg-hanzi">?</span><span class="sugg-py">inconnu</span></button>`
            : '';

        if (!this.suggestions.length) {
            this.container.innerHTML = unknownTile;
            this.updateVisibility();
            return;
        }

        // As soon as a dictionary is in use, every tile shows where it comes
        // from -- lexicon-only ones included, or they'd look unmarked.
        const showSources = this.suggestions.some((s) => s.sources?.some((src) => src !== 'L'));
        let withUnihan = false;
        this.container.innerHTML = this.suggestions.map((s, i) => {
            const keyHint = suggestionKeyHint(i);
            // Main form follows the sitewide Trad./Simp. toggle (char()); the
            // other variant, when it differs, is a small superscript.
            const simp = s.pron.simp || '?';
            const trad = s.pron.trad || simp;
            const main = s.pron.char ? (s.pron.char() || simp) : simp;
            const alt = main === simp ? trad : simp;
            const hanzi = alt && alt !== main ? `${main}<span class="sugg-alt">(${alt})</span>` : main;
            const pinyin = s.pron.pinyinSpan ? s.pron.pinyinSpan() : (s.pron.abstractPinyin ? s.pron.abstractPinyin() : '?');
            // Where it comes from, when more than the lexicon is in use (L·B·M).
            const marks = showSources && s.sources?.length
                ? `<span class="sugg-src">${s.sources.map((src) => `<i class="src-bar" data-src="${src}"></i>`).join('')}</span>`
                : '';
            const sourceTitle = showSources && s.sources?.length ? ` · sources : ${s.sources.join(', ')}` : '';
            // Mandarin + meaning (Unihan), when loaded (HanziInfo.js).
            const info = typeof HanziInfo !== 'undefined' ? HanziInfo.text(simp) || HanziInfo.text(trad) : '';
            const infoTitle = info ? `\n${info.replace(/"/g, '&quot;')}` : '';
            const uh = typeof HanziInfo !== 'undefined' ? HanziInfo.get(simp) || HanziInfo.get(trad) : null;
            const mandarin = uh?.mandarin ? `<span class="sugg-man">${escapeSugg(uh.mandarin.split(', ')[0])}</span>` : '';
            const english = uh?.meaning ? `<span class="sugg-en" lang="en">${escapeSugg(uh.meaning.split(/[;,]/)[0].trim())}</span>` : '';
            if (uh) withUnihan = true;
            return `<button type="button" data-suggestion-index="${i}" class="sugg suggestion-btn" title="Raccourci : ${this.shortcutLabel}+${keyHint}${sourceTitle}${infoTitle}">`
                + `<span class="sugg-key">${keyHint}</span>${marks}`
                + `<span class="hanzi sugg-hanzi">${hanzi}</span>`
                + `<span class="sugg-py"><span class="sugg-hk">${pinyin}</span>${mandarin}</span>`
                + english
                + `</button>`;
        }).join('') + unknownTile;

        this.container.classList.toggle?.('has-uh', withUnihan);
        this.updateVisibility();
    }
}

function escapeSugg(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// The suggestions' tooltips show each character's Mandarin and meaning: loaded early.
if (typeof HanziInfo !== 'undefined') HanziInfo.load();
