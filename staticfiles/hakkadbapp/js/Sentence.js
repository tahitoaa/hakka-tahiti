class Sentence {
    constructor(dico, text = '', french = '', rendering = '') {
        this.dico = dico;
        this.words = [];
        this.matches = [];
        this.parsedTokens = [];
        this.update(text);
        this.french = french;
        this.rendering = rendering;
    }

    // -----------------------------
    // Parsing
    // -----------------------------
    parseToken(token) {
        if (!token) return { hanzi: '', constraints: null, inline: null, raw: token };

        const parts = token.split(':');
        const base = parts[0];

        const constraints = parts[1]
            ? parts[1].split(',').map(c => c.trim().toLowerCase()).filter(Boolean)
            : null;

        const inlineMatch = base.match(/\(([^()]*)\)/);
        const inline = inlineMatch ? inlineMatch[1].trim() : null;

        const hanzi = base.replace(/\([^)]*\)/g, '').trim();

        return { hanzi, constraints, inline, raw: token };
    }

    // -----------------------------
    // Dictionary matching
    // -----------------------------
    findMatches(hanzi, constraints) {
        if (!hanzi) return [];

        let matches = this.dico.words.filter(w => {
            const d = w.dataset || w;
            const { simp, trad, french = '', pinyin = '' } = d;

            if (!simp) return false;
            if (simp !== hanzi && trad !== hanzi) return false;

            if (!constraints) return true;

            const fr = french.toLowerCase();
            const py = pinyin.toLowerCase();

            return constraints.some(c => fr.includes(c) || py.includes(c));
        });

        matches.sort((a, b) => {
            const da = a.dataset || a;
            const db = b.dataset || b;

            const fa = (da.french || '').toLowerCase();
            const fb = (db.french || '').toLowerCase();

            if (fa.length !== fb.length) return fa.length - fb.length;

            const frCmp = fa.localeCompare(fb, 'fr', { sensitivity: 'base' });
            if (frCmp !== 0) return frCmp;

            const pa = (da.pinyin || '').toLowerCase();
            const pb = (db.pinyin || '').toLowerCase();

            return pa.localeCompare(pb, 'fr');
        });

        return matches;
    }

    // -----------------------------
    // Unknown resolution
    // -----------------------------
    resolveUnknownPinyin(token) {
        const { hanzi, inline } = this.parseToken(token);

        if (inline) return inline;
        if (!hanzi || hanzi === '-') return '';

        return Array.from(hanzi).map(char => {
            const matches = this.dico.getMatchesForHanzi(char);
            if (!matches.length) return '?';

            const prons = matches
                .map(p => p.abstractPinyin?.())
                .filter(Boolean);

            return prons.length ? [...new Set(prons)].join('/') : '?';
        }).join('');
    }

    buildUnknownEntry(token) {
        const { hanzi, raw } = this.parseToken(token);
        return {
            dataset: {
                simp: hanzi || raw || '?',
                pinyin: this.resolveUnknownPinyin(token),
                french: '?',
                raw: raw || ''
            },
            isUnknown: true
        };
    }

    // -----------------------------
    // Update
    // -----------------------------
    update(text = '') {
        this.words = text ? text.trim().split(/\s+/) : [];

        this.matches = this.words.map(token => {
            const { hanzi, constraints } = this.parseToken(token);

            const matches = this.findMatches(hanzi, constraints);

            return matches.length ? matches : [this.buildUnknownEntry(token)];
        });
    }

    // -----------------------------
    // Helpers
    // -----------------------------
    superscriptTone(pinyin) {
        const map = { "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶" };
        return String(pinyin || '').replace(/[1-6]/g, d => map[d]);
    }

    renderPinyin(pinyin) {
        return this.superscriptTone(pinyin);
    }

