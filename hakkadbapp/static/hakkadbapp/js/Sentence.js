class Sentence {
    constructor(dico, text){
        this.dico = dico;
        this.update(text);
        this.unknowns = []
    }

    render(){
        document.createElement('div');
        return this.matches.map((candidates) => {
            return candidates.map((word) => {
                const color = word.dataset.french === '?' ? "bg-orange-400" : "bg-green-300";

                const tooltip = Object.entries(word.dataset)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join("\n");   // newline tooltip
                
                const showTrad = (word.dataset.simp != word.dataset.trad)
                return `
                    <span class="text-xs ${color} px-1 py-0.5 rounded inline-flex flex-col leading-tight"
                        title="${tooltip}">
                        
                        <!-- 1. Pinyin -->
                        <span class="italic text-[10px]">${word.dataset.pinyin || "sans pinyin" }</span>

                        <!-- 2. French -->
                        <span class="font-semibold">${word.dataset.french == '?' ? "sans traduction" : word.dataset.french }</span>

                        <!-- 3. Simplified -->
                        <span class="hanzi text-lg" >${word.dataset.simp}</span>

                        <!-- 4. Traditional (only if different) -->
                        ${showTrad && word.dataset.trad ? `<span class="hanzi text-lg opacity-60">${word.dataset.trad}</span>` : ""}
                    </span>
                `;
            }).join('/');
        }).join('|');
    }

    update(text){
        if (text)
            this.words = text.trim().split(/[\s,。，;:.\-]+/);
        else
            this.words = []
        this.matches = this.words.map(word => {
            const matchWords = this.dico.words.filter((dictWord) => {
                if (!dictWord.dataset.simp)
                    return false;
                return (dictWord.dataset.simp === word ||
                    dictWord.dataset.trad === word);
            });
            if (matchWords.length > 0) {
                    return matchWords;
            }
            else 
                return [{dataset: {french: '?', simp: word}}];
        }); 
    }
}