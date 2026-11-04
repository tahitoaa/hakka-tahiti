/* =========================================================================
   AdditionList — the list of LexiconAdditions (see additions.py), shared by
   the "Saisie" page (the drafts, next to the form) and the "Validation"
   page (what was proposed: validate, reject, back to draft).
   Also holds the small helpers both pages use (JSON API, busy buttons).
   ========================================================================= */
class AdditionList {
    static API = '/api/ajouts/';
    static OPEN_STATUSES = ['draft', 'review'];

    // What each list action shows while the server answers.
    static BUSY_LABELS = {
        review: 'Proposition…', validated: 'Validation…', rejected: 'Rejet…', draft: 'Retour en brouillon…', delete: 'Suppression…',
    };

    static statusLabels() {
        return JSON.parse(document.getElementById('saisie-status-labels')?.textContent || '{}');
    }

    static getCsrfToken() {
        const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : '';
    }

    static escapeHtml(text) {
        return String(text ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        })[c]);
    }

    static superscriptTones(pinyin) {
        return String(pinyin || '').replace(/[1-8]/g, (d) => '¹²³⁴⁵⁶⁷⁸'[d - 1]);
    }

    /** A stored (Wenfa) pinyin as shown, in the "J'affiche en" system. */
    /** As imported on the platform (e-reo « target »): Wenfa with tone
     *  superscripts, words separated by spaces... */
    static platformPinyin(pinyin) {
        return AdditionList.superscriptTones(String(pinyin || '').trim().split(/\s+/)
            .map((t) => (AdditionList.PUNCT_TOKEN.test(t) ? [...t].map((c) => AdditionList.PUNCT_TO_LATIN[c] || c).join('') : t)).join(' '));
    }

    /** ...and the characters run together, no spaces, no 把:sense hint,
     *  punctuation in its Chinese form (，。？). */
    static platformHanzi(hanzi) {
        return String(hanzi || '').trim().split(/\s+/)
            .map((t) => (AdditionList.PUNCT_TOKEN.test(t) ? t.replace(/\.\.\./g, '…').replace(/[,.;:?!()[\]{}]/g, (c) => AdditionList.PUNCT_TO_CHINESE[c]) : t.split(':')[0]))
            .join('');
    }

    /** The four cells every table of entries shares (Validation, Suggestions
     *  IA, Import): Caractères | Pinyin | Français (+ anglais, observations) |
     *  Thème -- in the platform's format (Wenfa, superscript tones,
     *  characters run together), as the lexicon's own entries.
     *  `opts`: docHanzi (the document's form), rawPinyin (shown when there is
     *  no reading yet), warn, aiFrench / aiEnglish (badges). */
    static entryCells(e, opts = {}) {
        const esc = AdditionList.escapeHtml;
        const ai = ' <span class="vt-ai-badge">IA</span>';
        const hanzi = AdditionList.platformHanzi(e.hanzi);
        const pinyin = e.pinyin ? esc(AdditionList.platformPinyin(e.pinyin)) : `<i>${esc(opts.rawPinyin || '') || '—'}</i>`;
        if (opts.editable) {
            // Brouillons: each field is a cell to tap, edited in place (the stored value: words spaced, tone digits).
            const cell = (field, shown, cls = '') => `<span class="vt-edit ${cls}" data-edit="${field}" tabindex="0" role="button"
                title="Modifier">${shown || '<i>—</i>'}</span>`;
            return `<td class="hanzi vt-hanzi">${cell('hanzi', esc(hanzi))}</td>
            <td class="vt-pinyin">${cell('pinyin', pinyin)}</td>
            <td class="vt-french">${cell('french', esc(e.french))}<span class="vt-sub italic" lang="en"> · ${cell('english', esc(e.english))}</span>
                ${e.observations ? `<div class="vt-sub vt-obs" title="${esc(e.observations)}">${esc(e.observations)}</div>` : ''}</td>
            <td class="vt-meta vt-type">${cell('themes', esc(e.themes || ''))}</td>`;
        }
        return `<td class="hanzi vt-hanzi">${esc(hanzi)}${opts.docHanzi && opts.docHanzi.replace(/\s+/g, '') !== hanzi
                ? `<small class="vt-sub" title="Forme du document">${esc(opts.docHanzi)}</small>` : ''}</td>
            <td class="vt-pinyin">${pinyin}${opts.warn ? `<div class="vt-warn">⚠ ${esc(opts.warn)}</div>` : ''}</td>
            <td class="vt-french">${esc(e.french) || '<i>—</i>'}${opts.aiFrench ? ai : ''}${e.english
                ? `<span class="vt-sub italic" lang="en"> · ${esc(e.english)}${opts.aiEnglish ? ai : ''}</span>` : ''}
                ${e.observations ? `<div class="vt-sub vt-obs" title="${esc(e.observations)}">${esc(e.observations)}</div>` : ''}</td>
            <td class="vt-meta vt-type">${esc(e.themes || '')}</td>`;
    }

    /** « 📝 Mots (12) | 💬 Expressions (5) »: two tabs over a table of entries. */
    static kindTabs(current, counts, attr) {
        const tab = (kind, label) => `<button type="button" role="tab" ${attr}="${kind}" aria-selected="${current === kind}">${label}
            <span class="vt-kinds-n">${counts[kind] || 0}</span></button>`;
        return tab('word', '📝 Mots') + tab('expression', '💬 Expressions');
    }

    static PUNCT_TOKEN = /^[\uFF0C\u3002\u3001\uFF1B\uFF1A\uFF1F\uFF01\uFF08\uFF09\u3010\u3011\uFF5B\uFF5D\u2018\u2019\u201C\u201D\u2014\u2026,.;:?!()[\]{}'"]+$/;
    static PUNCT_TO_LATIN = { '，': ',', '、': ',', '。': '.', '；': ';', '：': ':', '？': '?', '！': '!', '（': '(', '）': ')',
        '【': '[', '】': ']', '｛': '{', '｝': '}', '‘': "'", '’': "'", '“': '"', '”': '"', '—': '-', '…': '...' };
    static PUNCT_TO_CHINESE = { ',': '，', '.': '。', ';': '；', ':': '：', '?': '？', '!': '！', '(': '（', ')': '）',
        '[': '【', ']': '】', '{': '｛', '}': '｝' };

    static displayPinyin(pinyin) {
        const R = typeof Romanization !== 'undefined' && Romanization.systems().length ? Romanization : null;
        return AdditionList.superscriptTones(R ? R.fromPinyin(pinyin) : pinyin);
    }

    static async request(url, payload) {
        const options = payload === undefined ? {} : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': AdditionList.getCsrfToken() },
            body: JSON.stringify(payload),
        };
        const response = await fetch(url, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
        return data;
    }

    /** Runs `task` while `button` shows a spinner and `busyLabel`, the
     *  buttons of `group` disabled meanwhile (no double submit: a click
     *  on a busy button does nothing). */
    static async whileBusy(button, busyLabel, task, group = []) {
        if (button?.getAttribute('aria-busy') === 'true') return undefined;
        const label = button?.innerHTML;
        const others = group.filter((b) => b && b !== button && !b.disabled);
        if (button) {
            button.setAttribute('aria-busy', 'true');
            button.disabled = true;
            button.innerHTML = `<span class="saisie-spinner" aria-hidden="true"></span>${AdditionList.escapeHtml(busyLabel)}`;
        }
        others.forEach((b) => { b.disabled = true; });
        try {
            return await task();
        } finally {
            // The list re-renders after an action: the button may be gone.
            if (button?.isConnected) {
                button.removeAttribute('aria-busy');
                button.disabled = false;
                button.innerHTML = label;
            }
            others.forEach((b) => { if (b.isConnected) b.disabled = false; });
        }
    }

    /**
     * @param {object} options
     *   list, search, filters: elements (search and filters optional);
     *   filter: the status shown first ('open', 'all' or a status);
     *   empty: message when nothing matches;
     *   onEdit(addition): "Modifier" clicked;
     *   onLoad(), onRemove(id): after the additions loaded / one deleted.
     */
    constructor({ list, search = null, filters = null, filter = 'open', empty = 'Aucun ajout ici.', onEdit, onLoad, onRemove, scope = null }) {
        this.el = { list, search, filters };
        this.scope = scope;          // which additions this list is about (all by default)
        this.filter = filter;
        this.empty = empty;
        this.onEdit = onEdit || (() => {});
        this.onLoad = onLoad || (() => {});
        this.onRemove = onRemove || (() => {});
        this.additions = [];
        this.statusLabels = AdditionList.statusLabels();

        this.el.search?.addEventListener('input', () => this.render());
        this.el.filters?.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-filter]');
            if (!btn) return;
            this.filter = btn.dataset.filter;
            this.el.filters.querySelectorAll('[data-filter]').forEach((b) =>
                b.setAttribute('aria-pressed', String(b === btn)));
            this.render();
        });
        this.el.list.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-action]');
            if (btn) this.handleAction(btn.dataset.action, Number(btn.closest('[data-id]').dataset.id), btn.dataset.status, btn);
        });
        document.addEventListener('romanization-change', () => this.render());
    }

    async load() {
        try {
            this.additions = (await AdditionList.request(AdditionList.API)).additions;
        } catch (err) {
            this.el.list.innerHTML = `<li class="py-3 text-sm text-red-700">Échec du chargement : ${AdditionList.escapeHtml(err.message)}</li>`;
            return;
        }
        this.render();
        this.onLoad();
    }

    upsert(addition) {
        const i = this.additions.findIndex((a) => a.id === addition.id);
        if (i === -1) this.additions.unshift(addition);
        else this.additions[i] = addition;
        this.render();
    }

    /** Briefly highlights the rows of these additions. */
    flash(ids) {
        ids.forEach((id) => {
            const row = this.el.list.querySelector(`[data-id="${id}"]`);
            if (!row) return;
            row.classList.remove('saisie-flash');
            void row.offsetWidth; // restart the animation
            row.classList.add('saisie-flash');
        });
    }

    matchesFilter(a, filter = this.filter) {
        if (filter === 'all') return true;
        if (filter === 'open') return AdditionList.OPEN_STATUSES.includes(a.status);
        return a.status === filter;
    }

    visible() {
        const needle = (this.el.search?.value || '').trim().toLowerCase();
        return this.additions.filter((a) => {
            if (this.scope && !this.scope(a)) return false;
            if (!this.matchesFilter(a)) return false;
            if (!needle) return true;
            return [a.hanzi, a.pinyin, a.french, a.english, a.themes, a.source || '', a.observations || '']
                .some((f) => f.toLowerCase().includes(needle));
        });
    }

    render() {
        const review = this.additions.filter((a) => a.status === 'review').length;
        document.querySelectorAll('[data-review-count]').forEach((el) => { el.textContent = review; el.hidden = !review; });
        const drafts = this.additions.filter((a) => a.status === 'draft' && !a.by_ai).length;
        document.querySelectorAll('[data-draft-count]').forEach((el) => { el.textContent = drafts; el.hidden = !drafts; });
        this.el.filters?.querySelectorAll('[data-filter]').forEach((b) => {
            b.dataset.label ||= b.textContent.trim();
            const count = this.additions.filter((a) => this.matchesFilter(a, b.dataset.filter)).length;
            b.textContent = `${b.dataset.label} (${count})`;
        });

        const items = this.visible();
        this.el.list.innerHTML = items.length
            ? items.map((a) => this.renderItem(a)).join('')
            : `<li class="py-3 text-sm text-gray-500">${AdditionList.escapeHtml(this.empty)}</li>`;
    }

    /** One line for the clipboard: 船只 shon²zak⁵ — navires — ships — Thème. */
    static clipboardText(a) {
        // The platform line first (pinyin then characters, as e-reo's « target »).
        const target = [AdditionList.platformPinyin(a.pinyin), AdditionList.platformHanzi(a.hanzi)].filter(Boolean).join(' ');
        return [target, a.french, a.english, a.themes]
            .map((x) => (x || '').trim()).filter(Boolean).join(' — ');
    }

    /** Copies `text`; the button says « ✓ » for a moment. */
    static async copy(text, button) {
        let ok = false;
        try {
            await navigator.clipboard.writeText(text);
            ok = true;
        } catch (e) {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
            area.remove();
        }
        if (button) {
            const label = button.dataset.label || button.innerHTML;
            button.dataset.label = label;
            button.innerHTML = ok ? '✓ Copié' : '✕';
            setTimeout(() => { button.innerHTML = button.dataset.label; }, 1200);
        }
        return ok;
    }

    /** Member of « Validateurs » (permissions.is_validator): may validate,
     *  reject, or take an addition out of those statuses. The server checks too. */
    static canValidate() {
        return typeof document !== 'undefined' && document.body?.dataset?.canValidate === '1';
    }

    renderItem(a) {
        const esc = AdditionList.escapeHtml;
        const button = (action, label, status = '', variant = 'neutral') =>
            `<button type="button" data-action="${action}" data-status="${status}" `
            + `class="saisie-btn saisie-btn-${variant}">${label}</button>`;
        // The step forward first and coloured; the others plain.
        const actions = [];
        if (a.status === 'draft') actions.push(button('status', '↑ Proposer', 'review', 'review'));
        const decider = AdditionList.canValidate();
        if (a.status === 'review' && decider) {
            actions.push(button('status', '✓ Valider', 'validated', 'validate'));
            actions.push(button('status', '✕ Rejeter', 'rejected', 'reject'));
        }
        actions.push(button('edit', '✎ Modifier'));
        if (a.status !== 'draft' && (decider || !['validated', 'rejected'].includes(a.status))) {
            actions.push(button('status', '↺ Repasser en brouillon', 'draft'));
        }
        if (['draft', 'rejected'].includes(a.status)) actions.push(button('delete', 'Supprimer', '', 'delete'));

        const date = new Date(a.updated_at).toLocaleDateString('fr-FR');
        const who = a.updated_by && a.updated_by !== a.created_by ? `${a.created_by}, modifié par ${a.updated_by}` : a.created_by;
        return `<li data-id="${a.id}" class="py-3 flex flex-col gap-2">
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span class="hanzi text-lg text-gray-900">${esc(AdditionList.platformHanzi(a.hanzi))}</span>
                <span class="text-sm font-semibold text-gray-700">${esc(AdditionList.platformPinyin(a.pinyin))}</span>
                <span class="text-sm text-gray-900">${esc(a.french)}</span>
                ${a.english ? `<span class="text-sm text-gray-500 italic" lang="en">${esc(a.english)}</span>` : ''}
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span class="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">${a.kind === 'word' ? 'Mot' : 'Expression'}</span>
                <span class="vt-status vt-status-${esc(a.status)}">${esc(this.statusLabels[a.status] || a.status)}</span>
                ${a.themes ? `<span>${esc(a.themes)}</span>` : ''}
                <span>${esc(who)} · ${date}</span>
                ${a.observations ? `<span class="w-full text-gray-600">${esc(a.observations)}</span>` : ''}
            </div>
            <div class="saisie-actions flex flex-wrap gap-2">${actions.join('')}</div>
        </li>`;
    }

    async handleAction(action, id, status, button = null) {
        const addition = this.additions.find((a) => a.id === id);
        if (!addition) return;
        if (action === 'edit') return this.onEdit(addition);
        if (action === 'delete' && !confirm(`Supprimer « ${addition.hanzi} » (${addition.french}) ?`)) return;
        const row = button?.closest('[data-id]');
        row?.classList.add('is-busy');
        const group = row ? [...row.querySelectorAll('button')] : [];
        await AdditionList.whileBusy(button, AdditionList.BUSY_LABELS[action === 'delete' ? 'delete' : status] || '…', async () => {
            try {
                if (action === 'status') {
                    this.upsert((await AdditionList.request(`${AdditionList.API}${id}`, { status })).addition);
                    this.flash([id]);
                } else if (action === 'delete') {
                    await AdditionList.request(`${AdditionList.API}${id}/supprimer`, {});
                    this.additions = this.additions.filter((a) => a.id !== id);
                    this.onRemove(id);
                    this.render();
                }
            } catch (err) {
                alert(`Échec : ${err.message}`);
            }
        }, group);
        if (row?.isConnected) row.classList.remove('is-busy');
    }
}