renderFurigana() {
    return `
            ${this.matches.map((group, i) => {
                const best = group?.[0];
                const data = best?.dataset || best || {};
                const tokenObj = this.parseToken(this.words?.[i] || '');

                const hanzi = data.simp || tokenObj.hanzi || tokenObj.raw || '?';

                let pinyin = data.pinyin || '';
                if (!pinyin) {
                    const resolved = this.resolveUnknownPinyin(this.words?.[i] || '');
                    pinyin = resolved || '?';
                }

                return `
                    <span class="inline-flex flex-col items-center text-center align-top gap-[3px]">
                        
                        <span class="text-[12px] italic text-gray-600">
                            ${this.renderPinyin(pinyin)}
                        </span>

                        <span class="hanzi text-[1.15rem] font-semibold text-gray-900">
                            ${hanzi}
                        </span>

                    </span>
                `;
            }).join('')}
    `;
}
    truncateFrench(text, max = 16) {
        const s = String(text || '');
        return s.length > max ? s.slice(0, max) + '...' : s;
    }

    // -----------------------------
    // Sentence lines
    // -----------------------------
    renderPinyinLine() {
        return this.matches.map((group, i) => {
            const best = group?.[0];
            const data = best?.dataset || best;

            if (data?.pinyin) return this.renderPinyin(data.pinyin);

            const resolved = this.resolveUnknownPinyin(this.words[i]);
            return resolved ? this.renderPinyin(resolved) : '?';
        }).join(' ');
    }

    renderHanziLine() {
        return this.matches.map((group, i) => {
            const best = group?.[0];
            const data = best?.dataset || best;

            if (data?.simp) return data.simp;

            const t = this.parseToken(this.words[i]);
            return t.hanzi || t.raw || '?';
        }).join('');
    }

    renderFrenchLine() {
        return this.matches.map((group, i) => {
            const best = group?.[0];
            const data = best?.dataset || best;

            if (best?.isUnknown) {
                const t = this.parseToken(this.words[i]);
                return t.raw || '?';
            }

            return this.truncateFrench(data.french || '?');
        }).join(' ');
    }

    // -----------------------------
    // Token rendering
    // -----------------------------
    renderToken(group, index) {
        const best = group?.[0];
        if (!best) return '';

        const data = best.dataset || best;
        const isUnknown = !!best.isUnknown;
        const extra = group.length - 1;

        let color = "bg-green-200";
        if (isUnknown) color = "bg-orange-300";
        else if (extra > 0) color = "bg-blue-200";

        return `
        <span class="relative inline-flex flex-col justify-between items-center rounded-xl px-2 py-1 ${color} min-w-[4.5rem] max-w-[7rem] h-[5.25rem] shadow-sm">
            
            <div class="text-[10px] italic truncate w-full text-center">
                ${this.renderPinyin(data.pinyin)}
            </div>

            <div class="text-lg font-semibold truncate w-full text-center">
                ${data.simp}
            </div>

            <div class="text-[11px] truncate w-full text-center" title="${data.french}">
                ${isUnknown ? this.truncateFrench(data.raw) : this.truncateFrench(data.french)}
            </div>

            ${(!isUnknown && extra > 0) ? `
                <button onclick="toggleAlt(${index})" class="text-[10px]">+${extra}</button>
            ` : `<span class="h-[1rem]"></span>`}

            ${extra > 0 && !isUnknown ? `
                <div id="alt-${index}" class="hidden absolute top-full bg-white shadow p-1">
                    ${group.slice(1).map(w => {
                        const d = w.dataset || w;
                        return `
                            <div class="text-center text-xs">
                                ${this.renderPinyin(d.pinyin)} ${d.simp}
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : ""}
        </span>
        `;
    }

    renderTokens(){
        return `<div class="flex flex-wrap gap-2">
                ${this.matches.map((g, i) => this.renderToken(g, i)).join('')}
            </div>`;
    }
    // -----------------------------
    // Main render
    // -----------------------------
    render() {
        return `
        <div class="flex flex-col gap-3">
                ${this.renderTokens()}
            <div class="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <span class="text-sm text-slate-800">
                    ${this.renderPinyinLine()}
                </span>
                <span class="hanzi text-lg font-medium text-slate-900 tracking-wide">
                    ${this.renderHanziLine()}
                </span>
                <span class="text-sm text-slate-800 leading-snug">
                    ${this.french}
                </span>
            </div>

        </div>
        `;
    }
}

// global helper
function toggleAlt(i) {
    const el = document.getElementById(`alt-${i}`);
    if (el) el.classList.toggle('hidden');
}