/* =========================================================================
   ReadingSources — the "Lectures" setting (components/reading_settings.html),
   shared by the converter and the transcriber: which pronunciations the
   Dictionary uses -- the lexicon, one dictionary index, or all of them.

   It is independent of the two other settings (Romanization.js):
   "Je tape en" (input system) and "J'affiche en" (display system). Typed
   syllables reach every source whatever its spelling, and every reading is
   shown in the display system (Dictionary.suggestionsFor,
   SourcePronunciation.displayPinyin).
   ========================================================================= */

class ReadingSourceSwitch {
    static STORAGE_KEY = 'hakka-reading-source';
    // One fetch per dictionary file and page, shared by every switch.
    static loading = {};

    constructor({ root, status, summary = null, dico, onChange = () => {} }) {
        this.root = root;
        this.status = status;
        this.summary = summary;
        this.dico = dico;
        this.onChange = onChange;
        this.buttons = Array.from(root.querySelectorAll('[data-source]'));
        this.legend = document.getElementById('source-legend');
        ReadingSourceSwitch.injectColors(this.buttons);
        root.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-source]');
            if (btn) this.set(btn.dataset.source);
        });
        let saved = null;
        try {
            // Older key (converter only) still honoured.
            saved = localStorage.getItem(ReadingSourceSwitch.STORAGE_KEY) ?? localStorage.getItem('hakka-converter-source');
        } catch (e) { /* private mode */ }
        if (saved === 'dict') saved = 'baoan';
        this.set(this.button(saved) ? saved : 'db');
    }

    /** Each source's colour (data-dict-color on its button), keyed by its
     *  short mark: used by the suggestion tiles (CharacterInput.js) and the
     *  legend, so a new dictionary only needs a button with a colour. */
    static injectColors(buttons) {
        if (typeof document === 'undefined' || document.getElementById('source-colors-css')) return;
        const rules = buttons.filter((b) => b.dataset.dictShort && b.dataset.dictColor).map((b) => {
            const id = CSS.escape(b.dataset.dictShort);
            const color = b.dataset.dictColor;
            return `.src-pill[data-src="${id}"], .src-bar[data-src="${id}"] { background: ${color}; }`;
        });
        const style = document.createElement('style');
        style.id = 'source-colors-css';
        // Base pill style here too: the legend shows before any suggestion bar exists.
        style.textContent = '.src-pill { display: inline-block; min-width: 0.8rem; padding: 0 0.2rem; border-radius: 9999px; '
            + 'background: #8C8478; color: #fff; font-size: 0.5rem; font-weight: 700; line-height: 0.8rem; text-align: center; }\n'
            + '.settings-legend .src-pill { font-size: 0.6rem; line-height: 0.95rem; min-width: 0.95rem; }\n'
            + rules.join('\n');
        document.head.appendChild(style);
    }

    renderLegend() {
        if (!this.legend) return;
        const multi = this.source === 'all';
        this.legend.hidden = !multi;
        if (!multi) return;
        this.legend.innerHTML = 'Couleur des suggestions : ' + this.buttons
            .filter((b) => b.dataset.dictShort && b.dataset.dictColor)
            .map((b) => `<span><span class="src-pill" data-src="${escapeSummary(b.dataset.dictShort)}">${escapeSummary(b.dataset.dictShort)}</span>${escapeSummary(b.textContent.trim())}</span>`)
            .join('');
    }

    button(id) {
        return id ? this.buttons.find((b) => b.dataset.source === id) || null : null;
    }

    dictionaryButtons() {
        return this.buttons.filter((b) => b.dataset.dictUrl);
    }

    /** What the current choice reads as, for the summary line. */
    label() {
        if (this.source === 'db') return 'mots et lectures du lexique Wenfa';
        if (this.source === 'all') {
            return `lexique + ${this.dictionaryButtons().map((b) => b.textContent.trim()).join(' + ')} (toutes les sources)`;
        }
        const b = this.button(this.source);
        return `lectures du ${b?.dataset.dictLabel || b?.textContent.trim()}`;
    }

    load(button) {
        const id = button.dataset.source;
        const source = {
            id,
            system: button.dataset.dictSystem || null,
            label: button.textContent.trim(),
            short: button.dataset.dictShort || button.textContent.trim().charAt(0),
        };
        ReadingSourceSwitch.loading[id] ??= Promise.all([
            Dictionary.fetchSourcePronunciations(button.dataset.dictUrl, source),
            ReadingSourceSwitch.doubtful(),
        ]).then(([loaded, doubtful]) => {
            // Doubtful readings (scan misreadings?): marked ⚠ and shown last.
            const keys = new Set(doubtful[id] || []);
            if (keys.size) loaded.prons.forEach((p) => { p.doubtful = keys.has(`${p.simp}|${p.initial}|${p.tone}`); });
            return loaded;
        }).catch((err) => { delete ReadingSourceSwitch.loading[id]; throw err; });
        return ReadingSourceSwitch.loading[id].then(({ meta, prons }) => ({ ...source, meta, prons }));
    }

    /** {source id: ["字|syllable|tone"]}: the dictionaries' doubtful readings
     *  (source_rules.doubtful_readings), fetched once; none if unavailable. */
    static doubtful() {
        ReadingSourceSwitch.doubtfulLoading ??= fetch('/api/doubtful-readings')
            .then((r) => (r.ok ? r.json() : {}))
            .catch(() => ({}));
        return ReadingSourceSwitch.doubtfulLoading;
    }

    async set(source) {
        this.source = source;
        this.buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.source === source)));
        // Hints: data-source-hint="db" (lexicon in use), "dict" (a dictionary in use).
        document.querySelectorAll('[data-source-hint]').forEach((el) => {
            const hint = el.dataset.sourceHint;
            el.hidden = !(hint === 'db' ? source === 'db' || source === 'all' : source !== 'db');
        });
        try { localStorage.setItem(ReadingSourceSwitch.STORAGE_KEY, source); } catch (e) { /* private mode */ }

        const lexiconStatus = () => `Lexique · ${this.dico.lexiconPronunciations.length.toLocaleString('fr-FR')} lectures · `
            + `${this.dico.lexiconWords.length.toLocaleString('fr-FR')} mots`;
        if (source === 'db') {
            this.dico.useSources({ lexicon: true });
            this.status.textContent = lexiconStatus();
            this.changed();
            return;
        }

        const buttons = source === 'all' ? this.dictionaryButtons() : [this.button(source)];
        this.status.textContent = 'Chargement du dictionnaire…';
        try {
            const loaded = await Promise.all(buttons.map((b) => this.load(b)));
            if (this.source !== source) return; // switched again while loading
            this.dico.useSources({ lexicon: source === 'all', sources: loaded });
            const parts = loaded.map((d) => `${d.label} · ${d.prons.length.toLocaleString('fr-FR')} lectures`);
            this.status.textContent = source === 'all'
                ? [lexiconStatus(), ...parts].join(' — ')
                : `${loaded[0].meta.title || loaded[0].label}${loaded[0].meta.author ? `, ${loaded[0].meta.author}` : ''} · `
                  + `${loaded[0].prons.length.toLocaleString('fr-FR')} lectures · sans mots ni traductions`;
            this.changed();
        } catch (err) {
            console.error(err);
            await this.set('db');
            this.status.textContent = 'Impossible de charger le dictionnaire : retour au lexique. ' + this.status.textContent;
        }
    }

    changed() {
        this.renderSummary();
        this.renderLegend();
        this.onChange(this.source);
    }

    /** "Tapez en Wenfa (ex. wuk5 ga1 hao3 tai4) → lectures … → affichage en …" */
    renderSummary() {
        if (!this.summary || typeof Romanization === 'undefined' || !Romanization.systems().length) return;
        this.summary.innerHTML = `Tapez en <b>${escapeSummary(Romanization.label(Romanization.inputSystem()))}</b> `
            + `(ex. <code>${escapeSummary(ReadingSourceSwitch.inputExample())}</code>) → ${escapeSummary(this.label())} → `
            + `affichage en <b>${escapeSummary(Romanization.label(Romanization.current()))}</b>.`;
    }

    /** A sample to type in the current input system, tones as digits. */
    static inputExample() {
        const sample = 'wuk5 ga1 hao3 tai4';
        if (typeof Romanization === 'undefined' || !Romanization.systems().length) return sample;
        return Romanization.fromPinyin(sample, Romanization.inputSystem())
            .replace(/[¹²³⁴⁵⁶⁷⁸]/g, (c) => String('¹²³⁴⁵⁶⁷⁸'.indexOf(c) + 1));
    }
}

function escapeSummary(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Both other settings change the summary too.
document.addEventListener('romanization-change', () => window.readingSources?.renderSummary());
document.addEventListener('romanization-input-change', () => window.readingSources?.renderSummary());