/* =========================================================================
   The "Validation" page: the additions as a table (made for an iPad in
   landscape), rows ticked then validated / rejected / sent back together
   (one request: /api/ajouts/lot). "Modifier" goes back to the Saisie form
   with that addition loaded.
   The AI assistant's remarks (assistant.py) show under each row: an editor
   applies a correction, dismisses a remark, or mutes the AI on an item.
   ========================================================================= */
class ValidationTable extends AdditionList {
    static COMMENTS_API = '/api/commentaires';
    static BULK = {
        validated: { busy: 'Validation…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} validé${n > 1 ? 's' : ''}.` },
        rejected: { busy: 'Rejet…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} rejeté${n > 1 ? 's' : ''}.` },
        review: { busy: 'Proposition…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} proposé${n > 1 ? 's' : ''} à la validation.` },
        draft: { busy: 'Retour en brouillon…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} renvoyé${n > 1 ? 's' : ''} en brouillon.` },
        delete: { busy: 'Suppression…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''}.` },
    };
    static MAX_AI_REVIEW = 12;
    static PAGE = 100;
    // Filters beyond the status, and what rows can be grouped by.
    static FACETS = [
        ['origin', 'Origine'], ['author', 'Auteur'], ['theme', 'Thème'],
    ];

    /** The values of `facet` for an addition (several for the themes). */
    static facetValues(a, facet) {
        if (facet === 'origin') return [a.by_ai ? '🤖 IA' : a.source ? a.source : 'Saisie'];
        if (facet === 'author') return [a.created_by || '—'];
        if (facet === 'kind') return [a.kind === 'word' ? 'Mot' : 'Expression'];
        const themes = (a.themes || '').split(',').map((t) => t.trim()).filter(Boolean);
        return themes.length ? themes : ['Sans thème'];
    }

    /** options: AdditionList's, plus `all` (the header checkbox), `bar`
     *  (the bulk buttons, [data-bulk]), `count` and `status` elements,
     *  `facets` (the filter / group bar) and `more` (« Afficher plus »). */
    constructor(options) {
        super(options);
        Object.assign(this.el, { all: options.all, bar: options.bar, count: options.count, status: options.status,
            facets: options.facets, more: options.more });
        this.facets = {};            // facet -> chosen value ('' = all)
        this.kindTab = 'word';       // words and expressions: two tabs
        this.el.kinds = document.getElementById('vt-kinds');
        this.el.kinds?.addEventListener('click', (event) => {
            const b = event.target.closest('[data-kind-tab]');
            if (!b) return;
            this.kindTab = b.dataset.kindTab;
            this.limit = ValidationTable.PAGE;
            this.render();
        });
        // Opened from the import page: ?origine=<source> shows that import.
        const origin = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('origine') : null;
        if (origin) this.facets.origin = origin;
        this.groupBy = '';
        this.limit = ValidationTable.PAGE;
        // Phones: the settings start folded; the summary says what is active.
        const settings = document.getElementById('vt-settings');
        if (settings && window.matchMedia?.('(max-width: 640px)').matches) settings.open = false;
        this.el.facets?.addEventListener('change', (event) => {
            const select = event.target.closest('select');
            if (!select) return;
            if (select.dataset.facet) this.facets[select.dataset.facet] = select.value;
            if (select.dataset.groupBy !== undefined) this.groupBy = select.value;
            this.limit = ValidationTable.PAGE;
            this.render();
        });
        this.el.facets?.addEventListener('click', (event) => {
            if (!event.target.closest('[data-facets-reset]')) return;
            this.facets = {};
            this.groupBy = '';
            this.render();
        });
        this.el.more?.addEventListener('click', () => { this.limit += ValidationTable.PAGE; this.render(); });
        this.inlineEdit = !!options.inlineEdit;
        if (this.inlineEdit) {
            const open = (span) => this.editInPlace(span);
            this.el.list.addEventListener('click', (event) => {
                if (event.target.closest('input')) return;
                const s = event.target.closest('[data-edit]');
                if (s) open(s);
            });
            this.el.list.addEventListener('keydown', (event) => {
                if (event.target.closest('input')) return;   // typing in an open field
                const s = event.target.closest('span[data-edit]');
                if (s && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(s); }
            });
        }
        this.el.list.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-copy]');
            if (!btn) return;
            const a = this.additions.find((x) => x.id === Number(btn.dataset.copy));
            if (a) AdditionList.copy(AdditionList.clipboardText(a), btn);
        });
        this.el.list.addEventListener('change', (event) => {
            const box = event.target.closest('[data-group]');
            if (!box) return;
            const key = box.dataset.group;
            this.visible().filter((a) => ValidationTable.facetValues(a, this.groupBy).includes(key))
                .forEach((a) => (box.checked ? this.selected.add(a.id) : this.selected.delete(a.id)));
            this.render();
        });
        this.selected = new Set();
        this.comments = [];          // remarks on additions (open + recently resolved)
        this.muted = new Set();      // addition ids the AI must leave alone
        this.expanded = new Set();   // rows showing their remarks

        this.el.list.addEventListener('change', (event) => {
            const box = event.target.closest('[data-select]');
            if (box) this.toggle(Number(box.dataset.select), box.checked);
        });
        // A tap anywhere on the row ticks it (not on its buttons).
        this.el.list.addEventListener('click', (event) => {
            const remark = event.target.closest('[data-remark]');
            if (remark) return this.onRemarkAction(remark);
            if (event.target.closest('button, a, input, label, textarea, .vt-detail, [data-edit]')) return;
            const row = event.target.closest('tr[data-id]');
            if (row) this.toggle(Number(row.dataset.id), !this.selected.has(Number(row.dataset.id)));
        });
        this.el.list.addEventListener('submit', (event) => {
            const form = event.target.closest('[data-comment-form]');
            if (!form) return;
            event.preventDefault();
            this.addHumanComment(Number(form.dataset.commentForm), form);
        });
        this.el.all.addEventListener('change', () => {
            const ids = this.visible().map((a) => a.id);
            if (this.el.all.checked) ids.forEach((id) => this.selected.add(id));
            else ids.forEach((id) => this.selected.delete(id));
            this.render();
        });
        this.el.bar.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-bulk]');
            if (btn) this.bulk(btn.dataset.bulk, btn);
        });
    }

    async load() {
        await super.load();
        await this.loadComments();
    }

    async loadComments() {
        try {
            const data = await AdditionList.request(`${ValidationTable.COMMENTS_API}?scope=additions`);
            this.comments = data.comments;
            this.muted = new Set(data.muted.map((m) => m.target_id));
            this.aiEnabled = data.ai_enabled;
            document.querySelectorAll('[data-needs-ai]').forEach((el) => { el.hidden = !data.ai_enabled; });
        } catch (err) {
            this.setStatus(`Remarques de l'IA indisponibles : ${err.message}`, true);
        }
        this.render();
    }

    openRemarks(id) {
        return this.comments.filter((c) => c.target_id === id && c.status === 'open');
    }

    toggle(id, on) {
        if (on) this.selected.add(id);
        else this.selected.delete(id);
        const row = this.el.list.querySelector(`tr[data-id="${id}"]`);
        row?.classList.toggle('is-selected', on);
        const box = row?.querySelector('[data-select]');
        if (box) box.checked = on;
        this.renderBar();
    }

    /** Brouillons: a field turned into an input; Enter (or leaving it) saves,
     *  Escape cancels. Characters and pinyin are edited as stored (a space
     *  between the words of an expression, tone digits). */
    editInPlace(span) {
        if (span.querySelector('input')) return;
        const id = Number(span.closest('tr[data-id]')?.dataset.id);
        const a = this.additions.find((x) => x.id === id);
        if (!a) return;
        const field = span.dataset.edit;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = a[field] || '';
        input.className = `vt-edit-input${['hanzi', 'pinyin'].includes(field) ? ' is-hakka' : ''}`;
        input.setAttribute('aria-label', field);
        span.replaceChildren(input);
        input.focus();
        input.select();
        let done = false;
        const finish = async (save) => {
            if (done) return;
            done = true;
            const value = input.value.trim();
            if (!save || value === (a[field] || '')) { this.render(); return; }
            const payload = { [field]: value };
            // New characters or reading: the text typed in the Saisie no longer applies.
            if (field === 'hanzi' || field === 'pinyin') payload.input_text = '';
            try {
                const data = await AdditionList.request(`${AdditionList.API}${id}`, payload);
                this.upsert(data.addition);
                this.flash([id]);
                this.setStatus('');
            } catch (err) {
                this.setStatus(`Échec : ${err.message}`, true);
                this.render();
            }
        };
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') { event.preventDefault(); finish(true); }
            if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
    }

    /** The status filter and the search (AdditionList), without the facets. */
    unfaceted() {
        return super.visible();
    }

    /** The status, the search and the facets -- both kinds. */
    faceted() {
        const chosen = Object.entries(this.facets || {}).filter(([, v]) => v);
        return this.unfaceted().filter((a) => chosen.every(([f, v]) => ValidationTable.facetValues(a, f).includes(v)));
    }

    visible() {
        const all = this.faceted();
        return this.el.kinds ? all.filter((a) => a.kind === this.kindTab) : all;
    }

    /** Filter selects with counts (within the status and the search), and « Grouper par ». */
    renderFacets() {
        if (!this.el.facets) return;
        const esc = AdditionList.escapeHtml;
        const base = this.unfaceted();
        const selects = ValidationTable.FACETS.map(([facet, label]) => {
            const counts = new Map();
            base.forEach((a) => ValidationTable.facetValues(a, facet).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1)));
            const current = this.facets[facet] || '';
            if (current && !counts.has(current)) counts.set(current, 0);
            const options = [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'fr'))
                .map(([v, n]) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)} (${n})</option>`).join('');
            return `<label class="${current ? 'is-on' : ''}"><span>${label}</span><select data-facet="${facet}">
                <option value="">Tous</option>${options}</select></label>`;
        }).join('');
        const group = `<label class="${this.groupBy ? 'is-on' : ''}"><span>Grouper</span><select data-group-by>
            <option value="">—</option>${ValidationTable.FACETS.map(([f, l]) => `<option value="${f}" ${f === this.groupBy ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>`;
        const active = Object.values(this.facets).some(Boolean) || this.groupBy;
        const summary = document.getElementById('vt-settings-summary');
        if (summary) {
            const status = this.el.filters?.querySelector('[aria-pressed="true"]')?.dataset.label || '';
            summary.textContent = ` · ${[status, ...Object.values(this.facets).filter(Boolean)].filter(Boolean).join(' · ')}`;
        }
        this.el.facets.innerHTML = selects + group
            + (active ? '<button type="button" class="vt-facets-reset" data-facets-reset>✕ Effacer</button>' : '');
    }

    render() {
        // Only what is shown can stay ticked.
        const visible = this.visible();
        const shown = new Set(visible.map((a) => a.id));
        [...this.selected].forEach((id) => { if (!shown.has(id)) this.selected.delete(id); });
        super.render();   // status chips (counts)
        this.renderFacets();
        if (this.el.kinds) {
            const all = this.faceted();
            const counts = { word: all.filter((a) => a.kind === 'word').length, expression: all.filter((a) => a.kind === 'expression').length };
            this.el.kinds.innerHTML = AdditionList.kindTabs(this.kindTab, counts, 'data-kind-tab');
        }
        const esc = AdditionList.escapeHtml;
        if (!visible.length) {
            this.el.list.innerHTML = `<tr><td colspan="9" class="vt-empty">${esc(this.empty)}</td></tr>`;
        } else if (!this.groupBy) {
            this.el.list.innerHTML = visible.slice(0, this.limit).map((a) => this.renderItem(a)).join('');
        } else {
            // One block per value (an addition with two themes shows in both).
            const groups = new Map();
            visible.forEach((a) => ValidationTable.facetValues(a, this.groupBy).forEach((v) => {
                if (!groups.has(v)) groups.set(v, []);
                groups.get(v).push(a);
            }));
            let budget = this.limit;
            this.el.list.innerHTML = [...groups].sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0], 'fr'))
                .map(([key, items]) => {
                    if (budget <= 0) return '';
                    const ticked = items.filter((a) => this.selected.has(a.id)).length;
                    const rows = items.slice(0, budget).map((a) => this.renderItem(a)).join('');
                    budget -= items.length;
                    return `<tr class="vt-group"><td class="vt-check"><input type="checkbox" data-group="${esc(key)}"
                        ${ticked && ticked === items.length ? 'checked' : ''} aria-label="Cocher le groupe ${esc(key)}"></td>
                        <td colspan="8"><b>${esc(key)}</b> <span class="vt-sub">${items.length} ajout${items.length > 1 ? 's' : ''}${ticked ? ` · ${ticked} coché${ticked > 1 ? 's' : ''}` : ''}</span></td></tr>${rows}`;
                }).join('');
            this.el.list.querySelectorAll('[data-group]').forEach((box) => {
                const items = groups.get(box.dataset.group) || [];
                const ticked = items.filter((a) => this.selected.has(a.id)).length;
                box.indeterminate = ticked > 0 && ticked < items.length;
            });
        }
        if (this.el.more) {
            const rest = visible.length - this.limit;
            this.el.more.hidden = rest <= 0;
            this.el.more.textContent = `Afficher plus (${Math.max(rest, 0)} restant${rest > 1 ? 's' : ''})`;
        }
        if (this.el.bar) this.renderBar();
    }

    renderBar() {
        const visible = this.visible();
        const n = this.selected.size;
        this.el.all.checked = n > 0 && n === visible.length;
        this.el.all.indeterminate = n > 0 && n < visible.length;
        this.el.all.disabled = !visible.length;
        this.el.count.textContent = n ? `${n} sélectionné${n > 1 ? 's' : ''}` : 'Cochez des lignes';
        const chosen = this.additions.filter((a) => this.selected.has(a.id));
        this.el.bar.querySelectorAll('[data-bulk]').forEach((b) => {
            if (b.getAttribute('aria-busy') === 'true') return;
            const action = b.dataset.bulk;
            // Nothing to do when every ticked row already has that status;
            // only drafts and rejected additions can be deleted.
            if (action === 'ai-review') {
                b.disabled = !n || n > ValidationTable.MAX_AI_REVIEW || chosen.every((a) => this.muted.has(a.id));
                b.title = n > ValidationTable.MAX_AI_REVIEW ? `Au plus ${ValidationTable.MAX_AI_REVIEW} lignes à la fois` : '';
                return;
            }
            const decider = AdditionList.canValidate();
            const decided = (s) => ['validated', 'rejected'].includes(s);
            if (decided(action)) b.hidden = !decider;
            b.disabled = !n || (action === 'delete'
                ? chosen.some((a) => !['draft', 'rejected'].includes(a.status)) || (!decider && chosen.some((a) => decided(a.status)))
                : chosen.every((a) => a.status === action) || (!decider && (decided(action) || chosen.some((a) => decided(a.status)))));
        });
    }

    renderItem(a) {
        const esc = AdditionList.escapeHtml;
        const on = this.selected.has(a.id);
        const date = new Date(a.updated_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
        const who = a.by_ai ? '<span class="vt-ai-badge">🤖 IA</span>'
            : esc(a.updated_by && a.updated_by !== a.created_by ? `${a.created_by} → ${a.updated_by}` : a.created_by);
        const remarks = this.openRemarks(a.id);
        const corrections = remarks.filter((c) => c.kind === 'correction').length;
        const muted = this.muted.has(a.id);
        const open = this.expanded.has(a.id);
        const iaLabel = remarks.length ? `💬 ${remarks.length}${corrections ? ` · ✎ ${corrections}` : ''}` : '💬';
        const row = `<tr data-id="${a.id}" class="${on ? 'is-selected' : ''}">
            <td class="vt-check"><input type="checkbox" data-select="${a.id}" ${on ? 'checked' : ''}
                aria-label="Sélectionner ${esc(a.hanzi)}"></td>
            ${AdditionList.entryCells(a, { editable: this.inlineEdit })}
            <td class="vt-meta vt-who">${who} <span class="vt-sub">${date}</span>${a.source ? `<div class="vt-src" title="Source : ${esc(a.source)}">📄 ${esc(a.source)}</div>` : ''}</td>
            <td class="vt-st"><span class="vt-status vt-status-${esc(a.status)}">${esc(this.statusLabels[a.status] || a.status)}</span></td>
            <td class="vt-ia"><button type="button" class="vt-ia-btn ${remarks.length ? 'has-remarks' : ''}" data-remark="expand"
                aria-expanded="${open}" aria-label="Remarques sur ${esc(a.hanzi)}">${iaLabel}${muted ? ' 🔕' : ''}</button></td>
            <td class="vt-actions"><button type="button" data-copy="${a.id}" class="saisie-btn saisie-btn-neutral"
                aria-label="Copier ${esc(a.hanzi)}" title="Copier dans le presse-papiers">📋</button><button type="button" data-action="edit" class="saisie-btn saisie-btn-neutral"
                aria-label="Modifier ${esc(a.hanzi)}" title="Modifier">✎</button></td>
        </tr>`;
        return open ? row + this.renderDetail(a, remarks, muted) : row;
    }

    /** The remarks under a row: corrections to apply, comments, mute, a comment of one's own. */
    renderDetail(a, remarks, muted) {
        const esc = AdditionList.escapeHtml;
        const list = remarks.map((c) => `<li class="vt-remark vt-remark-${c.kind}">
              <div class="vt-remark-head">${c.by_ai ? '🤖 IA' : esc(c.author)} ·
                ${c.kind === 'correction' ? `correction du ${esc(c.field_label)}` : 'commentaire'}</div>
              ${c.kind === 'correction' ? `<div class="vt-diff"><del>${esc(c.current_value) || '<i>vide</i>'}</del>
                  <span aria-hidden="true">→</span> <ins>${esc(c.proposed_value)}</ins></div>` : ''}
              <div>${esc(c.text)}</div>
              <div class="vt-remark-actions">
                ${c.applicable ? `<button type="button" class="saisie-btn saisie-btn-validate" data-remark="apply" data-cid="${c.id}">Appliquer</button>` : ''}
                <button type="button" class="saisie-btn saisie-btn-neutral" data-remark="dismiss" data-cid="${c.id}">Écarter</button>
              </div></li>`).join('');
        return `<tr class="vt-detail" data-detail="${a.id}"><td colspan="9">
            <div class="vt-detail-box">
              ${list ? `<ul class="vt-remarks">${list}</ul>` : '<p class="vt-sub">Aucune remarque en cours.</p>'}
              <form class="vt-comment-form" data-comment-form="${a.id}">
                <label class="sr-only" for="vt-comment-${a.id}">Votre commentaire</label>
                <input id="vt-comment-${a.id}" type="text" placeholder="Ajouter un commentaire…" maxlength="1000">
                <button type="submit" class="saisie-btn saisie-btn-neutral">Commenter</button>
              </form>
              <button type="button" class="src-open-btn" data-sources="${esc(a.hanzi.replace(/\s+/g, ''))}" data-reading="${esc(a.pinyin)}">🔎 Sources</button>
              <button type="button" class="saisie-btn saisie-btn-neutral" data-remark="mute" data-muted="${muted}">
                ${muted ? '🔔 Réactiver l’IA sur cet ajout' : '🔕 Couper l’IA sur cet ajout'}</button>
            </div></td></tr>`;
    }

    async onRemarkAction(button) {
        const row = button.closest('[data-id], [data-detail]');
        const id = Number(row.dataset.id || row.dataset.detail);
        const action = button.dataset.remark;
        if (action === 'expand') {
            if (this.expanded.has(id)) this.expanded.delete(id);
            else this.expanded.add(id);
            return this.render();
        }
        const labels = { apply: 'Application…', dismiss: '…', mute: '…' };
        await AdditionList.whileBusy(button, labels[action], async () => {
            try {
                if (action === 'mute') {
                    const muted = button.dataset.muted !== 'true';
                    await AdditionList.request('/api/ia/muet', { target_type: 'addition', target_id: id, muted });
                    if (muted) this.muted.add(id); else this.muted.delete(id);
                    this.setStatus(muted ? 'L’IA ne commentera plus cet ajout.' : 'L’IA peut de nouveau commenter cet ajout.');
                } else {
                    const data = await AdditionList.request(`${ValidationTable.COMMENTS_API}/${button.dataset.cid}`, { action });
                    this.comments = this.comments.map((c) => (c.id === data.comment.id ? data.comment : c));
                    if (data.addition) this.additions = this.additions.map((a) => (a.id === data.addition.id ? data.addition : a));
                    this.setStatus(action === 'apply' ? '✓ Correction appliquée.' : 'Remarque écartée.');
                }
                this.render();
                this.flash([id]);
            } catch (err) {
                this.setStatus(`Échec : ${err.message}`, true);
            }
        });
    }

    async addHumanComment(id, form) {
        const input = form.querySelector('input');
        const text = input.value.trim();
        if (!text) return;
        await AdditionList.whileBusy(form.querySelector('button'), '…', async () => {
            try {
                const data = await AdditionList.request(ValidationTable.COMMENTS_API, { target_type: 'addition', target_id: id, text });
                this.comments.unshift(data.comment);
                this.render();
            } catch (err) {
                this.setStatus(`Échec : ${err.message}`, true);
            }
        });
    }

    setStatus(message, isError = false) {
        this.el.status.textContent = message;
        this.el.status.className = `text-sm ${isError ? 'text-red-700' : 'text-green-700'}`;
    }

    async bulk(action, button) {
        if (action === 'ai-review') return this.aiReview(button);
        const ids = [...this.selected];
        if (!ids.length) return;
        if (action === 'delete' && !confirm(`Supprimer ${ids.length} ajout${ids.length > 1 ? 's' : ''} ? C'est définitif.`)) return;
        const labels = ValidationTable.BULK[action];
        const rows = ids.map((id) => this.el.list.querySelector(`tr[data-id="${id}"]`)).filter(Boolean);
        rows.forEach((r) => r.classList.add('is-busy'));
        this.setStatus('');
        await AdditionList.whileBusy(button, labels.busy, async () => {
            try {
                const payload = action === 'delete' ? { ids, action } : { ids, status: action };
                const data = await AdditionList.request(`${AdditionList.API}lot`, payload);
                if (action === 'delete') {
                    const gone = new Set(data.deleted);
                    this.additions = this.additions.filter((a) => !gone.has(a.id));
                } else {
                    const byId = new Map(data.additions.map((a) => [a.id, a]));
                    this.additions = this.additions.map((a) => byId.get(a.id) || a);
                }
                this.selected.clear();
                this.render();
                if (action !== 'delete') this.flash(ids);
                this.setStatus(`✓ ${labels.done(ids.length)}`);
            } catch (err) {
                rows.forEach((r) => r.classList.remove('is-busy'));
                this.setStatus(`Échec : ${err.message}`, true);
            }
        }, [...this.el.bar.querySelectorAll('[data-bulk]')]);
        this.renderBar();
    }

    /** The AI reads the ticked rows (muted ones left out) and leaves remarks. */
    async aiReview(button) {
        const ids = [...this.selected].filter((id) => !this.muted.has(id));
        if (!ids.length) return;
        this.setStatus('');
        await AdditionList.whileBusy(button, 'L’IA relit…', async () => {
            try {
                const data = await AdditionList.request('/api/ia/relire', { target_type: 'addition', ids });
                this.comments = [...data.comments, ...this.comments];
                data.comments.forEach((c) => this.expanded.add(c.target_id));
                this.render();
                const n = data.comments.length;
                this.setStatus(n ? `🤖 ${n} remarque${n > 1 ? 's' : ''} de l’IA (sous les lignes concernées).`
                    : '🤖 L’IA n’a rien à redire sur ces lignes.');
            } catch (err) {
                this.setStatus(`Échec : ${err.message}`, true);
            }
        }, [...this.el.bar.querySelectorAll('[data-bulk]')]);
        this.renderBar();
    }

    /** The AI suggests a few new words; they arrive "À valider". */
    async aiNewWords(mode, button) {
        this.setStatus('');
        const wanted = Math.max(1, Math.min(50, Number(document.getElementById('ai-count')?.value) || 5));
        const PER_REQUEST = 10;
        await AdditionList.whileBusy(button, 'L’IA cherche…', async () => {
            try {
                // Batches of at most 10 (each request must end within Vercel's 60 s).
                const added = [];
                while (added.length < wanted) {
                    const count = Math.min(PER_REQUEST, wanted - added.length);
                    if (wanted > PER_REQUEST) this.setStatus(`🤖 L’IA cherche : ${added.length} sur ${wanted}…`);
                    const data = await AdditionList.request('/api/ia/mots', { mode, count });
                    data.additions.forEach((a) => this.additions.unshift(a));
                    added.push(...data.additions);
                    this.render();
                    if (!data.additions.length) break;
                }
                this.flash(added.map((a) => a.id));
                const n = added.length;
                const what = mode === 'expressions' ? ['expression', 'expressions', 'proposée', 'proposées', 'nouvelle expression']
                    : ['mot', 'mots', 'proposé', 'proposés', 'nouveau mot'];
                this.setStatus(n ? `🤖 ${n} ${n > 1 ? what[1] : what[0]} ${n > 1 ? what[3] : what[2]} par l’IA, en tête de liste « À valider ».`
                    : `🤖 L’IA n’a pas trouvé de ${what[4]} à proposer.`);
            } catch (err) {
                this.setStatus(`Échec : ${err.message}`, true);
            }
        });
    }
}

