class Pronunciation {
    static toneMap = {"1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "":""};

    constructor ({simp, trad, initial, final, tone}){
        this.simp = simp;
        this.trad = trad;
        this.initial = initial;
        this.final = final;
        this.tone = tone;
        this.origin = "lexique-wenfa"
    }

    abstractPinyin() {
        return this.initial + this.final + Pronunciation.toneMap[this.tone];
    }

    char() {
        if (document.getElementById('toggle-hanzi').hasAttribute('aria-pressed')){
            return this.trad;
        } else {
            return this.simp;
        }
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
