/* Dictionnaire des caractères: the two lookups in other dictionaries.
   - 📕 Rey 1926 (rey.py): a syllable -> Rey's pages (scans), each page read
     by the AI on request, once (kept).
   - 🔎 hakkadictionary.com (hakkadict.py): a character -> its readings,
     senses and the spoken words the dictionary quotes. */
(function () {
    const $ = (id) => document.getElementById(id);
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const csrf = () => (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
    async function request(url, method = 'GET') {
        const r = await fetch(url, { method, headers: method === 'POST' ? { 'X-CSRFToken': decodeURIComponent(csrf()) } : {} });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
        return data;
    }
    const busy = async (button, label, task) => {
        const text = button.innerHTML;
        button.disabled = true;
        button.innerHTML = label;
        try { await task(); } finally { button.disabled = false; button.innerHTML = text; }
    };

    // ---- 📕 Rey 1926 ----------------------------------------------------------------------
    const rey = { data: null, syllable: null };
    function entriesTable(entries) {
        if (!entries.length) return '<p class="text-sm text-gray-500">Aucun caractère relevé sur cette page.</p>';
        const KIND = { 'caractère': '字 caractère', mot: 'mot', expression: 'expression' };
        return `<div class="sx-wrap"><table class="sx-table lk-entries"><thead><tr><th>Caractères</th><th>Lecture (Rey)</th><th>Français</th><th>Type</th></tr></thead>
            <tbody>${entries.map((e) => `<tr class="${e.kind === 'caractère' ? 'lk-head' : ''}">
              <td class="sx-char"><a class="hanzi" href="/hanzi/${encodeURIComponent([...e.hanzi][0])}/">${esc(e.hanzi)}</a></td>
              <td>${esc(e.reading)}</td><td class="sx-en">${esc(e.french)}</td><td class="sx-legend">${esc(KIND[e.kind] || e.kind)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    function renderRey() {
        const box = $('rey-result');
        const d = rey.data;
        if (!d) { box.innerHTML = ''; return; }
        if (!d.matches.length) {
            box.innerHTML = `<p class="text-sm text-gray-600">Aucune syllabe de Rey pour « ${esc(d.q)} » (essayé : ${esc(d.spellings.join(', '))}).</p>`;
            return;
        }
        const current = d.matches.find((m) => m.syllable === rey.syllable) || d.matches[0];
        rey.syllable = current.syllable;
        box.innerHTML = `<div class="lk-chips">${d.matches.map((m) => `<button type="button" class="sx-chip" data-rey-syl="${esc(m.syllable)}"
                aria-pressed="${m.syllable === current.syllable}">${esc(m.syllable)} <small>${m.pages.length} p.</small></button>`).join('')}</div>
            <div class="lk-pages">${current.pages.map((p) => `<div class="lk-page" data-rey-image="${p.image}">
                <div class="lk-page-head"><b>p. ${p.page}</b>
                  <a href="${esc(p.url)}" target="_blank" rel="noopener" class="sx-chip">🖼 Ouvrir la page</a>
                  <button type="button" class="sx-chip" data-rey-show>👁 Voir ici</button>
                  ${p.read ? '<span class="lk-read">✓ caractères lus</span>'
                    : '<button type="button" class="sx-chip lk-ai" data-rey-read title="L’IA lit la page une fois ; le résultat est gardé">✨ Lire les caractères (IA)</button>'}</div>
                <div class="lk-page-body" data-rey-body></div></div>`).join('')}</div>`;
        // Pages already read: their entries, at once (no AI).
        current.pages.filter((p) => p.read).forEach((p) => loadEntries(p.image));
    }
    async function loadEntries(image) {
        const body = document.querySelector(`[data-rey-image="${image}"] [data-rey-body]`);
        try {
            const d = await request(`/api/rey/page/${image}`);
            if (body && d.read) body.innerHTML = entriesTable(d.entries);
        } catch (err) { if (body) body.textContent = `Échec : ${err.message}`; }
    }
    async function searchRey() {
        const q = $('rey-q').value.trim();
        if (!q) return;
        await busy($('rey-go'), 'Recherche…', async () => {
            try {
                rey.data = await request(`/api/rey?q=${encodeURIComponent(q)}`);
                rey.syllable = null;
                $('rey-status').textContent = rey.data.matches.length
                    ? `Orthographes essayées : ${rey.data.spellings.join(', ')}.` : '';
            } catch (err) {
                rey.data = null;
                $('rey-status').textContent = `Échec : ${err.message}`;
            }
            renderRey();
        });
    }
    $('rey-go')?.addEventListener('click', searchRey);
    $('rey-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchRey(); } });
    $('rey-result')?.addEventListener('click', async (e) => {
        const syl = e.target.closest('[data-rey-syl]');
        if (syl) { rey.syllable = syl.dataset.reySyl; renderRey(); return; }
        const card = e.target.closest('[data-rey-image]');
        if (!card) return;
        const image = Number(card.dataset.reyImage);
        const page = rey.data.matches.flatMap((m) => m.pages).find((p) => p.image === image);
        if (e.target.closest('[data-rey-show]')) {
            const shown = card.querySelector('.lk-scan');
            if (shown) shown.remove();
            else card.insertAdjacentHTML('beforeend', `<img class="lk-scan" src="${esc(page.url)}" alt="Page ${page.page} du dictionnaire de Rey" loading="lazy">`);
            return;
        }
        const read = e.target.closest('[data-rey-read]');
        if (read) {
            await busy(read, 'L’IA lit la page…', async () => {
                try {
                    const d = await request(`/api/rey/page/${image}`, 'POST');
                    rey.data.matches.forEach((m) => m.pages.forEach((p) => { if (p.image === image) p.read = true; }));
                    read.outerHTML = '<span class="lk-read">✓ caractères lus</span>';
                    card.querySelector('[data-rey-body]').innerHTML = entriesTable(d.entries);
                } catch (err) {
                    $('rey-status').textContent = `Échec : ${err.message}`;
                }
            });
        }
    });

    // ---- 🔎 hakkadictionary.com ------------------------------------------------------------
    async function searchHd() {
        const q = $('hdx-q').value.trim();
        if (!q) return;
        const box = $('hdx-result');
        await busy($('hdx-go'), 'Recherche…', async () => {
            try {
                const d = await request(`/api/hakkadict?q=${encodeURIComponent(q)}`);
                box.innerHTML = `${d.entries.map((e) => `<div class="hd-entry"><b>${esc(e.reading)}</b> ${esc((e.senses || []).join(' ; ') || e.text)}</div>`).join('')}
                    <p class="sx-legend">${d.words.length} mots parlés cités, ${d.words.filter((w) => !w.known).length} absents du lexique.
                      Pour en faire des suggestions : onglet <a class="underline" href="/suggestions-ia/">🤖 IA</a>.</p>
                    <div class="sx-wrap"><table class="sx-table"><thead><tr><th>Mot</th><th>Pinyin (déduit)</th><th>Sens (dictionnaire)</th><th>Lexique</th></tr></thead>
                    <tbody>${d.words.map((w) => `<tr><td class="sx-char"><span class="hanzi">${esc(w.hanzi)}</span>${w.trad !== w.hanzi ? `<small class="hanzi">${esc(w.trad)}</small>` : ''}</td>
                      <td>${esc(w.pinyin) || '<span class="sx-none">—</span>'}${w.note ? `<div class="sx-legend">${esc(w.note)}</div>` : ''}</td>
                      <td class="sx-en" lang="zh">${esc(w.definition)}</td><td>${w.known ? '✓ connu' : 'nouveau'}</td></tr>`).join('')}</tbody></table></div>`;
            } catch (err) {
                box.textContent = `Échec : ${err.message}`;
            }
        });
    }
    $('hdx-go')?.addEventListener('click', searchHd);
    $('hdx-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchHd(); } });
})();
