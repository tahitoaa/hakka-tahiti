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
        const readings = new Set(
            this.dico.getMatchesForHanzi(char).map((p) => (p.storedKey ? p.storedKey() : `${p.initial}${p.final}${p.tone ?? ''}`))
        );
        if (readings.size < 2) return char;
        const R = typeof Romanization !== 'undefined' && Romanization.systems().length ? Romanization : null;
        const reading = this.dico.wenfaReadingFor
            ? this.dico.wenfaReadingFor(pron, typed, R ? R.inputSystem() : null)
            : `${pron.initial}${pron.final}${pron.tone ?? ''}`;
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
    border: 1px solid #c7d2fe; border-radius: 0.5rem;
    background: #fff; color: #3730a3; line-height: 1;
    touch-action: manipulation; -webkit-tap-highlight-color: transparent;
}
.sugg:active { background: #c7d2fe; }
@media (hover: hover) { .sugg:hover { background: #e0e7ff; } }
.sugg .sugg-hanzi { font-size: 1.3rem !important; line-height: 1.1; letter-spacing: 0; white-space: nowrap; }
.sugg .sugg-alt { font-size: 0.55em; color: #9ca3af; font-weight: 500; vertical-align: super; margin-left: 1px; }
.sugg .sugg-py {
    margin-top: 0.15rem; font-size: 0.625rem; color: #6b7280;
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sugg .sugg-key { position: absolute; top: 2px; left: 4px; font-size: 0.5rem; color: #9ca3af; }
/* Source stripe along the bottom edge, one coloured segment per source
   (colours: ReadingSourceSwitch.injectColors); never covers the character. */
.sugg .sugg-src { position: absolute; left: 3px; right: 3px; bottom: 2px; height: 3px; display: flex; gap: 1px;
                  border-radius: 9999px; overflow: hidden; }
.sugg .src-bar { flex: 1 1 0; background: #9ca3af; }
.sugg:has(.sugg-src) { padding-bottom: 0.5rem; }
.src-pill { display: inline-block; min-width: 0.8rem; padding: 0 0.2rem; border-radius: 9999px; background: #6b7280;
            color: #fff; font-size: 0.5rem; font-weight: 700; line-height: 0.8rem; text-align: center; }
@media (hover: none) and (pointer: coarse) { .sugg .sugg-key { display: none; } }
`;

function injectSuggestionBarCss() {
    if (typeof document === 'undefined' || !document.head || document.getElementById('sugg-bar-css')) return;
    const style = document.createElement('style');
    style.id = 'sugg-bar-css';
    style.textContent = SUGGESTION_BAR_CSS;
    document.head.appendChild(style);
}

class SuggestionBar {
    constructor(container, { onSelect, anchorTo, shortcutLabel = 'Maj' } = {}) {
        injectSuggestionBarCss();
        this.container = container;
        this.shortcutLabel = shortcutLabel; // modifier shown in the tooltips
        this.container.classList.add('sugg-bar');
        this.onSelect = onSelect;
        this.anchorTo = anchorTo;
        this.suggestions = [];

        this.container.addEventListener('click', (event) => this.handleClick(event));

        if (this.anchorTo) {
            // Tapping/clicking a suggestion would otherwise move focus to the
            // button first, blurring the field and hiding the popover before
            // the click is even handled — suppress that default.
            this.container.addEventListener('mousedown', (event) => event.preventDefault());

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
        const show = document.activeElement === this.anchorTo && this.suggestions.length > 0;
        // Inline style rather than a `hidden` class: this element also
        // carries `flex`, and Tailwind's utility ordering doesn't reliably
        // guarantee `display: none` wins over `display: flex` when both
        // classes are present on the same element.
        this.container.style.display = show ? '' : 'none';
    }

    handleClick(event) {
        const btn = event.target.closest('[data-suggestion-index]');
        if (!btn) return;
        this.onSelect?.(parseInt(btn.dataset.suggestionIndex, 10));
    }

    render(suggestions) {
        this.suggestions = suggestions || [];

        if (!this.suggestions.length) {
            this.container.innerHTML = '';
            this.updateVisibility();
            return;
        }

        // As soon as a dictionary is in use, every tile shows where it comes
        // from -- lexicon-only ones included, or they'd look unmarked.
        const showSources = this.suggestions.some((s) => s.sources?.some((src) => src !== 'L'));
        this.container.innerHTML = this.suggestions.map((s, i) => {
            const keyHint = suggestionKeyHint(i);
            // Main form follows the sitewide Trad./Simp. toggle (char()); the
            // other variant, when it differs, is a small superscript.
            const simp = s.pron.simp || '?';
            const trad = s.pron.trad || simp;
            const main = s.pron.char ? (s.pron.char() || simp) : simp;
            const alt = main === simp ? trad : simp;
            const hanzi = alt && alt !== main ? `${main}<span class="sugg-alt">${alt}</span>` : main;
            const pinyin = s.pron.pinyinSpan ? s.pron.pinyinSpan() : (s.pron.abstractPinyin ? s.pron.abstractPinyin() : '?');
            // Where it comes from, when more than the lexicon is in use (L·B·M).
            const marks = showSources && s.sources?.length
                ? `<span class="sugg-src">${s.sources.map((src) => `<i class="src-bar" data-src="${src}"></i>`).join('')}</span>`
                : '';
            const sourceTitle = showSources && s.sources?.length ? ` · sources : ${s.sources.join(', ')}` : '';
            return `<button type="button" data-suggestion-index="${i}" class="sugg suggestion-btn" title="Raccourci : ${this.shortcutLabel}+${keyHint}${sourceTitle}">`
                + `<span class="sugg-key">${keyHint}</span>${marks}`
                + `<span class="hanzi sugg-hanzi">${hanzi}</span>`
                + `<span class="sugg-py">${pinyin}</span>`
                + `</button>`;
        }).join('');

        this.updateVisibility();
    }
}
