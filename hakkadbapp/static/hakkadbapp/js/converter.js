function isPunctuation(ch) {
    // This covers most ASCII punctuation
    return /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~、。]$/.test(ch);
}

function isHanzi(ch) {
    return /[\u4e00-\u9fff]/.test(ch);
}

class Dictionary {
    constructor ({containerId, itemSelector}) {
        this.items = Array.from(document.querySelectorAll(`${containerId} > ${itemSelector}`));
        this.pronunciations = this.items.map(el => this.parsePronunciation(el));
    }

    parsePronunciation(el) {
        const parts = el.dataset.search?.toLowerCase().split(',') || [];
        return new Pronunciation({
            simp: parts[0],
            trad: parts[1],
            initial: parts[2],
            final: parts[3],
            tone:parts[4]
        });
    }

    getMatchesForSyllable(syl) {
        return this.pronunciations.filter(p => {
            const pinyin = p.abstractPinyin();
            const lowerTone = p.initial + p.final + p.tone;
            return syl == [p.initial, p.final].join('') 
                    || syl == pinyin
                    || syl == lowerTone
                    || p.simp === syl
                    || p.trad === syl ; 
        });
    }

    getMatchesForHanzi(char) {
        if (!char || char.length !== 1 || !isHanzi(char)) {
            return [new NoHanziToken({text:char})]
        }
        const matches = this.pronunciations.filter(p => {
            return p.simp == char || p.trad == char;
        });
        console.log(matches);
        return matches;
    }
}


class Pronunciation {
    static toneMap = {"1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "":""};

    constructor ({simp, trad, initial, final, tone}){
        this.simp = simp;
        this.trad = trad;
        this.initial = initial;
        this.final = final;
        this.tone = tone;
    }

    abstractPinyin() {
        return this.initial + this.final + Pronunciation.toneMap[this.tone];
    }
}

class NoHanziToken extends Pronunciation {
    constructor ({text}) {
        super({simp:text, trad:text, initial:"", final:"", tone:""})
        this.text = text;
    }

    abstractPinyin() {
        return this.text;
    }
}

class Punctuation extends NoHanziToken {
    constructor ({text}) {
        super({text});
    }
}

class UnknownHanzi extends Pronunciation {
    constructor ({initial, final, tone}) {
        super({simp:"", trad:"", initial:"", final:"", tone:""})
        this.text = text;
        this.simp = ["(",initial, final, tone, ")"].join('');
        this.trad = this.simp;
    }
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
        this.syllables = text.match(/[a-z]+[0-9]?/gi) || [];
        this.suggestions = [] 
        this.syllables.forEach((syl, i) => {
            this.suggestions.push(...this.dico
                                          .getMatchesForSyllable(syl)
                                          .map(p => {
                                            p.for = i;
                                            return p;
                                        }));
        });
        this.text = text;
    }

    select(selectionIndex){
        const selection = this.suggestions[selectionIndex];
        const toReplace = this.syllables[selection.for];
        this.text = this.text.replace(toReplace+'_', selection.simp);
        this.text = this.text.replace(toReplace, selection.simp);
        this.update(this.text);
    }
}

class View {
    constructor ({inputId, outputId, pinyinOutputId, pinyinOnlyId, hanziOnlyOutput, dico}) {
        this.input = document.getElementById(inputId);
        this.output = document.getElementById(outputId);
        this.pinyinOutput = document.getElementById(pinyinOutputId);
        this.pinyinOnlyOutput = document.getElementById(pinyinOnlyId);
        this.hanziOnlyOutput = document.getElementById(hanziOnlyOutput);
        this.dico = dico;
    }

    renderSuggestions(suggestions){
        this.output.innerHTML = `
        <div class="flex gap-2 flex-wrap mb-2">
            ${suggestions.map((pron, i) => {
                const keyHint = i < 9 ? (i + 1) : String.fromCharCode(65 + i - 9); // 1–9, A–Z
                return `
                    <div class="flex flex-col items-center border rounded">
                        <span class="text-xs text-gray-500">${keyHint}</span>
                        <button 
                            id="suggested-${keyHint}" 
                            class="text-2xl font-semibold px-2 py-1 rounded hover:bg-gray-200" 
                            value="${i}">
                            ${pron.simp || '?'}
                        </button>
                        <div class="text-lg text-gray-600">
                            ${pron.abstractPinyin() || '?'}
                        </div>
                    </div>`;
                }).join('')}
        </div>`
    }

    renderChar(char){return `<span class="block text-base font-semibold text-black">${char}</span>`}
    renderKana(kana){return `<span class="block text-sm">${kana}</span>`}
    renderBlock(content){return `<span class="inline-block mr-2 text-center align-center">${content}</span>`;}
    renderFurigana(char, kana){return this.renderBlock(`${this.renderKana(kana)}${this.renderChar(char)}`)}

    render(text) {
        this.input.value = text
        // Build rich pinyin output
        const inputHanzi = Array.from(text);
        this.pinyinOutput.innerHTML = inputHanzi
            .filter(e => e != "_")
            .map(h => {
                if (h === '\n') return '<br>';
                if (h == ' ') return '<span class="inline-block w-4"></span>';
                if (isPunctuation(h)) {this.renderFurigana(h,"");}
                if (!isHanzi(h)) {return this.renderBlock(this.renderChar(h))}
                const matches = this.dico.getMatchesForHanzi(h);
                const matchedPinyin = (matches.length === 0) ? '?' : matches.map(p => p.abstractPinyin()).join('/');
                return this.renderBlock(`${this.renderKana(matchedPinyin)}${this.renderChar(h)}`)
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
        this.input.focus(); // keep focus on input
    }
}

class Controller{
    constructor ({ inputId, itemSelector, containerId, outputId, pinyinOutputId, pinyinOnlyId, hanziOnlyOutput }) {
        const dico = new Dictionary({containerId, itemSelector});
        this.model = new TextModel(dico);
        this.view = new View({inputId, outputId, pinyinOutputId, pinyinOnlyId, hanziOnlyOutput, dico});
        this.view.input.addEventListener("input", (event) => this.handleInput(event));
        this.view.input.addEventListener("paste", (event) => this.handleInput(event));
        this.view.input.addEventListener("change", (event) => this.handleInput(event));
        this.view.output.addEventListener("click", (event) => this.handleClick(event));
        this.view.input.value = '大家hao';
        this.view.input.dispatchEvent(new Event('change'));
        this.suggestions = [];
    }

    // Input change
    handleInput(event) {
        const text = this.view
                         .input
                         .value
                         .toLowerCase()
                        //  .split('')
                        //  .map(c => c == "_"? "" : c)
                        //  .join('');
        this.model.update(text);
        this.view.renderSuggestions(this.model.suggestions);
        this.view.render(this.model.text);
    }

    // Select one Hanzi
    handleClick(event) {
        if (event.target.tagName !== 'BUTTON') return; // only react to button clicks
        this.model.select(event.target.value);
        this.view.render(this.model.text);
        this.view.renderSuggestions(this.model.suggestions);    
    }
}

// Activate
document.addEventListener("DOMContentLoaded", () =>
    {
        const converter = new Controller({
            inputId: 'pinyin-input',
            itemSelector: 'li',
            containerId: '#pron-list',
            outputId: 'suggested-hanzi',
            pinyinOutputId: 'pinyin-sentence-results',
            pinyinOnlyId:'pinyin-only',
            hanziOnlyOutput:'hanzi-only-output',
        });
    }
)
