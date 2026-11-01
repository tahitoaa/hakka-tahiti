/* =========================================================================
   Phonèmes — initial x final table (cells shaded by number of characters),
   a per-syllable detail panel and a few statistics, all from the same
   reading payload as the Caractères page (views.caracters_data).
   Initials/finals/syllables are shown in the header menu's transcription
   system and re-rendered when it changes.
   ========================================================================= */
(function () {
    const DATA = JSON.parse(document.getElementById('phonemes-data').textContent);
    const READINGS = DATA.readings.map(([id, simp, trad, initial, final, tone]) => ({
        id, simp, trad: trad || simp, initial, final, tone,
        syllable: initial + final,
        key: initial + final + (tone ?? ''),
    }));
    // Phonetic order for the rows; anything else goes last, alphabetically.
    const INITIAL_ORDER = ['b', 'p', 'm', 'f', 'w', 'd', 't', 'n', 'l', 'z', 'c', 's', 'zh', 'ch', 'sh',
        'j', 'q', 'x', 'g', 'k', 'ng', 'h', 'y', ''];
    // Distinct characters per syllable -> ramp step (--ph-seq-* in the template).
    const STEPS = [
        { label: '1', min: 1, max: 1 }, { label: '2', min: 2, max: 2 }, { label: '3–4', min: 3, max: 4 },
        { label: '5–7', min: 5, max: 7 }, { label: '8+', min: 8, max: Infinity },
    ];
    const CHECKED = /[ptk]$/; // "entering tone" finals

    const rank = (i) => (INITIAL_ORDER.includes(i) ? INITIAL_ORDER.indexOf(i) : INITIAL_ORDER.length);
    const INITIALS = [...new Set(READINGS.map((r) => r.initial))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const FINALS = [...new Set(READINGS.map((r) => r.final))].sort();
    const TONES = [...new Set(READINGS.map((r) => String(r.tone ?? '')))].sort((a, b) => (a || '9').localeCompare(b || '9'));

    const state = { mode: 'syllable', tone: 'all', selected: null };
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

    function show(initial, final, tone = '') {
        const R = typeof Romanization !== 'undefined' && Romanization.systems().length ? Romanization : null;
        return R ? R.convert(initial, final, tone) : Pronunciation.formatStored(initial + final + tone);
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

    function uniqueChars(rs) {
        const seen = new Map();
        rs.forEach((r) => { if (!seen.has(r.simp)) seen.set(r.simp, r); });
        return [...seen.values()];
    }

    const step = (n) => STEPS.findIndex((s) => n >= s.min && n <= s.max) + 1;
    const percent = (n, total) => `${Math.round((100 * n) / total)} %`;

    function visibleReadings() {
        return state.tone === 'all' ? READINGS : READINGS.filter((r) => String(r.tone ?? '') === state.tone);
    }

    // ---- key figures ---------------------------------------------------

    function renderKpis() {
        const syllables = new Set(READINGS.map((r) => r.syllable));
        const withTone = new Set(READINGS.map((r) => r.key));
        const checked = [...syllables].filter((s) => CHECKED.test(s)).length;
        const possible = INITIALS.length * FINALS.length;
        const kpis = [
            [INITIALS.length, 'initiales'],
            [FINALS.length, 'finales'],
            [syllables.size, `syllabes attestées sur ${possible} combinaisons (${percent(syllables.size, possible)})`],
            [withTone.size, 'syllabes avec leur ton'],
            [checked, 'syllabes à finale -p, -t, -k'],
        ];
        $('ph-kpis').innerHTML = kpis.map(([value, label]) =>
            `<div class="bg-white rounded-xl border border-gray-200 shadow-sm px-3 py-2">`
            + `<div class="font-display text-2xl font-bold text-gray-900 tabular-nums">${value}</div>`
            + `<div class="text-xs text-gray-600 leading-tight">${label}</div></div>`).join('');
    }

    // ---- table ---------------------------------------------------------

    function renderTable() {
        const cells = groupBy(visibleReadings(), (r) => r.syllable);
        const table = $('ph-table');
        table.className = `ph-table no-auto-csv mode-${state.mode}`;

        const head = `<thead><tr><th scope="col">&nbsp;</th>${FINALS.map((f, c) =>
            `<th scope="col" data-col="${c}">${escapeHtml(f ? show('', f) : '∅')}</th>`).join('')}</tr></thead>`;
        const body = INITIALS.map((initial, row) => `<tr><th scope="row" data-row="${row}">${escapeHtml(initial ? show(initial, '') : '∅')}</th>${
            FINALS.map((final, col) => {
                const rs = cells.get(initial + final);
                if (!rs) return '<td></td>';
                const chars = uniqueChars(rs);
                const syllable = initial + final;
                let content;
                if (state.mode === 'count') content = String(chars.length);
                else if (state.mode === 'chars') content = `<span class="hanzi">${chars.map(hanziBlock).join('')}</span>`;
                else content = escapeHtml(show(initial, final));
                const selected = state.selected === syllable ? ' is-selected' : '';
                return `<td class="${selected}" data-step="${step(chars.length)}" style="background:var(--ph-seq-${step(chars.length)})">`
                    + `<button type="button" data-syllable="${escapeHtml(syllable)}" data-row="${row}" data-col="${col}" `
                    + `aria-label="${escapeHtml(show(initial, final))} : ${chars.length} caractère${chars.length > 1 ? 's' : ''}">${content}</button></td>`;
            }).join('')}</tr>`).join('');
        table.innerHTML = head + `<tbody>${body}</tbody>`;

        $('ph-legend').innerHTML = 'Caractères par syllabe :'
            + STEPS.map((s, i) => `<span><i style="background:var(--ph-seq-${i + 1})"></i>${s.label}</span>`).join('')
            + '<span><i style="background:var(--ph-empty);border:1px solid var(--ph-grid)"></i>absente</span>';
    }

    /** Crosshair: light up the row and column headers of the hovered cell. */
    function highlightHeaders(row, col) {
        $('ph-table').querySelectorAll('th.is-hot').forEach((th) => th.classList.remove('is-hot'));
        if (row === undefined) return;
        $('ph-table').querySelector(`tbody th[data-row="${row}"]`)?.classList.add('is-hot');
        $('ph-table').querySelector(`thead th[data-col="${col}"]`)?.classList.add('is-hot');
    }

    /** Scrolls the table so a row or column is in view and flashes its header. */
    function revealHeader(selector) {
        const th = $('ph-table').querySelector(selector);
        if (!th) return;
        $('ph-table').closest('.ph-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
        th.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        th.classList.add('is-hot');
        setTimeout(() => th.classList.remove('is-hot'), 1600);
    }

    // ---- detail panel --------------------------------------------------

    function renderDetail() {
        const panel = $('ph-detail');
        if (!state.selected) {
            panel.innerHTML = '<p class="text-sm text-gray-500">Touchez une case du tableau pour voir les caractères de la syllabe, ton par ton.</p>';
            return;
        }
        const rs = READINGS.filter((r) => r.syllable === state.selected);
        const { initial, final } = rs[0];
        const byTone = [...groupBy(rs, (r) => String(r.tone ?? ''))].sort(([a], [b]) => (a || '9').localeCompare(b || '9'));
        const url = DATA.syllable_url.replace('__SYLLABLE__', encodeURIComponent(state.selected));
        panel.innerHTML = `<div class="flex items-baseline justify-between gap-2 mb-2">`
            + `<h3 class="font-display text-2xl font-bold text-gray-900">${escapeHtml(show(initial, final))}</h3>`
            + `<span class="text-xs text-gray-500">${uniqueChars(rs).length} caractère${uniqueChars(rs).length > 1 ? 's' : ''}</span></div>`
            + byTone.map(([tone, trs]) => `<div class="ph-detail-tone"><span class="text-sm text-gray-600 pt-1">${escapeHtml(show(initial, final, tone))}</span>`
                + `<span class="hanzi text-xl">${trs.map((r) =>
                    `<a href="${DATA.hanzi_url.replace('__HANZI__', encodeURIComponent(r.simp))}">${hanziBlock(r)}</a>`).join(' ')}</span></div>`).join('')
            + `<a href="${url}" class="inline-block mt-2 text-sm text-brand hover:underline">Page de la syllabe →</a>`;
    }

    function select(syllable) {
        state.selected = state.selected === syllable ? null : syllable;
        $('ph-table').querySelectorAll('td.is-selected').forEach((td) => td.classList.remove('is-selected'));
        if (state.selected) $('ph-table').querySelector(`button[data-syllable="${CSS.escape(syllable)}"]`)?.parentElement.classList.add('is-selected');
        renderDetail();
        // On narrow screens the panel sits under the table.
        if (state.selected && window.matchMedia('(max-width: 1023px)').matches) {
            $('ph-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    // ---- charts --------------------------------------------------------

    function hbars(container, bars) {
        const max = Math.max(1, ...bars.map((b) => b.value));
        container.innerHTML = bars.map((b, i) =>
            `<button type="button" class="ph-hbar" data-bar="${i}" aria-label="${escapeHtml(b.aria)}">`
            + `<span class="ph-lab">${escapeHtml(b.label)}</span>`
            + `<span class="ph-track"><span class="ph-mark" style="width:${(100 * b.value) / max}%"></span></span>`
            + `<span class="ph-val">${b.value}</span></button>`).join('');
        container._bars = bars;
    }

    function renderCharts() {
        const charsOf = (rs) => new Set(rs.map((r) => r.simp)).size;

        const byInitial = groupBy(READINGS, (r) => r.initial);
        hbars($('ph-chart-initials'), [...byInitial]
            .map(([initial, rs]) => ({ initial, n: charsOf(rs) }))
            .sort((a, b) => b.n - a.n)
            .map(({ initial, n }) => ({
                label: initial ? show(initial, '') : '∅',
                value: n,
                aria: `Initiale ${initial || 'nulle'} : ${n} caractères`,
                tip: `<b>${escapeHtml(initial ? show(initial, '') : 'Sans initiale')}</b> · ${n} caractères`,
                onClick: () => revealHeader(`tbody th[data-row="${INITIALS.indexOf(initial)}"]`),
            })));

        const byFinal = groupBy(READINGS, (r) => r.final);
        hbars($('ph-chart-finals'), [...byFinal]
            .map(([final, rs]) => ({ final, n: charsOf(rs) }))
            .sort((a, b) => b.n - a.n)
            .slice(0, 20)
            .map(({ final, n }) => ({
                label: final ? show('', final) : '∅',
                value: n,
                aria: `Finale ${final || 'nulle'} : ${n} caractères`,
                tip: `<b>${escapeHtml(final ? show('', final) : 'Sans finale')}</b> · ${n} caractères`,
                onClick: () => revealHeader(`thead th[data-col="${FINALS.indexOf(final)}"]`),
            })));

        renderToneStack();
    }

    /** Stacked columns per tone: readings with a -p/-t/-k final vs others. */
    function renderToneStack() {
        const container = $('ph-chart-tones');
        const tones = TONES.map((tone) => {
            const rs = READINGS.filter((r) => String(r.tone ?? '') === tone);
            const checked = rs.filter((r) => CHECKED.test(r.final)).length;
            return { tone, checked, open: rs.length - checked, total: rs.length };
        });
        const max = Math.max(1, ...tones.map((t) => t.total));
        container.innerHTML = `<div class="ph-stack-cols">${tones.map((t, i) =>
            `<button type="button" class="ph-stack" data-bar="${i}" aria-label="Ton ${t.tone || 'non noté'} : ${t.checked} à finale occlusive, ${t.open} autres">`
            + `<span class="ph-total">${t.total}</span>`
            + (t.checked ? `<span class="ph-seg" style="height:${(100 * t.checked) / max}%;background:var(--ph-series-1)"></span>` : '')
            + (t.open ? `<span class="ph-seg" style="height:${(100 * t.open) / max}%;background:var(--ph-series-2)"></span>` : '')
            + `</button>`).join('')}</div>`
            + `<div class="ph-stack-labels">${tones.map((t) => `<span>${t.tone ? `ton ${t.tone}` : 'sans'}</span>`).join('')}</div>`;
        container._bars = tones.map((t) => ({
            tip: `<b>${t.tone ? `Ton ${t.tone}` : 'Sans ton'}</b> · ${t.total} lectures<br>`
                + `finale en -p, -t, -k : ${t.checked} (${percent(t.checked, t.total)})<br>autres : ${t.open}`,
            onClick: () => setTone(t.tone),
        }));
    }

    // ---- tooltip -------------------------------------------------------

    function cellTip(button) {
        const syllable = button.dataset.syllable;
        const rs = visibleReadings().filter((r) => r.syllable === syllable);
        const chars = uniqueChars(rs);
        return `<b>${escapeHtml(show(rs[0].initial, rs[0].final))}</b> · ${chars.length} caractère${chars.length > 1 ? 's' : ''}`
            + `<br><span class="hanzi">${escapeHtml(chars.map((r) => r.simp).join(' '))}</span>`;
    }

    function setupTooltip() {
        const tip = $('ph-tooltip');
        const display = (el) => {
            const html = el.dataset.syllable ? cellTip(el) : el.closest('[id^="ph-chart"]')?._bars?.[el.dataset.bar]?.tip;
            if (!html) return;
            tip.innerHTML = html;
            tip.hidden = false;
            const box = el.getBoundingClientRect();
            const w = tip.offsetWidth;
            const h = tip.offsetHeight;
            tip.style.left = `${Math.min(Math.max(8, box.left + box.width / 2 - w / 2), window.innerWidth - w - 8)}px`;
            tip.style.top = `${box.top - h - 8 >= 8 ? box.top - h - 8 : box.bottom + 8}px`;
        };
        const target = (event) => event.target.closest?.('[data-syllable], [data-bar]');
        ['mouseover', 'focusin'].forEach((type) => document.addEventListener(type, (event) => {
            const el = target(event);
            if (!el) return;
            display(el);
            if (el.dataset.syllable) highlightHeaders(el.dataset.row, el.dataset.col);
        }));
        ['mouseout', 'focusout'].forEach((type) => document.addEventListener(type, (event) => {
            const el = target(event);
            if (!el) return;
            tip.hidden = true;
            if (el.dataset.syllable) highlightHeaders();
        }));
        document.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true, capture: true });
    }

    // ---- controls ------------------------------------------------------

    function renderToneChips() {
        $('ph-tones').innerHTML = [['all', 'Tous'], ...TONES.map((t) => [t, t || 'sans'])]
            .map(([value, label]) => `<button type="button" class="ph-chip min-h-9 min-w-9 px-2.5 rounded-full border border-gray-300" `
                + `data-tone="${value}" aria-pressed="${state.tone === value}">${label}</button>`).join('');
    }

    function setTone(tone) {
        state.tone = tone;
        renderToneChips();
        renderTable();
        $('ph-table').closest('.ph-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function bindControls() {
        document.querySelectorAll('[data-mode]').forEach((btn) => btn.addEventListener('click', () => {
            state.mode = btn.dataset.mode;
            document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
            renderTable();
        }));
        $('ph-tones').addEventListener('click', (event) => {
            const btn = event.target.closest('[data-tone]');
            if (!btn) return;
            state.tone = btn.dataset.tone;
            renderToneChips();
            renderTable();
        });
        $('ph-table').addEventListener('click', (event) => {
            const btn = event.target.closest('[data-syllable]');
            if (btn) select(btn.dataset.syllable);
        });
        document.querySelectorAll('[id^="ph-chart"]').forEach((chart) => chart.addEventListener('click', (event) => {
            const el = event.target.closest('[data-bar]');
            chart._bars?.[el?.dataset.bar]?.onClick?.();
        }));
        // Labels are spelled in the header's system: redraw when it changes.
        document.addEventListener('romanization-change', () => { renderTable(); renderDetail(); renderCharts(); });
    }

    document.addEventListener('DOMContentLoaded', () => {
        renderKpis();
        renderToneChips();
        renderTable();
        renderDetail();
        renderCharts();
        bindControls();
        setupTooltip();
    });
})();
