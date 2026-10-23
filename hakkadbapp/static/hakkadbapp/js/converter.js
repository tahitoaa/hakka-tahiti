class TextModel extends SyllableInputModel {
    // Thin wrapper: the converter only needs the shared parse/select/replace
    // logic from SyllableInputModel, with no extra per-page fields.
    update(text) {
        this.parse(text);
    }
}

class View {
    constructor ({dico}) {
        this.input = document.getElementById('pinyin-input');
        this.output = document.getElementById('suggested-hanzi');
        this.furiganaOutput = document.getElementById('pinyin-sentence-results');
        this.pinyinHanziLinesOutput = document.getElementById('pinyin-hanzi-lines');
        this.pinyinOnlyOutput = document.getElementById('pinyin-only');
        this.hanziOnlyOutput = document.getElementById('hanzi-only-output');
        this.expressionOutput = document.getElementById('expression-output');
        this.unknownChars = document.getElementById('unknown-chars');
        this.unknownProns = document.getElementById('unknown-prons');
        this.exportNew = document.getElementById('export-new');
        this.importProns = document.getElementById('import-prons');
        this.insertButton = document.getElementById('insert-button');
        this.insertHanzi = document.getElementById('insert-hanzi');
        this.dico = dico;

        this.suggestionBar = new SuggestionBar(this.output, {
            anchorTo: this.input,
            onSelect: (index) => this.onSelectSuggestion?.(index),
        });
    }

    renderSuggestions(suggestions){
        this.suggestionBar.render(suggestions);
    }

    renderUnknownChars() {
        this.unknownChars.innerHTML = Array
                                        .from(this.dico.unknowns.values())
                                        .map(char => `<li>${char}</li>`);
    }

    renderUnknownProns(syllables){
        this.unknownProns.innerHTML = Array
                                        .from(syllables)
                                        .map((syl,i) => `<tr><td>${syl}</td></tr>`)
                                        .join('');
    }

    // Rendering (furigana/pinyin/hanzi/detail) is delegated to Sentence, the
    // same shared model transcripter.js uses, so both pages stay visually
    // and behaviourally in sync.
    render(text) {
        this.input.value = text;
        this.sentences = text.split('\n').map((line) => new Sentence(this.dico, line));

        this.furiganaOutput.innerHTML = this.sentences.map(s => s.renderFurigana()).join('<br>');
        // The container is plain sans-serif; only the hanzi run gets the
        // dedicated hanzi font, so pinyin (with its tone-superscript digits)
        // doesn't render in a calligraphic/serif face meant for characters.
        this.pinyinHanziLinesOutput.innerHTML = this.sentences
            .map(s => `${s.renderDisplayPinyinLine()} <span class="hanzi">${s.renderHanziLine()}</span>`)
            .join('\n');
        this.pinyinOnlyOutput.innerHTML = this.sentences.map(s => s.renderDisplayPinyinLine()).join('<br>');
        this.hanziOnlyOutput.innerHTML = this.sentences.map(s => s.renderHanziLine()).join('<br>');
        this.expressionOutput.innerHTML = this.sentences.map(s => s.render()).join('<br>');
    }
}

class Controller{
    static SOURCE_KEY = 'hakka-converter-source';

    constructor ({itemSelector, containerId }) {
        const dico = new Dictionary({containerId, itemSelector});
        this.model = new TextModel(dico);
        this.view = new View({dico});
        this.dico = dico;
        this.view.onSelectSuggestion = (index) => this.handleSelectSuggestion(index);
        this.view.unknownProns.addEventListener("input", (event) => this.handleInsertHanzi(event));
        // this.view.unknownProns.addEventListener("click", (event) => this.handleInsertChar(event));
        this.view.input.addEventListener("input", (event) => this.handleInput(event));
        this.view.input.addEventListener("paste", (event) => this.handleInput(event));
        this.view.input.addEventListener("change", (event) => this.handleInput(event));
        this.view.exportNew.addEventListener('click', (event) => this.handleExportNew(event));
        this.view.importProns.addEventListener('click', (event) => {this.handleImportProns(event)});
        this.view.input.value = '若 爸爸 在 屋家 么 ?';
        this.view.input.dispatchEvent(new Event('change'));

        this.bindKeyboard();
        this.bindSourceSwitch();

        // Sentence.render() bakes simp/trad into a plain string at render
        // time rather than re-reading the DOM, so flipping the sitewide
        // Trad./Simp. toggle needs an explicit re-render to actually show
        // up here instead of only taking effect on the next keystroke.
        document.addEventListener('hanzi-mode-change', () => this.view.render(this.model.text));
        // Display system: re-render; with "Saisie en: comme l'affichage" it
        // is also the input system, so suggestions are recomputed too.
        document.addEventListener('romanization-change', () => this.handleInput());
        document.addEventListener('romanization-input-change', () => this.handleInput());
    }

