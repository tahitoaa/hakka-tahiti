function isPunctuation(ch) {
    // This covers most ASCII punctuation
    return /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~、。]$/.test(ch);
}

function isHanzi(ch) {
    // Covers CJK Unified Ideographs, Extension A, and B (including \u3400-\u4DBF, \u4E00-\u9FFF, \u20000-\u2A6DF)
    return /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(ch);
}

class TextModel {
    constructor (dico) {
        // A text model is a list of Tokens
        // this.items = [];
        this.suggestions = [];
        this.syllables = [];
        this.text = ''
        this.dico = dico
    }

    update(text){
        // Remove all substrings between two * (including the *)
        const textWithoutStars = text.replace(/\*[^*]*\*/g, '');
        this.syllables = textWithoutStars.match(/[a-z]+[_0-6]?/gi) || [];
        this.suggestions = [] 
        this.syllables.forEach((syl, i) => {
            this.suggestions.push(...this.dico
                                          .getMatchesForSyllable(syl.split("_")[0])
                                          .map(p => {
                                            p.for = i;
                                            p.start = 0;
                                            p.end = 0;
                                            return p;
                                        }));
        });
        console.log(this.syllables)
        this.text = text;
    }

    select(selectionIndex){
        const selection = this.suggestions[selectionIndex];
        this.replace(selection.for, selection.simp);
        this.update(this.text);
    }

    replace(sylIndex, replaceValue) {
        const toReplace = this.syllables[sylIndex];
        console.log(toReplace, replaceValue)
        const replaced = this.text.replace(toReplace, replaceValue);
        // if (replaced !== this.text) {this.text = replaced;}
        // else {
        console.log(this.text, replaced);

        this.text = replaced;
        // }
    }
}

class View {
    constructor ({dico}) {
        this.input = document.getElementById('pinyin-input');
        this.output = document.getElementById('suggested-hanzi');
        this.furiganaOutput = document.getElementById('pinyin-sentence-results');
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
    }

    renderSuggestions(suggestions){
        this.output.innerHTML = `
        <div class="flex gap-2 flex-wrap mb-2">
            ${suggestions.map((pron, i) => {
                const keyHint = i < 9 ? (i + 1) : String.fromCharCode(65 + i - 9); // 1–9, A–Z
                return `
                    <div class="flex flex-col items-center rounded hover:bg-gray-200 hover:shadow">
                        <button 
                            id="suggested-${keyHint}" 
                            class="text-small font-semibold" 
                            value="${i}">
                            ${pron.simp || '?'}
                        </button>
                        <div class="text-xs text-gray-600">
                            ${pron.abstractPinyin() || '?'}
                        </div>
                    </div>`;
                }).join('')}
        </div>`
    }

    renderChar(char){return `<span class="block text-base font-semibold text-black">${char}</span>`}
    renderKana(kana){return `<span class="block text-sm">${kana}</span>`}
    renderBlock(content){return `<span class="inline-block text-center align-center">${content}</span>`;}
    renderFurigana(char, kana){return this.renderBlock(`${this.renderKana(kana)}${this.renderChar(char)}`)}
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

    renderUnknownWords(sentences){

    }

    render(text) {
        this.input.value = text;
        // Build rich pinyin output
        const inputHanzi = Array.from(text);
        this.furiganaOutput.innerHTML = inputHanzi
            .filter(e => e != "_")
            .map(h => {
                if (h === '\n') return '<br>';
                if (h == ' ') return '<span class="inline-block w-4"></span>';
                if (isPunctuation(h)) {this.renderFurigana(h,"");}
                if (!isHanzi(h)) {return this.renderBlock(this.renderFurigana("",h))}
                const matches = this.dico.getMatchesForHanzi(h);
                const matchedPinyin = (matches.length === 0) ? '?' : matches.map(p => p.diacriticsPinyin()).join('/');
                return this.renderFurigana(h, matchedPinyin)
            })
            .join('');

        this.pinyinOnlyOutput.innerHTML = inputHanzi
            .filter(e => e != "_")
            .map(h => {
                if (h == '\n') return '<br>';
                if (h == ' ') return '<span class="inline-block w-4"></span>';
                if (h == '。') return '.';
                if (h == '、') return ',';
                const matches = this.dico.getMatchesForHanzi(h).map(p => p.abstractPinyin());
                return matches.length > 1 ? '(' + matches.join('/') + ')' : matches[0];
            })
            .join(' ');

        this.hanziOnlyOutput.innerHTML = inputHanzi
            .filter(e => e != "_")
            .map(h => {
                if (h === '\n') return '<br>';
                if (h == ' ') return '<span class="inline-block w-4"></span>';
                return h;
            })
            .join('');

        const sentences = text.split('\n').map((s) => new Sentence(this.dico, s));
        this.expressionOutput.innerHTML = sentences.map(s => s.render()).join('<br>');
    }
}

class Controller{
    constructor ({itemSelector, containerId }) {
        const dico = new Dictionary({containerId, itemSelector});
        this.model = new TextModel(dico);
        this.view = new View({dico});
        this.dico = dico;
        this.view.unknownProns.addEventListener("input", (event) => this.handleInsertHanzi(event));
        // this.view.unknownProns.addEventListener("click", (event) => this.handleInsertChar(event));
        this.view.input.addEventListener("input", (event) => this.handleInput(event));
        this.view.input.addEventListener("paste", (event) => this.handleInput(event));
        this.view.input.addEventListener("change", (event) => this.handleInput(event));
        this.view.output.addEventListener("click", (event) => this.handleClick(event));
        this.view.exportNew.addEventListener('click', (event) => this.handleExportNew(event));
        this.view.importProns.addEventListener('click', (event) => {this.handleImportProns(event)});
        this.view.input.value = '若 爸爸 在 屋家 麽?';
        this.view.input.dispatchEvent(new Event('change'));
        this.suggestions = [];
    }

    handleInsertHanzi(event){
        if (event.target.tagName !== 'INPUT') return; // only react to button clicks
        const sylIndex = event.target.id.split('char-for-syl-')[1];
        console.log(event.target);
        console.log(sylIndex)
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
                            console.log(p);
                            pronunciations.push(p);
                        }
                        console.log(this.dico.pronunciations.length)
                        console.log(pronunciations.length)

                        this.dico.addPronunciations(pronunciations);
                        console.log(this.dico.pronunciations.length)
                        // Output or use the array as needed
                        console.log('Compiled pronunciations:', pronunciations);
                        console.log(this.dico);
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

    // Select one Hanzi
    handleClick(event) {
        if (event.target.tagName !== 'BUTTON') return; // only react to button clicks
        this.model.select(event.target.value);
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
    }
)
