/* =========================================================================
   GrammarAnalysis — la page « Grammaire » : l'analyse d'une phrase
   d'exemple (linéaire : mots, catégories, fonctions, gloses ; en arbre :
   les groupes emboîtés), son dessin, et le panneau des étiquettes
   (catégories de mots, groupes, fonctions), définies au fur et à mesure.
   Côté serveur : grammar_analysis.py.

   Une analyse : tokens [{t, p, c, f, g}] et groups [{s, e, c, f}], un groupe
   couvrant les mots s à e-1. Les groupes sont emboîtés, jamais à cheval.
   ========================================================================= */
(function (global) {
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const KIND_LABELS = { category: 'Catégories de mots', phrase: 'Groupes', function: 'Fonctions' };
    const KIND_ONE = { category: 'catégorie', phrase: 'groupe', function: 'fonction' };
    const SYLLABLE = /[a-zA-ZÀ-ɏŋεɔ'’]+[0-9¹²³⁴⁵⁶⁷⁸]?/g;

    // ---- Les étiquettes ---------------------------------------------------------------------------
    class TagSet {
        constructor(list = []) { this.set(list); }
        set(list) {
            this.list = list;
            this.byId = new Map(list.map((t) => [t.id, t]));
        }
        code(id) { return this.byId.get(id)?.code || ''; }
        of(kind) {
            // Rangées sous leur étiquette générale : V, puis V de mouvement…
            const mine = this.list.filter((t) => t.kind === kind);
            const out = [];
            const walk = (parent, depth) => mine.filter((t) => (t.parent || null) === parent)
                .forEach((t) => { out.push({ tag: t, depth }); walk(t.id, depth + 1); });
            walk(null, 0);
            mine.filter((t) => !out.some((o) => o.tag === t)).forEach((t) => out.push({ tag: t, depth: 0 }));
            return out;
        }
        options(kind, value, empty = '—') {
            return `<option value="">${empty}</option>` + this.of(kind).map(({ tag, depth }) =>
                `<option value="${tag.id}"${tag.id === value ? ' selected' : ''}>${'  '.repeat(depth)}${esc(tag.code)}${tag.name && tag.name !== tag.code ? ` — ${esc(tag.name)}` : ''}${tag.status === 'proposed' ? ' (IA)' : ''}</option>`).join('')
                + `<option value="new">＋ nouvelle ${KIND_ONE[kind]}…</option>`;
        }
        label(item) {
            return [this.code(item.c), this.code(item.f)].filter(Boolean).join(':');
        }
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

    const textWidth = (text, size) => [...String(text || '')].reduce((w, c) => w + (/[㐀-鿿豈-﫿]/.test(c) ? size : size * 0.58), 0);

    /** L'arbre en SVG : les groupes en haut, les mots en bas (catégorie, mot,
     *  lecture, fonction, glose). data-group / data-token : touchables. */
    function drawTree(tokens, groups, tags, { selectedGroup = null, selection = null, mark = null } = {}) {
        if (!tokens.length) return '';
        const { gs, top } = structure(tokens, groups);
        const ROW = 44, PAD = 10;
        const widths = tokens.map((t) => Math.max(textWidth(t.t, 22), textWidth(t.p, 12), textWidth(tags.code(t.c), 12),
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
        let svg = '';
        gs.forEach((g) => {
            const p = pos.get(g);
            g.children.forEach((c) => {
                const to = c.group ? { x: pos.get(c.group).x, y: pos.get(c.group).y - 13 } : { x: xs[c.token], y: base };
                svg += `<line x1="${p.x}" y1="${p.y + 5}" x2="${to.x}" y2="${to.y}" class="ga-edge"/>`;
            });
        });
        // Mots seuls (aucun groupe) : un trait discret vers le haut n'a pas de sens ; rien.
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
            svg += `<g class="${cls}" data-token="${i}" role="button" tabindex="0" aria-label="${esc(t.t)}">
                <rect x="${cx - widths[i] / 2 + 3}" y="${base}" width="${widths[i] - 6}" height="86" rx="6"/>
                <text x="${cx}" y="${base + 14}" text-anchor="middle" class="ga-cat">${esc(tags.code(t.c))}</text>
                <text x="${cx}" y="${base + 40}" text-anchor="middle" class="ga-han" lang="zh">${esc(t.t)}</text>
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

    /** L'analyse en ligne, pour la liste des exemples : 我ᴾᴿᴼ 唔ᴺᴱᴳ 食ⱽ, la partie qui suit le schéma soulignée. */
    function linear(tokens, tags, mark = null) {
        return tokens.map((t, i) => {
            const label = tags.label(t);
            const on = mark && mark[0] <= i && i < mark[1];
            return `<span class="ga-lin${on ? ' is-mark' : ''}"><span lang="zh">${esc(t.t)}</span>${label ? `<sub>${esc(label)}</sub>` : ''}</span>`;
        }).join(' ');
    }

    function splitReading(pinyin, n) {
        const syl = String(pinyin || '').match(SYLLABLE) || [];
        return syl.length === n ? syl : [pinyin || '', ...Array(n - 1).fill('')];
    }

    // ---- L'éditeur d'une analyse ------------------------------------------------------------------
    class AnalysisEditor {
        /** `api`: {get, save, ai, tag}; `call(url, body)` (la page) ; `tags`: TagSet ;
         *  `onTags(list)`, `onSaved()`, `onClose()`. */
        constructor(container, { api, call, tags, target, onTags, onSaved, onClose }) {
            Object.assign(this, { container, api, call, tags, target, onTags, onSaved, onClose });
            this.tokens = [];
            this.groups = [];
            this.selection = null;     // [premier, dernier] mot sélectionné
            this.selectedGroup = null; // index dans this.groups
            this.dirty = false;
            this.source = 'manual';
            this.pendingField = null;  // où mettre l'étiquette qu'on crée : {where, i, field}
            this.newGroup = { c: null, f: null };  // les étiquettes choisies pour le prochain groupe
            this.message = '';
            this.container.addEventListener('click', (e) => this.onClick(e));
            this.container.addEventListener('change', (e) => this.onChange(e));
            this.container.addEventListener('input', (e) => this.onInput(e));
            this.container.addEventListener('keydown', (e) => {
                const node = e.target.closest?.('[data-group],[data-token]');
                if (node && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.pick(node); }
            });
            this.load();
        }

        async load() {
            this.container.innerHTML = '<p class="gr-meta">Chargement de l\'analyse…</p>';
            try {
                const data = await this.call(`${this.api.get}?type=${encodeURIComponent(this.target.target_type)}&key=${encodeURIComponent(this.target.target_key)}`);
                this.sentence = data.sentence;
                this.saved = data.analysis;
                this.draft = data.draft || [];
                this.aiEnabled = data.ai;
                this.rules = data.rules || [];
                const from = this.saved || { tokens: this.draft, groups: [] };
                this.tokens = from.tokens.map((t) => ({ ...t }));
                this.groups = from.groups.map((g) => ({ ...g }));
                this.note = this.saved?.note || '';
                this.source = this.saved?.source || 'manual';
                this.message = this.saved ? '' : (this.draft.some((t) => t.guessed)
                    ? 'Premier découpage ; les catégories en italique sont devinées d\'après vos analyses.'
                    : 'Premier découpage, d\'après le lexique : corrigez-le si besoin.');
                this.render();
            } catch (err) {
                this.container.innerHTML = `<p class="gr-status is-error">${esc(err.message)}</p>`;
            }
        }

        touch() { this.dirty = true; this.message = 'Modifiée, pas encore enregistrée.'; }

        render() {
            const s = this.sentence || {};
            const sel = this.selection;
            const g = this.selectedGroup !== null ? this.groups[this.selectedGroup] : null;
            let bar = '<span class="gr-meta">Touchez un mot puis un autre pour sélectionner les mots entre eux ; touchez un groupe de l\'arbre pour le modifier.</span>';
            if (g) {
                bar = `<b>Groupe ${esc(this.tokens.slice(g.s, g.e).map((t) => t.t).join(' '))}</b>
                    <select data-gf="c" aria-label="Type de groupe">${this.tags.options('phrase', g.c, 'groupe ?')}</select>
                    <select data-gf="f" aria-label="Fonction du groupe">${this.tags.options('function', g.f, 'fonction ?')}</select>
                    <button type="button" class="gr-btn" data-ga="ungroup">Défaire le groupe</button>
                    <button type="button" class="gr-btn" data-ga="unselect">OK</button>`;
            } else if (sel) {
                const one = sel[0] === sel[1];
                const t = this.tokens[sel[0]];
                bar = `<b>${one ? `« ${esc(t.t)} »` : `Mots ${sel[0] + 1} à ${sel[1] + 1}`}</b>
                    <select id="ga-new-c" aria-label="Type du groupe">${this.tags.options('phrase', this.newGroup.c, 'groupe ?')}</select>
                    <select id="ga-new-f" aria-label="Fonction du groupe">${this.tags.options('function', this.newGroup.f, 'fonction ?')}</select>
                    <button type="button" class="gr-btn gr-btn-main" data-ga="group">Grouper</button>
                    ${one && [...t.t].length > 1 ? '<button type="button" class="gr-btn" data-ga="split" title="Un mot par caractère">✂ Couper</button>' : ''}
                    ${one && sel[0] < this.tokens.length - 1 ? '<button type="button" class="gr-btn" data-ga="join" title="Avec le mot suivant">⊕ Joindre au suivant</button>' : ''}
                    <button type="button" class="gr-btn" data-ga="unselect">Annuler</button>`;
            }
            const stale = this.saved?.stale
                ? `<p class="gr-status is-error">La phrase a changé depuis l'analyse (« ${esc(this.saved.text)} »).
                    <button type="button" class="gr-btn" data-ga="restart">Repartir de la phrase actuelle</button></p>` : '';
            this.container.innerHTML = `
                <div class="ga">
                  <div class="ga-sentence"><span class="gr-hanzi" lang="zh">${esc(s.hanzi)}</span>
                    ${s.pinyin ? `<span class="gr-pinyin">${esc(s.pinyin)}</span>` : ''}
                    ${s.french ? `<span class="gr-fr">${esc(s.french)}</span>` : ''}
                    <span class="gr-meta">${this.rules.length > 1 ? `Analyse commune aux règles : ${this.rules.map(esc).join(', ')}` : 'L\'analyse vaut pour toutes les règles qui citent cette phrase.'}</span>
                  </div>
                  ${stale}
                  <h3 class="ga-h3">Analyse linéaire</h3>
                  <div class="ga-tokens">${this.tokens.map((t, i) => this.tokenHtml(t, i)).join('')}</div>
                  <div class="ga-bar">${bar}</div>
                  <h3 class="ga-h3">Arbre</h3>
                  <div class="ga-tree">${drawTree(this.tokens, this.groups, this.tags, { selectedGroup: this.selectedGroup, selection: sel })}</div>
                  <div class="ga-bracket" title="L'arbre en une ligne">${esc(bracketed(this.tokens, this.groups, this.tags))}</div>
                  ${this.newTagForm()}
                  <label class="ga-label" for="ga-note">Commentaire</label>
                  <textarea id="ga-note" class="ga-note" placeholder="Ce que cette phrase montre, un doute…">${esc(this.note)}</textarea>
                  <div class="gr-row">
                    <button type="button" class="gr-btn gr-btn-main" data-ga="save">Enregistrer l'analyse</button>
                    ${this.aiEnabled ? '<button type="button" class="gr-btn" data-ga="ai" title="Catégories, fonctions et groupes proposés par l\'IA, à revoir avant d\'enregistrer">✨ Proposer avec l\'IA</button>' : ''}
                    ${this.saved ? '<button type="button" class="gr-btn" data-ga="erase">Effacer l\'analyse</button>' : ''}
                    <button type="button" class="gr-btn" data-ga="close">Fermer</button>
                    <span class="gr-status ga-msg" aria-live="polite">${esc(this.message)}</span>
                  </div>
                  ${this.aiNote ? `<div class="ga-ai">${this.aiNote}</div>` : ''}
                </div>`;
        }

        tokenHtml(t, i) {
            const sel = this.selection && this.selection[0] <= i && i <= this.selection[1];
            return `<div class="ga-tok${sel ? ' is-sel' : ''}">
                <button type="button" class="ga-word" data-token="${i}" title="Sélectionner"><span lang="zh">${esc(t.t)}</span><small>${esc(t.p)}</small></button>
                <select data-tf="c" data-i="${i}" class="${t.guessed ? 'is-guess' : ''}" aria-label="Catégorie de ${esc(t.t)}">${this.tags.options('category', t.c, 'catégorie ?')}</select>
                <select data-tf="f" data-i="${i}" aria-label="Fonction de ${esc(t.t)}">${this.tags.options('function', t.f, 'fonction ?')}</select>
                <input data-tf="g" data-i="${i}" value="${esc(t.g)}" placeholder="glose" aria-label="Glose de ${esc(t.t)}">
              </div>`;
        }

        newTagForm() {
            const p = this.pendingField;
            if (!p) return '';
            return `<div class="ga-newtag">
                <b>Nouvelle ${KIND_ONE[p.kind]}</b>
                <input id="ga-tag-code" placeholder="abréviation (${p.kind === 'function' ? 'obj' : p.kind === 'phrase' ? 'GN' : 'CL'})" maxlength="20">
                <input id="ga-tag-name" placeholder="nom (${p.kind === 'function' ? 'objet' : p.kind === 'phrase' ? 'groupe nominal' : 'classificateur'})" maxlength="100">
                <button type="button" class="gr-btn gr-btn-main" data-ga="create-tag">Créer</button>
                <button type="button" class="gr-btn" data-ga="cancel-tag">Annuler</button>
              </div>`;
        }

        pick(node) {
            if (node.dataset.group !== undefined) {
                const i = Number(node.dataset.group);
                this.selectedGroup = this.selectedGroup === i ? null : i;
                this.selection = null;
            } else {
                const i = Number(node.dataset.token);
                const s = this.selection;
                this.selectedGroup = null;
                if (!s) this.selection = [i, i];
                else if (s[0] === i && s[1] === i) this.selection = null;
                else if (i < s[0] || i > s[1]) this.selection = [Math.min(s[0], i), Math.max(s[1], i)];
                else this.selection = [i, i];
            }
            this.render();
        }

        onInput(e) {
            if (e.target.dataset.tf === 'g') {
                this.tokens[Number(e.target.dataset.i)].g = e.target.value;
                this.touch();
                this.container.querySelector('.ga-msg').textContent = this.message;
            } else if (e.target.id === 'ga-note') {
                this.note = e.target.value;
                this.touch();
                this.container.querySelector('.ga-msg').textContent = this.message;
            }
        }

        onChange(e) {
            const el = e.target;
            const value = el.value === '' ? null : el.value === 'new' ? 'new' : Number(el.value);
            if (el.dataset.tf && el.dataset.tf !== 'g') {
                const i = Number(el.dataset.i);
                if (value === 'new') {
                    this.pendingField = { kind: el.dataset.tf === 'c' ? 'category' : 'function', where: 'token', i, field: el.dataset.tf };
                } else {
                    this.tokens[i][el.dataset.tf] = value;
                    delete this.tokens[i].guessed;
                    this.touch();
                }
                this.render();
            } else if (el.dataset.gf) {
                if (value === 'new') {
                    this.pendingField = { kind: el.dataset.gf === 'c' ? 'phrase' : 'function', where: 'group', i: this.selectedGroup, field: el.dataset.gf };
                } else {
                    this.groups[this.selectedGroup][el.dataset.gf] = value;
                    this.touch();
                }
                this.render();
            } else if (el.id === 'ga-new-c' || el.id === 'ga-new-f') {
                const field = el.id === 'ga-new-c' ? 'c' : 'f';
                if (value === 'new') {
                    this.pendingField = { kind: field === 'c' ? 'phrase' : 'function', where: 'new-group', field };
                    this.render();
                } else this.newGroup[field] = value;
            }
            if (this.pendingField) this.container.querySelector('#ga-tag-code')?.focus();
        }

        async onClick(e) {
            const node = e.target.closest('[data-group],[data-token]');
            if (node && !e.target.closest('select,input')) { this.pick(node); return; }
            const button = e.target.closest('[data-ga]');
            if (!button) return;
            const act = button.dataset.ga;
            try {
                if (act === 'unselect') { this.selection = null; this.selectedGroup = null; }
                else if (act === 'group') this.group();
                else if (act === 'ungroup') { this.groups.splice(this.selectedGroup, 1); this.selectedGroup = null; this.touch(); }
                else if (act === 'split') this.split(this.selection[0]);
                else if (act === 'join') this.join(this.selection[0]);
                else if (act === 'restart') { this.tokens = this.draft.map((t) => ({ ...t })); this.groups = []; this.selection = null; this.selectedGroup = null; this.touch(); }
                else if (act === 'create-tag') { await this.createTag(); }
                else if (act === 'cancel-tag') { this.pendingField = null; }
                else if (act === 'save') { await this.save(); }
                else if (act === 'ai') { await this.askAi(button); return; }
                else if (act === 'erase') {
                    if (button.dataset.armed !== '1') { button.dataset.armed = '1'; button.textContent = 'Effacer pour toutes les règles ?'; return; }
                    await this.call(this.api.save, { action: 'delete', ...this.target });
                    this.dirty = false;
                    this.onSaved?.();
                    this.onClose?.();
                    return;
                } else if (act === 'close') {
                    if (this.dirty && button.dataset.armed !== '1') { button.dataset.armed = '1'; button.textContent = 'Fermer sans enregistrer ?'; return; }
                    this.onClose?.();
                    return;
                }
            } catch (err) { this.message = err.message; }
            this.render();
        }

        group() {
            const [s, last] = this.selection;
            const e = last + 1;
            const at = this.groups.findIndex((g) => g.s === s && g.e === e);
            if (at >= 0) { this.selectedGroup = at; this.selection = null; this.message = 'Ce groupe existe déjà : le voici.'; return; }
            const crossing = this.groups.find((g) => (g.s < s && s < g.e && g.e < e) || (s < g.s && g.s < e && e < g.e));
            if (crossing) { this.message = 'Ce groupe chevaucherait un autre : un groupe doit être dans l\'autre, ou à côté.'; return; }
            this.groups.push({ s, e, c: this.newGroup.c, f: this.newGroup.f });
            this.newGroup = { c: null, f: null };
            this.selectedGroup = this.groups.length - 1;
            this.selection = null;
            this.touch();
        }

        split(i) {
            const t = this.tokens[i];
            const chars = [...t.t];
            const readings = splitReading(t.p, chars.length);
            const k = chars.length;
            this.tokens.splice(i, 1, ...chars.map((c, j) => ({ t: c, p: readings[j], c: null, f: null, g: '' })));
            this.groups = this.groups.map((g) => ({ ...g, s: g.s > i ? g.s + k - 1 : g.s, e: g.e > i ? g.e + k - 1 : g.e }));
            this.selection = [i, i + k - 1];
            this.touch();
        }

        join(i) {
            const [a, b] = [this.tokens[i], this.tokens[i + 1]];
            this.tokens.splice(i, 2, { t: a.t + b.t, p: [a.p, b.p].filter(Boolean).join(''), c: null, f: null, g: '' });
            // A group that starts or ends between the two words can't stay.
            this.groups = this.groups.filter((g) => g.s !== i + 1 && g.e !== i + 1)
                .map((g) => ({ ...g, s: g.s > i + 1 ? g.s - 1 : g.s, e: g.e > i + 1 ? g.e - 1 : g.e }))
                .filter((g, n, all) => all.findIndex((h) => h.s === g.s && h.e === g.e) === n);
            this.selection = [i, i];
            this.touch();
        }

        async createTag() {
            const p = this.pendingField;
            const code = this.container.querySelector('#ga-tag-code').value.trim();
            const name = this.container.querySelector('#ga-tag-name').value.trim();
            const data = await this.call(this.api.tag, { action: 'create', kind: p.kind, code, name });
            this.tags.set(data.tags);
            this.onTags?.(data.tags);
            if (p.where === 'token') { this.tokens[p.i][p.field] = data.id; delete this.tokens[p.i].guessed; }
            else if (p.where === 'group' && this.groups[p.i]) this.groups[p.i][p.field] = data.id;
            else if (p.where === 'new-group') this.newGroup[p.field] = data.id;
            this.pendingField = null;
            this.message = `« ${code} » créée.`;
            this.touch();
        }

        payload() {
            return {
                action: 'save', ...this.target, note: this.note, source: this.source,
                tokens: this.tokens.map(({ t, p, c, f, g }) => ({ t, p, c, f, g })), groups: this.groups,
            };
        }

        async save() {
            const data = await this.call(this.api.save, this.payload());
            this.saved = data.analysis;
            this.tokens = data.analysis.tokens.map((t) => ({ ...t }));
            this.groups = data.analysis.groups.map((g) => ({ ...g }));
            this.selectedGroup = null;
            this.dirty = false;
            this.message = 'Analyse enregistrée.';
            this.onSaved?.();
        }

        async askAi(button) {
            button.disabled = true;
            button.textContent = '✨ L\'IA analyse…';
            try {
                const data = await this.call(this.api.ai, { ...this.target, tokens: this.payload().tokens });
                this.tags.set(data.tags);
                this.onTags?.(data.tags);
                this.tokens = data.tokens.map((t) => ({ ...t }));
                this.groups = data.groups.map((g) => ({ ...g }));
                this.source = 'ai';
                this.selection = null;
                this.selectedGroup = null;
                this.touch();
                this.message = 'Proposition de l\'IA : revoyez-la, puis enregistrez.';
                this.aiNote = `<b>IA (confiance ${esc(data.confidence)})</b> ${esc(data.explanation)}`
                    + (data.new_tags.length ? `<br>Étiquettes nouvelles proposées : <b>${data.new_tags.map(esc).join(', ')}</b> (à retenir ou rejeter dans « Étiquettes »).` : '');
            } catch (err) {
                this.message = err.message;
            }
            this.render();
        }
    }

    // ---- Le panneau des étiquettes ----------------------------------------------------------------
    class TagPanel {
        constructor(container, { api, call, tags, onTags }) {
            Object.assign(this, { container, api, call, tags, onTags });
            this.editing = null;
            this.container.addEventListener('click', (e) => this.onClick(e));
            this.render();
        }

        render(message = '') {
            const empty = !this.tags.list.length;
            this.container.innerHTML = `
              <div class="gt">
                <p class="gr-meta">Les étiquettes des analyses, à définir au fur et à mesure. Une étiquette peut en préciser une autre
                  (V › V de mouvement) : un schéma qui demande V accepte aussi V de mouvement. Dans un schéma de règle, écrivez
                  leur abréviation (ou leur nom) : <code>GN:sujet + NÉG + V (+ GN:obj)</code>.</p>
                <div class="gr-row">
                  <button type="button" class="gr-btn${empty ? ' gr-btn-main' : ''}" data-gt="seed" title="N, V, NÉG, CL, GN, GV, sujet, objet… : seules celles qui manquent sont ajoutées">${empty ? 'Partir d\'une base de départ' : 'Compléter avec la base de départ'}</button>
                  <span class="gr-status" aria-live="polite">${esc(message)}</span>
                </div>
                ${['category', 'phrase', 'function'].map((kind) => this.section(kind)).join('')}
              </div>`;
        }

        section(kind) {
            const rows = this.tags.of(kind);
            return `<h2 class="gr-h2">${KIND_LABELS[kind]} <small>${rows.length}</small></h2>
              <ul class="gr-list">${rows.map(({ tag, depth }) => this.row(tag, depth)).join('') || '<li class="gr-meta">Aucune pour l\'instant.</li>'}</ul>
              <form class="gt-add" data-kind="${kind}">
                <input name="code" placeholder="abréviation" maxlength="20" required>
                <input name="name" placeholder="nom" maxlength="100">
                <select name="parent" aria-label="Précise">${this.parentOptions(kind, null)}</select>
                <input name="description" placeholder="ce qu'elle couvre (facultatif)">
                <button type="button" class="gr-btn" data-gt="add">＋ Ajouter</button>
              </form>`;
        }

        parentOptions(kind, value, self = null) {
            return '<option value="">(générale)</option>' + this.tags.of(kind).filter(({ tag }) => tag.id !== self)
                .map(({ tag, depth }) => `<option value="${tag.id}"${tag.id === value ? ' selected' : ''}>précise ${'· '.repeat(depth)}${esc(tag.code)}</option>`).join('');
        }

        row(tag, depth) {
            if (this.editing === tag.id) {
                return `<li class="gt-row" data-tag="${tag.id}" style="padding-left:${depth}rem">
                  <form class="gt-add">
                    <input name="code" value="${esc(tag.code)}" maxlength="20">
                    <input name="name" value="${esc(tag.name)}" maxlength="100" placeholder="nom">
                    <select name="parent">${this.parentOptions(tag.kind, tag.parent, tag.id)}</select>
                    <input name="description" value="${esc(tag.description)}" placeholder="ce qu'elle couvre">
                    <button type="button" class="gr-btn gr-btn-main" data-gt="update">Enregistrer</button>
                    <button type="button" class="gr-btn" data-gt="cancel">Annuler</button>
                  </form></li>`;
            }
            return `<li class="gt-row" data-tag="${tag.id}" style="padding-left:${depth}rem">
                <span><b>${esc(tag.code)}</b> ${tag.name && tag.name !== tag.code ? esc(tag.name) : ''}
                  ${tag.status === 'proposed' ? '<span class="gt-ai">proposée par l\'IA</span>' : ''}
                  ${tag.description ? `<span class="gr-meta"> — ${esc(tag.description)}</span>` : ''}
                  <span class="gr-meta"> · ${tag.uses} emploi${tag.uses > 1 ? 's' : ''}</span></span>
                <span class="gt-tools">
                  ${tag.status === 'proposed' ? '<button type="button" class="gr-btn" data-gt="accept">Retenir</button>' : ''}
                  <button type="button" class="gr-btn" data-gt="edit" title="Modifier">✎</button>
                  <button type="button" class="gr-btn" data-gt="delete" title="${tag.status === 'proposed' ? 'Rejeter' : 'Supprimer'}">${tag.status === 'proposed' ? 'Rejeter' : '🗑'}</button>
                </span></li>`;
        }

        async onClick(e) {
            const button = e.target.closest('[data-gt]');
            if (!button) return;
            const act = button.dataset.gt;
            const id = Number(button.closest('[data-tag]')?.dataset.tag) || null;
            const form = button.closest('form');
            const fields = form ? Object.fromEntries(new FormData(form).entries()) : {};
            const parent = fields.parent ? Number(fields.parent) : null;
            let message = '';
            try {
                let data = null;
                if (act === 'seed') {
                    data = await this.call(this.api.tag, { action: 'seed' });
                    message = data.created ? `${data.created} étiquette(s) ajoutée(s).` : 'Rien ne manquait.';
                } else if (act === 'add') {
                    data = await this.call(this.api.tag, { action: 'create', kind: form.dataset.kind, code: fields.code, name: fields.name, description: fields.description, parent });
                    message = `« ${fields.code} » ajoutée.`;
                } else if (act === 'edit') { this.editing = id; this.render(); return; }
                else if (act === 'cancel') { this.editing = null; this.render(); return; }
                else if (act === 'update') {
                    data = await this.call(this.api.tag, { action: 'update', id, code: fields.code, name: fields.name, description: fields.description, parent });
                    this.editing = null;
                } else if (act === 'accept') {
                    data = await this.call(this.api.tag, { action: 'accept', id });
                } else if (act === 'delete') {
                    const tag = this.tags.byId.get(id);
                    if (button.dataset.armed !== '1') {
                        button.dataset.armed = '1';
                        button.textContent = tag.uses ? `Retirer de ${tag.uses} emploi${tag.uses > 1 ? 's' : ''} et supprimer ?` : 'Supprimer ?';
                        return;
                    }
                    data = await this.call(this.api.tag, { action: 'delete', id, force: true });
                }
                if (data?.tags) { this.tags.set(data.tags); this.onTags?.(data.tags); }
            } catch (err) { message = err.message; }
            this.render(message);
        }
    }

    global.GrammarAnalysis = { TagSet, AnalysisEditor, TagPanel, drawTree, bracketed, linear, structure };
})(typeof window !== 'undefined' ? window : globalThis);
