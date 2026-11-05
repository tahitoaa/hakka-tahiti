/* « 🛠 Corrections e-reo », the step after « Validés » on the Suivi page:
   the remarks on entries already in the lexicon (platform_corrections.py),
   loaded on demand, each moved En attente -> À faire -> Fait (or Rejetée). */
const EreoCorrections = (() => {
    const URL_ = '/corrections-ereo/?fragment=1';
    const NEXT = { todo: 'todo', done: 'fait', wait: 'attente', dismiss: 'rejete' };
    const SAID = { todo: '📌 Passée à « À faire ».', done: '✓ Marquée faite sur e-reo.', wait: '🕓 Remise en attente.', dismiss: '✕ Rejetée.' };
    let box = null;
    let step = null;
    let onCount = () => {};

    const q = (sel) => box.querySelector(sel);
    const items = () => [...box.querySelectorAll('.pc-item')];
    const shown = () => items().filter((el) => el.dataset.status === step);
    const say = (text) => { const s = q('[data-pc-status]'); if (s) s.textContent = text; };

    function render() {
        if (!q('[data-ereo-root]')) return;     // (still loading)
        box.querySelectorAll('[data-step]').forEach((b) => {
            b.setAttribute('aria-pressed', String(b.dataset.step === step));
            b.querySelector('[data-count]').textContent = items().filter((el) => el.dataset.status === b.dataset.step).length;
        });
        items().forEach((el) => {
            el.hidden = el.dataset.status !== step;
            el.querySelectorAll('[data-on]').forEach((x) => { x.hidden = !x.dataset.on.split(' ').includes(el.dataset.status); });
        });
        q('[data-pc-empty]').hidden = shown().length > 0;
        onCount(items().filter((el) => ['attente', 'todo'].includes(el.dataset.status)).length);
        const url = new URL(location.href);
        url.searchParams.set('etape', 'ereo');
        url.searchParams.set('statut', step);
        try { history.replaceState(null, '', url); } catch (e) { /* ignore */ }
    }

    async function load(message = '') {
        box.innerHTML = '<p class="vt-sub">Chargement…</p>';
        const r = await fetch(URL_, { headers: { 'X-Requested-With': 'fetch' } });
        box.innerHTML = r.ok ? await r.text() : `<p class="text-sm text-red-700">Échec du chargement (${r.status}).</p>`;
        const root = q('[data-ereo-root]');
        if (!root) return;
        step ||= new URLSearchParams(location.search).get('statut') || root.dataset.start;
        render();
        if (message) say(message);
    }

    async function onClick(e) {
        const stepBtn = e.target.closest('[data-step]');
        if (stepBtn) { step = stepBtn.dataset.step; say(''); render(); return; }
        if (e.target.closest('[data-pc-copy]')) {
            const label = q(`[data-step="${step}"] .st-name`).textContent;
            const text = shown().map((el, k) => `${k + 1}. ${el.dataset.instruction}`).join('\n');
            AdditionList.copy(`Corrections e-reo — ${label} (${shown().length})\n\n${text}`, e.target.closest('[data-pc-copy]'));
            return;
        }
        const review = e.target.closest('[data-pc-review]');
        if (review) {
            await AdditionList.whileBusy(review, 'L’IA relit…', async () => {
                try {
                    const data = await AdditionList.request('/api/ia/relire', { target_type: review.dataset.pcReview, next: true });
                    const n = data.comments.length;
                    step = 'attente';
                    await load(data.message || (n ? `🤖 ${n} nouvelle${n > 1 ? 's' : ''} remarque${n > 1 ? 's' : ''} (en attente).`
                        : '🤖 L’IA n’a rien à redire sur ces éléments.'));
                } catch (err) { say(`Échec : ${err.message}`); }
            });
            return;
        }
        const b = e.target.closest('[data-pc]');
        if (!b) return;
        const item = b.closest('.pc-item');
        const action = b.dataset.pc;
        if (action === 'copy') { AdditionList.copy(item.dataset.instruction, b); return; }
        b.disabled = true;
        try {
            if (action === 'mute') {
                const muted = b.dataset.muted !== 'true';
                await AdditionList.request('/api/ia/muet', {
                    target_type: item.dataset.targetType, target_id: Number(item.dataset.targetId), muted });
                // Every remark on that entry.
                box.querySelectorAll(`.pc-item[data-target-type="${item.dataset.targetType}"][data-target-id="${item.dataset.targetId}"] [data-pc="mute"]`)
                    .forEach((x) => { x.dataset.muted = String(muted); x.textContent = muted ? '🔔 Réactiver l’IA' : '🔕 Couper l’IA ici'; });
                say(muted ? '🔕 L’IA ne commentera plus cette entrée.' : '🔔 L’IA peut de nouveau la commenter.');
            } else {
                await AdditionList.request(`/api/commentaires/${item.dataset.id}`, { action });
                item.dataset.status = NEXT[action];
                render();
                say(SAID[action]);
            }
        } catch (err) {
            say(`Échec : ${err.message}`);
        } finally {
            b.disabled = false;
        }
    }

    return {
        /** Shows the panel in `el` (loaded the first time); `count(n)`: the open remarks. */
        show(el, count) {
            onCount = count || onCount;
            if (box === el) { render(); return; }
            box = el;
            box.addEventListener('click', onClick);
            load();
        },
    };
})();