/* The validation slideshow: the additions of the table (as filtered), one
   at a time, large, to validate, reject, send back to draft or correct
   (French, English, theme, observations) on the spot, with the AI's
   remarks. After a decision, the next item comes by itself. A double click
   never skips an item: a second click within 450 ms is ignored, as are the
   repeated clicks of one gesture and held-down keys. */
class ValidationShow {
    constructor(table) {
        this.table = table;
        this.dialog = document.getElementById('vs-dialog');
        this.card = document.getElementById('vs-card');
        this.ids = [];
        this.pos = 0;
        this.lockedUntil = 0;
        this.editing = false;
        this.busy = false;
        document.getElementById('vs-open').addEventListener('click', () => this.open());
        this.dialog.addEventListener('click', (e) => this.onClick(e));
        this.dialog.addEventListener('keydown', (e) => {
            if (e.repeat || this.editing || e.target.closest('input, textarea')) return;
            if (e.key === 'ArrowRight') { e.preventDefault(); this.move(1); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); this.move(-1); }
        });
        let x0 = null;
        this.card.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
        this.card.addEventListener('touchend', (e) => {
            if (x0 === null || this.editing) return;
            const dx = e.changedTouches[0].clientX - x0;
            x0 = null;
            if (Math.abs(dx) > 60) this.move(dx < 0 ? 1 : -1);
        });
    }

    current() {
        return this.table.additions.find((a) => a.id === this.ids[this.pos]);
    }

    open(startId = null) {
        this.ids = this.table.visible().map((a) => a.id);
        if (!this.ids.length) { this.table.setStatus('Aucun ajout à afficher avec ce filtre.', true); return; }
        this.pos = Math.max(0, startId === null ? 0 : this.ids.indexOf(startId));
        this.editing = false;
        this.render();
        if (!this.dialog.open) this.dialog.showModal();
    }

    locked() {
        const now = Date.now();
        if (now < this.lockedUntil || this.busy) return true;
        this.lockedUntil = now + 450;
        return false;
    }

    move(step, { force = false } = {}) {
        if (!force && this.locked()) return;
        const next = Math.min(this.ids.length - 1, Math.max(0, this.pos + step));
        if (next === this.pos) return;
        this.pos = next;
        this.editing = false;
        this.card.classList.add('is-changing');
        setTimeout(() => { this.render(); this.card.classList.remove('is-changing'); }, 120);
    }

    render(message = '') {
        const a = this.current();
        const esc = AdditionList.escapeHtml;
        const head = document.getElementById('vs-count');
        if (!a) { this.card.innerHTML = '<p class="vs-empty">Cet ajout n’existe plus.</p>'; return; }
        head.innerHTML = `${esc(this.table.statusLabels[this.table.filter] || 'Ajouts')} · <b>${this.pos + 1} / ${this.ids.length}</b>`;
        const date = new Date(a.updated_at).toLocaleDateString('fr-FR');
        const author = a.by_ai ? '🤖 IA' : esc(a.created_by || '?');
        const edited = a.updated_by && a.updated_by !== a.created_by ? `, modifié par ${esc(a.updated_by)}` : '';
        const remarks = this.table.openRemarks(a.id);
        const field = (name, label, value) => `<label class="vs-field"><span>${label}</span>
            <input type="text" data-vs-field="${name}" value="${esc(value)}"></label>`;
        this.card.innerHTML = `
            <div class="vs-meta"><span class="vt-status vt-status-${esc(a.status)}">${esc(this.table.statusLabels[a.status] || a.status)}</span>
              <span>${a.kind === 'word' ? 'Mot' : 'Expression'}${a.themes ? ` · ${esc(a.themes)}` : ''}</span>
              <span class="vs-author">par <b>${author}</b>${edited} · ${date}</span></div>
            <div class="hanzi vs-hanzi">${esc(AdditionList.platformHanzi(a.hanzi))}</div>
            <div class="vs-pinyin">${esc(AdditionList.platformPinyin(a.pinyin))}</div>
            ${this.editing ? `<div class="vs-edit">
                <a class="saisie-btn saisie-btn-neutral vs-saisie-link" href="${esc(this.table.saisieUrl || '/saisie/')}?modifier=${a.id}">✎ Corriger les caractères ou le pinyin dans la Saisie</a>
                ${field('french', 'Français', a.french)}${field('english', 'Anglais', a.english)}
                ${field('themes', 'Thème', a.themes)}${field('observations', 'Observations', a.observations)}
                <div class="vs-edit-actions"><button type="button" class="saisie-btn saisie-btn-validate" data-vs="save">Enregistrer la correction</button>
                  <button type="button" class="saisie-btn saisie-btn-neutral" data-vs="cancel">Annuler</button></div></div>`
            : `<div class="vs-french">${esc(a.french) || '<i>sans traduction</i>'}</div>
               ${a.english ? `<div class="vs-english" lang="en">${esc(a.english)}</div>` : ''}
               ${a.observations ? `<div class="vs-obs">${esc(a.observations)}</div>` : ''}`}
            ${remarks.length ? `<ul class="vs-remarks">${remarks.map((c) => `<li>
                <b>${c.by_ai ? '🤖 IA' : esc(c.author)}</b> ${c.kind === 'correction'
                    ? `· ${esc(c.field_label)} : <del>${esc(c.current_value) || 'vide'}</del> → <ins>${esc(c.proposed_value)}</ins>` : ''}
                <div>${esc(c.text)}</div>
                <span class="vs-remark-actions">${c.applicable ? `<button type="button" class="saisie-btn saisie-btn-validate" data-vs-remark="apply" data-cid="${c.id}">Appliquer</button>` : ''}
                  <button type="button" class="saisie-btn saisie-btn-neutral" data-vs-remark="dismiss" data-cid="${c.id}">Écarter</button></span></li>`).join('')}</ul>` : ''}
            <p class="vs-message" role="status">${esc(message)}</p>`;
        this.dialog.querySelector('[data-vs-nav="-1"]').disabled = this.pos === 0;
        this.dialog.querySelector('[data-vs-nav="1"]').disabled = this.pos === this.ids.length - 1;
        const decider = AdditionList.canValidate();
        const decided = (s) => ['validated', 'rejected'].includes(s);
        this.dialog.querySelectorAll('[data-vs-status]').forEach((b) => {
            if (decided(b.dataset.vsStatus)) b.hidden = !decider;
            b.disabled = this.editing || b.dataset.vsStatus === a.status || (!decider && decided(a.status));
        });
        this.dialog.querySelector('[data-vs="edit"]').disabled = this.editing;
        if (this.editing) this.card.querySelector('[data-vs-field="french"]')?.focus();
    }

    async onClick(e) {
        const b = e.target.closest('button');
        if (b?.dataset.vs === 'close') { this.dialog.close(); return; }
        if (!b || e.detail > 1) return;                       // the 2nd click of a double click
        if (b.dataset.vsNav) { this.move(Number(b.dataset.vsNav)); return; }
        if (b.dataset.vs === 'edit') { this.editing = true; this.render(); return; }
        if (b.dataset.vs === 'cancel') { this.editing = false; this.render(); return; }
        if (this.locked()) return;
        const a = this.current();
        if (!a) return;
        if (b.dataset.vsStatus) return this.decide(a, b.dataset.vsStatus, b);
        if (b.dataset.vs === 'save') return this.save(a, b);
        if (b.dataset.vsRemark) return this.remark(a, b);
    }

    async run(button, label, task) {
        this.busy = true;
        try {
            await AdditionList.whileBusy(button, label, task);
        } catch (err) {
            this.render(`Échec : ${err.message}`);
        } finally {
            this.busy = false;
        }
    }

    replace(addition) {
        this.table.additions = this.table.additions.map((x) => (x.id === addition.id ? addition : x));
        this.table.render();
    }

    async decide(a, status, button) {
        const done = { validated: '✓ Validé', rejected: '✕ Rejeté', draft: '↺ Renvoyé en brouillon', review: '↑ Remis à valider' };
        await this.run(button, '…', async () => {
            const data = await AdditionList.request(`${AdditionList.API}${a.id}`, { status });
            this.replace(data.addition);
            this.render(done[status] || 'Enregistré');
        });
        // On to the next item, once the change has been seen.
        if (this.current()?.status === status && this.pos < this.ids.length - 1) {
            setTimeout(() => this.move(1, { force: true }), 600);
        }
    }

    async save(a, button) {
        const values = {};
        this.card.querySelectorAll('[data-vs-field]').forEach((input) => { values[input.dataset.vsField] = input.value; });
        await this.run(button, 'Enregistrement…', async () => {
            const data = await AdditionList.request(`${AdditionList.API}${a.id}`, values);
            this.editing = false;
            this.replace(data.addition);
            this.render('✓ Correction enregistrée');
        });
    }

    async remark(a, button) {
        await this.run(button, '…', async () => {
            const data = await AdditionList.request(`${ValidationTable.COMMENTS_API}/${button.dataset.cid}`, { action: button.dataset.vsRemark });
            this.table.comments = this.table.comments.map((c) => (c.id === data.comment.id ? data.comment : c));
            if (data.addition) this.replace(data.addition); else this.table.render();
            this.render(button.dataset.vsRemark === 'apply' ? '✓ Correction appliquée' : 'Remarque écartée');
        });
    }
}

