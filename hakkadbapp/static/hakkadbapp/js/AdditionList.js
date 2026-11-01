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
   The AI assistant's remarks (assistant.py) show under each row: an editor
   applies a correction, dismisses a remark, or mutes the AI on an item.
   ========================================================================= */
class ValidationTable extends AdditionList {
    static COMMENTS_API = '/api/commentaires';
    static BULK = {
        validated: { busy: 'Validation…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} validé${n > 1 ? 's' : ''}.` },
        rejected: { busy: 'Rejet…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} rejeté${n > 1 ? 's' : ''}.` },
        review: { busy: 'Proposition…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} remis à valider.` },
        draft: { busy: 'Retour en brouillon…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} renvoyé${n > 1 ? 's' : ''} en brouillon.` },
        delete: { busy: 'Suppression…', done: (n) => `${n} ajout${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''}.` },
    };
    static MAX_AI_REVIEW = 12;

    /** options: AdditionList's, plus `all` (the header checkbox), `bar`
     *  (the bulk buttons, [data-bulk]), `count` and `status` elements. */
    constructor(options) {
        super(options);
        Object.assign(this.el, { all: options.all, bar: options.bar, count: options.count, status: options.status });
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
            if (event.target.closest('button, a, input, label, textarea, .vt-detail')) return;
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

    render() {
        // Only what is shown can stay ticked.
        const visible = this.visible();
        const shown = new Set(visible.map((a) => a.id));
        [...this.selected].forEach((id) => { if (!shown.has(id)) this.selected.delete(id); });
        super.render();
        if (!visible.length) {
            this.el.list.innerHTML = `<tr><td colspan="9" class="vt-empty">${AdditionList.escapeHtml(this.empty)}</td></tr>`;
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
            b.disabled = !n || (action === 'delete'
                ? chosen.some((a) => !['draft', 'rejected'].includes(a.status))
                : chosen.every((a) => a.status === action));
        });
    }

    renderItem(a) {
        const esc = AdditionList.escapeHtml;
        const on = this.selected.has(a.id);
        const date = new Date(a.updated_at).toLocaleDateString('fr-FR');
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
            <td class="hanzi vt-hanzi">${esc(a.hanzi)}</td>
            <td class="vt-pinyin">${esc(AdditionList.displayPinyin(a.pinyin))}</td>
            <td class="vt-french">${esc(a.french)}${a.english ? `<span class="vt-sub italic"> · ${esc(a.english)}</span>` : ''}
                ${a.observations ? `<div class="vt-sub vt-obs" title="${esc(a.observations)}">${esc(a.observations)}</div>` : ''}</td>
            <td class="vt-meta">${a.kind === 'word' ? 'Mot' : 'Expr.'}${a.themes ? `<span class="vt-sub"> · ${esc(a.themes)}</span>` : ''}</td>
            <td class="vt-meta vt-who">${who} <span class="vt-sub">${date}</span></td>
            <td><span class="vt-status vt-status-${esc(a.status)}">${esc(this.statusLabels[a.status] || a.status)}</span></td>
            <td class="vt-ia"><button type="button" class="vt-ia-btn ${remarks.length ? 'has-remarks' : ''}" data-remark="expand"
                aria-expanded="${open}" aria-label="Remarques sur ${esc(a.hanzi)}">${iaLabel}${muted ? ' 🔕' : ''}</button></td>
            <td class="vt-actions"><button type="button" data-action="edit" class="saisie-btn saisie-btn-neutral"
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
        await AdditionList.whileBusy(button, 'L’IA cherche…', async () => {
            try {
                const data = await AdditionList.request('/api/ia/mots', { mode });
                data.additions.forEach((a) => this.additions.unshift(a));
                this.render();
                this.flash(data.additions.map((a) => a.id));
                const n = data.additions.length;
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

    constructor(table) {
        this.table = table;
        const $ = (id) => document.getElementById(id);
        this.form = $('import-form');
        this.file = $('import-file');
        this.status = $('import-status');
        this.result = $('import-result');
        this.reset();
        this.form.addEventListener('submit', (event) => { event.preventDefault(); this.analyse(); });
        this.result.addEventListener('change', (event) => {
            const box = event.target.closest('[data-pick]');
            if (box) { this.entries[Number(box.dataset.pick)].picked = box.checked; this.renderSummary(); }
        });
        this.result.addEventListener('click', (event) => {
            if (event.target.closest('[data-propose]')) this.propose(event.target.closest('[data-propose]'));
        });
    }

    reset() {
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

    add(candidates) {
        const seen = new Set(this.entries.map((e) => e.hanzi.replace(/\s+/g, '')));
        candidates.forEach((c) => {
            const key = c.hanzi.replace(/\s+/g, '');
            if (c.state === 'new' && seen.has(key)) c.state = 'duplicate';
            seen.add(key);
            this.entries.push({ ...c, picked: c.state === 'new' });
        });
    }

    async analyse() {
        const file = this.file.files[0];
        if (!file) return;
        this.reset();
        const button = this.form.querySelector('button');
        await AdditionList.whileBusy(button, 'Lecture…', async () => {
            try {
                const body = new FormData();
                body.append('file', file);
                const data = await this.post('/api/import/analyse', body);
                this.doc = data;
                if (data.kind === 'table') {
                    this.add(data.candidates);
                    this.setStatus(`Tableau lu${data.used_ai ? ' (colonnes reconnues par l’IA)' : ' sans IA'} : ${data.candidates.length} entrée(s).`);
                    this.render();
                    return;
                }
                if (!data.chunks) {
                    this.setStatus('Aucun mot nouveau à lire dans ce texte (pas de caractères chinois inconnus du lexique).');
                    return;
                }
                if (!data.ai_enabled) {
                    this.setStatus('Ce texte doit être lu par l’IA, qui n’est pas configurée sur ce serveur.', true);
                    return;
                }
                for (let n = 0; n < data.chunks; n += 1) {
                    this.setStatus(`L’IA lit le texte : partie ${n + 1} sur ${data.chunks}…`);
                    const part = await this.post(`/api/import/${data.document}/extraire`, { chunk: n });
                    this.add(part.candidates);
                    this.render();
                }
                this.setStatus(`Texte lu par l’IA (${data.chunks} partie${data.chunks > 1 ? 's' : ''}${data.truncated ? ', début du texte seulement' : ''}) : ${this.entries.length} entrée(s).`);
                this.render();
            } catch (err) {
                this.setStatus(`Échec : ${err.message}`, true);
            }
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
    }

    render() {
        const esc = AdditionList.escapeHtml;
        if (!this.entries.length) { this.result.innerHTML = ''; return; }
        this.result.innerHTML = `
            <div class="vt-import-summary"><span data-summary></span>
              <button type="button" class="saisie-btn saisie-btn-lg saisie-btn-review" data-propose></button></div>
            <div class="vt-wrap"><table class="vt-table vt-import-table no-auto-csv">
              <thead><tr><th class="vt-check"><span class="sr-only">Proposer</span></th><th class="vt-hk">Caractères</th><th class="vt-hk">Lecture</th>
                <th>Français</th><th class="vt-who">Origine</th><th>État</th></tr></thead>
              <tbody>${this.entries.map((e, i) => `<tr class="${e.state === 'new' ? '' : 'is-off'}">
                <td class="vt-check"><input type="checkbox" data-pick="${i}" ${e.picked ? 'checked' : ''} ${e.state === 'new' ? '' : 'disabled'}
                    aria-label="Proposer ${esc(e.hanzi)}"></td>
                <td class="hanzi vt-hanzi">${esc(e.hanzi)}</td>
                <td class="vt-pinyin">${e.reading ? esc(AdditionList.displayPinyin(e.reading)) : `<i>${esc(e.pinyin) || '—'}</i>`}
                    ${e.reading_note ? `<div class="vt-warn">⚠ ${esc(e.reading_note)}</div>` : ''}</td>
                <td class="vt-french">${esc(e.french) || '<i>—</i>'}${e.translated ? ' <span class="vt-ai-badge">traduit IA</span>' : ''}
                    ${e.english ? `<div class="vt-sub italic">${esc(e.english)}</div>` : ''}</td>
                <td class="vt-meta vt-who">${esc(e.location)}</td>
                <td><span class="vt-state vt-state-${esc(e.state)}">${esc(DocumentImport.STATES[e.state] || e.state)}</span></td>
              </tr>`).join('')}</tbody></table></div>`;
        this.renderSummary();
    }

    async propose(button) {
        const entries = this.entries.filter((e) => e.picked).map((e) => ({
            hanzi: e.hanzi, pinyin: e.pinyin || e.reading || '', french: e.french || '', english: e.english || '',
            themes: e.themes || '', location: e.location || '', translated: !!e.translated,
        }));
        if (!entries.length || !this.doc) return;
        await AdditionList.whileBusy(button, 'Envoi…', async () => {
            try {
                const data = await this.post(`/api/import/${this.doc.document}/proposer`, { entries });
                data.additions.forEach((a) => this.table.additions.unshift(a));
                this.table.render();
                this.table.flash(data.additions.map((a) => a.id));
                const n = data.additions.length;
                this.setStatus(`✓ ${n} mot${n > 1 ? 's' : ''} proposé${n > 1 ? 's' : ''} à la validation${data.skipped ? ` (${data.skipped} ignoré${data.skipped > 1 ? 's' : ''} : déjà connus)` : ''}.`);
                this.reset();
                this.form.reset();
            } catch (err) {
                this.setStatus(`Échec : ${err.message}`, true);
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('validation-page');
    if (!root) return;
    const $ = (id) => document.getElementById(id);
    const table = new ValidationTable({
        list: $('validation-rows'), search: $('saisie-search'), filters: $('saisie-filters'),
        all: $('validation-all'), bar: $('validation-bar'), count: $('validation-count'), status: $('validation-status'),
        filter: 'review', empty: 'Rien à afficher ici.',
        onEdit: (a) => { window.location.href = `${root.dataset.saisieUrl}?modifier=${a.id}`; },
    });
    window.validationTable = table;
    table.load();
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
