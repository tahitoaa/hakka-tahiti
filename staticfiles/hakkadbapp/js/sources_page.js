/* =========================================================================
   The Sources page (source_rules.py): every character of every source in
   one searchable table, the rules from each source to Wenfa, and those
   rules drawn as a three-stage automaton (transducer):
       q0 --initiale--> q1 --finale--> q2 --ton--> q3
   Each stage is a bipartite graph: source values (left) to Wenfa values
   (right), edges as thick as the number of characters.
   ========================================================================= */
(function () {
    const script = document.currentScript;
    const URL = script.dataset.url;
    const HANZI_URL = script.dataset.hanziUrl;
    const $ = (id) => document.getElementById(id);
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const PAGE = 200;
    const PARTS = [['initial', 'Initiale'], ['final', 'Finale'], ['tone', 'Ton']];
    const SUP = '⁰¹²³⁴⁵⁶⁷⁸';

    /** For search: superscript tones as digits, no diacritics, lowercase. */
    const fold = (t) => String(t || '').toLowerCase()
        .replace(/[⁰¹²³⁴⁵⁶⁷⁸]/g, (c) => String(SUP.indexOf(c)))
        .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");
    const shown = (v) => (v === '' ? '∅' : v);

    let data = null;
    const state = { filter: 'all', query: '', limit: PAGE, source: null, part: 'initial', hot: null };

    // ---- tabs ---------------------------------------------------------------------------------
    const TABS = ['tableau', 'regles', 'automate'];
    function showTab() {
        const name = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'tableau';
        document.querySelectorAll('[data-sxtab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.sxtab === name)));
        document.querySelectorAll('[data-sxpanel]').forEach((p) => { p.hidden = p.dataset.sxpanel !== name; });
        if (data && name === 'automate') drawAutomaton();
    }
    document.querySelectorAll('[data-sxtab]').forEach((t) => t.addEventListener('click', (e) => {
        e.preventDefault();
        history.replaceState(null, '', t.getAttribute('href'));
        showTab();
    }));
    window.addEventListener('hashchange', showTab);

    // ---- 1. the table -------------------------------------------------------------------------
    function readings(text, cls) {
        return text ? text.split(' ').map((r) => `<span class="sx-r ${cls}">${esc(r)}</span>`).join('') : '<span class="sx-none">—</span>';
    }

    function rowHtml(r) {
        const [char, trad, wenfa, baoan, mciver, mandarin, english, guess, warning] = r;
        let lex = readings(wenfa, 'sx-r-wenfa');
        if (!wenfa && guess) {
            const [reading, source, confidence] = guess.split('|');
            lex = `<span class="sx-guess" title="Déduite des règles ${esc(source)} (confiance ${confidence} %)">≈ ${esc(reading)}</span>`
                + `<br><small class="sx-none">${esc(source)}, ${confidence} %</small>`;
        }
        return `<tr><td class="sx-char"><a class="hanzi" href="${HANZI_URL.replace('__H__', encodeURIComponent(char))}">${esc(char)}</a>`
            + `${trad ? `<small class="hanzi">${esc(trad)}</small>` : ''}</td>`
            + `<td>${lex}</td><td>${readings(baoan, '')}</td><td>${readings(mciver, '')}</td>`
            + `<td>${readings(mandarin, 'sx-r-man')}${warning !== '' ? ` <span class="sx-warn" title="Lecture mandarin éloignée des lectures hakka `
                + `(cohérence ${warning} %) : caractère peut-être emprunté pour son sens, lecture dialectale, ou erreur à vérifier.">⚠</span>` : ''}</td>`
            + `<td class="sx-en" lang="en">${esc(english)}</td></tr>`;
    }

    function matches() {
        const q = fold(state.query.trim());
        const words = q ? q.split(/\s+/) : [];
        return data.rows.filter((r, i) => {
            if (state.filter === 'lexicon' && !r[2]) return false;
            if (state.filter === 'guess' && r[2]) return false;
            if (state.filter === 'warn' && r[8] === '') return false;
            return words.every((w) => data.hay[i].includes(w));
        });
    }

    function renderTable() {
        const found = matches();
        $('sx-count').textContent = `${found.length.toLocaleString('fr-FR')} caractère${found.length > 1 ? 's' : ''}`
            + (found.length > state.limit ? ` · ${state.limit.toLocaleString('fr-FR')} affichés` : '');
        $('sx-rows').innerHTML = found.length ? found.slice(0, state.limit).map(rowHtml).join('')
            : '<tr><td colspan="6" class="sx-none py-6">Aucun caractère ne correspond.</td></tr>';
        $('sx-more').hidden = found.length <= state.limit;
    }

    $('sx-search').addEventListener('input', (e) => { state.query = e.target.value; state.limit = PAGE; renderTable(); });
    $('sx-more').addEventListener('click', () => { state.limit += PAGE; renderTable(); });
    document.querySelectorAll('[data-sxfilter]').forEach((b) => b.addEventListener('click', () => {
        state.filter = b.dataset.sxfilter;
        state.limit = PAGE;
        document.querySelectorAll('[data-sxfilter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        renderTable();
    }));

    // ---- 2. the rules -------------------------------------------------------------------------
    function sourceButtons() {
        document.querySelectorAll('[data-sxsource-group]').forEach((group) => {
            group.innerHTML = data.order.map((id) => `<button type="button" class="sx-chip" data-sxsource="${id}"
                aria-pressed="${id === state.source}">${esc(data.rules[id].label)}</button>`).join('');
        });
    }
    document.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sxsource]');
        if (!b) return;
        state.source = b.dataset.sxsource;
        state.hot = null;
        sourceButtons();
        renderRules();
        drawAutomaton();
    });

    /** [{src, total, outs: [{w, n, pct}]}] for one part of one source, biggest first. */
    function ruleRows(id, part) {
        return Object.entries(data.rules[id].parts[part]).map(([src, outs]) => {
            const total = Object.values(outs).reduce((a, b) => a + b, 0);
            return { src, total, outs: Object.entries(outs).map(([w, n]) => ({ w, n, pct: Math.round((100 * n) / total) }))
                .sort((a, b) => b.n - a.n) };
        }).sort((a, b) => b.total - a.total);
    }

    function renderRules() {
        const r = data.rules[state.source];
        const a = r.accuracy;
        $('sx-acc').innerHTML = [[r.pairs, 'caractères appris'], [`${a.initial} %`, 'initiale juste'],
            [`${a.final} %`, 'finale juste'], [`${a.tone} %`, 'ton juste'], [`${a.all} %`, 'syllabe entière juste']]
            .map(([v, l]) => `<div><b>${v}</b>${l}</div>`).join('');
        $('sx-rules').innerHTML = PARTS.map(([part, label]) => {
            const rows = ruleRows(state.source, part);
            const max = Math.max(...rows.map((x) => x.total), 1);
            return `<div class="sx-rule-card"><h3>${label} <span class="sx-legend">${esc(r.label)} → Wenfa</span></h3>
                ${rows.map((x) => `<div class="sx-rule"><span class="sx-src" title="${x.total} caractères">${esc(shown(x.src))}</span>
                  <span><span class="sx-bar" style="width:${Math.max(4, Math.round((60 * x.total) / max))}px"></span>
                  ${x.outs.slice(0, 4).map((o) => `<span class="sx-out" title="ex. ${esc((r.examples[part][`${x.src}>${o.w}`] || []).join(' '))}">→ <code>${esc(shown(o.w))}</code><span class="sx-pct">${o.pct} %</span></span>`).join('')}
                  ${x.outs.length > 4 ? `<span class="sx-pct">+${x.outs.length - 4}</span>` : ''}</span></div>`).join('')}
              </div>`;
        }).join('');
    }

    // ---- 3. the automaton -----------------------------------------------------------------------
    const NS = 'http://www.w3.org/2000/svg';

    function drawChain() {
        const xs = [50, 230, 410, 590];
        const parts = PARTS.map(([p, l], i) => `<g class="tr${p === state.part ? ' is-on' : ''}" data-part="${p}" tabindex="0" role="button" aria-label="Étape ${l}">
            <rect x="${xs[i] + 22}" y="14" width="${xs[i + 1] - xs[i] - 44}" height="50" fill="transparent"/>
            <path d="M${xs[i] + 24},45 L${xs[i + 1] - 28},45"/><text x="${(xs[i] + xs[i + 1]) / 2}" y="32">${l}</text></g>`).join('');
        const states = xs.map((x, i) => `<circle class="st" cx="${x}" cy="45" r="22"/>${i === 3 ? `<circle class="st st-end" cx="${x}" cy="45" r="17"/>` : ''}
            <text x="${x}" y="50">q${i}</text>`).join('');
        $('sx-chain').innerHTML = `<defs><marker id="sx-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#6E655C"/></marker></defs>${parts}${states}`;
    }
    $('sx-chain').addEventListener('click', (e) => {
        const g = e.target.closest('[data-part]');
        if (!g) return;
        state.part = g.dataset.part;
        state.hot = null;
        drawAutomaton();
    });
    $('sx-chain').addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.part) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    });
    $('sx-rare').addEventListener('change', () => drawAutomaton());

    function drawAutomaton() {
        if (!data || !state.source) return;
        drawChain();
        const rare = $('sx-rare').checked;
        const rows = ruleRows(state.source, state.part);
        const edges = [];
        rows.forEach((x) => x.outs.forEach((o, k) => {
            if (rare || o.pct >= 5) edges.push({ src: x.src, w: o.w, n: o.n, pct: o.pct, best: k === 0 });
        }));
        const left = rows.map((x) => x.src).filter((s) => edges.some((e) => e.src === s));
        // Right side ordered by the mean position of its sources: fewer crossings.
        const pos = new Map(left.map((s, i) => [s, i]));
        const weight = new Map();
        edges.forEach((e) => {
            const [sum, n] = weight.get(e.w) || [0, 0];
            weight.set(e.w, [sum + pos.get(e.src) * e.n, n + e.n]);
        });
        const right = [...weight.keys()].sort((a, b) => weight.get(a)[0] / weight.get(a)[1] - weight.get(b)[0] / weight.get(b)[1]);
        const ROW = 26, TOP = 30, W = 600, NODE = 80;
        const height = TOP + Math.max(left.length, right.length) * ROW + 10;
        const yL = (s) => TOP + left.indexOf(s) * ROW + ROW / 2;
        const yR = (w) => TOP + right.indexOf(w) * ROW + ROW / 2;
        const max = Math.max(...edges.map((e) => e.n), 1);
        const label = data.rules[state.source].label;
        const svg = $('sx-graph');
        svg.setAttribute('viewBox', `0 0 ${W} ${height}`);
        svg.style.width = '100%';
        svg.style.minWidth = '420px';
        svg.style.height = `${height}px`;
        const x1 = 20 + NODE, x2 = W - 20 - NODE;
        svg.innerHTML = `<text class="col-title" x="20" y="14">${esc(label)}</text><text class="col-title" x="${W - 20}" y="14" text-anchor="end">Wenfa</text>`
            + edges.map((e, i) => {
                const a = yL(e.src), b = yR(e.w), mid = (x1 + x2) / 2;
                return `<path class="edge" data-i="${i}" data-src="${esc(e.src)}" data-w="${esc(e.w)}" d="M${x1},${a} C${mid},${a} ${mid},${b} ${x2},${b}"
                    stroke="${e.best ? '#9B1C1C' : '#B5AA9B'}" stroke-opacity="${e.best ? 0.55 : 0.45}" stroke-width="${(1.5 + (10 * e.n) / max).toFixed(1)}">
                    <title>${esc(shown(e.src))} → ${esc(shown(e.w))} : ${e.n} (${e.pct} %)</title></path>`;
            }).join('')
            + left.map((s) => `<g class="node" data-node="src" data-v="${esc(s)}" tabindex="0"><rect x="20" y="${yL(s) - 10}" width="${NODE}" height="20" rx="5"/>
                <text x="${20 + NODE / 2}" y="${yL(s)}" text-anchor="middle">${esc(shown(s))}</text></g>`).join('')
            + right.map((w) => `<g class="node is-wenfa" data-node="w" data-v="${esc(w)}" tabindex="0"><rect x="${x2}" y="${yR(w) - 10}" width="${NODE}" height="20" rx="5"/>
                <text x="${x2 + NODE / 2}" y="${yR(w)}" text-anchor="middle">${esc(shown(w))}</text></g>`).join('');
        svg._edges = edges;
        highlight(null);
        $('sx-detail').textContent = `${label} → Wenfa, étape « ${PARTS.find(([p]) => p === state.part)[1]} » : ${left.length} valeurs, ${edges.length} transitions. Touchez une valeur.`;
    }

    function highlight(node) {
        const svg = $('sx-graph');
        svg.classList.toggle('has-hot', !!node);
        svg.querySelectorAll('.is-hot').forEach((el) => el.classList.remove('is-hot'));
        if (!node) return;
        node.classList.add('is-hot');
        const side = node.dataset.node === 'src' ? 'src' : 'w';
        const v = node.dataset.v;
        const r = data.rules[state.source];
        const lines = [];
        svg.querySelectorAll(`.edge[data-${side}="${CSS.escape(v)}"]`).forEach((p) => {
            p.classList.add('is-hot');
            const e = svg._edges[p.dataset.i];
            const ex = (r.examples[state.part][`${e.src}>${e.w}`] || []).join(' ');
            lines.push(`${shown(e.src)} → ${shown(e.w)} : ${e.n} (${e.pct} %)${ex ? ` ex. ${ex}` : ''}`);
            const other = svg.querySelector(`.node[data-node="${side === 'src' ? 'w' : 'src'}"][data-v="${CSS.escape(side === 'src' ? e.w : e.src)}"]`);
            other?.classList.add('is-hot');
        });
        $('sx-detail').textContent = lines.join(' · ');
    }
    $('sx-graph').addEventListener('click', (e) => {
        const node = e.target.closest('.node');
        highlight(node && !node.classList.contains('is-hot') ? node : null);
    });
    $('sx-graph').addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.node')) { e.preventDefault(); highlight(e.target.closest('.node')); }
    });

    // ---- load -----------------------------------------------------------------------------------
    fetch(URL).then((r) => r.json()).then((payload) => {
        data = payload;
        data.hay = data.rows.map((r) => fold(r.join(' ')));
        state.source = data.order[0];
        const inLexicon = data.rows.filter((r) => r[2]).length;
        $('sx-summary').textContent = `${data.rows.length.toLocaleString('fr-FR')} caractères · ${inLexicon.toLocaleString('fr-FR')} dans le lexique`;
        sourceButtons();
        renderTable();
        renderRules();
        showTab();
    }).catch(() => {
        $('sx-rows').innerHTML = '<tr><td colspan="6" class="sx-none py-6">Impossible de charger les sources : rechargez la page.</td></tr>';
    });
    showTab();
})();
