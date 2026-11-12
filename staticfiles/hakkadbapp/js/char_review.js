/* =========================================================================
   CharReview — the characters of the additions on their way (Brouillons,
   À valider, Validés) checked against the lexicon (char_review.py):
   - in the Suivi tables, a character absent from the lexicon is coloured
     (cr-new-char), and so is a known character given a reading the lexicon
     doesn't have (cr-new-reading) -- AdditionList.entryCells();
   - « 🔤 Caractères », a step of the Suivi page: one card per character,
     the readings the additions give it next to the lexicon's (with words
     that use them) and the dictionaries', each reading with its additions;
     a reading is replaced in all of them in one click, or an addition
     opened in the Saisie.
   Characters and syllables are paired here, in the browser, so an edit
   shows at once: the Han characters of the hanzi (and □) in order, against
   the syllables of the pinyin («…» text blocks and :sense hints left out);
   when the counts differ the addition is « non alignée ».
   ========================================================================= */
const CharReview = (() => {
    const API = '/api/ajouts/caracteres';
    const STATUSES = ['draft', 'review', 'validated'];
    const SEEN_KEY = 'hakka-char-review-seen';
    const PAGE = 40;
    const HAN = /^(?:\p{Script=Han}|□)$/u;
    const esc = (t) => AdditionList.escapeHtml(t);
    const sup = (r) => AdditionList.superscriptTones(r || '');

    let data = null;          // {lexicon: {char: [readings]}, chars: {char: {words, mandarin, meaning, sources}}}
    let withDictionaries = false;
    let loading = null;
    let table = null;
    let box = null;
    let onCount = () => {};
    const state = { filter: 'todo', search: '', statuses: new Set(STATUSES), limit: PAGE };

    // ---- data ------------------------------------------------------------

    function load(dictionaries = false) {
        if (data && (withDictionaries || !dictionaries)) return Promise.resolve(data);
        if (loading && (!dictionaries || loading.dictionaries)) return loading;
        const p = fetch(`${API}${dictionaries ? '?dictionnaires=1' : ''}`, { credentials: 'same-origin' })
            .then((r) => { if (!r.ok) throw new Error(`Erreur ${r.status}`); return r.json(); })
            .then((d) => { data = d; withDictionaries = withDictionaries || dictionaries; loading = null; return d; })
            .catch((err) => { loading = null; throw err; });
        p.dictionaries = dictionaries;
        loading = p;
        return p;
    }

    /** [{char, reading, start, end}]: the addition's characters with their
     *  syllable (reading null, start -1 when the counts differ). */
    function pairs(hanzi, pinyin) {
        const chars = [...String(hanzi || '').replace(/«[^»]*»?/gu, ' ').replace(/:\S*/gu, ' ')].filter((c) => HAN.test(c));
        const syllables = [];
        for (const m of String(pinyin || '').matchAll(/«[^»]*»?|([a-zA-Zü]+)([0-9_]?)/gu)) {
            if (m[1]) syllables.push({ reading: (m[1] + m[2]).toLowerCase(), start: m.index, end: m.index + m[0].length });
        }
        const aligned = syllables.length === chars.length;
        return chars.map((char, k) => (aligned
            ? { char, ...syllables[k] }
            : { char, reading: null, start: -1, end: -1 }));
    }

    /** 'new-char' (absent from the lexicon), 'new-reading' (a reading the
     *  lexicon doesn't give it) or ''. A tone left open (ngai_) fits any. */
    function classify(char, reading) {
        if (!data || char === '□') return '';
        const known = data.lexicon[char];
        if (!known) return 'new-char';
        if (!reading) return '';
        if (reading.endsWith('_')) return known.some((r) => r.replace(/\d$/, '') === reading.slice(0, -1)) ? '' : 'new-reading';
        return known.includes(reading) ? '' : 'new-reading';
    }

    /** The characters of an addition as the tables show them (platform
     *  form), the new ones wrapped in a coloured span. */
    function markHanzi(e) {
        const shown = AdditionList.platformHanzi(e.hanzi);
        if (!data) return esc(shown);
        const ps = pairs(e.hanzi, e.pinyin);
        let k = 0;
        return [...shown].map((c) => {
            if (!HAN.test(c)) return esc(c);
            const p = ps[k++];
            const kind = p ? classify(p.char, p.reading) : '';
            if (!kind) return esc(c);
            const known = (data.lexicon[c] || []).map(sup).join(', ');
            const title = kind === 'new-char' ? 'Caractère absent du lexique'
                : `Lecture nouvelle : ${sup(p.reading)} — lexique : ${known}`;
            return `<span class="cr-${kind}" title="${esc(title)}">${esc(c)}</span>`;
        }).join('');
    }

    // ---- the « Caractères » step ------------------------------------------

    function inScope(a) {
        return STATUSES.includes(a.status) && !(a.ai_pending && a.status === 'draft');
    }

    function seenSet() {
        try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch (e) { return new Set(); }
    }

    function setSeen(signature, on) {
        const seen = seenSet();
        if (on) seen.add(signature); else seen.delete(signature);
        try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch (e) { /* private mode */ }
    }

    /** One entry per character: its readings in the additions (each with
     *  its additions), the additions that don't align, and what to look at. */
    function characters() {
        const byChar = new Map();
        table.additions.filter(inScope).forEach((a) => {
            pairs(a.hanzi, a.pinyin).forEach((p) => {
                if (p.char === '□') return;
                if (!byChar.has(p.char)) byChar.set(p.char, { char: p.char, readings: new Map(), unaligned: [] });
                const c = byChar.get(p.char);
                if (!p.reading) { if (!c.unaligned.includes(a)) c.unaligned.push(a); return; }
                if (!c.readings.has(p.reading)) c.readings.set(p.reading, []);
                const list = c.readings.get(p.reading);
                if (!list.includes(a)) list.push(a);
            });
        });
        const seen = seenSet();
        return [...byChar.values()].map((c) => {
            c.newChar = !data.lexicon[c.char];
            c.newReadings = [...c.readings.keys()].filter((r) => classify(c.char, r) === 'new-reading');
            c.mixed = c.readings.size > 1;
            c.signature = `${c.char}|${[...c.readings.keys()].sort().join(',')}`;
            c.seen = seen.has(c.signature);
            c.count = new Set([...c.readings.values(), c.unaligned].flat().map((a) => a.id)).size;
            // What to look at first: a known character read otherwise, then
            // differing readings, then a new character.
            c.rank = c.newReadings.length ? 0 : c.mixed ? 1 : c.newChar ? 2 : 3;
            return c;
        });
    }

    function toReview(c) {
        return !c.seen && c.rank < 3;
    }

    function matches(c) {
        if (state.filter === 'todo' && !toReview(c)) return false;
        if (state.filter === 'new-reading' && !c.newReadings.length) return false;
        if (state.filter === 'mixed' && !c.mixed) return false;
        if (state.filter === 'new-char' && !c.newChar) return false;
        const shown = [...c.readings.values(), c.unaligned].flat().some((a) => state.statuses.has(a.status));
        if (!shown) return false;
        const needle = state.search.trim().toLowerCase();
        if (!needle) return true;
        return [...needle].some((x) => x === c.char) || [...c.readings.keys()].some((r) => r.startsWith(needle.replace(/\s+/g, '')));
    }

    /** The other readings worth offering in « → ka¹ »: the lexicon's, then the dictionaries'. */
    function alternatives(c, reading) {
        const fromDicts = (data.chars[c.char]?.sources || []).map((s) => s.wenfa).filter(Boolean);
        return [...new Set([...(data.lexicon[c.char] || []), ...c.readings.keys(), ...fromDicts])]
            .filter((r) => r !== reading).slice(0, 5);
    }

    function pinyinMarked(a, char, reading) {
        const ps = pairs(a.hanzi, a.pinyin).filter((p) => p.char === char && p.reading === reading);
        let out = '';
        let at = 0;
        ps.forEach((p) => {
            out += esc(AdditionList.superscriptTones(a.pinyin.slice(at, p.start)))
                + `<mark class="cr-syl">${esc(sup(a.pinyin.slice(p.start, p.end)))}</mark>`;
            at = p.end;
        });
        return out + esc(AdditionList.superscriptTones(a.pinyin.slice(at)));
    }

    function additionLine(a, c, reading) {
        const labels = AdditionList.statusLabels();
        return `<li class="cr-add">
            <span class="hanzi cr-add-hz">${markHanzi(a)}</span>
            <span class="cr-add-py">${reading ? pinyinMarked(a, c.char, reading) : esc(AdditionList.superscriptTones(a.pinyin)) || '<i>—</i>'}</span>
            <span class="cr-add-fr">${esc(a.french) || '<i>—</i>'}</span>
            <span class="vt-status vt-status-${esc(a.status)}">${esc(labels[a.status] || a.status)}</span>
            <button type="button" class="saisie-btn saisie-btn-neutral cr-edit" data-cr-edit="${a.id}" title="Ouvrir dans la Saisie">✎</button>
        </li>`;
    }

    function card(c) {
        const info = data.chars[c.char] || {};
        const words = info.words || {};
        const lexicon = (data.lexicon[c.char] || []).map((r) => {
            const w = words[r];
            const title = w ? `${w.count} mot${w.count > 1 ? 's' : ''} du lexique :\n${w.words.join('\n')}` : 'Aucun mot du lexique avec cette lecture';
            return `<span class="cr-chip" title="${esc(title)}">${esc(sup(r))}${w ? ` <small>${w.count} mot${w.count > 1 ? 's' : ''}</small>` : ''}</span>`;
        }).join('') || '<span class="cr-none">absent du lexique</span>';
        const examples = (data.lexicon[c.char] || []).flatMap((r) => (words[r]?.words || []).slice(0, 2).map((w) => `<li>${esc(w)}</li>`)).slice(0, 4).join('');

        let dicts = '';
        if (withDictionaries) {
            const grouped = new Map();
            (info.sources || []).forEach((s) => {
                const key = s.wenfa || `?${s.raw}`;
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key).push(s);
            });
            dicts = [...grouped].map(([wenfa, list]) => {
                const doubtful = list.every((s) => s.doubtful);
                const title = list.map((s) => `${s.source} : ${s.raw}${s.doubtful ? ' (⚠ douteuse)' : ''}`).join('\n');
                return `<span class="cr-chip cr-dict${doubtful ? ' is-doubt' : ''}" title="${esc(title)}">${doubtful ? '⚠ ' : ''}${esc(wenfa.startsWith('?') ? wenfa.slice(1) : sup(wenfa))}
                    <small>${esc(list.map((s) => s.source.split(' ')[0]).join(', '))}</small></span>`;
            }).join('') || '<span class="cr-none">aucun dictionnaire</span>';
        }

        const groups = [...c.readings].sort((x, y) => y[1].length - x[1].length).map(([reading, adds]) => {
            const kind = classify(c.char, reading);
            const shown = adds.filter((a) => state.statuses.has(a.status));
            if (!shown.length) return '';
            const replace = alternatives(c, reading).map((r) => `<button type="button" class="cr-replace" data-cr-replace="${esc(r)}"
                title="Remplacer ${esc(sup(reading))} par ${esc(sup(r))} pour ${esc(c.char)} dans ces ${shown.length} ajout${shown.length > 1 ? 's' : ''}">→ ${esc(sup(r))}</button>`).join('');
            return `<section class="cr-group${kind ? ` is-${kind}` : ''}" data-cr-reading="${esc(reading)}">
                <div class="cr-group-head"><span class="cr-chip cr-reading${kind ? ` is-${kind}` : ''}">${esc(sup(reading))}</span>
                  <span class="cr-what">${kind === 'new-reading' ? 'lecture nouvelle' : kind === 'new-char' ? 'caractère nouveau' : 'lecture du lexique'}
                    · ${shown.length} ajout${shown.length > 1 ? 's' : ''}</span>
                  ${replace ? `<span class="cr-replaces">Corriger : ${replace}</span>` : ''}</div>
                <ul>${shown.map((a) => additionLine(a, c, reading)).join('')}</ul></section>`;
        }).join('');
        const unaligned = c.unaligned.filter((a) => state.statuses.has(a.status));
        const loose = unaligned.length ? `<section class="cr-group is-loose"><div class="cr-group-head">
            <span class="cr-what" title="Autant de syllabes que de caractères ? (lecture vide, ton manquant…)">⚠ Lecture non alignée · ${unaligned.length}</span></div>
            <ul>${unaligned.map((a) => additionLine(a, c, null)).join('')}</ul></section>` : '';

        const badges = [
            c.newChar ? '<span class="cr-badge is-new-char">caractère nouveau</span>' : '',
            c.newReadings.length ? `<span class="cr-badge is-new-reading">${c.newReadings.length} lecture${c.newReadings.length > 1 ? 's' : ''} nouvelle${c.newReadings.length > 1 ? 's' : ''}</span>` : '',
            c.mixed ? `<span class="cr-badge is-mixed">${c.readings.size} lectures différentes</span>` : '',
        ].join('');
        return `<article class="cr-card${c.seen ? ' is-seen' : ''}" data-cr-char="${esc(c.char)}">
            <header class="cr-head">
              <span class="hanzi cr-big">${esc(c.char)}</span>
              <span class="cr-uh">${info.mandarin ? `<b>${esc(info.mandarin)}</b> ` : ''}${esc(info.meaning || '')}</span>
              <span class="cr-badges">${badges}</span>
              <button type="button" class="saisie-btn ${c.seen ? 'saisie-btn-neutral' : 'saisie-btn-validate'} cr-seen" data-cr-seen
                title="${c.seen ? 'Remettre dans « À relire »' : 'Lectures vérifiées : sortir de « À relire » (revient si une autre lecture apparaît)'}">${c.seen ? '↺ À relire' : '✓ Relu'}</button>
            </header>
            <div class="cr-compare">
              <div><span class="cr-label">Lexique</span>${lexicon}${examples ? `<ul class="cr-examples">${examples}</ul>` : ''}</div>
              ${withDictionaries ? `<div><span class="cr-label">Dictionnaires</span>${dicts}</div>` : ''}
            </div>
            ${groups}${loose}
        </article>`;
    }

    function render() {
        if (!box || !data) return;
        const all = characters();
        onCount(all.filter(toReview).length);
        const counts = {
            todo: all.filter(toReview).length, 'new-reading': all.filter((c) => c.newReadings.length).length,
            mixed: all.filter((c) => c.mixed).length, 'new-char': all.filter((c) => c.newChar).length, all: all.length,
        };
        const labels = { todo: 'À relire', 'new-reading': 'Lectures nouvelles', mixed: 'Lectures différentes', 'new-char': 'Caractères nouveaux', all: 'Tous' };
        const statusLabels = AdditionList.statusLabels();
        const shown = all.filter(matches).sort((x, y) => x.rank - y.rank || y.count - x.count || x.char.localeCompare(y.char));
        box.querySelector('[data-cr-filters]').innerHTML = Object.entries(labels).map(([k, l]) =>
            `<button type="button" data-cr-filter="${k}" aria-pressed="${state.filter === k}">${l} <span class="vt-kinds-n">${counts[k]}</span></button>`).join('');
        box.querySelector('[data-cr-statuses]').innerHTML = STATUSES.map((s) =>
            `<label><input type="checkbox" data-cr-status="${s}" ${state.statuses.has(s) ? 'checked' : ''}> ${esc(statusLabels[s] || s)}</label>`).join('');
        const list = box.querySelector('[data-cr-list]');
        list.innerHTML = shown.length ? shown.slice(0, state.limit).map(card).join('')
            : '<p class="vt-empty">Rien à relire ici.</p>';
        const more = box.querySelector('[data-cr-more]');
        more.hidden = shown.length <= state.limit;
        more.textContent = `Afficher plus (${Math.max(shown.length - state.limit, 0)} restants)`;
    }

    function say(text, isError = false) {
        const s = box.querySelector('[data-cr-status-line]');
        s.textContent = text;
        s.classList.toggle('text-red-700', isError);
    }

    /** Every syllable `reading` of `char` in these additions becomes `next`. */
    async function replaceReading(char, reading, next, button) {
        const c = characters().find((x) => x.char === char);
        const adds = (c?.readings.get(reading) || []).filter((a) => state.statuses.has(a.status));
        if (!adds.length) return;
        const n = adds.length;
        if (!confirm(`Remplacer ${sup(reading)} par ${sup(next)} pour ${char} dans ${n} ajout${n > 1 ? 's' : ''} ?`)) return;
        await AdditionList.whileBusy(button, 'Correction…', async () => {
            let done = 0;
            const failed = [];
            for (const a of adds) {
                const spots = pairs(a.hanzi, a.pinyin).filter((p) => p.char === char && p.reading === reading).reverse();
                let pinyin = a.pinyin;
                spots.forEach((p) => { pinyin = pinyin.slice(0, p.start) + next + pinyin.slice(p.end); });
                try {
                    // The Saisie text held the old reading: rebuilt from the characters and the new reading.
                    const res = await AdditionList.request(`${AdditionList.API}${a.id}`, { pinyin, input_text: '' });
                    table.upsert(res.addition);
                    done += 1;
                } catch (err) {
                    failed.push(`${a.hanzi} (${err.message})`);
                }
            }
            render();
            say(`✓ ${char} : ${sup(reading)} → ${sup(next)} dans ${done} ajout${done > 1 ? 's' : ''}.${failed.length ? ` Échec : ${failed.join(', ')}` : ''}`, failed.length > 0);
        });
    }

    function edit(id, char) {
        const c = characters().find((x) => x.char === char);
        const ids = c ? [...new Set([...c.readings.values(), c.unaligned].flat().filter((a) => state.statuses.has(a.status)).map((a) => a.id))] : [id];
        AdditionList.rememberReview(ids.includes(id) ? ids : [id],
            `${location.pathname}?etape=caracteres&car=${encodeURIComponent(char)}`, `Caractère ${char}`);
        location.href = `${table.saisieUrl || '/saisie/'}?modifier=${id}`;
    }

    function bind() {
        box.addEventListener('click', (e) => {
            const f = e.target.closest('[data-cr-filter]');
            if (f) { state.filter = f.dataset.crFilter; state.limit = PAGE; render(); return; }
            if (e.target.closest('[data-cr-more]')) { state.limit += PAGE; render(); return; }
            const cardEl = e.target.closest('[data-cr-char]');
            if (!cardEl) return;
            const char = cardEl.dataset.crChar;
            if (e.target.closest('[data-cr-seen]')) {
                const c = characters().find((x) => x.char === char);
                if (c) { setSeen(c.signature, !c.seen); render(); }
                return;
            }
            const ed = e.target.closest('[data-cr-edit]');
            if (ed) { edit(Number(ed.dataset.crEdit), char); return; }
            const rep = e.target.closest('[data-cr-replace]');
            if (rep) replaceReading(char, rep.closest('[data-cr-reading]').dataset.crReading, rep.dataset.crReplace, rep);
        });
        box.addEventListener('change', (e) => {
            const s = e.target.closest('[data-cr-status]');
            if (!s) return;
            if (s.checked) state.statuses.add(s.dataset.crStatus); else state.statuses.delete(s.dataset.crStatus);
            render();
        });
        box.querySelector('[data-cr-search]').addEventListener('input', (e) => { state.search = e.target.value; state.limit = PAGE; render(); });
    }

    return {
        load,
        pairs,
        classify,
        markHanzi,
        ready: () => !!data,
        /** The characters still to review among the additions of `t`. */
        count(t) {
            if (!data) return 0;
            table = t;
            return characters().filter(toReview).length;
        },
        /** Shows the step in `el` for the additions of `t` (ValidationTable);
         *  `count(n)`: the characters still to review. */
        async show(el, t, count) {
            table = t;
            onCount = count || onCount;
            if (box !== el) {
                box = el;
                const car = new URLSearchParams(location.search).get('car') || '';
                state.search = car;
                if (car) state.filter = 'all';
                box.innerHTML = `<div class="cr-tools">
                    <input type="search" data-cr-search placeholder="Caractère ou lecture…" value="${esc(car)}" aria-label="Chercher un caractère"
                      class="min-h-9 w-full sm:w-56 px-3 py-1.5 border border-gray-300 rounded-md text-base bg-white">
                    <div class="vt-kinds" role="group" aria-label="Quels caractères" data-cr-filters></div>
                    <div class="cr-statuses" data-cr-statuses></div>
                  </div>
                  <p class="cr-legend"><span class="cr-new-char">字</span> caractère absent du lexique ·
                    <span class="cr-new-reading">字</span> lecture que le lexique ne donne pas à ce caractère
                    (aussi dans les tableaux du suivi) · « → » remplace la lecture dans tous les ajouts du groupe.</p>
                  <div data-cr-status-line class="text-sm min-h-5" role="status"></div>
                  <div data-cr-list class="cr-list"><p class="vt-sub">Chargement des lectures…</p></div>
                  <button type="button" data-cr-more class="saisie-btn saisie-btn-neutral vt-more" hidden></button>`;
                bind();
            }
            if (data) render();
            try {
                await load(true);
                render();
            } catch (err) {
                box.querySelector('[data-cr-list]').innerHTML = `<p class="text-sm text-red-700">Échec du chargement : ${esc(err.message)}</p>`;
            }
        },
        render,
    };
})();
