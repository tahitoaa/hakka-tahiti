/**
 * Sentence
 * ----------
 * - Takes a dictionary (dico) and an input text
 * - Splits the text into tokens
 * - Matches each token against dictionary entries
 * - Renders annotated HTML (pinyin / french / hanzi)
 */
class Sentence {

    /**
     * @param {Object} dico - Dictionary instance containing words
     * @param {String} text - Input sentence
     */
    constructor(dico, text = '') {
        this.dico = dico;
        this.words = [];
        this.matches = [];
        this.unknowns = [];

        this.update(text);
    }

    /**
     * Render the sentence as HTML
     * - Each word may have multiple candidate dictionary matches
     * - Candidates are separated by "/"
     * - Words are separated by "|"
     */
    render() {
        return this.matches
            .map(candidates =>
                candidates
                    .map((word, index) => this.renderWord(word, index))
            )
            .join('|');              // word separator
    }

    /**
     * Render a single dictionary word entry
     * @param {Object} word - Dictionary word object
     */
    renderWord(word, index) {
        const { french, simp, trad, pinyin} = word.dataset;

        console.log(word);
        // Color depending on translation availability
        var color = french === '?' ? 'bg-orange-400' : 'bg-green-300';
        if (index > 0) 
            color = 'bg-green-100';
        // Tooltip: all dataset fields
        const tooltip = Object.entries(word.dataset)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n');

        // Show traditional only if different from simplified
        const showTrad = trad && trad !== simp;

        return `
            <span class="text-xs ${color} px-1 py-0.5 rounded inline-flex flex-col leading-tight"
                  title="${tooltip}">
                  <span>${index+1}</span>

                <!-- 1. Pinyin -->
                <span class="italic text-[10px]">
                    ${pinyin || 'sans pinyin'}
                </span>

                <!-- 2. French -->
                <span class="font-semibold block max-w-[8rem] truncate">
                    ${french === '?' ? 'sans traduction' : french}
                </span>

                <!-- 3. Simplified Hanzi -->
                <span class="hanzi text-lg">
                    ${simp}
                </span>

                <!-- 4. Traditional Hanzi (optional) -->
                ${showTrad
                    ? `<span class="hanzi text-lg opacity-60">${trad}</span>`
                    : ''
                }
            </span>
        `;
    }

    /**
     * Update sentence content
     * - Tokenizes text
     * - Matches each token against dictionary words
     * @param {String} text
     */
    update(text = '') {
        // Split on spaces + common punctuation
        this.words = text
            ? text.trim().split(/[\s,。，.\-]+/)
            : [];

        // For each word, find dictionary matches
        this.matches = this.words.map(disambiguatedWord => {
            const word = disambiguatedWord.split(':')[0];
            const disambiguation = disambiguatedWord.split(':')[1];

            const constraints = disambiguation?.split(',')
                                            .map(c => c.trim().toLowerCase())
                                            .filter(Boolean);
                                                        
            const matches = this.dico.words
                .filter(dictWord => {
                    const { simp, trad, french = '', pinyin = '' } = dictWord.dataset || {};

                    // 1️⃣ Hanzi match (required)
                    if (!simp) return false;

                    if ((simp !== word && trad !== word)) return false;

                    // 2️⃣ No constraints → accept
                    if (!constraints) return true;

                    const fr = french.toLowerCase();
                    const py = pinyin.toLowerCase();

                    // 3️⃣ At least one constraint must match french OR pinyin
                    return constraints.some(c =>
                        fr.includes(c) || py.includes(c)
                    );
                })
                .sort((a, b) => {
                    const fa = (a.dataset.french || '').toLowerCase();
                    const fb = (b.dataset.french || '').toLowerCase();

                    if (fa.length < fb.length) 
                        return -1;
                    else if (fa.length > fb.length)
                        return 1;
                    // 1️⃣ French (ascending)
                    if (fa !== fb) {
                        return fa.localeCompare(fb, 'fr', { sensitivity: "base" });
                    }

                    // 2️⃣ Pinyin (lexicographical)
                    const pa = (a.dataset.pinyin || '').toLowerCase();
                    const pb = (b.dataset.pinyin || '').toLowerCase();

                    return pa.localeCompare(pb, 'fr');
                });
                if (matches.length) return matches;

                else return [{ dataset: { french: '?', simp: word } }];
            });
    }
}
