/* =========================================================================
   « Relecture » tab of the lexicon browser (search.html), for editors:
   pick one word or expression of the lexicon, see its remarks, have the AI
   read it now, add your own remark, and decide on each pending one.

   Only existing, editor-only endpoints (assistant.py):
   - GET  /api/commentaires?scope=lexicon     the lexicon's remarks, muted items
   - POST /api/commentaires                   {target_type, target_id, text}
   - POST /api/ia/relire                      {target_type, ids: [id]}
   - POST /api/commentaires/<id>              {action: todo | wait | dismiss | done}
   - POST /api/ia/muet                        {target_type, target_id, muted}
   A lexicon remark is applied by hand on the e-reo platform: « À faire »
   puts it in the list of Suivi › Corrections e-reo.
   ========================================================================= */
(function () {
    const root = document.getElementById('lex-review');
    const dataEl = document.getElementById('lex-review-items');
    if (!root || !dataEl) return;

    const ITEMS = JSON.parse(dataEl.textContent);
    const TYPE_LABELS = { word: 'Mot', expression: 'Expression' };
    const STATUS_LABELS = { open: 'À traiter', todo: 'À faire (e-reo)', applied: 'Faite', dismissed: 'Écartée' };
    const MAX_RESULTS = 40;
    const $ = (sel) => root.querySelector(sel);
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[⁰¹²³⁴⁵⁶⁷⁸]/g, (c) => String('⁰¹²³⁴⁵⁶⁷⁸'.indexOf(c)));
    const csrf = () => decodeURIComponent((document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '');
    ITEMS.forEach((it) => { it.hay = fold([it.hanzi, it.pinyin, it.french, it.english, it.theme].join(' ')); });

    async function request(url, body) {
        const options = body === undefined ? {} : {
            method: 'POST', body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
        };
        const response = await fetch(url, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
        return data;
    }

    const state = { item: null, comments: null, muted: new Set(), aiEnabled: true, loading: null };
    const key = (type, id) => `${type}:${id}`;

    /** The lexicon's remarks, once (then kept up to date locally). */
    function loadComments() {
        if (!state.loading) {
            state.loading = request('/api/commentaires?scope=lexicon').then((data) => {
                state.comments = data.comments;
                state.muted = new Set(data.muted.map((m) => key(m.target_type, m.target_id)));
                state.aiEnabled = data.ai_enabled !== false;
            }).catch((err) => { state.loading = null; throw err; });
        }
        return state.loading;
    }

    // ---- choosing an item -------------------------------------------------------------------

    function renderResults() {
        const q = fold($('[data-lr="q"]').value.trim());
        const type = $('[data-lr="type"]').value;
        const box = $('[data-lr="results"]');
        if (!q) { box.innerHTML = ''; return; }
        const terms = q.split(/\s+/);
        const found = ITEMS.filter((it) => (!type || it.type === type) && terms.every((t) => it.hay.includes(t)));
        box.innerHTML = found.length
            ? found.slice(0, MAX_RESULTS).map((it) => `<button type="button" class="lr-result" data-lr-pick="${key(it.type, it.id)}">
                <span class="lr-type">${TYPE_LABELS[it.type]}</span><span class="hanzi">${esc(it.hanzi) || '—'}</span>
                <span class="lr-py">${esc(it.pinyin)}</span><span class="lr-fr">${esc(it.french)}</span></button>`).join('')
              + (found.length > MAX_RESULTS ? `<p class="lr-note">${found.length - MAX_RESULTS} autres : précisez la recherche.</p>` : '')
            : '<p class="lr-note">Aucun mot ni expression ne correspond.</p>';
    }

    async function pick(itemKey) {
        state.item = ITEMS.find((it) => key(it.type, it.id) === itemKey) || null;
        $('[data-lr="results"]').innerHTML = '';
        renderItem();
        if (!state.item) return;
        try {
            await loadComments();
        } catch (err) {
            $('[data-lr="status"]').textContent = `Remarques indisponibles : ${err.message}`;
        }
        renderItem();
    }

    // ---- the item and its remarks -----------------------------------------------------------

    function remarksOf(item) {
        return (state.comments || []).filter((c) => c.target_type === item.type && c.target_id === item.id);
    }

    function remarkHtml(c) {
        const pending = c.status === 'open' || c.status === 'todo';
        const correction = c.field && (c.current_value || c.proposed_value)
            ? `<div class="lr-diff"><span>${esc(c.field_label || c.field)}</span>
                 <del>${esc(c.current_value) || '∅'}</del> → <ins>${esc(c.proposed_value) || '∅'}</ins></div>` : '';
        const actions = !pending ? '' : `<div class="lr-actions">
            ${c.status === 'open' ? `<button type="button" class="sx-chip" data-lr-act="todo" title="À corriger à la main sur e-reo (Suivi › Corrections e-reo)">✓ À faire sur e-reo</button>`
                                  : `<button type="button" class="sx-chip" data-lr-act="done" title="Corrigée sur e-reo">✓ Faite</button>
                                     <button type="button" class="sx-chip" data-lr-act="wait">Remettre à traiter</button>`}
            <button type="button" class="sx-chip" data-lr-act="dismiss">✕ Écarter</button></div>`;
        return `<li class="lr-remark${pending ? '' : ' is-closed'}" data-lr-comment="${c.id}">
            <div class="lr-remark-head"><b>${c.by_ai ? '🤖 IA' : esc(c.author) || '—'}</b>
              <span class="lr-status lr-status-${esc(c.status)}">${esc(STATUS_LABELS[c.status] || c.status)}</span>
              <time datetime="${esc(c.created_at)}">${esc(new Date(c.created_at).toLocaleDateString('fr-FR'))}</time></div>
            ${correction}<p>${esc(c.text)}</p>${actions}</li>`;
    }

    function renderItem() {
        const box = $('[data-lr="item"]');
        const it = state.item;
        if (!it) { box.hidden = true; return; }
        box.hidden = false;
        const muted = state.muted.has(key(it.type, it.id));
        const remarks = state.comments ? remarksOf(it) : null;
        const pending = remarks ? remarks.filter((c) => c.status === 'open' || c.status === 'todo') : [];
        box.innerHTML = `
          <div class="lr-card">
            <div class="lr-card-head"><span class="lr-type">${TYPE_LABELS[it.type]}</span>
              <span class="hanzi lr-hanzi">${esc(it.hanzi) || '—'}</span><span class="lr-py">${esc(it.pinyin)}</span>
              <button type="button" class="sx-chip lr-close" data-lr-act="close" aria-label="Fermer">✕</button></div>
            <dl class="lr-fields"><dt>Français</dt><dd>${esc(it.french) || '<i>—</i>'}</dd>
              <dt>Anglais</dt><dd>${esc(it.english) || '<i>—</i>'}</dd>
              <dt>Thème</dt><dd>${esc(it.theme) || '<i>—</i>'}</dd></dl>
            <div class="lr-tools">
              <button type="button" class="sx-chip lr-ai" data-lr-act="ai" ${!state.aiEnabled || muted ? 'disabled' : ''}
                title="${muted ? 'L’IA ignore cet élément' : 'L’IA relit le français et l’anglais et laisse des remarques'}">✨ Relire avec l’IA</button>
              <label class="lr-mute" title="L’IA ne le relira plus (ni à la demande, ni la nuit)">
                <input type="checkbox" data-lr-act="mute" ${muted ? 'checked' : ''}> l’IA l’ignore</label>
              ${state.aiEnabled ? '' : '<span class="lr-note">IA non configurée sur ce serveur.</span>'}
            </div>
          </div>
          <form class="lr-add" data-lr="add">
            <label class="sr-only" for="lr-text">Votre remarque</label>
            <textarea id="lr-text" rows="2" maxlength="1000" placeholder="Votre remarque sur ${esc(it.hanzi)} (sens, traduction, orthographe…)"></textarea>
            <button type="submit" class="sx-chip">Ajouter la remarque</button>
          </form>
          <h3 class="lr-h">Remarques ${remarks ? `<small>${pending.length} en cours · ${remarks.length} en tout</small>` : ''}</h3>
          ${remarks === null ? '<p class="lr-note">Chargement…</p>'
            : remarks.length ? `<ul class="lr-remarks">${remarks.map(remarkHtml).join('')}</ul>`
            : '<p class="lr-note">Aucune remarque pour l’instant.</p>'}`;
    }

    const setStatus = (text) => { $('[data-lr="status"]').textContent = text; };

    async function act(action, target) {
        const it = state.item;
        if (action === 'close') { state.item = null; renderItem(); $('[data-lr="q"]').focus(); return; }
        if (action === 'ai') {
            target.disabled = true;
            target.textContent = 'L’IA relit…';
            setStatus('');
            try {
                const data = await request('/api/ia/relire', { target_type: it.type, ids: [it.id] });
                state.comments = [...data.comments, ...state.comments];
                setStatus(data.comments.length ? `L’IA a laissé ${data.comments.length} remarque${data.comments.length > 1 ? 's' : ''}.`
                    : 'L’IA n’a rien à signaler.');
            } catch (err) { setStatus(`Échec : ${err.message}`); }
            renderItem();
            return;
        }
        if (action === 'mute') {
            try {
                await request('/api/ia/muet', { target_type: it.type, target_id: it.id, muted: target.checked });
                if (target.checked) state.muted.add(key(it.type, it.id)); else state.muted.delete(key(it.type, it.id));
            } catch (err) { setStatus(`Échec : ${err.message}`); target.checked = !target.checked; }
            renderItem();
            return;
        }
        const li = target.closest('[data-lr-comment]');
        if (!li) return;
        target.disabled = true;
        try {
            const data = await request(`/api/commentaires/${li.dataset.lrComment}`, { action });
            state.comments = state.comments.map((c) => (c.id === data.comment.id ? data.comment : c));
            setStatus('');
        } catch (err) { setStatus(`Échec : ${err.message}`); }
        renderItem();
    }

    root.addEventListener('input', (e) => { if (e.target.matches('[data-lr="q"]')) renderResults(); });
    root.addEventListener('change', (e) => {
        if (e.target.matches('[data-lr="type"]')) renderResults();
        if (e.target.matches('[data-lr-act="mute"]')) act('mute', e.target);
    });
    root.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.matches('[data-lr="q"]')) {
            e.preventDefault();
            root.querySelector('[data-lr-pick]')?.click();
        }
    });
    root.addEventListener('click', (e) => {
        const chosen = e.target.closest('[data-lr-pick]');
        if (chosen) { pick(chosen.dataset.lrPick); return; }
        const button = e.target.closest('button[data-lr-act]');
        if (button) act(button.dataset.lrAct, button);
    });
    root.addEventListener('submit', async (e) => {
        if (!e.target.matches('[data-lr="add"]')) return;
        e.preventDefault();
        const textarea = e.target.querySelector('textarea');
        const text = textarea.value.trim();
        if (!text || !state.item) return;
        try {
            const data = await request('/api/commentaires', { target_type: state.item.type, target_id: state.item.id, text });
            state.comments = [data.comment, ...(state.comments || [])];
            setStatus('Remarque ajoutée.');
            renderItem();
        } catch (err) { setStatus(`Échec : ${err.message}`); }
    });
})();