/* The "Lexique" tab of the Validation page: the AI's remarks on lexicon
   words and expressions. The lexicon is edited on the platform: an editor
   fixes it there, then marks the remark done -- or dismisses it, or mutes
   the AI on that item. */
class LexiconRemarks {
    constructor(root, status) {
        this.root = root;
        this.status = status;
        this.list = root.querySelector('[data-lex-list]');
        this.comments = [];
        this.muted = new Set();
        root.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-lex]');
            if (btn) this.action(btn);
        });
    }

    key(type, id) { return `${type}:${id}`; }

    async load() {
        try {
            const data = await AdditionList.request(`${ValidationTable.COMMENTS_API}?scope=lexicon`);
            this.comments = data.comments.filter((c) => c.status === 'open');
            this.muted = new Set(data.muted.map((m) => this.key(m.target_type, m.target_id)));
        } catch (err) {
            this.list.innerHTML = `<li class="vt-sub">Échec du chargement : ${AdditionList.escapeHtml(err.message)}</li>`;
            return;
        }
        this.render();
    }

    render() {
        const esc = AdditionList.escapeHtml;
        const count = document.getElementById('lexicon-count');
        if (count) count.textContent = this.comments.length ? ` (${this.comments.length})` : '';
        if (!this.comments.length) {
            this.list.innerHTML = '<li class="vt-sub">Aucune remarque en cours sur le lexique.</li>';
            return;
        }
        this.list.innerHTML = this.comments.map((c) => {
            const muted = this.muted.has(this.key(c.target_type, c.target_id));
            const [hanzi, ...rest] = c.target_label.split(' · ');
            return `<li class="vt-remark vt-remark-${c.kind}" data-cid="${c.id}">
              <div class="vt-remark-head"><span class="hanzi">${esc(hanzi)}</span> ${esc(rest.join(' · '))} ·
                ${c.target_type === 'word' ? 'mot' : 'expression'} · ${c.by_ai ? '🤖 IA' : esc(c.author)}</div>
              ${c.kind === 'correction' ? `<div class="vt-diff"><b>${esc(c.field_label)}</b> : <del>${esc(c.current_value) || '<i>vide</i>'}</del>
                  <span aria-hidden="true">→</span> <ins>${esc(c.proposed_value)}</ins></div>` : ''}
              <div>${esc(c.text)}</div>
              <div class="vt-remark-actions">
                <button type="button" class="saisie-btn saisie-btn-validate" data-lex="done" data-cid="${c.id}">✓ Corrigé sur la plateforme</button>
                <button type="button" class="saisie-btn saisie-btn-neutral" data-lex="dismiss" data-cid="${c.id}">Écarter</button>
                <button type="button" class="saisie-btn saisie-btn-neutral" data-lex="mute" data-cid="${c.id}" data-muted="${muted}">
                  ${muted ? '🔔 Réactiver l’IA' : `🔕 Couper l’IA sur ${c.target_type === 'word' ? 'ce mot' : 'cette expression'}`}</button>
              </div></li>`;
        }).join('');
    }

    setStatus(message, isError = false) {
        this.status.textContent = message;
        this.status.className = `text-sm ${isError ? 'text-red-700' : 'text-green-700'}`;
    }

    async action(button) {
        const action = button.dataset.lex;
        if (action === 'review') return this.review(button);
        const comment = this.comments.find((c) => c.id === Number(button.dataset.cid));
        if (!comment) return;
        await AdditionList.whileBusy(button, '…', async () => {
            try {
                if (action === 'mute') {
                    const muted = button.dataset.muted !== 'true';
                    await AdditionList.request('/api/ia/muet', { target_type: comment.target_type, target_id: comment.target_id, muted });
                    const key = this.key(comment.target_type, comment.target_id);
                    if (muted) this.muted.add(key); else this.muted.delete(key);
                } else {
                    await AdditionList.request(`${ValidationTable.COMMENTS_API}/${comment.id}`, { action });
                    this.comments = this.comments.filter((c) => c.id !== comment.id);
                }
                this.render();
            } catch (err) {
                this.setStatus(`Échec : ${err.message}`, true);
            }
        });
    }

    /** The AI reads the next lexicon words (or expressions) it hasn't read yet. */
    async review(button) {
        await AdditionList.whileBusy(button, 'L’IA relit…', async () => {
            try {
                const data = await AdditionList.request('/api/ia/relire', { target_type: button.dataset.type, next: true });
                this.comments = [...data.comments, ...this.comments];
                this.render();
                const n = data.comments.length;
                this.setStatus(data.message || (n ? `🤖 ${n} nouvelle${n > 1 ? 's' : ''} remarque${n > 1 ? 's' : ''}.`
                    : '🤖 L’IA n’a rien à redire sur ces éléments.'));
            } catch (err) {
                this.setStatus(`Échec : ${err.message}`, true);
            }
        });
    }
}

