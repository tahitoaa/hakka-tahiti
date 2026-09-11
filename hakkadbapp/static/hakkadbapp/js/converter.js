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
            .map(s => `${s.renderPinyinLine()} <span class="hanzi">${s.renderHanziLine()}</span>`)
            .join('\n');
        this.pinyinOnlyOutput.innerHTML = this.sentences.map(s => s.renderPinyinLine()).join('<br>');
        this.hanziOnlyOutput.innerHTML = this.sentences.map(s => s.renderHanziLine()).join('<br>');
        this.expressionOutput.innerHTML = this.sentences.map(s => s.render()).join('<br>');
    }
}

class Controller{
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

        // Sentence.render() bakes simp/trad into a plain string at render
        // time rather than re-reading the DOM, so flipping the sitewide
        // Trad./Simp. toggle needs an explicit re-render to actually show
        // up here instead of only taking effect on the next keystroke.
        document.addEventListener('hanzi-mode-change', () => this.view.render(this.model.text));
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
                .map(s => `${s.renderPinyinLine()} ${s.renderHanziLine()}`)
                .join('\n'),
        });
        new CopyButton('#pinyin-hanzi-lines', { label: 'Copier pinyin + hanzi' });
        new CopyButton('#hanzi-only-output', { label: 'Copier les hanzi' });
        new CopyButton('#pinyin-only', { label: 'Copier le pinyin' });
    }
)
