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
    // Each character with its syllable (rey.align), or why it gives none.
    const charsLine = (chars) => (chars
        ? `<div class="lk-align">${chars.map(([c, r]) => `<span><a class="hanzi" href="/hanzi/${encodeURIComponent(c)}/">${esc(c)}</a> ${esc(r)}</span>`).join('')}</div>`
        : '<div class="lk-align lk-noalign" title="Pas autant de syllabes que de caractères (ou syllabe du caractère de tête différente) : aucune lecture de caractère retenue">⚠ non aligné</div>');
    function entriesTable(entries, chars = []) {
        if (!entries.length) return '<p class="text-sm text-gray-500">Aucun caractère relevé sur cette page.</p>';
        const KIND = { 'caractère': '字 caractère', mot: 'mot', expression: 'expression' };
        return `<div class="sx-wrap"><table class="sx-table lk-entries"><thead><tr><th>Caractères</th><th>Lecture (Rey)</th><th>Français</th><th>Type</th></tr></thead>
            <tbody>${entries.map((e, k) => `<tr class="${e.kind === 'caractère' ? 'lk-head' : ''}">
              <td class="sx-char"><a class="hanzi" href="/hanzi/${encodeURIComponent([...e.hanzi][0])}/">${esc(e.hanzi)}</a>
                ${e.kind === 'caractère' ? '' : charsLine(chars[k])}</td>
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
            if (body && d.read) body.innerHTML = entriesTable(d.entries, d.chars);
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
                    card.querySelector('[data-rey-body]').innerHTML = entriesTable(d.entries, d.chars);
                } catch (err) {
                    $('rey-status').textContent = `Échec : ${err.message}`;
                }
            });
        }
    });

    // ---- 🔎 hakkadictionary.com ------------------------------------------------------------
    // One character, typed as such or picked from its reading (pinyin, as in Saisie): the
    // lexicon's reading first, then the other Hakka sources, then Mandarin. Shown simplified
    // and traditional before the search (the site wants the traditional one).
    const SUP = '⁰¹²³⁴⁵⁶⁷⁸';
    const foldR = (t) => String(t || '').toLowerCase()
        .replace(/[⁰¹²³⁴⁵⁶⁷⁸]/g, (c) => String(SUP.indexOf(c)))
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/’/g, "'").trim();
    const HAN = /[\u3400-\u9fff\u{20000}-\u{2ffff}]/u;
    const hdx = { simp: null, trad: null, list: [] };
    const rows = () => window.sxData?.rows || [];
    const srcShort = (id) => (window.sxData?.sources || []).find((s) => s.id === id)?.short || id;

    function candidates(typed) {
        const f = foldR(typed).replace(/\s+/g, '');
        if (!f) return [];
        const toned = /\d$/.test(f);
        const base = f.replace(/\d+$/, '');
        const hit = (reading) => {
            const r = foldR(reading);
            return toned ? r === f : r.replace(/\d+$/, '') === base;
        };
        const words = (t) => String(t || '').split(/[\s,/;]+/).filter(Boolean);
        const out = [];
        for (const r of rows()) {
            const [simp, trad, wenfa, guess, mandarin] = r;
            let found = null;
            const w = words(wenfa).find(hit);
            if (w) found = { rank: 0, reading: w, src: 'Lexique' };
            else if (words(guess).find(hit)) found = { rank: 1, reading: words(guess).find(hit), src: 'déduit' };
            else {
                const srcs = Object.entries(r[7] || {}).filter(([, list]) => list.some(([rd]) => hit(rd)));
                if (srcs.length) {
                    found = { rank: 2 - Math.min(srcs.length, 9) / 10, reading: srcs[0][1].find(([rd]) => hit(rd))[0],
                              src: srcs.map(([id]) => srcShort(id)).join(', ') };
                } else if (!toned && words(mandarin).find(hit)) {
                    found = { rank: 3, reading: words(mandarin).find(hit), src: 'mandarin' };
                }
            }
            if (found) out.push({ simp, trad: trad || simp, ...found });
        }
        return out.sort((a, b) => a.rank - b.rank).slice(0, 60);
    }

    function renderChosen() {
        const box = $('hdx-chosen');
        if (!hdx.simp) { box.hidden = true; return; }
        box.hidden = false;
        box.innerHTML = `<span>Simplifié <span class="hanzi">${esc(hdx.simp)}</span></span>
            <span>Traditionnel <span class="hanzi">${esc(hdx.trad)}</span></span>
            <span>→ recherche de <b class="hanzi">${esc(hdx.trad)}</b>${hdx.trad === hdx.simp ? ' (même forme)' : ''}</span>`;
    }
    function choose(simp, trad) {
        hdx.simp = simp;
        hdx.trad = trad || simp;
        $('hdx-pick').querySelectorAll('[data-hdx-simp]').forEach((b) =>
            b.setAttribute('aria-selected', String(b.dataset.hdxSimp === simp && b.dataset.hdxTrad === hdx.trad)));
        renderChosen();
    }
    /** A character typed: its two forms, from the table (else as typed). */
    function fromChar(ch) {
        const row = rows().find((r) => r[0] === ch) || rows().find((r) => r[1] === ch);
        return row ? [row[0], row[1] || row[0]] : [ch, ch];
    }
    function onType() {
        const input = $('hdx-q');
        const pick = $('hdx-pick');
        const chars = [...input.value].filter((c) => HAN.test(c));
        if (chars.length) {
            // A single character: the first one typed or pasted.
            if (input.value !== chars[0]) input.value = chars[0];
            pick.innerHTML = '';
            choose(...fromChar(chars[0]));
            return;
        }
        hdx.simp = hdx.trad = null;
        renderChosen();
        if (!input.value.trim()) { pick.innerHTML = ''; return; }
        if (!rows().length) { pick.innerHTML = '<span class="sx-legend">Chargement des lectures…</span>'; return; }
        hdx.list = candidates(input.value);
        pick.innerHTML = hdx.list.length
            ? hdx.list.map((c) => `<button type="button" class="sx-chip hdx-cand" role="option" aria-selected="false"
                data-hdx-simp="${esc(c.simp)}" data-hdx-trad="${esc(c.trad)}" title="${esc(c.src)}">
                <span class="hanzi">${esc(c.simp)}</span>${c.trad !== c.simp ? `<span class="hanzi">${esc(c.trad)}</span>` : ''}
                <small>${esc(c.reading)} · ${esc(c.src)}</small></button>`).join('')
            : '<span class="sx-legend">Aucun caractère pour cette lecture.</span>';
        if (hdx.list.length === 1) choose(hdx.list[0].simp, hdx.list[0].trad);
    }
    $('hdx-q')?.addEventListener('input', onType);
    document.addEventListener('sx-data', () => { if ($('hdx-q')?.value) onType(); });
    $('hdx-pick')?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-hdx-simp]');
        if (b) choose(b.dataset.hdxSimp, b.dataset.hdxTrad);
    });

    async function searchHd() {
        if (!hdx.simp) {
            $('hdx-result').innerHTML = $('hdx-q').value.trim()
                ? '<p class="text-sm text-gray-600">Choisissez d’abord un caractère dans la liste.</p>' : '';
            return;
        }
        const q = hdx.trad;
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