/* Import of a text document (importer.py), on the Validation page: the
   server reads the file, the AI reads a free text chunk by chunk, every
   entry is checked, and the editor ticks what to propose "À valider". */
class DocumentImport {
    static STATES = {
        new: 'nouveau', known: 'déjà au lexique', proposed: 'déjà proposé',
        rejected: 'déjà rejeté', duplicate: 'en double dans le fichier',
    };

    /** `table`: the Validation table to add the proposed words to, or null
     *  on the import page (a link to Validation is shown instead). */
    constructor(table = null, validationUrl = '/validation/') {
        this.table = table;
        this.validationUrl = validationUrl;
        const $ = (id) => document.getElementById(id);
        this.form = $('import-form');
        this.file = $('import-file');
        this.status = $('import-status');
        this.result = $('import-result');
        this.reset();
        this.form.addEventListener('submit', (event) => { event.preventDefault(); this.analyse(); });
        // 📋 A pasted text, read by the AI.
        this.paste = $('import-paste');
        $('import-paste-go')?.addEventListener('click', (event) => this.analysePaste(event.currentTarget));
        this.paste?.addEventListener('input', () => {
            const han = (this.paste.value.match(/\p{Script=Han}/gu) || []).length;
            const count = $('import-paste-count');
            if (count) count.textContent = this.paste.value.trim() ? `${this.paste.value.length} signes, ${han} caractères chinois` : '';
        });
        this.result.addEventListener('change', (event) => {
            const box = event.target.closest('[data-pick]');
            if (box) { this.entries[Number(box.dataset.pick)].picked = box.checked; this.renderSummary(); }
            const name = event.target.closest('[data-source-name]');
            if (name) this.sourceName = name.value.trim();
        });
        this.result.addEventListener('click', (event) => {
            if (event.target.closest('[data-propose]')) this.propose(event.target.closest('[data-propose]'));
            if (event.target.closest('[data-languages]')) this.checkLanguages(event.target.closest('[data-languages]'));
            if (event.target.closest('[data-map-apply]')) this.applyMapping(event.target.closest('[data-map-apply]'));
            if (event.target.closest('[data-define]')) this.define(event.target.closest('[data-define]'));
            if (event.target.closest('[data-read-all]')) this.readAllWithAi(event.target.closest('[data-read-all]'));
            const kindTab = event.target.closest('[data-import-kind]');
            if (kindTab) { this.kindTab = kindTab.dataset.importKind; this.render(); }
        });
    }

