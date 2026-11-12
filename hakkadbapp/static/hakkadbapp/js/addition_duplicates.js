/* =========================================================================
   Duplicates — the possible duplicates of each addition on its way
   (addition_duplicates.py): the lexicon words and expressions and the other
   additions sharing its hakka, its pinyin, a sense of its French or of its
   English. In the Suivi table (a badge under the status, the list under the
   row), its slideshow, and its « Doublons » filter / grouping.
   ========================================================================= */
const Duplicates = (() => {
    const API = '/api/ajouts/doublons';
    const LABELS = { exact: 'Doublon exact', strong: 'Doublon probable', weak: 'Ressemblance', '': 'Aucun doublon' };
    const FIELDS = { hakka: 'même hakka', pinyin: 'même pinyin', french: 'même français', english: 'même anglais' };
    const TYPES = { word: 'Lexique · mot', expression: 'Lexique · expression', addition: 'Ajout' };
    let data = null;          // {addition id: {level, count, matches}}
    let timer = null;
    const esc = (t) => AdditionList.escapeHtml(t);

    async function load() {
        const d = await AdditionList.request(API);
        data = d.duplicates;
        return data;
    }

    /** Fetched again a moment after an edit (several edits: once). */
    function refresh(after) {
        clearTimeout(timer);
        timer = setTimeout(() => load().then(after).catch(() => {}), 1500);
    }

    function of(id) {
        return data?.[id] || null;
    }

    /** For the « Doublons » filter: the level's label, or '…' while loading. */
    function label(id) {
        if (!data) return '…';
        return LABELS[of(id)?.level || ''];
    }

    /** « ⧉ Doublon exact (2) », a button that opens the list; '' for none. */
    function badge(a, open = false) {
        const d = of(a.id);
        if (!d) return '';
        return `<button type="button" class="dup-badge is-${d.level}" data-dup-toggle="${a.id}" aria-expanded="${open}"
            title="${esc(d.matches.map((m) => `${TYPES[m.type]} : ${AdditionList.platformHanzi(m.hanzi)} ${m.pinyin} — ${m.french} (${m.fields.map((f) => FIELDS[f]).join(', ')})`).join('\n'))}">⧉ ${
            LABELS[d.level]}${d.count > 1 ? ` (${d.count})` : ''}</button>`;
    }

    /** The matches, each with what it shares (highlighted). */
    function list(a) {
        const d = of(a.id);
        if (!d) return '';
        const labels = AdditionList.statusLabels();
        const items = d.matches.map((m) => {
            const same = (f) => (m.fields.includes(f) ? ' is-same' : '');
            const where = m.type === 'addition'
                ? `${TYPES.addition} · <span class="vt-status vt-status-${esc(m.status)}">${esc(labels[m.status] || m.status)}</span>`
                : TYPES[m.type];
            return `<li class="dup-item is-${m.level}">
                <span class="dup-where">${where}</span>
                <span class="hanzi dup-f${same('hakka')}">${esc(AdditionList.platformHanzi(m.hanzi)) || '—'}</span>
                <span class="dup-f${same('pinyin')}">${esc(AdditionList.superscriptTones(m.pinyin)) || '—'}</span>
                <span class="dup-f${same('french')}">${esc(m.french) || '—'}</span>
                <span class="dup-f${same('english')}" lang="en">${esc(m.english) || '—'}</span>
                ${m.type === 'addition' ? `<button type="button" class="saisie-btn saisie-btn-neutral dup-open" data-dup-edit="${m.id}" title="Ouvrir cet ajout dans la Saisie">✎</button>` : ''}
            </li>`;
        }).join('');
        const more = d.count > d.matches.length ? `<p class="vt-sub">… et ${d.count - d.matches.length} autre${d.count - d.matches.length > 1 ? 's' : ''}.</p>` : '';
        return `<div class="dup-list"><p class="dup-head">⧉ ${LABELS[d.level]} — en <span class="dup-f is-same">surligné</span>, ce qui est identique :</p>
            <ul>${items}</ul>${more}</div>`;
    }

    return { load, refresh, of, label, badge, list, ready: () => !!data, LABELS };
})();
