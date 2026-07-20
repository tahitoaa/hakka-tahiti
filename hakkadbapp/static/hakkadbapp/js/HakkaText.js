class HakkaText extends SyllableInputModel {
    constructor (dico, text='') {
        super(dico);
        this.matches = '';
        this.pinyin = '';
        this.french = '';
        this.hanzi = '';
        this.sentences = [];
        this.update({"hanzi" : text});

    }

    update(update) {
        if (update["french"] != undefined) {
            this.french = update["french"];
        }

        if (update["hanzi"] != undefined) {
            this.parse(update["hanzi"]);
            this.sentences = this.text
                                    .split('\n')
                                    .map(line => new Sentence(this.dico, line));

            // --- Compute pinyin from Sentence, line by line ---
            this.pinyin = this.sentences.map(s => s.renderPinyinLine()).join('\n ');
            this.hanzi = this.sentences.map(s => s.renderHanziLine()).join('\n ');
        }
    }

    resolveSentencePinyin(line) {
        const sentence = new Sentence(this.dico, line || '');
        return sentence.renderPinyinLine();
    }

    select(selectionIndex){
        const suggestion = this.suggestions[selectionIndex];
        if (!suggestion) return;
        this.replace(suggestion.for, suggestion.pron.simp);
        this.update({"hanzi": this.text});
    }
}
