/* =========================================================================
   Visas — each member's opinion on an addition or on a character's
   reading (visas.py): 👍 / 👎 with an optional comment, given, changed or
   withdrawn by each editor; the validators (group « Validateurs ») decide
   -- an addition by its status, a reading by « ✓ Accepter » / « ✕ Refuser »
   in the « Caractères » step (char_review.js).
   Shown in the Suivi table, its slideshow and the « Caractères » cards;
   any change fires 'visas-change' on document (they re-render).
   ========================================================================= */
const Visas = (() => {
    const API = '/api/visas';
    let state = null;         // {visas: Map(target -> [visa]), decisions: Map(char|reading -> decision), me, canDecide}
    let loading = null;
    const esc = (t) => AdditionList.escapeHtml(t);
    const target = (type, key) => `${type}:${key}`;

    function load() {
        if (state) return Promise.resolve(state);
        loading ||= AdditionList.request(API).then((d) => {
            state = { visas: new Map(), decisions: new Map(), me: d.me, canDecide: d.can_decide };
            d.visas.forEach(put);
            d.decisions.forEach((x) => state.decisions.set(`${x.char}|${x.reading}`, x));
            loading = null;
            return state;
        }).catch((err) => { loading = null; throw err; });
        return loading;
    }

    function put(v) {
        const t = target(v.target_type, v.target_key);
        const list = (state.visas.get(t) || []).filter((x) => x.user !== v.user);
        list.push(v);
        state.visas.set(t, list);
    }

    function changed() {
        document.dispatchEvent(new CustomEvent('visas-change'));
    }

    /** « 👍 2 👎 1 » for an item, the reader's own visa pressed; the title
     *  lists who said what. `author` (username): on one's own addition the
     *  visas of the others are shown, but one cannot give one. */
    function html(type, key, author = '') {
        if (!state) return '';
        const list = state.visas.get(target(type, key)) || [];
        const mine = list.find((v) => v.user === state.me)?.opinion || '';
        const own = !!author && author === state.me;
        const button = (opinion, icon, label) => {
            const who = list.filter((v) => v.opinion === opinion);
            const title = `${label}${who.length ? ` :\n${who.map((v) => `${v.name}${v.comment ? ` — ${v.comment}` : ''}`).join('\n')}` : ''}`
                + (own ? '\n(votre ajout : le visa est donné par les autres membres)'
                    : mine === opinion ? '\n(cliquez pour retirer votre visa)' : '');
            return `<button type="button" class="vz-btn vz-${opinion}" data-vz="${opinion}" aria-pressed="${mine === opinion}"
                ${own ? 'disabled' : ''} title="${esc(title)}">${icon}${who.length ? ` <b>${who.length}</b>` : ''}</button>`;
        };
        const commented = list.filter((v) => v.comment);
        return `<span class="vz" data-vz-type="${esc(type)}" data-vz-key="${esc(key)}">${button('ok', '👍', 'Visa favorable')}${button('ko', '👎', 'Visa défavorable')}${
            commented.length ? `<span class="vz-notes" title="${esc(commented.map((v) => `${v.name} : ${v.comment}`).join('\n'))}">💬 ${commented.length}</span>` : ''}</span>`;
    }

    async function give(type, key, opinion, button) {
        const list = state.visas.get(target(type, key)) || [];
        const mine = list.find((v) => v.user === state.me);
        let comment = mine?.comment || '';
        if (mine?.opinion === opinion) {
            opinion = '';          // the same button again: withdrawn
        } else if (opinion === 'ko') {
            const asked = prompt('Visa défavorable : pourquoi ? (facultatif)', comment);
            if (asked === null) return;
            comment = asked;
        }
        await AdditionList.whileBusy(button, '…', async () => {
            try {
                const data = await AdditionList.request(`${API}/donner`, { target_type: type, target_key: String(key), opinion, comment });
                if (data.visa) put(data.visa);
                else state.visas.set(target(type, key), list.filter((v) => v.user !== state.me));
                changed();
            } catch (err) {
                alert(`Échec : ${err.message}`);
            }
        });
    }

    async function decide(char, reading, status, button) {
        const current = state.decisions.get(`${char}|${reading}`)?.status || '';
        if (current === status) status = '';      // the same decision again: undecided
        await AdditionList.whileBusy(button, '…', async () => {
            try {
                const data = await AdditionList.request('/api/lectures/decision', { char, reading, status });
                if (data.decision) state.decisions.set(`${char}|${reading}`, data.decision);
                else state.decisions.delete(`${char}|${reading}`);
                changed();
            } catch (err) {
                alert(`Échec : ${err.message}`);
            }
        });
    }

    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('click', (e) => {
            const b = e.target.closest?.('[data-vz]');
            if (!b || !state) return;
            e.stopPropagation();
            const box = b.closest('[data-vz-type]');
            give(box.dataset.vzType, box.dataset.vzKey, b.dataset.vz, b);
        }, true);
    }

    return {
        load,
        html,
        decide,
        ready: () => !!state,
        canDecide: () => !!state?.canDecide,
        /** {status, by, at} of a reading, or null. */
        decision: (char, reading) => state?.decisions.get(`${char}|${reading}`) || null,
    };
})();
