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



(function () {
    const { API, escapeHtml, superscriptTones, displayPinyin, request, whileBusy } = typeof AdditionList !== 'undefined'
        ? AdditionList : {};

    const AI_API = '/api/ia/suggestion';

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
            // Readings, cuts, joins and the lexicon's segmentation: WordBoxes.
            this.boxes = new WordBoxes(this.el.slots, {
                slotInputs: true,
                additions: false,     // the page's own list (this.additions)
                onChange: (text, what) => {
                    this.el.text.value = text;
                    // A word cut in two is an expression.
                    if (this.kind === 'word' && what === 'split') this.setKind('expression');
                    else this.updateText();
                },
            });
            this.el.slots.addEventListener('compositionend', onSlotInput);
            this.el.form.addEventListener('submit', (event) => {
                event.preventDefault();
                // Enter in a field submits with the first button, "Enregistrer".
                const button = event.submitter || this.el.form.querySelector('button[type="submit"]');
                this.save(button?.dataset.status || 'draft', button);
            });
            this.el.cancel.addEventListener('click', () => this.resetForm());
            document.getElementById('saisie-delete')?.addEventListener('click', (event) => this.deleteEditing(event.currentTarget));
            // « Autre… »: the type typed.
            document.getElementById('saisie-word-type')?.addEventListener('change', (event) => {
                const other = document.getElementById('saisie-word-type-other');
                other.hidden = event.target.value !== '__other';
                if (!other.hidden) other.focus();
                this.lockTranslations();
                this.renderPreview();
            });
            document.getElementById('saisie-word-type-other')?.addEventListener('input', () => {
                this.lockTranslations();
                this.renderPreview();
            });
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
            // Tab / Entrée / Échap, as in a Chinese input method (WordBoxes.bindKeys).
            WordBoxes.bindKeys(this.el.form, {
                bar: this.suggestionBar, boxes: this.boxes, pick: (index) => this.pickSuggestion(index),
                accepts: (t) => t === this.el.text || t.dataset?.slot !== undefined,
            });
            // Alt+1..9 picks a suggestion, as on the "Écrire" and "Transcrire"
            // pages (not Maj: on an AZERTY keyboard Maj+1 types the tone 1).
            this.el.form.addEventListener('keydown', (event) => {
                if (!event.altKey || event.ctrlKey || !/^Digit[1-9]$/.test(event.code)) return;
                if (event.target !== this.el.text && event.target.dataset?.slot === undefined) return;
                const index = Number(event.code.slice(5)) - 1;
                if (index >= this.visible.length) return;
                event.preventDefault();
                this.pickSuggestion(index);
            });
        }

        /** The additions are in: "déjà proposé" can be checked, and an
         *  addition opened from the Validation page (?modifier=id) loaded. */
        afterLoad() {
            this.renderAll();
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
            if (this.el.french) this.lockTranslations();
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
            // The expressions holding the word, once its characters are settled.
            this.renderOccurrences();
            // 🔎 Sources (Sources.js) follows the characters typed.
            const sources = document.getElementById('saisie-sources');
            if (sources) {
                const v = this.entry.values();
                sources.dataset.sources = this.entry.syllables.length ? '' : v.hanzi.replace(/\s+/g, '');
                sources.dataset.reading = v.pinyin;
                sources.hidden = !sources.dataset.sources;
            }
        }

        renderOccurrences() {
            const el = document.getElementById('saisie-occurrences');
            if (!el) return;
            const word = this.kind === 'word' && !this.entry.syllables.length ? this.entry.values().hanzi.replace(/\s+/g, '') : '';
            if ((el.dataset.occurrencesFor || '') === word) return;    // the same word: nothing to fetch again
            clearTimeout(this.occurrencesTimer);
            // While typing: once the characters stay a moment.
            this.occurrencesTimer = setTimeout(() => AdditionList.showOccurrences(el, word), word ? 300 : 0);
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
                if (!value || this.el[field].readOnly) return;
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
                const typedByEditor = ((state[name] || '').trim() && !state.ai[name])
                    || (SaisieEntry.isOnomatopoeia(state.word_type) && name in SaisieEntry.ONOMATOPOEIA_TRANSLATIONS);
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
            fields.filter((f) => s[f] && inputs[f] && !inputs[f].readOnly).forEach((f) => {
                inputs[f].value = s[f];
                inputs[f].classList.add('is-ai');
            });
            this.setStatus('Suggestion reprise : vérifiez-la avant d’enregistrer.');
            this.renderMeaning();
            inputs[fields[0]]?.focus();
        }

        /** The characters, one box each, grouped by word and coloured by
         *  what the lexicon says of each word (WordBoxes.js). */
        renderSlots() {
            this.boxes.render(this.entry, { active: this.active, additions: this.additions || [] });
            this.renderSuggestions();
        }

        renderSlotStates() {
            this.el.slots.querySelectorAll('[data-slot]').forEach((input) => {
                input.closest('.wb-box').classList.toggle('is-active', Number(input.dataset.slot) === this.active);
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
                word_type: this.wordType(),
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
            const type = this.wordType();
            this.el.preview.innerHTML = mixed.hanzi
                ? `${escapeHtml(mixed.pinyin)} <span class="hanzi">${escapeHtml(mixed.hanzi)}</span>${type ? ` <i>(${escapeHtml(type)})</i>` : ''}` : '';
        }

        /** The word's type (« emprunt anglais », or the one typed after
         *  « Autre… »); '' for an ordinary word, and for an expression. */
        wordType() {
            const select = document.getElementById('saisie-word-type');
            if (!select || this.kind !== 'word') return '';
            const value = select.value === '__other' ? document.getElementById('saisie-word-type-other').value : select.value;
            return value.replace(/[()]/g, ' ').split(/\s+/).join(' ').trim();
        }

        /** An onomatopoeia (SaisieEntry.ONOMATOPOEIA): French and English say
         *  so and can't be changed (also enforced by the server); another type
         *  frees them again, emptied if they still held that mention. */
        lockTranslations() {
            const locked = SaisieEntry.isOnomatopoeia(this.wordType());
            Object.entries(SaisieEntry.ONOMATOPOEIA_TRANSLATIONS).forEach(([field, value]) => {
                const input = this.el[field];
                if (locked) input.value = value;
                else if (input.readOnly && input.value === value) input.value = '';
                input.readOnly = locked;
                input.classList.toggle('is-locked', locked);
                input.title = locked ? 'Onomatopée : la traduction le dit, elle ne se change pas' : '';
            });
            if (locked) this.renderMeaning();
        }

        setWordType(type) {
            const select = document.getElementById('saisie-word-type');
            const other = document.getElementById('saisie-word-type-other');
            if (!select) return;
            const listed = [...select.options].some((o) => o.value === type);
            select.value = !type ? '' : listed ? type : '__other';
            other.value = type && !listed ? type : '';
            other.hidden = select.value !== '__other';
            this.lockTranslations();
            // The mixed line shows the type: always redrawn with it.
            if (this.entry) this.renderPreview();
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
            // Each word's status is shown on its boxes (WordBoxes).
            this.el.check.innerHTML = '';
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
                        this.newWords.set(key, { checked: c.status !== 'reading', french: c.sense || '', english: '', themes: '',
                            word_type: '', other: false, ai: {} });
                    }
                    const state = this.newWords.get(key);
                    const locked = SaisieEntry.isOnomatopoeia(state.word_type);
                    const field = (name, placeholder, extra = '') => {
                        const fixed = locked && name in SaisieEntry.ONOMATOPOEIA_TRANSLATIONS;
                        return `<input type="text" data-nw="${name}" value="${escapeHtml(state[name])}"
                        placeholder="${placeholder}" ${extra} aria-label="${placeholder} de ${escapeHtml(c.hanzi)}"${fixed ? ' readonly title="Onomatopée : la traduction le dit"' : ''}
                        class="min-h-10 px-2 py-1 border border-gray-300 rounded-md text-sm${state.ai[name] ? ' is-ai' : ''}${fixed ? ' is-locked' : ''}" ${state.checked ? '' : 'disabled'}>`;
                    };
                    // The same types as the word's own menu (saisie.html).
                    const types = [...(document.getElementById('saisie-word-type')?.options || [])]
                        .filter((o) => o.value && o.value !== '__other').map((o) => [o.value, o.textContent]);
                    const listed = !state.word_type || types.some(([v]) => v === state.word_type);
                    const choice = state.other || !listed ? '__other' : state.word_type;
                    const typeField = `<span class="saisie-nw-type">
                        <select data-nw="word_type" aria-label="Type du mot ${escapeHtml(c.hanzi)}" ${state.checked ? '' : 'disabled'}
                          class="min-h-10 px-1 border border-gray-300 rounded-md text-sm bg-white">
                          <option value="">— ordinaire —</option>
                          ${types.map(([v, l]) => `<option value="${escapeHtml(v)}"${choice === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}
                          <option value="__other"${choice === '__other' ? ' selected' : ''}>Autre…</option>
                        </select>${choice === '__other' ? `<input type="text" data-nw="word_type_other" maxlength="60" value="${escapeHtml(state.word_type)}"
                          placeholder="Type" aria-label="Autre type du mot ${escapeHtml(c.hanzi)}" ${state.checked ? '' : 'disabled'}
                          class="min-h-10 px-2 border border-gray-300 rounded-md text-sm">` : ''}</span>`;
                    return `<div class="saisie-new-word" data-key="${escapeHtml(key)}">
                        <label class="inline-flex items-center gap-2 min-w-0">
                          <input type="checkbox" data-nw="checked" ${state.checked ? 'checked' : ''}>
                          <span class="hanzi text-lg">${escapeHtml(c.hanzi)}</span>
                          <span class="text-sm text-gray-600">${escapeHtml(displayPinyin(c.pinyin))}</span>
                        </label>
                        ${typeField}${field('french', 'Français')}${field('english', 'Anglais')}${field('themes', 'Thème', 'list="saisie-theme-list"')}
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
                row.querySelectorAll('input[type="text"], select').forEach((input) => { input.disabled = !state.checked; });
            } else if (name === 'word_type' || name === 'word_type_other') {
                if (event.type !== 'change' && name === 'word_type') return;
                const was = SaisieEntry.isOnomatopoeia(state.word_type);
                if (name === 'word_type') {
                    state.other = event.target.value === '__other';
                    state.word_type = state.other ? '' : event.target.value;
                } else {
                    state.word_type = event.target.value.replace(/[()]/g, ' ').split(/\s+/).join(' ').trim();
                }
                const now = SaisieEntry.isOnomatopoeia(state.word_type);
                // An onomatopoeia: its French and English say so; freed again, emptied.
                Object.entries(SaisieEntry.ONOMATOPOEIA_TRANSLATIONS).forEach(([field, value]) => {
                    if (now) { state[field] = value; state.ai[field] = false; } else if (was && state[field] === value) state[field] = '';
                });
                if (name === 'word_type' || was !== now) {
                    this.renderNewWords();
                    if (name === 'word_type_other') {
                        const input = this.el.newWords.querySelector(`[data-key="${CSS.escape(row.dataset.key)}"] [data-nw="word_type_other"]`);
                        input?.focus();
                        input?.setSelectionRange(input.value.length, input.value.length);
                    } else if (state.other) {
                        this.el.newWords.querySelector(`[data-key="${CSS.escape(row.dataset.key)}"] [data-nw="word_type_other"]`)?.focus();
                    }
                }
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
                    english: state.english.trim(), themes: state.themes.trim(), word_type: state.word_type || '' }));
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
                return this.setStatus('Choisissez la lecture des caractères en mauve ⚠ (plusieurs lectures possibles).', true);
            }
            if (!this.el.french.value.trim()) return this.setStatus('Indiquez la traduction en français.', true);
            const newWords = this.newWordsPayload();
            const untranslated = newWords.filter((w) => !w.french);
            if (untranslated.length) {
                return this.setStatus(`Indiquez le français des mots à ajouter (${untranslated.map((w) => w.hanzi).join(', ')}), ou décochez-les.`, true);
            }
            // Proposed or validated: complete, English included (additions.incomplete_refused).
            // An addition already proposed keeps its status: its edits are saved as they are.
            if (['review', 'validated'].includes(status) && status !== this.editingStatus) {
                if (!this.el.english.value.trim()) {
                    return this.setStatus('Indiquez la traduction en anglais : un ajout incomplet reste en brouillon '
                        + '(« Garder en brouillon » pour le compléter plus tard).', true);
                }
                const noEnglish = newWords.filter((w) => !w.english);
                if (noEnglish.length) {
                    return this.setStatus(`Indiquez l’anglais des mots à ajouter (${noEnglish.map((w) => w.hanzi).join(', ')}), `
                        + 'ou décochez-les, ou gardez l’expression en brouillon.', true);
                }
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
            // Delete: any draft; a decided addition (validated, rejected) only by a validator.
            const del = document.getElementById('saisie-delete');
            if (del) del.hidden = ['validated', 'rejected'].includes(addition.status) && !AdditionList.canValidate();
            // An addition already proposed (opened from the Validation tab)
            // keeps its status when saved; a draft can still be proposed.
            this.setSaveButtons(addition.status);
            // The text as it was typed; else (imports, AI, older additions)
            // rebuilt with a reading only where the lexicon needs one.
            this.el.text.value = addition.input_text
                || SaisieEntry.textFromStored(addition.hanzi, addition.pinyin, addition.kind, this.dico);
            this.newWords.clear();
            // The type first: the text then drawn (setKind) shows it at once.
            this.setWordType(addition.word_type || '');
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

        /** « 🗑 Supprimer cet ajout »: the addition open, deleted (confirmed);
         *  from Suivi, on to the next row. */
        async deleteEditing(button) {
            const id = this.editingId;
            if (!id) return;
            const r = this.review(id);
            await this.list.handleAction('delete', id, null, button);
            if (this.additions.some((a) => a.id === id)) return;     // not confirmed, or refused
            if (r) {
                // The deleted row is skipped: the next one, else back to the table.
                this.reviewNav = { ...this.reviewNav, ids: this.reviewNav.ids.filter((x) => x !== id) };
                try { sessionStorage.setItem(AdditionList.REVIEW_KEY, JSON.stringify(this.reviewNav)); } catch (e) { /* private mode */ }
                const next = this.reviewNav.ids[r.index] ?? null;
                const a = next !== null && this.additions.find((x) => x.id === next);
                if (a) {
                    this.edit(a);
                    window.history.replaceState(null, '', `${window.location.pathname}?modifier=${a.id}`);
                    this.setStatus('✓ Supprimé. Élément suivant.');
                } else {
                    this.setStatus('✓ Supprimé. C’était le dernier : retour au tableau…');
                    setTimeout(() => { window.location.href = r.back; }, 700);
                }
                return;
            }
            this.resetForm();
            this.setStatus('✓ Ajout supprimé.');
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
                this.el.observations.value, this.kind, this.wordType()]);
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
            const del = document.getElementById('saisie-delete');
            if (del) del.hidden = true;
            this.setSaveButtons('draft');
            this.el.form.reset();
            this.setWordType('');
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