    /** Mutually exclusive sources for the readings offered while typing:
     *  'db' = the Supabase lexicon embedded in the page (default), or one of
     *  the dictionary indexes declared as buttons in converter.html
     *  (data-source="baoan", "mciver"... with data-dict-url, its compact
     *  file fetched on first use only, and data-dict-system, the system of
     *  romanization.json it's spelled in). The choice is remembered per
     *  browser. */
    bindSourceSwitch() {
        this.sourceSwitch = document.getElementById('source-switch');
        if (!this.sourceSwitch) return;
        this.sourceStatus = document.getElementById('source-status');
        this.dictPromises = {};
        this.sourceSwitch.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-source]');
            if (btn) this.setSource(btn.dataset.source);
        });
        let saved = null;
        try { saved = localStorage.getItem(Controller.SOURCE_KEY); } catch (e) { /* private mode */ }
        if (saved === 'dict') saved = 'baoan'; // value saved before there were several dictionaries
        this.setSource(this.sourceButton(saved) ? saved : 'db');
    }

    sourceButton(source) {
        return source ? this.sourceSwitch.querySelector(`[data-source="${CSS.escape(source)}"]`) : null;
    }

    async setSource(source, { status = null } = {}) {
        const button = this.sourceButton(source);
        this.source = source;
        this.sourceSwitch.querySelectorAll('[data-source]').forEach((btn) => {
            btn.setAttribute('aria-pressed', String(btn.dataset.source === source));
        });
        // Hints: data-source-hint="db" for the lexicon, "dict" for any dictionary.
        document.querySelectorAll('[data-source-hint]').forEach((el) => {
            el.hidden = el.dataset.sourceHint !== (source === 'db' ? 'db' : 'dict');
        });
        try { localStorage.setItem(Controller.SOURCE_KEY, source); } catch (e) { /* private mode */ }

        if (source === 'db' || !button?.dataset.dictUrl) {
            this.dico.useSource(null);
            this.view.input.placeholder = this.inputExample();
            this.sourceStatus.textContent = status
                || `Lexique de la base : ${this.dico.pronunciations.length} prononciations, ${this.dico.words.length} mots.`;
            this.handleInput();
            return;
        }

        this.sourceStatus.textContent = 'Chargement du dictionnaire…';
        try {
            // One fetch per dictionary and page load, shared by later toggles.
            this.dictPromises[source] ??= Dictionary.fetchSourcePronunciations(button.dataset.dictUrl);
            const { meta, prons } = await this.dictPromises[source];
            if (this.source !== source) return; // switched again while loading
            // Typed in the dictionary's own system it's matched directly;
            // typed in Wenfa (or another system) through its Wenfa equivalents.
            this.dico.useSource(prons, { system: button.dataset.dictSystem || null });
            this.view.input.placeholder = this.inputExample();
            this.sourceStatus.textContent =
                `${meta.title || button.textContent.trim()}${meta.author ? ` — ${meta.author}` : ''} : `
                + `${prons.length} prononciations (sans mots ni traductions).`;
            this.handleInput();
        } catch (err) {
            console.error(err);
            delete this.dictPromises[source];
            this.setSource('db', { status: 'Impossible de charger le dictionnaire : retour au lexique de la base.' });
        }
    }

    /** "Ex: …" placeholder in the current input system, tones as digits
     *  since that's how they're typed. */
    inputExample() {
        const sample = 'wuk5 ga1 hao3 tai4';
        if (typeof Romanization === 'undefined' || !Romanization.systems().length) return `Ex: ${sample}`;
        const button = this.source !== 'db' ? this.sourceButton(this.source) : null;
        if (button?.dataset.dictExample && Romanization.inputSystem() === this.dico.sourceSystem) {
            return `Ex: ${button.dataset.dictExample}`; // the dictionary's own spelling
        }
        const typed = Romanization.fromPinyin(sample, Romanization.inputSystem())
            .replace(/[¹²³⁴⁵⁶⁷⁸]/g, (c) => '¹²³⁴⁵⁶⁷⁸'.indexOf(c) + 1);
        return `Ex: ${typed}`;
    }

    /** Shift+1..9 picks a suggestion by its keyboard hint, mirroring the
     *  transcription editor. Ignored while editing the small csv-style
     *  <input> fields (unknown chars/prons), active everywhere else. */
    bindKeyboard() {
        window.addEventListener('keydown', (event) => {
            if (!event.shiftKey || !/^[1-9]$/.test(event.key)) return;
            if (document.activeElement?.tagName === 'INPUT') return;

            const index = parseInt(event.key, 10) - 1;
            if (index >= this.model.suggestions.length) return;

            event.preventDefault();
            this.handleSelectSuggestion(index);
        });
    }

    handleInsertHanzi(event){
        if (event.target.tagName !== 'INPUT') return; // only react to button clicks
        const sylIndex = event.target.id.split('char-for-syl-')[1];
        this.model.replace(sylIndex, event.target.value);
        this.view.render(this.model.text);
        this.view.renderSuggestions(this.model.suggestions);
        this.view.renderUnknownProns(this.model.syllables);
    }

    handleImportProns(event){
        if (!window.showDirectoryPicker) {
            alert("Your browser does not support the File System Access API required for folder picking.");
            return;
        }
        (async () => {
            try {
                const dirHandle = await window.showDirectoryPicker();
                const pronunciations = [];
                for await (const entry of dirHandle.values()) {
                    if (entry.kind === 'file' && entry.name.endsWith('.csv')) {
                        const file = await entry.getFile();
                        const text = await file.text();
                        const lines = text.split('\n').filter(line => line.trim());
                        // Skip header if present
                        let start = 0;
                        if (lines[0].toLowerCase().includes('char') && lines[0].toLowerCase().includes('initial')) start = 1;
                        for (let i = start; i < lines.length; i++) {
                            const [char, initial, final, tone] = lines[i].split(',');
                            const p = new Pronunciation({ simp: char, trad: char, initial, final, tone })
                            pronunciations.push(p);
                        }

                        this.dico.addPronunciations(pronunciations);
                        alert(`Loaded ${pronunciations.length} pronunciations from folder.`);
                        this.view.input.dispatchEvent(new Event('change'));
                    }
                }

            } catch (err) {
                console.error(err);
                alert("Failed to import pronunciations.");
            }
        })();

    }

    handleExportNew(event){
        let csv = "char,initial,final,tone\n";
        this.dico.unknowns
            .values()
            .forEach(char => {
                const initial = document.getElementById(`initial-for-${char}`).value;
                const final = document.getElementById(`final-for-${char}`).value;
                const tone = document.getElementById(`tone-for-${char}`).value;
                csv += `${char},${initial},${final},${tone}\n`;
            })
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "new_char_pron_pairs.csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Input change
    handleInput(event) {
        this.view.input.placeholder = this.inputExample();
        this.dico.unknowns.clear();
        const text = this.view.input.value;
        this.model.update(text);
        this.view.renderSuggestions(this.model.suggestions);
        this.view.render(this.model.text);
        this.view.renderUnknownChars();
        this.view.renderUnknownProns(this.model.syllables);
    }

    // Select one Hanzi suggestion (click/tap on the SuggestionBar)
    handleSelectSuggestion(index) {
        this.model.select(index);
        this.view.render(this.model.text);
        this.view.renderSuggestions(this.model.suggestions);
        this.view.renderUnknownProns(this.model.syllables);
    }
}

// Activate
document.addEventListener("DOMContentLoaded", () =>
    {
        const converter = new Controller({
            itemSelector: 'li',
            containerId: '#pron-list',
        });

        new CopyButton('#expression-output', { label: 'Copier le détail' });
        new CopyButton('#pinyin-sentence-results', {
            label: 'Copier le furigana',
            getText: () => converter.view.sentences
                .map(s => `${s.renderDisplayPinyinLine()} ${s.renderHanziLine()}`)
                .join('\n'),
        });
        new CopyButton('#pinyin-hanzi-lines', { label: 'Copier pinyin + hanzi' });
        new CopyButton('#hanzi-only-output', { label: 'Copier les hanzi' });
        new CopyButton('#pinyin-only', { label: 'Copier le pinyin' });
    }
)