    /** "Chappell_Lamarre_mots.tsv" -> "Chappell Lamarre" (as migration 0026). */
    static sourceName(filename) {
        return filename.replace(/\.[A-Za-z0-9]{2,4}$/, '').replace(/[_-]+(mots|words|texte|extraction|ocr)$/i, '')
            .replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    }

    reset() {
        this.kindTab = null;
        this.sourceName = '';
        this.doc = null;
        this.entries = [];
        this.result.innerHTML = '';
    }

    setStatus(message, isError = false) {
        this.status.textContent = message;
        this.status.className = `text-sm ${isError ? 'text-red-700' : 'text-gray-700'}`;
    }

    async post(url, body) {
        const isForm = body instanceof FormData;
        const response = await fetch(url, {
            method: 'POST', body: isForm ? body : JSON.stringify(body),
            headers: { 'X-CSRFToken': AdditionList.getCsrfToken(), ...(isForm ? {} : { 'Content-Type': 'application/json' }) },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
        return data;
    }

    /** « Importer : mots et expressions / mots / expressions » (page Importer). */
    static want() {
        return document.querySelector('input[name="import-want"]:checked')?.value || 'all';
    }

    add(candidates) {
        const seen = new Set(this.entries.map((e) => e.hanzi.replace(/\s+/g, '')));
        const want = DocumentImport.want();
        candidates.forEach((c) => {
            // What was not asked for is left out.
            if ((want === 'words' && c.kind === 'expression') || (want === 'expressions' && c.kind !== 'expression')) return;
            const key = c.hanzi.replace(/\s+/g, '');
            if (c.state === 'new' && seen.has(key)) c.state = 'duplicate';
            seen.add(key);
            this.entries.push({ ...c, picked: c.state === 'new' });
        });
    }

    /** Lights up the mode cards used (page Importer): table, lines, candidates, ai. */
    static showModes(...modes) {
        document.querySelectorAll('[data-import-mode]').forEach((el) => el.classList.toggle('is-on', modes.includes(el.dataset.importMode)));
    }

    async analyse() {
        const file = this.file.files[0];
        if (!file) return;
        this.reset();
        DocumentImport.showModes();
        const button = this.form.querySelector('button');
        await AdditionList.whileBusy(button, 'Lecture…', async () => {
            try {
                const body = new FormData();
                body.append('file', file);
                const data = await this.post('/api/import/analyse', body);
                this.doc = data;
                if (data.kind === 'table') {
                    DocumentImport.showModes('table');
                    this.add(data.candidates);
                    this.setStatus(`Tableau lu${data.used_ai ? ' (colonnes reconnues par l’IA)' : ' sans IA'} : ${data.candidates.length} entrée(s)`
                        + `${data.candidates[0]?.romanization ? ` · romanisation reconnue : ${data.candidates[0].romanization}` : ''}.`);
                    this.render();
                    await this.checkLanguages();
                    return;
                }
                if (data.kind === 'mapping') {
                    DocumentImport.showModes('table');
                    // No recognised header: the editor says which column is which.
                    this.setStatus('Colonnes non reconnues : indiquez ce que contient chaque colonne (sans IA).');
                    this.renderMapping(data);
                    return;
                }
                // A text, read without the AI: the lines a template reads, and candidate words.
                DocumentImport.showModes(...(Object.keys(data.templates || {}).length ? ['lines'] : []), ...(data.shortlist ? ['candidates'] : []));
                this.add(data.candidates);
                const read = Object.entries(data.templates || {}).map(([t, n]) => `${n} « ${t} »`).join(', ');
                this.setStatus(`Texte lu sans IA : ${read || 'aucune ligne de vocabulaire reconnue'}`
                    + `${data.shortlist ? ` · ${data.shortlist} mot${data.shortlist > 1 ? 's' : ''} candidat${data.shortlist > 1 ? 's' : ''} (sens à trouver)` : ''}.`);
                this.render();
                await this.checkLanguages();
            } catch (err) {
                this.setStatus(`Échec : ${err.message}`, true);
            }
        });
    }

    /** The columns of a table without recognised headers: one menu per
     *  column, prefilled by the server's guess -- or by what was chosen for
     *  this source before (kept in this browser). */
    renderMapping(data) {
        const esc = AdditionList.escapeHtml;
        const FIELDS = [['', '— ignorer —'], ['hanzi', 'Caractères'], ['pinyin', 'Lecture'], ['french', 'Français'],
            ['english', 'Anglais'], ['themes', 'Thème'], ['type', 'Type (mot / expression)'], ['page', 'Page'],
            ['source_sense', 'Sens (autre langue)'], ['remark', 'Remarque']];
        const key = `import-columns:${DocumentImport.sourceName(data.filename || '')}:${data.width}`;
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { saved = null; }
        const chosen = {};
        Object.entries((saved && saved.columns) || data.guess || {}).forEach(([f, c]) => { chosen[c] = f; });
        const header = saved ? !!saved.header : false;
        this.mapping = { key, data };
        this.result.innerHTML = `<div class="vt-import-map">
            <label class="text-sm"><input type="checkbox" data-map-header ${header ? 'checked' : ''}> La première ligne est une en-tête</label>
            <div class="vt-wrap"><table class="vt-table no-auto-csv"><thead><tr>${Array.from({ length: data.width }, (_, c) => `<th>
              <select data-map-col="${c}" aria-label="Colonne ${c + 1}">${FIELDS.map(([f, l]) => `<option value="${f}" ${chosen[c] === f ? 'selected' : ''}>${l}</option>`).join('')}</select></th>`).join('')}</tr></thead>
              <tbody>${data.preview.map((r) => `<tr>${Array.from({ length: data.width }, (_, c) => `<td>${esc(r[c] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
            <button type="button" class="saisie-btn saisie-btn-review" data-map-apply>Lire le tableau avec ces colonnes</button>
          </div>`;
    }

    async applyMapping(button) {
        const columns = {};
        this.result.querySelectorAll('[data-map-col]').forEach((sel) => { if (sel.value) columns[sel.value] = Number(sel.dataset.mapCol); });
        const header = !!this.result.querySelector('[data-map-header]')?.checked;
        if (!('hanzi' in columns)) { this.setStatus('Indiquez au moins la colonne des caractères.', true); return; }
        try { localStorage.setItem(this.mapping.key, JSON.stringify({ columns, header })); } catch (e) { /* private mode */ }
        await AdditionList.whileBusy(button, 'Lecture…', async () => {
            try {
                const data = await this.post(`/api/import/${this.doc.document}/colonnes`, { columns, header });
                this.entries = [];
                this.add(data.candidates);
                this.setStatus(`Tableau lu sans IA : ${data.candidates.length} entrée(s).`);
                this.render();
                await this.checkLanguages();
            } catch (err) {
                this.setStatus(`Échec : ${err.message}`, true);
            }
        });
    }

    /** Candidate words (no meaning yet) the AI may define -- a short list, not the text. */
    toDefine() {
        return this.entries.filter((e) => e.template === 'candidat' && !e.defined && !e.french && !e.english && e.state === 'new');
    }

    async define(button) {
        const todo = this.toDefine();
        if (!todo.length) return;
        await AdditionList.whileBusy(button, 'L’IA définit…', async () => {
            try {
                for (let start = 0; start < todo.length; start += 60) {
                    const batch = todo.slice(start, start + 60);
                    const data = await this.post('/api/import/definir', { entries: batch.map((e) => ({ hanzi: e.hanzi, context: e.context || '' })) });
                    batch.forEach((e, i) => {
                        const r = data.entries[i];
                        e.defined = true;
                        e.french = r.french;
                        e.english = r.english;
                        e.ai_fields = ['french', 'english'];
                        if (!r.keep) { e.picked = false; e.reading_note = [e.reading_note, 'pas un mot selon l’IA'].filter(Boolean).join(' ; '); }
                    });
                }
                const kept = todo.filter((e) => e.picked).length;
                this.setStatus(`L’IA a défini ${todo.length} candidat${todo.length > 1 ? 's' : ''} (${kept} retenu${kept > 1 ? 's' : ''}) : vérifiez avant de proposer.`);
            } catch (err) {
                this.setStatus(`Échec : ${err.message}`, true);
            }
            this.render();
        });
    }

    /** 📋 A pasted text: saved as a document, then read by the AI part by part. */
    async analysePaste(button) {
        const text = this.paste?.value || '';
        if (!text.trim()) { this.setStatus('Collez d’abord un texte.', true); return; }
        this.reset();
        const name = document.getElementById('import-paste-name')?.value.trim() || '';
        this.sourceName = name;
        try {
            this.doc = await this.post('/api/import/texte', { text, name });
        } catch (err) {
            this.setStatus(`Échec : ${err.message}`, true);
            return;
        }
        if (!this.doc.chunks) {
            this.setStatus('Rien de nouveau à lire : chaque ligne en caractères chinois n’a que des mots déjà dans le lexique.');
            return;
        }
        await this.readAllWithAi(button, { confirm: false, mode: 'paste' });
    }

    /** The old way, on demand only: the AI reads the whole text, by parts. */
    async readAllWithAi(button, { confirm = true, mode = 'ai' } = {}) {
        const data = this.doc;
        if (!data?.chunks) return;
        if (confirm && !window.confirm(`L’IA va lire tout le texte (${data.chunks} partie${data.chunks > 1 ? 's' : ''}) : c’est la lecture la plus coûteuse. Continuer ?`)) return;
        DocumentImport.showModes(mode);
        await AdditionList.whileBusy(button, 'L’IA lit…', async () => {
            try {
                for (let n = 0; n < data.chunks; n += 1) {
                    this.setStatus(`L’IA lit le texte : partie ${n + 1} sur ${data.chunks}…`);
                    const part = await this.post(`/api/import/${data.document}/extraire`, { chunk: n, want: DocumentImport.want() });
                    this.add(part.candidates);
                    this.render();
                }
                data.readAll = true;   // read once: no « Lire tout le texte » button any more
                this.setStatus(`Texte lu par l’IA (${data.chunks} partie${data.chunks > 1 ? 's' : ''}) : ${this.entries.length} entrée(s).`);
                this.render();
                await this.checkLanguages();
            } catch (err) {
                this.setStatus(`Échec : ${err.message}`, true);
            }
            this.render();
        });
    }

    renderSummary() {
        const summary = this.result.querySelector('[data-summary]');
        const button = this.result.querySelector('[data-propose]');
        if (!summary || !button) return;
        const counts = {};
        this.entries.forEach((e) => { counts[e.state] = (counts[e.state] || 0) + 1; });
        summary.innerHTML = Object.entries(counts).map(([state, n]) =>
            `<span class="vt-state vt-state-${state}">${n} ${DocumentImport.STATES[state] || state}</span>`).join(' ');
        const picked = this.entries.filter((e) => e.picked).length;
        button.textContent = `↑ Proposer ${picked} mot${picked > 1 ? 's' : ''} à la validation`;
        button.disabled = !picked;
        const check = this.result.querySelector('[data-languages]');
        if (check) check.hidden = !this.toCheck().length;
    }

    /** Ticked entries whose French and English the AI has not checked yet. */
    toCheck() {
        return this.entries.filter((e) => e.picked && !e.checked && (e.french || e.english || e.source_sense));
    }

    /** French really in French, English really in English, the missing one
     *  translated: the AI, in batches (run after each analysis). */
    async checkLanguages(button = null) {
        const todo = this.toCheck();
        if (!todo.length) return;
        const BATCH = 60;
        const run = async () => {
            try {
                for (let start = 0; start < todo.length; start += BATCH) {
                    const batch = todo.slice(start, start + BATCH);
                    this.setStatus(`L’IA vérifie le français et l’anglais : ${start + 1}–${start + batch.length} sur ${todo.length}…`);
                    const data = await this.post('/api/import/langues', {
                        entries: batch.map((e) => ({ hanzi: e.hanzi, french: e.french || '', english: e.english || '',
                            source_sense: e.source_sense || '', remark: e.remark || '' })),
                    });
                    batch.forEach((e, i) => {
                        const r = data.entries[i];
                        e.french = r.french;
                        e.english = r.english;
                        e.ai_fields = [...new Set([...(e.ai_fields || []), ...r.changed])];
                        e.checked = true;
                    });
                    this.render();
                }
                const n = todo.filter((e) => e.ai_fields?.length).length;
                this.setStatus(`Français et anglais vérifiés : ${n} sens traduit${n > 1 ? 's' : ''} par l’IA (badge IA), à relire avant de proposer.`);
            } catch (err) {
                this.setStatus(`Vérification FR / EN impossible : ${err.message}. Vous pouvez réessayer.`, true);
            }
            this.render();
        };
        if (button) await AdditionList.whileBusy(button, 'Vérification…', run);
        else await run();
    }

    render() {
        const esc = AdditionList.escapeHtml;
        if (!this.entries.length) { this.result.innerHTML = ''; return; }
        // The tab with entries first (words, unless the document has none).
        if (!this.kindTab) this.kindTab = this.entries.some((e) => e.kind !== 'expression') ? 'word' : 'expression';
        this.result.innerHTML = `
            <label class="vt-import-source">Source <input type="text" data-source-name maxlength="200"
                value="${esc(this.sourceName || DocumentImport.sourceName(this.doc?.filename || ''))}"
                placeholder="Livre, auteur, page web…" title="Nom de la source, enregistré avec chaque mot : filtre « Origine » de la validation"></label>
            <div class="vt-import-summary"><span data-summary></span>
              <button type="button" class="saisie-btn saisie-btn-lg" data-languages hidden>✨ Vérifier FR / EN</button>
              ${this.toDefine().length ? `<button type="button" class="saisie-btn saisie-btn-lg saisie-btn-ai" data-define>✨ Définir les ${this.toDefine().length} candidats (IA)</button>` : ''}
              ${this.doc?.kind === 'text' && this.doc.chunks && this.doc.ai_enabled && !this.doc.readAll ? `<button type="button" class="saisie-btn saisie-btn-lg saisie-btn-neutral" data-read-all
                  title="La lecture la plus coûteuse : tout le texte passe par l’IA">Lire tout le texte avec l’IA (${this.doc.chunks} partie${this.doc.chunks > 1 ? 's' : ''})</button>` : ''}
              <button type="button" class="saisie-btn saisie-btn-lg saisie-btn-review" data-propose></button></div>
            <div class="vt-kinds" role="tablist" aria-label="Mots ou expressions">${AdditionList.kindTabs(this.kindTab, {
                word: this.entries.filter((e) => e.kind !== 'expression').length,
                expression: this.entries.filter((e) => e.kind === 'expression').length }, 'data-import-kind')}</div>
            <div class="vt-wrap"><table class="vt-table vt-import-table no-auto-csv">
              <thead><tr><th class="vt-check"><span class="sr-only">Proposer</span></th><th class="vt-hk">Caractères</th><th class="vt-hk">Pinyin</th>
                <th>Français</th><th class="vt-type">Thème</th><th class="vt-who">Origine</th><th class="vt-st">État</th></tr></thead>
              <tbody>${this.entries.map((e, i) => ((e.kind === 'expression') !== (this.kindTab === 'expression') ? '' : `<tr class="${e.state === 'new' ? '' : 'is-off'}">
                <td class="vt-check"><input type="checkbox" data-pick="${i}" ${e.picked ? 'checked' : ''} ${e.state === 'new' ? '' : 'disabled'}
                    aria-label="Proposer ${esc(e.hanzi)}"></td>
                ${AdditionList.entryCells({ hanzi: e.hanzi, pinyin: e.reading, french: e.french, english: e.english,
                    kind: e.kind, themes: e.themes }, { docHanzi: e.document_hanzi, rawPinyin: e.pinyin, warn: e.reading_note,
                    aiFrench: e.translated || e.ai_fields?.includes('french'), aiEnglish: e.ai_fields?.includes('english') })}
                <td class="vt-meta vt-who"${e.remark || e.source_sense ? ` title="${esc([e.source_sense, e.remark].filter(Boolean).join(' — '))}"` : ''}>${esc(e.location)}</td>
                <td class="vt-st"><span class="vt-state vt-state-${esc(e.state)}">${esc(DocumentImport.STATES[e.state] || e.state)}</span></td>
              </tr>`)).join('')}</tbody></table></div>`;
        this.renderSummary();
    }

    async propose(button) {
        const entries = this.entries.filter((e) => e.picked).map((e) => ({
            hanzi: e.hanzi, document_hanzi: e.document_hanzi || '', pinyin: e.pinyin || e.reading || '', french: e.french || '', english: e.english || '',
            themes: e.themes || '', location: e.location || '', translated: !!e.translated, ai_fields: e.ai_fields || [],
            source_sense: e.source_sense || '', remark: e.remark || '', type: e.type || '',
        }));
        if (!entries.length || !this.doc) return;
        await AdditionList.whileBusy(button, 'Envoi…', async () => {
            try {
                const source = this.result.querySelector('[data-source-name]')?.value.trim() || '';
                const data = await this.post(`/api/import/${this.doc.document}/proposer`, { entries, source });
                if (this.table) {
                    data.additions.forEach((a) => this.table.additions.unshift(a));
                    this.table.render();
                    this.table.flash(data.additions.map((a) => a.id));
                }
                const n = data.additions.length;
                const origin = data.additions[0]?.source || source;
                this.setStatus(`✓ ${n} mot${n > 1 ? 's' : ''} proposé${n > 1 ? 's' : ''} à la validation${data.skipped ? ` (${data.skipped} ignoré${data.skipped > 1 ? 's' : ''} : déjà connus)` : ''}.`);
                if (!this.table && n) {
                    const url = `${this.validationUrl}?origine=${encodeURIComponent(origin)}`;
                    this.status.insertAdjacentHTML('beforeend', ` <a class="underline font-semibold" href="${AdditionList.escapeHtml(url)}">Voir dans Validation →</a>`);
                }
                this.reset();
                this.form.reset();
            } catch (err) {
                this.setStatus(`Échec : ${err.message}`, true);
            }
        });
    }
}

/* « Brouillons »: every draft, whoever wrote it (the AI's are on its own
   page), edited in place, then proposed to Validation or deleted. */
document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('drafts-page');
    if (!root) return;
    const $ = (id) => document.getElementById(id);
    const table = new ValidationTable({
        list: $('validation-rows'), search: $('saisie-search'), filters: null,
        all: $('validation-all'), bar: $('validation-bar'), count: $('validation-count'), status: $('validation-status'),
        facets: $('vt-facets'), more: $('vt-more'), filter: 'all', inlineEdit: true,
        scope: (a) => a.status === 'draft' && !a.by_ai,
        empty: 'Aucun brouillon.',
        onEdit: (a) => { window.location.href = `${root.dataset.saisieUrl}?modifier=${a.id}`; },
    });
    table.saisieUrl = root.dataset.saisieUrl;
    window.validationTable = table;
    table.load();
});

/* « Suggestions IA »: the AI's drafts, generated here, filtered, corrected,
   then proposed to Validation or set aside -- by a person. */
document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('ai-page');
    if (!root) return;
    const $ = (id) => document.getElementById(id);
    const table = new ValidationTable({
        list: $('validation-rows'), search: $('saisie-search'), filters: null,
        all: $('validation-all'), bar: $('validation-bar'), count: $('validation-count'), status: $('validation-status'),
        facets: $('vt-facets'), more: $('vt-more'), filter: 'all',
        scope: (a) => a.by_ai && a.status === 'draft',
        empty: 'Aucune suggestion en attente : générez-en ci-dessus.',
        onEdit: (a) => { window.location.href = `${root.dataset.saisieUrl}?modifier=${a.id}`; },
    });
    table.saisieUrl = root.dataset.saisieUrl;
    window.validationTable = table;
    table.load();
    if (document.getElementById('vs-dialog')) window.validationShow = new ValidationShow(table);
    const mode = $('ai-mode');
    const syncTheme = () => { $('ai-theme-wrap').hidden = mode.value !== 'expressions'; };
    mode.addEventListener('change', syncTheme);
    syncTheme();
    // 📖 hakkadictionary.com: a character's words, ticked, become the AI's drafts.
    const hd = { data: null };
    const esc = AdditionList.escapeHtml;
    const renderHd = () => {
        const box = $('hd-result');
        const d = hd.data;
        if (!d) { box.innerHTML = ''; return; }
        const fresh = d.words.filter((w) => !w.known);
        box.innerHTML = `<div class="hd-box">
            ${d.entries.map((e) => `<div class="hd-entry"><b>${esc(e.reading)}</b> ${esc((e.senses || []).join(' ; ') || e.text).slice(0, 300)}</div>`).join('')}
            <div class="hd-bar"><span class="text-sm">${d.words.length} mot${d.words.length > 1 ? 's' : ''} cité${d.words.length > 1 ? 's' : ''}, ${fresh.length} absent${fresh.length > 1 ? 's' : ''} du lexique</span>
              <button type="button" class="saisie-btn saisie-btn-ai" id="hd-create"></button></div>
            <div class="vt-wrap"><table class="vt-table no-auto-csv"><thead><tr><th class="vt-check"></th><th class="vt-hk">Caractères</th><th class="vt-hk">Pinyin</th>
              <th>Sens (dictionnaire)</th><th class="vt-st">État</th></tr></thead><tbody>
            ${d.words.map((w, i) => `<tr class="${w.known ? 'is-off' : ''}">
              <td class="vt-check"><input type="checkbox" data-hd="${i}" ${w.known ? 'disabled' : (w.picked ? 'checked' : '')} aria-label="Retenir ${esc(w.hanzi)}"></td>
              <td class="hanzi vt-hanzi">${esc(w.hanzi)}${w.trad !== w.hanzi ? `<small class="vt-sub">${esc(w.trad)}</small>` : ''}</td>
              <td class="vt-pinyin">${w.pinyin ? esc(AdditionList.platformPinyin(w.pinyin)) : '<i>—</i>'}${w.note ? `<div class="vt-warn">${esc(w.note)}</div>` : ''}</td>
              <td class="vt-french" lang="zh">${esc(w.definition)}</td>
              <td class="vt-st">${w.known ? 'dans le lexique' : 'nouveau'}</td></tr>`).join('')}
            </tbody></table></div></div>`;
        const picked = d.words.filter((w) => w.picked).length;
        $('hd-create').textContent = `🤖 Créer ${picked} suggestion${picked > 1 ? 's' : ''} (traduites par l’IA)`;
        $('hd-create').disabled = !picked;
    };
    const searchHd = async () => {
        const q = $('hd-q').value.trim();
        if (!q) return;
        await AdditionList.whileBusy($('hd-go'), 'Recherche…', async () => {
            try {
                hd.data = await AdditionList.request(`/api/hakkadict?q=${encodeURIComponent(q)}`);
                // Ticked by default: new words with a reading.
                hd.data.words.forEach((w) => { w.picked = !w.known && !!w.pinyin; });
                table.setStatus('');
            } catch (err) {
                hd.data = null;
                table.setStatus(`Échec : ${err.message}`, true);
            }
            renderHd();
        });
    };
    $('hd-go')?.addEventListener('click', searchHd);
    $('hd-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchHd(); } });
    $('hd-result')?.addEventListener('change', (e) => {
        const box = e.target.closest('[data-hd]');
        if (!box || !hd.data) return;
        hd.data.words[Number(box.dataset.hd)].picked = box.checked;
        renderHd();
    });
    $('hd-result')?.addEventListener('click', async (e) => {
        const button = e.target.closest('#hd-create');
        if (!button || !hd.data) return;
        const words = hd.data.words.filter((w) => w.picked);
        await AdditionList.whileBusy(button, 'L’IA traduit…', async () => {
            try {
                const data = await AdditionList.request('/api/hakkadict/brouillons', { char: hd.data.char, words });
                data.additions.forEach((a) => table.additions.unshift(a));
                table.render();
                table.flash(data.additions.map((a) => a.id));
                words.forEach((w) => { w.known = true; w.picked = false; });
                table.setStatus(`📖 ${data.additions.length} suggestion${data.additions.length > 1 ? 's' : ''} depuis hakkadictionary.com : vérifiez, puis proposez à la validation.`);
            } catch (err) {
                table.setStatus(`Échec : ${err.message}`, true);
            }
            renderHd();
        });
    });

    $('ai-generate').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const wanted = Math.max(1, Math.min(50, Number($('ai-count').value) || 5));
        const PER_REQUEST = 10;
        table.setStatus('');
        await AdditionList.whileBusy(button, 'L’IA cherche…', async () => {
            const added = [];
            try {
                while (added.length < wanted) {
                    const count = Math.min(PER_REQUEST, wanted - added.length);
                    table.setStatus(`🤖 L’IA cherche : ${added.length} sur ${wanted}…`);
                    const data = await AdditionList.request('/api/ia/mots', { mode: mode.value, count, theme: $('ai-theme').value, draft: true });
                    data.additions.forEach((a) => table.additions.unshift(a));
                    added.push(...data.additions);
                    table.render();
                    if (!data.additions.length) break;
                }
                table.flash(added.map((a) => a.id));
                table.setStatus(added.length ? `🤖 ${added.length} suggestion${added.length > 1 ? 's' : ''} : triez, corrigez, puis proposez à la validation.`
                    : '🤖 L’IA n’a rien trouvé de nouveau à proposer.');
            } catch (err) {
                table.setStatus(`Échec : ${err.message}${added.length ? ` (${added.length} déjà générée${added.length > 1 ? 's' : ''})` : ''}`, true);
            }
        });
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('import-page');
    if (page) window.documentImport = new DocumentImport(null, page.dataset.validationUrl);
});

document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('validation-page');
    if (!root) return;
    const $ = (id) => document.getElementById(id);
    const table = new ValidationTable({
        list: $('validation-rows'), search: $('saisie-search'), filters: $('saisie-filters'),
        all: $('validation-all'), bar: $('validation-bar'), count: $('validation-count'), status: $('validation-status'),
        facets: $('vt-facets'), more: $('vt-more'),
        filter: 'review', empty: 'Rien à afficher ici.',
        onEdit: (a) => { window.location.href = `${root.dataset.saisieUrl}?modifier=${a.id}`; },
    });
    table.saisieUrl = root.dataset.saisieUrl;
    window.validationTable = table;
    table.load();
    if (document.getElementById('vs-dialog')) window.validationShow = new ValidationShow(table);
    if (document.getElementById('import-form')) window.documentImport = new DocumentImport(table);
    document.querySelectorAll('[data-new-words]').forEach((btn) =>
        btn.addEventListener('click', () => table.aiNewWords(btn.dataset.newWords, btn)));

    const lexicon = new LexiconRemarks($('lexicon-panel'), $('lexicon-status'));
    lexicon.load();
    // Two tabs: the additions table, the remarks on the lexicon.
    const tabs = [...document.querySelectorAll('[data-vtab]')];
    const show = (name) => {
        tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.vtab === name)));
        $('additions-panel').hidden = name !== 'additions';
        $('lexicon-panel').hidden = name !== 'lexicon';
    };
    tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.vtab)));
});
