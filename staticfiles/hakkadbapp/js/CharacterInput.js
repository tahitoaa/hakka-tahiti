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
    constructor(dico) {
        this.dico = dico;
        this.text = '';
        this.syllables = [];
        this.suggestions = [];
    }

    parse(text) {
        const textWithoutStars = text.replace(/\*[^*]*\*/g, '');
        this.syllables = textWithoutStars.match(/[a-zü]+[_0-6]?/gi) || [];
        this.suggestions = [];

        this.syllables.forEach((syl, i) => {
            this.suggestions.push(
                ...this.dico.getMatchesForSyllable(syl.split('_')[0]).map((pron) => ({
                    pron, for: i, start: 0, end: 0,
                }))
            );
        });

        this.text = text;
    }

    select(selectionIndex) {
        const suggestion = this.suggestions[selectionIndex];
        if (!suggestion) return;
        this.replace(suggestion.for, suggestion.pron.simp);
        this.parse(this.text);
    }

    replace(sylIndex, replaceValue) {
        const toReplace = this.syllables[sylIndex];
        this.text = this.text.replace(toReplace, replaceValue);
    }
}

/** Keyboard hint for a suggestion index: 1-9, then A, B, C… Shown as a
 *  small label and title tooltip; purely a bonus for physical keyboards,
 *  ignored on touch devices where users just tap the character. */
function suggestionKeyHint(i) {
    return i < 9 ? String(i + 1) : String.fromCharCode(65 + i - 9);
}

/** Renders a row of tappable hanzi suggestion buttons and handles selecting
 *  one, either by click/tap or via a delegated event on a shared ancestor.
 *  Sized for touch first (large tap targets, generous spacing) so it works
 *  as well on a phone as with a mouse or keyboard.
 *
 *  Pass `anchorTo` (the textarea/input being typed into) to turn the bar
 *  into a floating popover docked just below that field (like a native IME
 *  candidate window) instead of a block sitting in the normal flow: it
 *  shows while the field has focus and there are suggestions, and hides on
 *  blur. It never overlaps the field itself, so the text being typed stays
 *  fully visible. The field's container must be `position: relative` for
 *  the overlay to anchor correctly. */
class SuggestionBar {
    constructor(container, { onSelect, anchorTo } = {}) {
        this.container = container;
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
                'max-h-48', 'overflow-y-auto',
                'p-1.5', 'rounded-lg', 'bg-white/95', 'border', 'shadow-lg',
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

        this.container.innerHTML = this.suggestions.map((s, i) => {
            const keyHint = suggestionKeyHint(i);
            const simp = s.pron.simp || '?';
            const trad = s.pron.trad;
            const hanzi = trad && trad !== simp ? `${simp}<span class="text-gray-400">／${trad}</span>` : simp;
            const pinyin = s.pron.abstractPinyin ? s.pron.abstractPinyin() : '?';
            return `
                <button type="button" data-suggestion-index="${i}"
                        class="suggestion-btn flex flex-col items-center justify-center gap-0.5
                               min-w-11 min-h-11 px-2.5 py-1.5 rounded-lg bg-white border
                               text-indigo-800 active:bg-indigo-200 hover:bg-indigo-100 hover:shadow
                               touch-manipulation"
                        title="Raccourci : Maj+${keyHint}">
                    <span class="text-[10px] text-gray-500 leading-none">${keyHint}</span>
                    <span class="hanzi text-base font-semibold leading-none">${hanzi}</span>
                    <span class="text-[10px] text-gray-500 leading-none">${pinyin}</span>
                </button>`;
        }).join('');

        this.updateVisibility();
    }
}
