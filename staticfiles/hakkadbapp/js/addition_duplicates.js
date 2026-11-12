/* =========================================================================
   Duplicates — the possible duplicates of each addition on its way
   (addition_duplicates.py): the lexicon words and expressions and the other
   additions sharing its hakka, its pinyin, a sense of its French or of its
   English. In the Suivi table (a badge under the status, the list under the
   row), its slideshow, and its « Doublons » filter / grouping.
   ========================================================================= */
const Duplicates = (() => {
    const API = '/api/ajouts/doublons';
    // One per relation (addition_duplicates.classify), most serious first.
    const LABELS = {
        exact: 'Doublon exact',
        translation: 'Même mot, autre traduction',
        reading: 'Même caractères, autre lecture',
        spelling: 'Même mot, autre graphie',
        synonym: 'Synonyme hakka',
        homophone: 'Homophone',
        sense_en: 'Sens proche (anglais)',
        '': 'Aucun doublon',
    };
    const HINTS = {
        exact: 'mêmes caractères, même pinyin, même sens : la même entrée',
        translation: 'mêmes caractères et pinyin, traductions sans point commun : synonyme français ou autre sens du mot',
        reading: 'mêmes caractères, autre pinyin : autre lecture, ou ton erroné',
        spelling: 'même pinyin et même sens, autres caractères : le même mot écrit autrement',
        synonym: 'même sens en français, autre mot hakka',
        homophone: 'même pinyin (2 syllabes ou plus), autres caractères et autre sens',
        sense_en: 'seul un sens anglais en commun',
    };
    // ⇄ (addition_merge.py): another addition is folded into this one; a lexicon
    // entry gets « Corrections e-reo » with what this addition brings.
    const MERGE = (a, m) => `<button type="button" class="saisie-btn saisie-btn-neutral dup-open" data-dup-merge="${a.id}" data-type="${m.type}" data-id="${m.id}"
        title="${m.type === 'addition'
        ? 'Fusionner : cet autre ajout est versé dans l’ajout courant (sens, thèmes, sources, observations ajoutés), puis supprimé'
        : 'Fusionner dans le lexique : ce que l’ajout apporte devient des corrections e-reo sur cette entrée, puis l’ajout est supprimé'}">⇄</button>`;
    const DELETE = (id) => `<button type="button" class="saisie-btn saisie-btn-delete dup-open" data-dup-delete="${id}" title="Supprimer cet ajout (définitif)">🗑</button>`;
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
        return LABELS[of(id)?.relation || ''];
    }

    /** « ⧉ Doublon exact (2) », a button that opens the list; '' for none. */
    function badge(a, open = false) {
        const d = of(a.id);
        if (!d) return '';
        return `<button type="button" class="dup-badge is-${d.level}" data-dup-toggle="${a.id}" aria-expanded="${open}"
            title="${esc(d.matches.map((m) => `${LABELS[m.relation]} — ${TYPES[m.type]} : ${AdditionList.platformHanzi(m.hanzi)} ${m.pinyin} — ${m.french} (${m.fields.map((f) => FIELDS[f]).join(', ')})`).join('\n'))}">⧉ ${
            LABELS[d.relation]}${d.count > 1 ? ` (${d.count})` : ''}</button>`;
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
                <span class="dup-rel is-${m.level}" title="${esc(HINTS[m.relation])}">${LABELS[m.relation]}</span>
                <span class="dup-where">${where}</span>
                <span class="hanzi dup-f${same('hakka')}">${esc(AdditionList.platformHanzi(m.hanzi)) || '—'}</span>
                <span class="dup-f${same('pinyin')}">${esc(AdditionList.superscriptTones(m.pinyin)) || '—'}</span>
                <span class="dup-f${same('french')}">${esc(m.french) || '—'}</span>
                <span class="dup-f${same('english')}" lang="en">${esc(m.english) || '—'}</span>
                ${MERGE(a, m)}
                ${m.type === 'addition' ? `<button type="button" class="saisie-btn saisie-btn-neutral dup-open" data-dup-edit="${m.id}" title="Ouvrir cet ajout dans la Saisie">✎</button>${DELETE(m.id)}` : ''}
            </li>`;
        }).join('');
        const more = d.count > d.matches.length ? `<p class="vt-sub">… et ${d.count - d.matches.length} autre${d.count - d.matches.length > 1 ? 's' : ''}.</p>` : '';
        // The addition itself first, so the right one can be kept: 🗑 on the others.
        const self = `<li class="dup-item dup-self">
                <span class="dup-rel">Cet ajout</span>
                <span class="hanzi">${esc(AdditionList.platformHanzi(a.hanzi)) || '—'}</span>
                <span>${esc(AdditionList.superscriptTones(a.pinyin)) || '—'}</span>
                <span>${esc(a.french) || '—'}</span>
                <span lang="en">${esc(a.english) || '—'}</span>
                ${DELETE(a.id)}
            </li>`;
        return `<div class="dup-list"><p class="dup-head">⧉ ${LABELS[d.relation]} — en <span class="dup-f is-same">surligné</span>, ce qui est identique ; 🗑 supprime un ajout en trop :</p>
            <ul>${self}${items}</ul>${more}</div>`;
    }

    return { load, refresh, of, label, badge, list, ready: () => !!data, LABELS };
})();
