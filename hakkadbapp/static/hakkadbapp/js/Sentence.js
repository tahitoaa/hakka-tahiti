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
    // One punctuation in the text, either form (, or ，): the Chinese mark in
    // the hanzi lines, the Latin one in the pinyin lines. Same table as
    // text_to_words.py (_PUNCT_FULLWIDTH_TO_LATIN) on the server.
    static PUNCT_TO_LATIN = {
        '，': ',', '、': ',', '。': '.', '；': ';', '：': ':', '？': '?', '！': '!', '（': '(', '）': ')',
        '【': '[', '】': ']', '｛': '{', '｝': '}', '‘': "'", '’': "'", '“': '"', '”': '"', '—': '-', '…': '...',
    };
    static PUNCT_TO_HAN = {
        ',': '，', '.': '。', ';': '；', ':': '：', '?': '？', '!': '！', '(': '（', ')': '）',
        '[': '【', ']': '】', '{': '｛', '}': '｝',
    };
    static PUNCT_ONLY = /^[，。、；：？！（）【】｛｝‘’“”—…,.;:?!()[\]{}'"]+$/;
    static PUNCT_TAIL = /[，。、；：？！…,.;:?!]+$/;

    /** « 好， » -> ["好", "，"]; « ， » -> ["", "，"]; « 好 » -> ["好", ""]. */
    static splitPunct(token) {
        const text = String(token || '');
        if (Sentence.PUNCT_ONLY.test(text)) return ['', text];
        const tail = text.match(Sentence.PUNCT_TAIL)?.[0] || '';
        return [tail ? text.slice(0, -tail.length) : text, tail];
    }

    /** The words of a text, space-separated -- except a «…» block, one
     *  word whatever spaces it holds (« ma'a tinito » too). An unclosed «
     *  runs to the end, while it is being typed. Same rule as
     *  text_to_words.split_words() on the server. */
    static WORDS_RE = /«[^»]*»?\S*|\S+/gu;

    static splitWords(text) {
        return String(text || '').match(Sentence.WORDS_RE) || [];
    }

    /** The text of a «…» block (Tahitian, French, a name: no character to
     *  find, written as is in the pinyin and the characters); null for any
     *  other word. Punctuation after the block (« «ma'a», ») is not in it. */
    static textBlock(token) {
        const m = Sentence.splitPunct(String(token || '').trim())[0].match(/^«([^»]*)»?$/);
        return m ? m[1].trim() : null;
    }

    /** The « Texte » button (Saisie, Transcrire): the selection put
     *  between « » (or « » inserted, the caret inside), spaced from its
     *  neighbours. Returns {text, caret}. */
    static wrapText(text, start, end) {
        const before = text.slice(0, start);
        const inner = text.slice(start, end).trim();
        const after = text.slice(end);
        const lead = before && !/\s$/.test(before) ? ' ' : '';
        const trail = after && !/^\s/.test(after) ? ' ' : '';
        const out = `${before}${lead}«${inner}»${trail}${after}`;
        const caret = before.length + lead.length + 1 + inner.length + (inner ? 1 : 0);
        return { text: out, caret };
    }

    static latinPunct(text) {
        return [...String(text || '')].map((c) => Sentence.PUNCT_TO_LATIN[c] ?? c).join('');
    }

    static hanPunct(text) {
        return [...String(text || '').replace(/\.\.\./g, '…')].map((c) => Sentence.PUNCT_TO_HAN[c] ?? c).join('');
    }

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
        if (!token) return { hanzi: '', constraints: null, inline: null, readings: [], raw: token };

        // «ma'a tinito»: written as is, no (reading) nor :sense in it.
        const block = Sentence.textBlock(token);
        if (block !== null) return { hanzi: block, constraints: null, inline: null, readings: [], raw: token, text: true };

        const parts = token.split(':');
        const base = parts[0];

        const constraints = parts[1]
            ? parts[1].split(',').map(c => c.trim().toLowerCase()).filter(Boolean)
            : null;

        const inlineMatch = base.match(/\(([^()]*)\)/);
        const inline = inlineMatch ? inlineMatch[1].trim() : null;

        const hanzi = base.replace(/\([^)]*\)/g, '').trim();

        return { hanzi, constraints, inline, readings: Sentence.pinnedReadings(base), raw: token };
    }

    /** Readings pinned with the (pinyin) syntax, one slot per character of
     *  the token's hanzi (null where nothing is pinned). An annotation
     *  covers the run of hanzi (or "-" placeholders) right before it:
     *    掃墳墓(sao4fun2mu4)  one syllable per character
     *    先生(sen1)           fewer syllables: they go to the LAST characters
     *    先(xien1)生(sen1)    one annotation per character
     *  Same rule as text_to_words.resolve_pinyin() on the server. */
    static pinnedReadings(base) {
        const chars = [];
        const readings = [];
        let pending = [];
        const isRun = (ch) => ch === '-' || /\p{Script=Han}/u.test(ch);
        const re = /\(([^()]*)\)|([\s\S])/gu;
        for (const m of String(base || '').matchAll(re)) {
            if (m[2] !== undefined) {
                chars.push(m[2]);
                readings.push(null);
                if (isRun(m[2])) pending.push(chars.length - 1);
                else pending = [];
                continue;
            }
            const syllables = m[1].match(/[a-zü][a-zü'’]*[0-8_]?/gi) || [];
            if (pending.length && syllables.length) {
                const targets = syllables.length < pending.length
                    ? pending.slice(pending.length - syllables.length)
                    : pending;
                targets.forEach((idx, k) => { readings[idx] = syllables[k]; });
            }
            pending = [];
        }
        return readings;
    }

    /** A word's syllables in stored notation (["sen1", "ngin2"]), from the
     *  per-syllable data-initials/finals/tones when present, else split out
     *  of its pinyin string after each tone digit. */
    static wordSyllables(d) {
        if (d.initials !== undefined && d.finals !== undefined) {
            const is = String(d.initials).split(' ');
            const fs = String(d.finals).split(' ');
            const ts = String(d.tones || '').split(' ');
            is.pop(); fs.pop(); ts.pop();
            if (is.length && is.length === fs.length) return is.map((i, k) => `${i}${fs[k]}${ts[k] || ''}`);
        }
        return String(d.pinyin || '').match(/[^\d\s]+\d?/g) || [];
    }

    /** Does word dataset `d` read the way the token pins it? A pinned
     *  reading without tone ("sen") accepts any tone. */
    static agreesWithReadings(d, readings) {
        if (!readings?.some(Boolean)) return true;
        const syllables = Sentence.wordSyllables(d);
        if (syllables.length !== readings.length) return false;
        return readings.every((r, k) => {
            if (!r) return true;
            // "_" (tone unknown) accepts any tone, like no tone at all.
            const pinned = r.toLowerCase().replace(/’/g, "'").replace(/_$/, '');
            const actual = syllables[k].toLowerCase();
            return pinned === actual || (!/\d$/.test(pinned) && actual.replace(/\d$/, '') === pinned);
        });
    }

    // -----------------------------
    // Dictionary matching
    // -----------------------------
    findMatches(hanzi, constraints, readings = null) {
        if (!hanzi) return [];

        let matches = this.dico.words.filter(w => {
            const d = w.dataset || w;
            const { simp, trad, french = '', pinyin = '' } = d;

            if (!simp) return false;
            if (simp !== hanzi && trad !== hanzi) return false;
            // A pinned reading (生(sen1)) rules out homophones read otherwise.
            if (!Sentence.agreesWithReadings(d, readings)) return false;

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
        const { hanzi, inline, readings, text } = this.parseToken(Sentence.splitPunct(token)[0]);
        const pinned = readings.some(Boolean);

        // «ma'a»: read as written.
        if (text) return hanzi;

        // An annotation that isn't attached to any hanzi run is kept whole.
        if (inline && !pinned) return inline;
        if (!hanzi || (hanzi === '-' && !pinned)) return '';

        return Array.from(hanzi).map((char, k) => {
            if (readings[k]) return readings[k];
            if (char === '-') return '';
            const matches = this.dico.getMatchesForHanzi(char);
            if (!matches.length) return '?';

            // Stored (Wenfa) readings, whatever the source: the display
            // conversion applies to them like to lexicon words.
            const prons = matches
                .map(p => (p.storedPinyin ? p.storedPinyin() : p.abstractPinyin?.()))
                .filter(Boolean);

            return prons.length ? [...new Set(prons)].join('/') : '?';
        }).join('');
    }

    buildUnknownEntry(token) {
        const { hanzi, raw, text } = this.parseToken(Sentence.splitPunct(token)[0] || token);
        if (text) {
            // «ma'a tinito»: no entry to find, the same text in every line.
            return { dataset: { simp: hanzi, pinyin: hanzi, french: '', raw: raw || '', text: true }, isUnknown: true, isText: true };
        }
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
        // A «…» block is one word, its spaces included.
        this.words = Sentence.splitWords(text);

        this.matches = this.words.map(token => {
            if (Sentence.textBlock(token) !== null) return [this.buildUnknownEntry(token)];
            // The word is looked up without its punctuation (« 好， » is 好).
            const { hanzi, constraints, readings } = this.parseToken(Sentence.splitPunct(token)[0]);

            const matches = this.findMatches(hanzi, constraints, readings);

            return matches.length ? matches : [this.buildUnknownEntry(token)];
        });
    }

    // -----------------------------
    // Helpers
    // -----------------------------
    superscriptTone(pinyin) {
        // "_": tone unknown (ngai_), shown as a raised question mark.
        const map = { "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "_": "ˀ" };
        return String(pinyin || '').replace(/[1-8_]/g, d => map[d]);
    }

    renderPinyin(pinyin) {
        return this.superscriptTone(pinyin);
    }

    // Display-only pinyin in the transcription system picked in the header
    // (Romanization.js / romanization.json). renderPinyin() above stays in
    // the stored notation: expressions.js compares it against platform data
    // and the transcripter exports it, so it must not depend on the menu.
    // Without Romanization loaded (pages not extending base.html, unit
    // tests) this is the stored notation with superscript tones.
    displayPinyin(dataOrPinyin) {
        const R = typeof Romanization !== 'undefined' ? Romanization : null;
        const isData = dataOrPinyin && typeof dataOrPinyin === 'object';
        // «ma'a»: no syllable to convert.
        if (isData && dataOrPinyin.text) return String(dataOrPinyin.pinyin || '');
        // A dictionary fed from another notation (Dictionary.useSource())
        // can't be converted: Romanization only parses Wenfa syllables.
        if (!R || !R.systems().length) {
            return this.renderPinyin(isData ? dataOrPinyin.pinyin : dataOrPinyin);
        }
        return isData ? R.fromDataset(dataOrPinyin) : R.fromPinyin(dataOrPinyin);
    }

    // displayPinyin() as self-updating HTML (Pronunciation.span()): badges,
    // popups and furigana then follow the header menu without the page
    // re-rendering (expressions.js builds its rows once). Not for text
    // that gets copied -- renderDisplayPinyinLine() stays plain.
    displayPinyinHtml(dataOrPinyin) {
        const text = this.displayPinyin(dataOrPinyin);
        const stored = dataOrPinyin && typeof dataOrPinyin === 'object' ? dataOrPinyin.pinyin : dataOrPinyin;
        const isText = !!(dataOrPinyin && typeof dataOrPinyin === 'object' && dataOrPinyin.text);
        const live = !isText && typeof Romanization !== 'undefined' && Romanization.systems().length && stored;
        if (isText) return escapeAttr(text);
        return live ? `<span data-py="${escapeAttr(stored)}">${text}</span>` : text;
    }

renderFurigana() {
    return `
            ${this.matches.map((group, i) => {
                const best = group?.[0];
                const data = best?.dataset || best || {};
                const tokenObj = this.parseToken(this.words?.[i] || '');

                const [punctCore, punctTail] = Sentence.splitPunct(this.words?.[i] || '');
                const hanzi = punctCore ? (pickHanzi(data) || tokenObj.hanzi || tokenObj.raw || '?') + Sentence.hanPunct(punctTail) : Sentence.hanPunct(punctTail);

                let pinyin = !punctCore ? Sentence.latinPunct(punctTail) : data.pinyin ? this.displayPinyinHtml(data) : '';
                if (!pinyin) {
                    const resolved = this.resolveUnknownPinyin(this.words?.[i] || '');
                    pinyin = resolved ? this.displayPinyinHtml(resolved) : '?';
                }

                return `
                    <span class="inline-flex flex-col items-center text-center align-top gap-[1px] mr-1">

                        <span class="text-[10px] italic leading-none text-[var(--sentence-text-muted)]">
                            ${pinyin}
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

            const [core, tail] = Sentence.splitPunct(this.words[i]);
            if (!core) return Sentence.latinPunct(tail);
            let line;
            if (data?.text) line = data.pinyin;
            else if (data?.pinyin) line = this.renderPinyin(data.pinyin);
            else {
                const resolved = this.resolveUnknownPinyin(this.words[i]);
                line = resolved ? this.renderPinyin(resolved) : '?';
            }
            return tail ? `${line} ${Sentence.latinPunct(tail)}` : line;
        }).join(' ');
    }

    // Same as renderPinyinLine(), in the selected transcription system --
    // for what's shown to the reader, never for comparisons/exports.
    renderDisplayPinyinLine() {
        return this.matches.map((group, i) => {
            const best = group?.[0];
            const data = best?.dataset || best;

            const [core, tail] = Sentence.splitPunct(this.words[i]);
            if (!core) return Sentence.latinPunct(tail);
            let line;
            if (data?.pinyin) line = this.displayPinyin(data);
            else {
                const resolved = this.resolveUnknownPinyin(this.words[i]);
                line = resolved ? this.displayPinyin(resolved) : '?';
            }
            return tail ? `${line} ${Sentence.latinPunct(tail)}` : line;
        }).join(' ');
    }

    // forceSimp bypasses the sitewide Trad./Simp. toggle -- for callers that
    // compare this text against a platform/DB value that's always
    // simplified (e.g. the expressions comparison view), where honoring the
    // toggle would make an otherwise-correct match look like a mismatch.
    // Characters follow each other; a «…» block stands apart, without its
    // guillemets: 我爱食 ma'a tinito.
    renderHanziLine(forceSimp = false) {
        let line = '';
        let lastText = false;
        this.matches.forEach((group, i) => {
            const best = group?.[0];
            const data = best?.dataset || best;

            const [core, tail] = Sentence.splitPunct(this.words[i]);
            let piece;
            if (!core) piece = '';
            else if (data?.simp) piece = forceSimp ? data.simp : pickHanzi(data);
            else {
                const t = this.parseToken(core);
                piece = t.hanzi || t.raw || '?';
            }
            const isText = !!data?.text && !!core;
            if (piece && line && (isText || lastText)) line += ' ';
            line += piece + Sentence.hanPunct(tail);
            // Punctuation closes the text: 我 ma'a，食.
            lastText = piece ? isText && !tail : (tail ? false : lastText);
        });
        return line;
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
    // Main render: the lines, ready to copy. The words themselves are
    // shown by WordBoxes.js (one box per character, coloured by word).
    // -----------------------------
    render() {
        const pinyinLine = this.renderDisplayPinyinLine();
        const hanziLine = this.renderHanziLine();

        return `
        <div class="flex flex-col gap-2">
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