/* =========================================================================
   tumu-kin — le module commun de grammaire (hakka-tahiti, tumuparau).

   Une analyse (voir FORMAT.md) : tokens [{t, p, c, f, g}] et groups
   [{s, e, c, f}], un groupe couvrant les mots s à e-1 ; les groupes sont
   emboîtés, jamais à cheval. c et f désignent des étiquettes : par leur
   numéro (hakka, en mémoire) ou par leur code (fichier d'échange) ; un TagSet
   sait retrouver les deux.

   Sans dépendance ni compilation. Se charge :
   - par une balise <script> : window.TumuKin ;
   - par require / import (Vite, Node) : module.exports.

   Origine : GrammarAnalysis.js (structure, drawTree, bracketed, linear,
   TagSet) et grammar_analysis.py (check, parse_pattern, match) de
   hakka-tahiti.
   ========================================================================= */
(function (global) {
    'use strict';

    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const HAN = /[㐀-鿿豈-﫿\u{20000}-\u{2FFFF}]/u;
    const HAN_ALL = /[㐀-鿿豈-﫿\u{20000}-\u{2FFFF}]/gu;
    const SUPERSCRIPTS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
    const KINDS = { CATEGORY: 'category', PHRASE: 'phrase', FUNCTION: 'function' };

    /** Minuscules, sans accents : « Maison », « maisón » -> « maison » (search_sources.fold). */
    function fold(text) {
        const t = String(text ?? '').replace(/[⁰-⁹]/g, (c) => SUPERSCRIPTS[c] ?? c).normalize('NFD').replace(/[̀-ͯ]/g, '');
        return t.replace(/ŋ/g, 'ng').replace(/ε/g, 'e').replace(/ɔ/g, 'o').replace(/’/g, "'").toLowerCase();
    }

    /** Une lecture comme clé : sans tons, espaces ni apostrophes (« zen¹ lao¹ » -> « zenlao »). */
    const readingKey = (text) => fold(text).replace(/[\s\d'\-·.,]/g, '');

    /** Un mot cité, comparable : minuscules, apostrophes droites ; les accents
     *  et les macrons comptent (tâne ≠ tane). */
    const wordKey = (text) => String(text ?? '').normalize('NFC').replace(/[’‘ʻ]/g, "'").toLowerCase().replace(/\s+/g, '');

    const hanOnly = (text) => (String(text ?? '').match(HAN_ALL) || []).join('');

    // ---- Les étiquettes ---------------------------------------------------------------------------
    /** L'inventaire des étiquettes : [{id?, kind, code, name, parent, …}].
     *  `parent` : le numéro (hakka) ou le code (fichier d'échange) de l'étiquette
     *  plus générale. Une étiquette se retrouve par son numéro ou par son code. */
    class TagSet {
        constructor(list = []) { this.set(list); }

        set(list) {
            this.list = list;
            this.byId = new Map(list.map((t) => [t.id ?? t.code, t]));
            this._byCode = new Map();
            list.forEach((t) => { if (!this._byCode.has(t.code)) this._byCode.set(t.code, t); });
        }

        /** L'étiquette désignée par `ref` (numéro ou code), sinon undefined. */
        get(ref) {
            if (ref === null || ref === undefined || ref === '') return undefined;
            return this.byId.get(ref) ?? this._byCode.get(ref);
        }

        key(tag) { return tag.id ?? tag.code; }
        code(ref) { return this.get(ref)?.code || ''; }
        kind(ref) { return this.get(ref)?.kind || null; }

        /** « GN:sujet » : la catégorie (ou le groupe) et la fonction d'un mot ou d'un groupe. */
        label(item) {
            return [this.code(item.c), this.code(item.f)].filter(Boolean).join(':');
        }

        /** Les étiquettes d'un type, rangées sous leur étiquette générale : V, puis V de mouvement… */
        of(kind) {
            const mine = this.list.filter((t) => t.kind === kind);
            const parentKey = (t) => { const p = this.get(t.parent); return p ? this.key(p) : null; };
            const out = [];
            const walk = (parent, depth) => mine.filter((t) => parentKey(t) === parent)
                .forEach((t) => { out.push({ tag: t, depth }); walk(this.key(t), depth + 1); });
            walk(null, 0);
            mine.filter((t) => !out.some((o) => o.tag === t)).forEach((t) => out.push({ tag: t, depth: 0 }));
            return out;
        }

        /** L'étiquette et toutes celles qui la précisent (leurs clés). */
        below(ref) {
            const tag = this.get(ref);
            if (!tag) return new Set();
            const out = new Set([this.key(tag)]);
            const todo = [tag];
            while (todo.length) {
                const parent = todo.pop();
                this.list.forEach((t) => {
                    const p = this.get(t.parent);
                    if (p === parent && !out.has(this.key(t))) { out.add(this.key(t)); todo.push(t); }
                });
            }
            return out;
        }

        /** Vrai si `ref` désigne `wanted` ou une étiquette qui la précise. */
        isA(ref, wanted) {
            const tag = this.get(ref);
            return !!tag && this.below(wanted).has(this.key(tag));
        }

        /** L'étiquette nommée par `text` (son code, sinon son nom), sans tenir
         *  compte de la casse ni des accents ; le code d'abord. */
        find(text, kinds = null) {
            const wanted = fold(text).trim();
            if (!wanted) return undefined;
            const pool = this.list.filter((t) => !kinds || kinds.includes(t.kind));
            for (const attr of ['code', 'name']) {
                const found = pool.find((t) => fold(t[attr]).trim() === wanted);
                if (found) return found;
            }
            return undefined;
        }
    }

    // ---- La validité d'une analyse ----------------------------------------------------------------
    /** null si l'analyse est valide, sinon l'erreur (grammar_analysis.check) : au
     *  moins un mot, des groupes dans la phrase, distincts, emboîtés, jamais à cheval. */
    function check(tokens, groups) {
        if (!Array.isArray(tokens) || !tokens.length) return "L'analyse n'a aucun mot.";
        if (!Array.isArray(groups)) return 'Groupes invalides.';
        if (tokens.some((t) => !t || !String(t.t ?? '').trim())) return 'Un mot est vide.';
        const n = tokens.length;
        const spans = [];
        for (const g of groups) {
            const { s, e } = g || {};
            if (!Number.isInteger(s) || !Number.isInteger(e) || !(0 <= s && s < e && e <= n)) return 'Un groupe sort de la phrase.';
            if (spans.some(([s2, e2]) => s2 === s && e2 === e)) return 'Deux groupes portent sur les mêmes mots.';
            if (spans.some(([s2, e2]) => (s < s2 && s2 < e && e < e2) || (s2 < s && s < e2 && e2 < e))) {
                return "Deux groupes se chevauchent : un groupe doit être dans l'autre, ou à côté.";
            }
            spans.push([s, e]);
        }
        return null;
    }

    // ---- L'arbre ----------------------------------------------------------------------------------
    /** Les groupes emboîtés : pour chacun, son parent, ses enfants (mots et
     *  groupes, dans l'ordre) et sa hauteur (1 au-dessus des mots). */
    function structure(tokens, groups) {
        const gs = groups.map((g, index) => ({ ...g, index })).sort((a, b) => a.s - b.s || b.e - a.e);
        const stack = [];
        gs.forEach((g) => {
            while (stack.length && !(stack[stack.length - 1].s <= g.s && g.e <= stack[stack.length - 1].e)) stack.pop();
            g.parent = stack.length ? stack[stack.length - 1] : null;
            stack.push(g);
        });
        const tokenParent = tokens.map((_t, i) => {
            let best = null;
            gs.forEach((g) => { if (g.s <= i && i < g.e && (!best || g.e - g.s <= best.e - best.s)) best = g; });
            return best;
        });
        gs.forEach((g) => {
            g.children = [
                ...tokens.map((_t, i) => i).filter((i) => tokenParent[i] === g).map((i) => ({ token: i, s: i })),
                ...gs.filter((c) => c.parent === g).map((c) => ({ group: c, s: c.s })),
            ].sort((a, b) => a.s - b.s);
        });
        const height = (g) => {
            if (g.height === undefined) g.height = 1 + Math.max(0, ...g.children.filter((c) => c.group).map((c) => height(c.group)));
            return g.height;
        };
        gs.forEach(height);
        return { gs, tokenParent, top: Math.max(0, ...gs.map((g) => g.height)) };
    }

    const textWidth = (text, size) => [...String(text || '')].reduce((w, c) => w + (HAN.test(c) ? size : size * 0.58), 0);

    /** L'arbre en SVG : les groupes en haut, les mots en bas (catégorie, mot,
     *  lecture, fonction, glose). data-group / data-token : touchables.
     *  Options : selectedGroup (indice), selection ([premier, dernier] mot),
     *  mark ([début, fin[), lang (des mots : "zh", "ty"…), word (le texte
     *  affiché d'un mot, par défaut t.t). Les classes ga-* sont celles de
     *  hakka-tahiti (voir arbre.css). */
    function drawTree(tokens, groups, tags, { selectedGroup = null, selection = null, mark = null, lang = '', word = (t) => t.t } = {}) {
        if (!tokens.length) return '';
        const { gs, top } = structure(tokens, groups);
        const ROW = 44, PAD = 10;
        const widths = tokens.map((t) => Math.max(textWidth(word(t), 22), textWidth(t.p, 12), textWidth(tags.code(t.c), 12),
            textWidth(tags.code(t.f), 11), Math.min(textWidth(t.g, 11), 120), 28) + 18);
        const xs = [];
        let x = PAD;
        widths.forEach((w) => { xs.push(x + w / 2); x += w; });
        const width = x + PAD;
        const base = top * ROW + 14;
        const pos = new Map();
        const place = (g) => {
            if (pos.has(g)) return pos.get(g);
            const ends = g.children.map((c) => (c.group ? place(c.group).x : xs[c.token]));
            const p = { x: (Math.min(...ends) + Math.max(...ends)) / 2, y: (top - g.height) * ROW + 18 };
            pos.set(g, p);
            return p;
        };
        gs.forEach(place);
        const inSel = (i) => selection && selection[0] <= i && i <= selection[1];
        const inMark = (i) => mark && mark[0] <= i && i < mark[1];
        const langAttr = lang ? ` lang="${esc(lang)}"` : '';
        let svg = '';
        gs.forEach((g) => {
            const p = pos.get(g);
            g.children.forEach((c) => {
                const to = c.group ? { x: pos.get(c.group).x, y: pos.get(c.group).y - 13 } : { x: xs[c.token], y: base };
                svg += `<line x1="${p.x}" y1="${p.y + 5}" x2="${to.x}" y2="${to.y}" class="ga-edge"/>`;
            });
        });
        gs.forEach((g) => {
            const p = pos.get(g);
            const label = tags.label(g) || '·';
            const w = textWidth(label, 13) + 14;
            svg += `<g class="ga-node${g.index === selectedGroup ? ' is-sel' : ''}" data-group="${g.index}" tabindex="0" role="button" aria-label="Groupe ${esc(label)}">
                <rect x="${p.x - w / 2}" y="${p.y - 13}" width="${w}" height="19" rx="5"/>
                <text x="${p.x}" y="${p.y + 1}" text-anchor="middle">${esc(label)}</text></g>`;
        });
        tokens.forEach((t, i) => {
            const cx = xs[i];
            const cls = ['ga-leaf', inSel(i) ? 'is-sel' : '', inMark(i) ? 'is-mark' : ''].filter(Boolean).join(' ');
            svg += `<g class="${cls}" data-token="${i}" role="button" tabindex="0" aria-label="${esc(word(t))}">
                <rect x="${cx - widths[i] / 2 + 3}" y="${base}" width="${widths[i] - 6}" height="86" rx="6"/>
                <text x="${cx}" y="${base + 14}" text-anchor="middle" class="ga-cat">${esc(tags.code(t.c))}</text>
                <text x="${cx}" y="${base + 40}" text-anchor="middle" class="ga-han"${langAttr}>${esc(word(t))}</text>
                <text x="${cx}" y="${base + 55}" text-anchor="middle" class="ga-pin">${esc(t.p)}</text>
                <text x="${cx}" y="${base + 69}" text-anchor="middle" class="ga-fn">${esc(tags.code(t.f))}</text>
                <text x="${cx}" y="${base + 82}" text-anchor="middle" class="ga-gloss">${esc((t.g || '').slice(0, 24))}</text></g>`;
        });
        return `<svg class="ga-svg" width="${width}" height="${base + 92}" viewBox="0 0 ${width} ${base + 92}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
    }

    /** L'arbre en une ligne : [P [GN:sujet 我/PRO] [GV 唔/NÉG 食/V]]. */
    function bracketed(tokens, groups, tags) {
        const order = groups.slice().sort((a, b) => a.s - b.s || b.e - a.e);
        const out = [];
        const open = [];
        let gi = 0;
        tokens.forEach((t, i) => {
            while (open.length && open[open.length - 1] <= i) { open.pop(); out.push(']'); }
            while (gi < order.length && order[gi].s === i) { out.push(`[${tags.label(order[gi]) || '·'}`); open.push(order[gi].e); gi++; }
            out.push(t.t + (tags.label(t) ? `/${tags.label(t)}` : ''));
        });
        open.forEach(() => out.push(']'));
        return out.join(' ').replace(/ \]/g, ']');
    }

    /** L'analyse en ligne : 我ᴾᴿᴼ 唔ᴺᴱᴳ 食ⱽ, la partie `mark` ([début, fin[) soulignée. */
    function linear(tokens, tags, mark = null, { lang = '' } = {}) {
        const langAttr = lang ? ` lang="${esc(lang)}"` : '';
        return tokens.map((t, i) => {
            const label = tags.label(t);
            const on = mark && mark[0] <= i && i < mark[1];
            return `<span class="ga-lin${on ? ' is-mark' : ''}"><span${langAttr}>${esc(t.t)}</span>${label ? `<sub>${esc(label)}</sub>` : ''}</span>`;
        }).join(' ');
    }

    // ---- Le schéma d'une règle ---------------------------------------------------------------------
    const READING = /^(?:[a-zA-ZÀ-ɏŋεɔ'’]+[0-9¹²³⁴⁵⁶⁷⁸]?\s*)+$/u;
    const QUOTED = /^["«“]\s*(.+?)\s*["»”]$/u;

    function element(text, optional, tags, readings) {
        const base = { text, optional };
        if (['…', '...', '*'].includes(text)) return { ...base, kind: 'any' };
        const quoted = text.match(QUOTED);
        if (quoted) return { ...base, kind: 'quoted', value: wordKey(quoted[1]) };
        if (HAN.test(text)) return { ...base, kind: 'word', value: hanOnly(text) };
        const alternatives = [];
        let known = true;
        for (const raw of text.split(/[|/]/)) {
            const alt = raw.trim();
            if (!alt) continue;
            const colon = alt.indexOf(':');
            const found = colon >= 0
                ? [tags.find(alt.slice(0, colon), [KINDS.CATEGORY, KINDS.PHRASE]), tags.find(alt.slice(colon + 1), [KINDS.FUNCTION])]
                : [tags.find(alt)];
            if (found.some((t) => !t)) { known = false; break; }
            alternatives.push(found.map((t) => tags.key(t)));
        }
        if (known && alternatives.length) {
            return { ...base, kind: 'tag', tags: alternatives, codes: alternatives.map((alt) => alt.map((k) => tags.code(k)).join(':')) };
        }
        if (readings && READING.test(text)) return { ...base, kind: 'reading', value: fold(text).replace(/\s/g, '') };
        return { ...base, kind: 'unknown' };
    }

    /** « GN:sujet + NÉG + V (+ GN:objet) » -> les éléments, dans l'ordre :
     *  [{text, kind: tag|quoted|word|reading|any|unknown, optional, …}].
     *  « … » : n'importe quels mots ; « V|ADJ » : l'un ou l'autre ; ( ) :
     *  facultatif ; "'ua" : ce mot-là (toutes langues) ; un caractère chinois
     *  ou une lecture (hakka) : ce mot-là. Option readings (vrai par défaut) :
     *  un mot latin sans guillemets qui n'est pas une étiquette est une
     *  lecture hakka ; à mettre à faux pour le tahitien. */
    function parsePattern(pattern, tags, { readings = true } = {}) {
        const parts = [];
        let depth = 0;
        const pieces = String(pattern || '').match(/"[^"]*"|«[^»]*»|“[^”]*”|\(|\)|\+|[^()+"«“]+/gu) || [];
        pieces.forEach((piece) => {
            if (piece === '(') depth += 1;
            else if (piece === ')') depth = Math.max(0, depth - 1);
            else if (piece !== '+' && piece.trim()) parts.push(element(piece.trim(), depth > 0, tags, readings));
        });
        return parts;
    }

    function fits(el, unit, tags) {
        if (el.kind !== 'tag') return false;
        const { what, item } = unit;
        return el.tags.some((alternative) => alternative.every((ref) => {
            const kind = tags.kind(ref);
            if (kind === KINDS.CATEGORY) return what === 'token' && tags.isA(item.c, ref);
            if (kind === KINDS.PHRASE) return what === 'group' && tags.isA(item.c, ref);
            return tags.isA(item.f, ref);
        }));
    }

    /** Les fins possibles d'un mot cité, d'un caractère ou d'une lecture à partir du mot `start`. */
    function wordEnds(el, tokens, start) {
        const toned = /\d/.test(el.value);
        const reading = (text) => (toned ? fold(text).replace(/\s/g, '') : readingKey(text));
        const target = el.kind === 'reading' ? reading(el.value) : el.value;
        const piece = (t) => (el.kind === 'word' ? hanOnly(t.t) : el.kind === 'quoted' ? wordKey(t.t) : reading(t.p));
        const ends = [];
        let text = '';
        for (let j = start; j < tokens.length; j++) {
            text += piece(tokens[j]);
            if (text === target) ends.push(j + 1);
            if (!text || !target.startsWith(text)) break;
        }
        return ends;
    }

    /** [début, fin[ des mots qui suivent le schéma, sinon null. Le schéma peut
     *  commencer n'importe où dans la phrase ; le premier début qui convient,
     *  avec la fin la plus lointaine. */
    function match(parts, tokens, groups, tags) {
        if (!parts.length || !tokens.length) return null;
        const n = tokens.length;
        const units = Array.from({ length: n }, () => []);
        tokens.forEach((t, i) => units[i].push({ what: 'token', s: i, e: i + 1, item: t }));
        groups.forEach((g) => { if (g.s >= 0 && g.s < n) units[g.s].push({ what: 'group', s: g.s, e: g.e, item: g }); });
        const memo = new Map();
        const ends = (k, i) => {
            const key = `${k},${i}`;
            if (!memo.has(key)) memo.set(key, [...new Set(rawEnds(k, i))].sort((a, b) => a - b));
            return memo.get(key);
        };
        const rawEnds = (k, i) => {
            if (k === parts.length) return [i];
            const el = parts[k];
            const out = [];
            if (el.optional || el.kind === 'any') out.push(...ends(k + 1, i));
            if (el.kind === 'any') {
                for (let j = i + 1; j <= n; j++) out.push(...ends(k + 1, j));
            } else if (['word', 'reading', 'quoted'].includes(el.kind)) {
                wordEnds(el, tokens, i).forEach((j) => out.push(...ends(k + 1, j)));
            } else if (i < n) {
                units[i].forEach((unit) => { if (fits(el, unit, tags)) out.push(...ends(k + 1, unit.e)); });
            }
            return out;
        };
        for (let start = 0; start < n; start++) {
            const found = ends(0, start).filter((e) => e > start);
            if (found.length) return [start, Math.max(...found)];
        }
        return null;
    }

    /** Pour un exemple : {ok, span} — ou null quand on ne peut pas juger (pas de
     *  schéma, un élément inconnu, pas d'analyse). */
    function conformity(parts, analysis, tags) {
        if (!parts || !parts.length || !analysis || parts.some((p) => p.kind === 'unknown')) return null;
        const found = match(parts, analysis.tokens || [], analysis.groups || [], tags);
        return { ok: found !== null, span: found };
    }

    // ---- Depuis un arbre PEG (tumuparau) ------------------------------------------------------------
    /** Un arbre produit par le greffon « actions syntaxiques » (nœuds
     *  {rule, text, start, end, children}) -> une analyse {tokens, groups}.
     *  `map(rule)` dit ce qu'est une règle : null (rien : on la traverse), ou
     *  {category} (une règle de mot : tout son texte devient un mot de cette
     *  catégorie), ou {phrase?, function?} (un groupe). Les textes trouvés hors
     *  d'une règle de mot (particules écrites dans la grammaire) deviennent
     *  des mots sans catégorie, un par mot séparé d'espaces. Deux groupes sur
     *  les mêmes mots (Sujet > GN) n'en font qu'un : le plus intérieur garde
     *  son étiquette, l'extérieur complète ce qui manque (GN:sujet).
     *  Options : skip(text) : vrai pour un texte à ignorer (parenthèses
     *  d'aide) ; wordText(node, category) : le texte d'un mot (par défaut le
     *  texte du nœud sans espaces autour). */
    function fromPeg(root, map, { skip = (t) => /^[()\s]*$/.test(t), wordText = (node) => node.text.trim() } = {}) {
        const tokens = [];
        const groups = [];
        const push = (t, c) => { if (t && !skip(t)) tokens.push({ t, p: '', c: c ?? null, f: null, g: '' }); };
        const visit = (node) => {
            if (node === null || node === undefined) return;
            if (typeof node === 'string') { node.split(/\s+/).forEach((w) => push(w, null)); return; }
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (typeof node !== 'object' || !('rule' in node)) return;
            const role = map(node.rule) || null;
            if (role && role.category !== undefined) { push(wordText(node, role.category), role.category); return; }
            const s = tokens.length;
            visit(node.children);
            const e = tokens.length;
            if (!role || e <= s || (role.phrase === undefined && role.function === undefined)) return;
            const same = groups.find((g) => g.s === s && g.e === e);
            if (same) {
                if (same.c === null && role.phrase !== undefined) same.c = role.phrase;
                if (same.f === null && role.function !== undefined) same.f = role.function;
            } else {
                groups.push({ s, e, c: role.phrase ?? null, f: role.function ?? null });
            }
        };
        visit(root);
        groups.sort((a, b) => a.s - b.s || b.e - a.e);
        return { tokens, groups };
    }

    const api = {
        KINDS, TagSet, check, structure, drawTree, bracketed, linear,
        parsePattern, match, conformity, fromPeg, fold, readingKey, wordKey, esc,
    };
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (global) global.TumuKin = api;
})(typeof window !== 'undefined' ? window : globalThis);
