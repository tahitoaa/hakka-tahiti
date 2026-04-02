class HakkaText {
    constructor (dico, text='') {
        // A text model is a list of Tokens
        // this.items = [];
        this.suggestions = [];
        this.syllables = [];
        this.text = '';
        this.matches = '';
        this.dico = dico;
        this.pinyin = '';
        this.french = '';
        this.update({"hanzi" : text});
    }

update(update) {
    if (update["french"] != undefined) {
        this.french = update["french"];
    }

    if (update["hanzi"] != undefined) {
        const text = update["hanzi"];
        const textWithoutStars = text.replace(/\*[^*]*\*/g, '');
        this.syllables = textWithoutStars.match(/[a-zü]+[_0-6]?/gi) || [];
        this.suggestions = [];

        this.syllables.forEach((syl, i) => {
            this.suggestions.push(
                ...this.dico.getMatchesForSyllable(syl.split("_")[0]).map(p => ({
                    pron: p,
                    for: i,
                    start: 0,
                    end: 0
                }))
            );
        });

        this.text = text;

        // --- Compute pinyin from Sentence, line by line ---
        this.pinyin = this.text
                                .split('\n')
                                .map(line => this.resolveSentencePinyin(line))
                                .join('\n');
                        }
}

    resolveSentencePinyin(line) {
        const sentence = new Sentence(this.dico, line || '');

        return sentence.renderPinyinLine();
    }

    select(selectionIndex){
        const suggestion = this.suggestions[selectionIndex];
        this.replace(suggestion.for, suggestion.pron.simp);
        this.update({"hanzi": this.text});
    }

    replace(sylIndex, replaceValue) {
        const toReplace = this.syllables[sylIndex];
        const replaced = this.text.replace(toReplace, replaceValue);
        this.text = replaced;
    }
}