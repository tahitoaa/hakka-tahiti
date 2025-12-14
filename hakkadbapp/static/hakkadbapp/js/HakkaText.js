class HakkaText {
    constructor (dico, text='') {
        // A text model is a list of Tokens
        // this.items = [];
        this.suggestions = [];
        this.syllables = [];
        this.text = '';
        this.matches = '';
        this.dico = dico;
        this.update({"hanzi" : text, "french": ''});
        this.french = '';
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