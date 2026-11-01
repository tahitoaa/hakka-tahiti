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
   ========================================================================= */
class ValidationTable extends AdditionList {
    static BULK = {
        validated: { busy: 'Validation…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} validé${n > 1 ? 's' : ''}.` },
        rejected: { busy: 'Rejet…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} rejeté${n > 1 ? 's' : ''}.` },
        review: { busy: 'Proposition…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} remis à valider.` },
        draft: { busy: 'Retour en brouillon…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} renvoyé${n > 1 ? 's' : ''} en brouillon.` },
        delete: { busy: 'Suppression…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''}.` },
    };

    /** options: AdditionList's, plus `all` (the header checkbox), `bar`
     *  (the bulk buttons, [data-bulk]), `count` and `status` elements. */
    constructor(options) {
        super(options);
        Object.assign(this.el, { all: options.all, bar: options.bar, count: options.count, status: options.status });
        this.selected = new Set();

        this.el.list.addEventListener('change', (event) => {
            const box = event.target.closest('[data-select]');
            if (box) this.toggle(Number(box.dataset.select), box.checked);
        });
        // A tap anywhere on the row ticks it (not on its buttons).
        this.el.list.addEventListener('click', (event) => {
            if (event.target.closest('button, a, input, label')) return;
            const row = event.target.closest('tr[data-id]');
            if (row) this.toggle(Number(row.dataset.id), !this.selected.has(Number(row.dataset.id)));
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

    toggle(id, on) {
        if (on) this.selected.add(id);
        else this.selected.delete(id);
        const row = this.el.list.querySelector(`tr[data-id="${id}"]`);
        row?.classList.toggle('is-selected', on);
        const box = row?.querySelector('[data-select]');
        if (box) box.checked = on;
        this.renderBar();
    }

    render() {
        // Only what is shown can stay ticked.
        const visible = this.visible();
        const shown = new Set(visible.map((a) => a.id));
        [...this.selected].forEach((id) => { if (!shown.has(id)) this.selected.delete(id); });
        super.render();
        if (!visible.length) {
            this.el.list.innerHTML = `<tr><td colspan="8" class="vt-empty">${AdditionList.escapeHtml(this.empty)}</td></tr>`;
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
            b.disabled = !n || (action === 'delete'
                ? chosen.some((a) => !['draft', 'rejected'].includes(a.status))
                : chosen.every((a) => a.status === action));
        });
    }

    renderItem(a) {
        const esc = AdditionList.escapeHtml;
        const on = this.selected.has(a.id);
        const date = new Date(a.updated_at).toLocaleDateString('fr-FR');
        const who = a.updated_by && a.updated_by !== a.created_by ? `${a.created_by} → ${a.updated_by}` : a.created_by;
        return `<tr data-id="${a.id}" class="${on ? 'is-selected' : ''}">
            <td class="vt-check"><input type="checkbox" data-select="${a.id}" ${on ? 'checked' : ''}
                aria-label="Sélectionner ${esc(a.hanzi)}"></td>
            <td class="hanzi vt-hanzi">${esc(a.hanzi)}</td>
            <td class="vt-pinyin">${esc(AdditionList.displayPinyin(a.pinyin))}</td>
            <td class="vt-french">${esc(a.french)}
                ${a.english ? `<div class="vt-sub italic">${esc(a.english)}</div>` : ''}
                ${a.observations ? `<div class="vt-sub">${esc(a.observations)}</div>` : ''}</td>
            <td class="vt-meta">${a.kind === 'word' ? 'Mot' : 'Expression'}${a.themes ? `<div class="vt-sub">${esc(a.themes)}</div>` : ''}</td>
            <td class="vt-meta vt-who">${esc(who)}<div class="vt-sub">${date}</div></td>
            <td><span class="vt-status vt-status-${esc(a.status)}">${esc(this.statusLabels[a.status] || a.status)}</span></td>
            <td class="vt-actions"><button type="button" data-action="edit" class="saisie-btn saisie-btn-neutral"
                aria-label="Modifier ${esc(a.hanzi)}" title="Modifier">✎</button></td>
        </tr>`;
    }

    setStatus(message, isError = false) {
        this.el.status.textContent = message;
        this.el.status.className = `text-sm ${isError ? 'text-red-700' : 'text-green-700'}`;
    }

    async bulk(action, button) {
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
}

document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('validation-page');
    if (!root) return;
    const $ = (id) => document.getElementById(id);
    window.validationTable = new ValidationTable({
        list: $('validation-rows'), search: $('saisie-search'), filters: $('saisie-filters'),
        all: $('validation-all'), bar: $('validation-bar'), count: $('validation-count'), status: $('validation-status'),
        filter: 'review', empty: 'Rien à afficher ici.',
        onEdit: (a) => { window.location.href = `${root.dataset.saisieUrl}?modifier=${a.id}`; },
    });
    window.validationTable.load();
});
