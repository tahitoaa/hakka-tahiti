/* =========================================================================
   Caractères — every lexicon reading (views.caracters' JSON payload),
   as a filterable list grouped by syllable (or by character for 多音字)
   plus a statistics tab. Every chart element filters the list.
   Pinyin goes through Pronunciation.span(), so it follows the header's
   transcription menu without re-rendering (Romanization.refresh()).
   ========================================================================= */
(function () {
    const DATA = JSON.parse(document.getElementById('caracters-data').textContent);
    const HANZI_URL = DATA.hanzi_url;
    const READINGS = DATA.readings.map(([id, simp, trad, initial, final, tone, words]) => ({
        id, simp, trad: trad || simp, initial, final, tone, words,
        syllable: initial + final,
        key: initial + final + (tone ?? ''),
        examples: DATA.examples[id] || [],
    }));
    const USAGE_BUCKETS = [
        { label: '1', min: 1, max: 1 }, { label: '2', min: 2, max: 2 }, { label: '3', min: 3, max: 3 },
        { label: '4', min: 4, max: 4 }, { label: '5', min: 5, max: 5 },
        { label: '6–10', min: 6, max: 10 }, { label: '11+', min: 11, max: Infinity },
    ];
    const byHanzi = groupBy(READINGS, (r) => r.simp);
    const bySyllable = groupBy(READINGS, (r) => r.syllable);
    const polyHanzi = new Set([...byHanzi].filter(([, rs]) => rs.length > 1).map(([h]) => h));

    const state = { search: '', tone: 'all', poly: false, sort: 'syllable', filter: null };
    const $ = (id) => document.getElementById(id);

    // ---- helpers -------------------------------------------------------

    function groupBy(items, keyOf) {
        const map = new Map();
        items.forEach((item) => {
            const key = keyOf(item);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(item);
        });
        return map;
    }

    function escapeHtml(text) {
        return String(text ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        })[c]);
    }

    function showingTrad() {
        return document.getElementById('toggle-hanzi')?.getAttribute('aria-pressed') === 'true';
    }

    /** Same simp/trad markup as components/hanzi_block.html, so the header's
     *  Trad./Simp. button also flips what's already rendered. */
    function hanziBlock(r) {
        const trad = showingTrad();
        return `<span class="hanzi-block"><span class="simp${trad ? ' hidden' : ''}">${escapeHtml(r.simp)}</span>`
            + `<span class="trad${trad ? '' : ' hidden'}">${escapeHtml(r.trad)}</span></span>`;
    }

    function hanziUrl(simp) {
        return HANZI_URL.replace('__HANZI__', encodeURIComponent(simp));
    }

    function pinyinText(stored) {
        return Pronunciation.formatStored(stored);
    }

    function fold(text) {
        return String(text || '').normalize('NFD').replace(/\p{M}/gu, '')
            .replace(/[¹²³⁴⁵⁶⁷⁸]/g, (c) => '¹²³⁴⁵⁶⁷⁸'.indexOf(c) + 1).toLowerCase();
    }

    function percent(n, total) {
        return `${Math.round((100 * n) / total)} %`;
    }

    // ---- filtering -----------------------------------------------------

    function matchesSearch(r, q) {
        if (!q) return true;
        if (/\p{Script=Han}/u.test(q)) return [...q].some((c) => c === r.simp || c === r.trad);
        const display = fold(Romanization.fromPinyin ? Romanization.fromPinyin(r.key) : r.key);
        if (/\d$/.test(q)) return r.key === q || display === q;
        return r.syllable.startsWith(q) || display.replace(/\d/g, '').startsWith(q);
    }

    function visibleReadings() {
        const q = fold(state.search.trim()).replace(/\s+/g, '');
        const f = state.filter;
        return READINGS.filter((r) => {
            if (state.tone !== 'all' && String(r.tone ?? '') !== state.tone) return false;
            if (state.poly && !polyHanzi.has(r.simp)) return false;
            if (f?.type === 'syllable' && r.syllable !== f.value) return false;
            if (f?.type === 'usage' && (r.words < f.min || r.words > f.max)) return false;
            return matchesSearch(r, q);
        });
    }

    // ---- list ----------------------------------------------------------

    function tile(r, { withPinyin = true } = {}) {
        return `<a class="car-tile" href="${hanziUrl(r.simp)}" data-tip="reading" data-id="${r.id}">`
            + `<span class="car-n" aria-label="${r.words} mots">${r.words}</span>`
            + `<span class="hanzi">${hanziBlock(r)}</span>`
            + (withPinyin ? Pronunciation.span(r.key, 'car-py') : '')
            + `</a>`;
    }

    function row(labelHtml, items) {
        return `<div class="car-row"><div class="car-row-label">${labelHtml}</div>`
            + `<div class="car-tiles">${items.map((r) => tile(r)).join('')}</div></div>`;
    }

    function renderList() {
        const items = visibleReadings();
        const chars = new Set(items.map((r) => r.simp)).size;
        $('car-count').textContent = items.length
            ? `${items.length} lecture${items.length > 1 ? 's' : ''} · ${chars} caractère${chars > 1 ? 's' : ''}`
            : '';

        let html;
        if (!items.length) {
            html = '<p class="text-sm text-gray-500 py-4">Aucun caractère ne correspond.</p>';
        } else if (state.poly) {
            // 多音字: one row per character, its readings side by side.
            const groups = [...groupBy(items, (r) => r.simp)];
            if (state.sort === 'usage') groups.sort((a, b) => sum(b[1]) - sum(a[1]));
            html = `<div class="car-groups">${groups.map(([, rs]) => row(`<span class="hanzi text-xl">${hanziBlock(rs[0])}</span>`, rs)).join('')}</div>`;
        } else if (state.sort === 'usage') {
            html = `<div class="car-tiles">${[...items].sort((a, b) => b.words - a.words).map((r) => tile(r)).join('')}</div>`;
        } else {
            html = `<div class="car-groups">${[...groupBy(items, (r) => r.syllable)]
                .map(([syllable, rs]) => row(
                    Pronunciation.span(syllable),
                    [...rs].sort((a, b) => (a.tone ?? 9) - (b.tone ?? 9) || b.words - a.words),
                ))
                .join('')}</div>`;
        }
        $('car-list').innerHTML = html;
        renderActiveFilter();
    }

    function sum(rs) {
        return rs.reduce((n, r) => n + r.words, 0);
    }

    function renderToneChips() {
        const counts = groupBy(READINGS, (r) => String(r.tone ?? ''));
        const tones = [...counts.keys()].sort((a, b) => (a || '9').localeCompare(b || '9'));
        $('car-tones').innerHTML = [['all', 'Tous'], ...tones.map((t) => [t, t || 'sans'])]
            .map(([value, label]) => `<button type="button" class="car-chip min-h-9 min-w-9 px-2.5 rounded-full border border-gray-300" `
                + `data-tone="${value}" aria-pressed="${state.tone === value}">${label}</button>`)
            .join('');
    }

    function renderActiveFilter() {
        const f = state.filter;
        $('car-active-filter').innerHTML = f
            ? `<button type="button" id="car-clear-filter" class="car-chip min-h-9 px-3 rounded-full border ml-2" aria-pressed="true" title="Retirer ce filtre">${f.label} ✕</button>`
            : '';
    }

    // ---- key figures ---------------------------------------------------

    function renderKpis() {
        const singleUse = READINGS.filter((r) => r.words === 1).length;
        const kpis = [
            [byHanzi.size, 'caractères'],
            [READINGS.length, 'lectures'],
            [polyHanzi.size, '多音字 à plusieurs lectures'],
            [bySyllable.size, 'syllabes (sans ton)'],
            [percent(singleUse, READINGS.length), `des lectures dans un seul mot (${singleUse})`],
        ];
        $('car-kpis').innerHTML = kpis.map(([value, label]) =>
            `<div class="bg-white rounded-xl border border-gray-200 shadow-sm px-3 py-2">`
            + `<div class="font-display text-2xl font-bold text-gray-900 tabular-nums">${value}</div>`
            + `<div class="text-xs text-gray-600 leading-tight">${label}</div></div>`).join('');
    }

    // ---- charts --------------------------------------------------------

    function columns(container, bars) {
        const max = Math.max(1, ...bars.map((b) => b.value));
        container.innerHTML = `<div class="car-cols">${bars.map((b, i) =>
            `<button type="button" class="car-col" data-bar="${i}" data-tip="bar" aria-label="${escapeHtml(b.aria)}">`
            + `<span class="car-val">${b.value}</span>`
            + `<span class="car-mark" style="height:${(100 * b.value) / max}%"></span></button>`).join('')}</div>`
            + `<div class="car-col-labels">${bars.map((b) => `<span>${b.label}</span>`).join('')}</div>`;
        bind(container, bars);
    }

    function hbars(container, bars) {
        const max = Math.max(1, ...bars.map((b) => b.value));
        container.innerHTML = bars.map((b, i) => {
            const tag = b.href ? 'a' : 'button';
            const attrs = b.href ? `href="${b.href}"` : 'type="button"';
            return `<${tag} ${attrs} class="car-hbar" data-bar="${i}" data-tip="bar" aria-label="${escapeHtml(b.aria)}">`
                + `<span class="car-lab">${b.label}</span>`
                + `<span class="car-track"><span class="car-mark" style="display:block;width:${(100 * b.value) / max}%"></span></span>`
                + `<span class="car-val">${b.value}</span></${tag}>`;
        }).join('');
        bind(container, bars);
    }

    /** Hover/focus tooltip + click action for a chart's bars. */
    function bind(container, bars) {
        container._bars = bars;
        container.addEventListener('click', (event) => {
            const el = event.target.closest('[data-bar]');
            const bar = el && bars[el.dataset.bar];
            if (bar?.onClick) bar.onClick();
        });
    }

    function applyFilter(changes) {
        Object.assign(state, changes);
        renderToneChips();
        renderList();
        selectTab('list');
        $('car-panel-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderCharts() {
        const total = READINGS.length;

        const tones = [...groupBy(READINGS, (r) => String(r.tone ?? ''))]
            .sort(([a], [b]) => (a || '9').localeCompare(b || '9'));
        columns($('car-chart-tones'), tones.map(([tone, rs]) => ({
            label: tone ? `ton ${tone}` : 'sans ton',
            value: rs.length,
            aria: `Ton ${tone || 'non noté'} : ${rs.length} lectures`,
            tip: `<b>${tone ? `Ton ${tone}` : 'Sans ton'}</b><br>${rs.length} lectures (${percent(rs.length, total)})`,
            onClick: () => applyFilter({ tone, filter: null }),
        })));

        columns($('car-chart-usage'), USAGE_BUCKETS.map((b) => {
            const n = READINGS.filter((r) => r.words >= b.min && r.words <= b.max).length;
            const label = `${b.label} mot${b.min > 1 ? 's' : ''}`;
            return {
                label: b.label, value: n,
                aria: `${n} lectures présentes dans ${label}`,
                tip: `<b>${n} lectures</b> (${percent(n, total)})<br>présentes dans ${label}`,
                onClick: () => applyFilter({ filter: { type: 'usage', min: b.min, max: b.max, label: `Dans ${label}` } }),
            };
        }));

        hbars($('car-chart-top'), [...READINGS].sort((a, b) => b.words - a.words).slice(0, 20).map((r) => ({
            label: `<span class="hanzi">${hanziBlock(r)}</span> ${Pronunciation.span(r.key, 'text-gray-500 text-xs')}`,
            value: r.words,
            href: hanziUrl(r.simp),
            aria: `${r.simp} ${pinyinText(r.key)} : ${r.words} mots`,
            tip: readingTip(r),
        })));

        const homophones = [...bySyllable]
            .map(([syllable, rs]) => ({ syllable, chars: [...new Set(rs.map((r) => r.simp))] }))
            .sort((a, b) => b.chars.length - a.chars.length || a.syllable.localeCompare(b.syllable))
            .slice(0, 15);
        hbars($('car-chart-homophones'), homophones.map(({ syllable, chars }) => ({
            label: Pronunciation.span(syllable),
            value: chars.length,
            aria: `${pinyinText(syllable)} : ${chars.length} caractères`,
            tip: `<b>${escapeHtml(pinyinText(syllable))}</b> · ${chars.length} caractères<br><span class="hanzi">${escapeHtml(chars.join(' '))}</span>`,
            onClick: () => applyFilter({ filter: { type: 'syllable', value: syllable, label: `Syllabe ${escapeHtml(pinyinText(syllable))}` } }),
        })));

    }

    // ---- tooltip -------------------------------------------------------

    const READING_BY_ID = new Map(READINGS.map((r) => [String(r.id), r]));

    function readingTip(r) {
        const examples = r.examples.map(([hanzi, french]) =>
            `<span class="hanzi">${escapeHtml(hanzi)}</span> ${escapeHtml(french)}`).join('<br>');
        return `<span class="hanzi">${escapeHtml(r.simp)}</span> <b>${escapeHtml(pinyinText(r.key))}</b>`
            + ` · ${r.words} mot${r.words > 1 ? 's' : ''}`
            + (polyHanzi.has(r.simp) ? `<br><i>autres lectures : ${byHanzi.get(r.simp).filter((o) => o !== r).map((o) => escapeHtml(pinyinText(o.key))).join(', ')}</i>` : '')
            + (examples ? `<br>${examples}` : '')
            + (typeof HanziInfo !== 'undefined' && HanziInfo.html(r.simp) ? `<br>${HanziInfo.html(r.simp)}` : '');
    }

    function tipFor(el) {
        if (el.dataset.tip === 'reading') return readingTip(READING_BY_ID.get(el.dataset.id));
        const bars = el.closest('[id^="car-chart"]')?._bars;
        return bars?.[el.dataset.bar]?.tip || '';
    }

    function setupTooltip() {
        if (typeof HanziInfo !== 'undefined') HanziInfo.load();
        const tip = $('car-tooltip');
        const show = (el) => {
            const html = tipFor(el);
            if (!html) return;
            tip.innerHTML = html;
            tip.hidden = false;
            const box = el.getBoundingClientRect();
            const w = tip.offsetWidth;
            const h = tip.offsetHeight;
            const left = Math.min(Math.max(8, box.left + box.width / 2 - w / 2), window.innerWidth - w - 8);
            const top = box.top - h - 8 >= 8 ? box.top - h - 8 : box.bottom + 8;
            tip.style.left = `${left}px`;
            tip.style.top = `${top}px`;
        };
        const hide = () => { tip.hidden = true; };
        ['mouseover', 'focusin'].forEach((type) => document.addEventListener(type, (event) => {
            const el = event.target.closest?.('[data-tip]');
            if (el) show(el);
        }));
        ['mouseout', 'focusout'].forEach((type) => document.addEventListener(type, (event) => {
            if (event.target.closest?.('[data-tip]')) hide();
        }));
        window.addEventListener('scroll', hide, { passive: true });
    }

    // ---- tabs & controls -----------------------------------------------

    function selectTab(name) {
        document.querySelectorAll('.car-tab').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.tab === name)));
        $('car-panel-list').hidden = name !== 'list';
        $('car-panel-stats').hidden = name !== 'stats';
        try { localStorage.setItem('caracters-tab', name); } catch (e) { /* private mode */ }
        // #stats makes the statistics tab linkable.
        history.replaceState(null, '', name === 'stats' ? '#stats' : location.pathname + location.search);
    }

    function bindControls() {
        let timer;
        $('car-search').addEventListener('input', (event) => {
            clearTimeout(timer);
            timer = setTimeout(() => { state.search = event.target.value; renderList(); }, 120);
        });
        $('car-sort').addEventListener('change', (event) => { state.sort = event.target.value; renderList(); });
        $('car-poly').addEventListener('click', (event) => {
            state.poly = !state.poly;
            event.currentTarget.setAttribute('aria-pressed', String(state.poly));
            renderList();
        });
        $('car-tones').addEventListener('click', (event) => {
            const btn = event.target.closest('[data-tone]');
            if (!btn) return;
            state.tone = btn.dataset.tone;
            renderToneChips();
            renderList();
        });
        $('car-active-filter').addEventListener('click', () => { state.filter = null; renderList(); });
        document.querySelectorAll('.car-tab').forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));
    }

    document.addEventListener('DOMContentLoaded', () => {
        renderKpis();
        renderToneChips();
        renderList();
        renderCharts();
        bindControls();
        setupTooltip();
        let tab = location.hash === '#stats' ? 'stats' : 'list';
        if (!location.hash) {
            try { tab = localStorage.getItem('caracters-tab') || 'list'; } catch (e) { /* private mode */ }
        }
        selectTab(tab === 'stats' ? 'stats' : 'list');
    });
})();
