function isPunctuation(ch) {
    // This covers most ASCII punctuation
    return /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~、。]$/.test(ch);
}

function isHanzi(ch) {
    // Covers CJK Unified Ideographs, Extension A, and B (including \u3400-\u4DBF, \u4E00-\u9FFF, \u20000-\u2A6DF)
    return /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(ch);
}

class Dictionary {
    constructor ({containerId, itemSelector}) {
        this.pronItems = Array.from(document.querySelectorAll(`${containerId} > ${itemSelector}`));
        this.pronunciations = this.pronItems.map(el => this.parsePronunciation(el));
        this.unknowns = new Set();
        this.wordItems = Array.from(document.querySelectorAll(`#word-list > ${itemSelector}`))
        this.words = this.wordItems.map(el => new Word(el.dataset));
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

    addPronunciations(newProns){
        newProns.forEach(newPron => {
            const exists = this.pronunciations.some(p =>
                p.simp === newPron.simp &&
                p.trad === newPron.trad &&
                p.initial === newPron.initial &&
                p.final === newPron.final &&
                p.tone === newPron.tone
            );
            if (!exists) {
                this.pronunciations.push(newPron);
            }
        });
    }

    getMatchesForSyllable(syl) {
        return this.pronunciations.filter(p => {
            const pinyin = p.abstractPinyin();
            const lowerTone = p.initial + p.final + p.tone;
            return syl == [p.initial, p.final].join('') 
                    // || syl == [p.initial+'h', p.final].join('') 
                    // || syl == [p.initial.replace('h',''), p.final].join('') 
                    || syl == pinyin
                    || syl == lowerTone
                    || p.simp === syl
                    || p.trad === syl 
                    ; 
        });
    }

    getMatchesForHanzi(char) {
        if (!isHanzi(char)) {
            return [new NoHanziToken({text:char})]
        }
        if (isPunctuation(char)) {
            return [new Punctuation({text:char})]
        }
        if (!char || char.length !== 1 || !isHanzi(char)) {
            return [new NoHanziToken({text:char})]
        }
        const matches = this.pronunciations.filter(p => {
            return p.simp == char || p.trad == char;
        });

        if (matches.length == 0) this.unknowns.add(char);
        return matches;
    }

    async handleImportProns(event){
        if (!window.showDirectoryPicker) {
            alert("Your browser does not support the File System Access API required for folder picking.");
            return;
        }
        try {
            const dirHandle = await window.showDirectoryPicker();
            const pronunciations = [];
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && entry.name == 'prons.csv' ) {
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
                    this.addPronunciations(pronunciations);
                    alert(`Loaded ${pronunciations.length} pronunciations from folder.`);
                }
            }

        } catch (err) {
            console.error(err);
            alert("Failed to import pronunciations.");
        }
    }
}