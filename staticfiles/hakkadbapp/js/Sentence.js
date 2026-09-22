// Sitewide simp/trad toggle (the "Trad. / Simp." button in base.html's
// header, present on every page): reads its aria-pressed value directly
// rather than caching it, since it can change between renders. Falls back
// to simp whenever no trad variant was recorded for a match (buildUnknownEntry
// entries, punctuation, etc. only ever set `simp`).
function isShowingTrad() {
    if (typeof document === 'undefined') return false;
    const toggle = document.getElementById('toggle-hanzi');
    return toggle?.getAttribute('aria-pressed') === 'true';
}

function pickHanzi(data) {
    if (!data) return '';
    return (isShowingTrad() && data.trad) ? data.trad : (data.simp || '');
}

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

                const hanzi = pickHanzi(data) || tokenObj.hanzi || tokenObj.raw || '?';

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

                        <span class="hanzi text-base leading-tight font-semibold">
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

    // forceSimp bypasses the sitewide Trad./Simp. toggle -- for callers that
    // compare this text against a platform/DB value that's always
    // simplified (e.g. the expressions comparison view), where honoring the
    // toggle would make an otherwise-correct match look like a mismatch.
    renderHanziLine(forceSimp = false) {
        return this.matches.map((group, i) => {
            const best = group?.[0];
            const data = best?.dataset || best;

            if (data?.simp) return forceSimp ? data.simp : pickHanzi(data);

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
        const tokenObj = this.parseToken(this.words?.[index] || '');
        const isDisambiguated = !isUnknown && !!(tokenObj.constraints && tokenObj.constraints.length > 0);

        // CSS-var-backed instead of fixed Tailwind colors, so these badges
        // stay legible under dark mode (system prefers-color-scheme, or a
        // page's own manual [data-theme="dark"] toggle) -- see base.html.
        // Four distinct hues are kept even in dark mode so each state stays
        // easy to tell apart at a glance: green = single unambiguous match,
        // yellow = disambiguated via a ":constraint" on the token, blue =
        // still ambiguous (several entries, no constraint given), orange =
        // no dictionary entry found at all.
        let colorClass = "bg-[var(--sentence-badge-known-bg)] text-[var(--sentence-badge-known-fg)]";
        if (isUnknown) colorClass = "bg-[var(--sentence-badge-unknown-bg)] text-[var(--sentence-badge-unknown-fg)]";
        else if (isDisambiguated) colorClass = "bg-[var(--sentence-badge-disambig-bg)] text-[var(--sentence-badge-disambig-fg)]";
        else if (extra > 0) colorClass = "bg-[var(--sentence-badge-multi-bg)] text-[var(--sentence-badge-multi-fg)]";

        return `
        <span onclick="toggleDetail(${index})" class="relative inline-flex flex-col justify-between items-center rounded-lg px-1.5 py-1 ${colorClass} min-w-[3.5rem] max-w-[5.5rem] h-[3.75rem] cursor-pointer">

            <div class="text-[9px] italic leading-none truncate w-full text-center">
                ${this.renderPinyin(data.pinyin)}
            </div>

            <div class="hanzi text-base font-semibold leading-tight truncate w-full text-center">
                ${pickHanzi(data)}
            </div>

            <div class="text-[9px] leading-none truncate w-full text-center" title="${escapeAttr(isUnknown ? data.raw : data.french)}">
                ${isUnknown ? this.truncateFrench(data.raw, 10) : this.truncateFrench(data.french, 10)}
            </div>

            ${(!isUnknown && extra > 0) ? `
                <button onclick="event.stopPropagation(); toggleAlt(${index})" class="absolute -top-1 -right-1 leading-none text-[9px] w-3.5 h-3.5 rounded-full bg-[var(--sentence-popup-bg)] text-[var(--sentence-text-primary)] border border-[var(--sentence-preview-border)]">+${extra}</button>
            ` : ""}

            ${extra > 0 && !isUnknown ? `
                <div id="alt-${index}" onclick="event.stopPropagation()" class="hidden absolute top-full left-0 z-10 mt-0.5 min-w-[13rem] max-w-[20rem] rounded-md border border-[var(--sentence-preview-border)] bg-[var(--sentence-popup-bg)] text-[var(--sentence-text-primary)] shadow-lg p-1.5 divide-y divide-[var(--sentence-preview-border)]">
                    ${group.map(w => {
                        // Ambiguous entries can still differ in the hanzi
                        // shown (simp/trad aren't always both filled in), so
                        // each row gets its own hanzi alongside the pinyin,
                        // french gloss and category -- otherwise entries with
                        // an identical or missing french gloss look like the
                        // same option repeated.
                        const d = w.dataset || w;
                        return `
                            <div class="flex items-center gap-2 text-[13px] leading-snug py-1.5 px-1" title="${escapeAttr(d.french || '?')}">
                                <span class="hanzi text-base font-semibold shrink-0">${pickHanzi(d) || '?'}</span>
                                <span class="italic text-[var(--sentence-text-muted)] text-[11px] shrink-0">${this.renderPinyin(d.pinyin)}</span>
                                <span class="flex-1 min-w-0">${escapeAttr(d.french || '?')}</span>
                                ${d.category ? `<span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[var(--sentence-preview-border)]">${escapeAttr(d.category)}</span>` : ""}
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : ""}

            ${this.renderDetailPopup(data, index, isUnknown)}
        </span>
        `;
    }

    // Full-detail popup shown when a token badge is clicked -- unlike the
    // badge itself (which truncates pinyin/hanzi/french to fit) and the
    // "+n" alternates list (which only covers other dictionary entries for
    // the same hanzi), this always shows the complete entry for the token's
    // best match: pinyin, both hanzi variants, and every gloss field the
    // Word model carries (french/english/mandarin/category).
    renderDetailPopup(data, index, isUnknown) {
        if (isUnknown) {
            return `
                <div id="detail-${index}" onclick="event.stopPropagation()" class="hidden absolute top-full left-0 z-20 mt-0.5 min-w-[10rem] max-w-[16rem] rounded-md border border-[var(--sentence-preview-border)] bg-[var(--sentence-popup-bg)] text-[var(--sentence-text-primary)] shadow-lg p-2 text-left text-[11px] leading-snug">
                    <div class="hanzi font-semibold text-sm mb-1">${escapeAttr(data.raw || data.simp || '?')}</div>
                    <div class="italic text-[var(--sentence-text-muted)]">Aucune entrée trouvée dans le dictionnaire.</div>
                </div>
            `;
        }

        const rows = [
            ['Pinyin', this.renderPinyin(data.pinyin)],
            ['Simplifié', data.simp],
            ['Traditionnel', data.trad],
            ['Français', data.french],
            ['Anglais', data.english],
            ['Mandarin', data.mandarin],
            ['Catégorie', data.category],
        ].filter(([, value]) => value);

        return `
            <div id="detail-${index}" onclick="event.stopPropagation()" class="hidden absolute top-full left-0 z-20 mt-0.5 min-w-[11rem] max-w-[18rem] rounded-md border border-[var(--sentence-preview-border)] bg-[var(--sentence-popup-bg)] text-[var(--sentence-text-primary)] shadow-lg p-2 text-left text-[11px] leading-snug">
                ${rows.map(([label, value]) => `
                    <div class="flex gap-1 py-0.5">
                        <span class="font-semibold text-[var(--sentence-text-muted)] shrink-0">${label}:</span>
                        <span class="${label === 'Pinyin' ? '' : (label === 'Simplifié' || label === 'Traditionnel' ? 'hanzi' : '')}">${label === 'Pinyin' ? value : escapeAttr(value)}</span>
                    </div>
                `).join('')}
            </div>
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

// Alternates ("+n") and detail popups share a token's badge, so only one
// should ever be open at a time -- across all tokens in the sentence, not
// just the one being toggled, otherwise stray popups from other tokens pile
// up as the user clicks around.
function closeSentencePopups(exceptId) {
    document.querySelectorAll('[id^="alt-"], [id^="detail-"]').forEach(el => {
        if (el.id !== exceptId) el.classList.add('hidden');
    });
}

function toggleAlt(i) {
    const id = `alt-${i}`;
    const el = document.getElementById(id);
    if (!el) return;
    const opening = el.classList.contains('hidden');
    closeSentencePopups(id);
    el.classList.toggle('hidden', !opening);
}

function toggleDetail(i) {
    const id = `detail-${i}`;
    const el = document.getElementById(id);
    if (!el) return;
    const opening = el.classList.contains('hidden');
    closeSentencePopups(id);
    el.classList.toggle('hidden', !opening);
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