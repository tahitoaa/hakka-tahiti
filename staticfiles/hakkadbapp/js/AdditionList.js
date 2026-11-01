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
        const SUPERSCRIPT = { 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶' };
        return String(pinyin || '').replace(/[1-6]/g, (d) => SUPERSCRIPT[d]);
    }

    /** A stored (Wenfa) pinyin as shown, in the "J'affiche en" system. */
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
    constructor({ list, search = null, filters = null, filter = 'open', empty = 'Aucun ajout ici.', onEdit, onLoad, onRemove }) {
        this.el = { list, search, filters };
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
            if (!this.matchesFilter(a)) return false;
            if (!needle) return true;
            return [a.hanzi, a.pinyin, a.french, a.english, a.themes].some((f) => f.toLowerCase().includes(needle));
        });
    }

    render() {
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

    renderItem(a) {
        const esc = AdditionList.escapeHtml;
        const button = (action, label, status = '', variant = 'neutral') =>
            `<button type="button" data-action="${action}" data-status="${status}" `
            + `class="saisie-btn saisie-btn-${variant}">${label}</button>`;
        // The step forward first and coloured; the others plain.
        const actions = [];
        if (a.status === 'draft') actions.push(button('status', '↑ Proposer', 'review', 'review'));
        if (a.status === 'review') {
            actions.push(button('status', '✓ Valider', 'validated', 'validate'));
            actions.push(button('status', '✕ Rejeter', 'rejected', 'reject'));
        }
        actions.push(button('edit', '✎ Modifier'));
        if (a.status !== 'draft') actions.push(button('status', '↺ Repasser en brouillon', 'draft'));
        if (['draft', 'rejected'].includes(a.status)) actions.push(button('delete', 'Supprimer', '', 'delete'));

        const date = new Date(a.updated_at).toLocaleDateString('fr-FR');
        const who = a.updated_by && a.updated_by !== a.created_by ? `${a.created_by}, modifié par ${a.updated_by}` : a.created_by;
        return `<li data-id="${a.id}" class="py-3 flex flex-col gap-2">
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span class="hanzi text-lg text-gray-900">${esc(a.hanzi)}</span>
                <span class="text-sm text-gray-700">${esc(AdditionList.displayPinyin(a.pinyin))}</span>
                <span class="text-sm text-gray-900">${esc(a.french)}</span>
                ${a.english ? `<span class="text-sm text-gray-500 italic">${esc(a.english)}</span>` : ''}
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span class="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">${a.kind === 'word' ? 'Mot' : 'Expression'}</span>
                <span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">${esc(this.statusLabels[a.status] || a.status)}</span>
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
        const row = button?.closest('li');
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

/* The "Validation" page: just the list, opened on what awaits validation;
   "Modifier" goes back to the Saisie form with that addition loaded. */
document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('validation-page');
    if (!root) return;
    const $ = (id) => document.getElementById(id);
    window.validationList = new AdditionList({
        list: $('saisie-list'), search: $('saisie-search'), filters: $('saisie-filters'),
        filter: 'review', empty: 'Rien à afficher ici.',
        onEdit: (a) => { window.location.href = `${root.dataset.saisieUrl}?modifier=${a.id}`; },
    });
    window.validationList.load();
});
