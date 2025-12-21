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

    update(update){
        // Remove all substrings between two * (including the *)
        if (update["french"] != undefined) {
            this.french = update["french"]
        }
        if (update["hanzi"] != undefined){
            const text = update["hanzi"];
            const textWithoutStars = text.replace(/\*[^*]*\*/g, '');
            this.syllables = textWithoutStars.match(/[a-z]+[_0-6]?/gi) || [];
            this.suggestions = [] 
            this.syllables.forEach((syl, i) => {
                this.suggestions.push(...this.dico
                    .getMatchesForSyllable(syl.split("_")[0])
                    .map(p => ({
                        pron: p,      // original pronunciation
                        for: i,       // syllable index
                        start: 0,
                        end: 0
                    })));
            });
            this.text = text;
            this.pinyin = Array.from(this.text)
                                .filter(e => e != "_")
                                .map(h => {
                                    if (h == '。') return '.';
                                    if (h == '、') return ',';
                                    const matches = this.dico.getMatchesForHanzi(h).map(p => p.abstractPinyin());
                                    return matches.length > 1 ? '(' + matches.join('/') + ')' : matches[0];
                                })
                                .join(' ');
            console.log(this.pinyin);
        }
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