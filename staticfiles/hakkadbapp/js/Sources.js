/* =========================================================================
   🔎 Sources (sources.py): any button [data-sources="屋家"] (optional
   data-reading) opens a panel with what the sources say about that word:
   1. lines of the imported documents (free, always shown);
   2. the stored online lookup -- paragraphs in French, each with the exact
      passages it rests on and their links;
   3. the AI's own knowledge, apart, labelled "non sourcée".
   A new online lookup is only run on request ("Rechercher" / "Actualiser").
   ========================================================================= */
(function () {
    const API = '/api/sources';
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const csrf = () => (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';

    let dialog = null;
    function panel() {
        if (dialog) return dialog;
        dialog = document.createElement('dialog');
        dialog.className = 'src-dialog';
        dialog.setAttribute('aria-labelledby', 'src-title');
        dialog.innerHTML = `<div class="src-head"><h2 id="src-title"></h2>
            <button type="button" class="src-close" aria-label="Fermer">✕</button></div>
            <div class="src-body" aria-live="polite"></div>`;
        document.body.append(dialog);
        dialog.querySelector('.src-close').addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
        dialog.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-src-run]');
            if (btn) run(btn);
        });
        return dialog;
    }

    async function call(method, body, q) {
        const url = method === 'GET' ? `${API}?q=${encodeURIComponent(q)}` : API;
        const response = await fetch(url, method === 'GET' ? {} : {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': decodeURIComponent(csrf()) },
            body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
        return data;
    }

    function render(data, state) {
        const body = dialog.querySelector('.src-body');
        const docs = data.documents || [];
        const lookup = data.lookup;
        const parts = [];
        parts.push(`<section><h3>📄 Documents importés</h3>${docs.length
            ? `<ul class="src-list">${docs.map((d) => `<li><q>${esc(d.text)}</q>
                 <span class="src-meta">« ${esc(d.document)} », ${esc(d.location)}</span></li>`).join('')}</ul>`
            : '<p class="src-empty">Aucun document importé ne cite ce mot.</p>'}</section>`);
        if (lookup) {
            parts.push(`<section><h3>🌐 Sources en ligne</h3>${lookup.web?.length
                ? `<ul class="src-list">${lookup.web.map((p) => `<li><p>${esc(p.text)}</p>
                     <ul class="src-cites">${p.citations.map((c) => `<li><q lang="">${esc(c.cited_text)}</q>
                       ${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.domain || c.url)}</a>` : `<span class="src-meta">${esc(c.title)}</span>`}</li>`).join('')}</ul></li>`).join('')}</ul>`
                : '<p class="src-empty">Aucune source en ligne trouvée.</p>'}</section>`);
            if (lookup.ai?.length) {
                parts.push(`<section class="src-ai"><h3>🤖 Connaissance de l'IA <small>(non sourcée)</small></h3>
                    <ul class="src-list">${lookup.ai.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`);
            }
            const date = new Date(lookup.created_at).toLocaleDateString('fr-FR');
            parts.push(`<p class="src-foot">Recherche du ${date}${lookup.created_by ? ` par ${esc(lookup.created_by)}` : ''}
                · sources : ${esc((lookup.sites || []).join(', '))}
                ${data.ai_enabled ? `<button type="button" class="src-btn" data-src-run>Actualiser</button>` : ''}</p>`);
        } else if (data.ai_enabled) {
            parts.push(`<p class="src-foot">Pas encore de recherche en ligne pour ce mot.
                <button type="button" class="src-btn src-btn-main" data-src-run>🔎 Rechercher dans les sources</button>
                <span class="src-meta">quelques centimes, environ 20 à 40 secondes</span></p>`);
        }
        if (state) parts.push(`<p class="src-state">${esc(state)}</p>`);
        body.innerHTML = parts.join('');
    }

    let current = null;
    async function open(q, reading) {
        panel();
        current = { q, reading, data: null };
        dialog.querySelector('#src-title').innerHTML = `Sources pour <span class="hanzi">${esc(q)}</span>${reading ? ` <small>${esc(reading)}</small>` : ''}`;
        dialog.querySelector('.src-body').innerHTML = '<p class="src-state">Chargement…</p>';
        if (!dialog.open) dialog.showModal();
        try {
            current.data = await call('GET', null, q);
            render(current.data);
        } catch (err) {
            dialog.querySelector('.src-body').innerHTML = `<p class="src-state src-error">${esc(err.message)}</p>`;
        }
    }

    async function run(button) {
        if (!current || button.disabled) return;
        button.disabled = true;
        button.textContent = 'Recherche en cours…';
        try {
            current.data = await call('POST', { q: current.q, reading: current.reading });
            render(current.data);
        } catch (err) {
            render(current.data || { documents: [] }, `Échec : ${err.message}`);
        }
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-sources]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const q = btn.dataset.sources.replace(/\s+/g, '');
        if (q) open(q, btn.dataset.reading || '');
    }, true);
    window.HakkaSources = { open };
})();
