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
        if (update["french"]) {
            this.french = update["french"]
        }
        if (update["hanzi"]){
            const text = update["hanzi"];
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
            this.text = text;
        }
    }

    select(selectionIndex){
        const selection = this.suggestions[selectionIndex];
        this.replace(selection.for, selection.simp);
        this.update(this.text);
    }

    replace(sylIndex, replaceValue) {
        const toReplace = this.syllables[sylIndex];
        const replaced = this.text.replace(toReplace, replaceValue);
        // if (replaced !== this.text) {this.text = replaced;}
        // else {
        this.text = replaced;
        // }
    }
}