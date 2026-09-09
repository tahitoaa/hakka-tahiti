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
                    <span class="inline-flex flex-col items-center text-center align-top gap-[1px] mr-1">

                        <span class="text-[10px] italic leading-none text-[var(--sentence-text-muted)]">
                            ${this.renderPinyin(pinyin)}
                        </span>

                        <span class="hanzi text-base leading-tight font-semibold text-[var(--sentence-text-strong)]">
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

        // CSS-var-backed instead of fixed Tailwind colors, so these badges
        // stay legible under dark mode (system prefers-color-scheme, or a
        // page's own manual [data-theme="dark"] toggle) -- see base.html.
        // Three distinct hues (green/blue/orange) are kept even in dark mode
        // so known / multi-match / unknown words stay easy to tell apart.
        let colorClass = "bg-[var(--sentence-badge-known-bg)] text-[var(--sentence-badge-known-fg)]";
        if (isUnknown) colorClass = "bg-[var(--sentence-badge-unknown-bg)] text-[var(--sentence-badge-unknown-fg)]";
        else if (extra > 0) colorClass = "bg-[var(--sentence-badge-multi-bg)] text-[var(--sentence-badge-multi-fg)]";

        return `
        <span class="relative inline-flex flex-col justify-between items-center rounded-lg px-1.5 py-1 ${colorClass} min-w-[3.5rem] max-w-[5.5rem] h-[3.75rem]">

            <div class="text-[9px] italic leading-none truncate w-full text-center">
                ${this.renderPinyin(data.pinyin)}
            </div>

            <div class="text-base font-semibold leading-tight truncate w-full text-center">
                ${data.simp}
            </div>

            <div class="text-[9px] leading-none truncate w-full text-center" title="${escapeAttr(isUnknown ? data.raw : data.french)}">
                ${isUnknown ? this.truncateFrench(data.raw, 10) : this.truncateFrench(data.french, 10)}
            </div>

            ${(!isUnknown && extra > 0) ? `
                <button onclick="toggleAlt(${index})" class="absolute -top-1 -right-1 leading-none text-[9px] w-3.5 h-3.5 rounded-full bg-[var(--sentence-popup-bg)] text-[var(--sentence-text-primary)] border border-[var(--sentence-preview-border)]">+${extra}</button>
            ` : ""}

            ${extra > 0 && !isUnknown ? `
                <div id="alt-${index}" class="hidden absolute top-full left-0 z-10 mt-0.5 min-w-full whitespace-nowrap rounded-md border border-[var(--sentence-preview-border)] bg-[var(--sentence-popup-bg)] text-[var(--sentence-text-primary)] shadow p-1">
                    ${group.slice(1).map(w => {
                        const d = w.dataset || w;
                        return `
                            <div class="text-center text-[11px] leading-tight py-0.5">
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
        return `<div class="flex flex-wrap gap-1.5">
                ${this.matches.map((g, i) => this.renderToken(g, i)).join('')}
            </div>`;
    }

    // -----------------------------
    // Copy-to-clipboard field
    // -----------------------------
    renderCopyButton(text, label) {
        return `
            <button type="button"
                class="copy-btn inline-flex items-center justify-center w-6 h-6 flex-shrink-0 rounded-md border border-[var(--sentence-preview-border)] text-[var(--sentence-text-muted)] hover:text-[var(--sentence-text-primary)] hover:border-[var(--sentence-text-muted)] transition-colors"
                data-copy-text="${escapeAttr(text)}"
                title="Copier ${escapeAttr(label)}"
                onclick="copyFromButton(this)">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
        `;
    }

    // -----------------------------
    // Main render
    // -----------------------------
    render() {
        const pinyinLine = this.renderPinyinLine();
        const hanziLine = this.renderHanziLine();

        return `
        <div class="flex flex-col gap-2">
                ${this.renderTokens()}
            <div class="flex flex-col rounded-md border border-[var(--sentence-preview-border)] bg-[var(--sentence-preview-bg)] overflow-hidden">
                <div class="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--sentence-preview-border)]">
                    <div class="flex-1 min-w-0">
                        <div class="text-xs text-[var(--sentence-text-primary)] truncate">${pinyinLine}</div>
                        <div class="hanzi text-base font-medium text-[var(--sentence-text-strong)] tracking-wide truncate">${hanziLine}</div>
                    </div>
                    ${this.renderCopyButton(`${pinyinLine} ${hanziLine}`, 'pinyin et hanzi')}
                </div>
                <div class="flex items-center gap-2 px-2 py-1.5">
                    <div class="flex-1 min-w-0 text-xs text-[var(--sentence-text-primary)] leading-snug">${this.french}</div>
                    ${this.renderCopyButton(this.french, 'français')}
                </div>
            </div>

        </div>
        `;
    }
}

// global helpers
function toggleAlt(i) {
    const el = document.getElementById(`alt-${i}`);
    if (el) el.classList.toggle('hidden');
}

function escapeAttr(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const CHECK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polyline points="20 6 9 17 4 12"></polyline></svg>';

function copyFromButton(btn) {
    const text = btn.getAttribute('data-copy-text') || '';
    if (!navigator.clipboard) return;

    navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = CHECK_ICON;
        btn.classList.add('text-green-600');
        clearTimeout(btn._copyResetTimer);
        btn._copyResetTimer = setTimeout(() => {
            btn.innerHTML = COPY_ICON;
            btn.classList.remove('text-green-600');
        }, 1200);
    }).catch(() => {});
}