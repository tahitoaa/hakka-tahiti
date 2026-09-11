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

    diacriticsPinyin() {
        const pron =  this.initial + this.final + this.tone;

        return pron.replace(
            /(\D*[aeo]|\D*i(?=u\d)|\D*u(?=i\d)|\D*[iu]|\D*[mn])(\D*)(\d)/g,
            (_, nucleus, tail, tone) => {
                // Convert tone number (string) → integer index
                return nucleus +  " ́̄̆̀̆̀"[+tone] + tail + "\u{2009}";
            }
        );
    }

    char() {
        // hasAttribute() alone is wrong here: the button ships with
        // aria-pressed="false" already in the markup, so the attribute is
        // *present* (just false-valued) before any click -- checking only
        // for presence made this return trad by default, before the user
        // ever touched the toggle. Compare the value instead, and don't
        // assume the button exists (this class is also usable standalone).
        const toggle = typeof document !== 'undefined' ? document.getElementById('toggle-hanzi') : null;
        const showingTrad = toggle?.getAttribute('aria-pressed') === 'true';
        return (showingTrad && this.trad) ? this.trad : this.simp;
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
