/* =========================================================================
   CharReview — the characters of the additions on their way (Brouillons,
   À valider, Validés) checked against the lexicon (char_review.py):
   - in the Suivi tables, a character absent from the lexicon is coloured
     (cr-new-char), and so is a known character given a reading the lexicon
     doesn't have (cr-new-reading) -- AdditionList.entryCells();
   - « 🔤 Caractères », a step of the Suivi page: a table, one row per
     character (its readings in the additions, the lexicon's, how many
     additions, what is left to settle), sorted and searched (character,
     reading, sense, word, French), gone through with ↑ ↓; a row opens its
     card (Entrée or a tap): the readings the additions give it next to
     the lexicon's (with words that use them) and the dictionaries', each
     reading with its additions;
     a reading is replaced in all of them in one click, or an addition
     opened in the Saisie. Each member gives a reading a visa (👍 / 👎,
     visas.js); a validator accepts or refuses it, which settles it.
     « ▶ Diaporama »: the new readings of the characters shown, one at a
     time, corrected (→ ka¹, another reading typed), given a visa,
     accepted or refused in one gesture or one key.
   Characters and syllables are paired here, in the browser, so an edit
   shows at once: the Han characters of the hanzi (and □) in order, against
   the syllables of the pinyin («…» text blocks and :sense hints left out);
   when the counts differ the addition is « non alignée ».
   ========================================================================= */
const CharReview = (() => {
    const API = '/api/ajouts/caracteres';
    const STATUSES = ['draft', 'review', 'validated'];
    const PAGE = 100;
    const HAN = /^(?:\p{Script=Han}|□)$/u;
    const esc = (t) => AdditionList.escapeHtml(t);
    const sup = (r) => AdditionList.superscriptTones(r || '');

    let data = null;          // {lexicon: {char: [readings]}, chars: {char: {words, mandarin, meaning, sources}}}
    let withDictionaries = false;
    let loading = null;
    let table = null;
    let box = null;
    let onCount = () => {};
    const state = { filter: 'todo', search: '', statuses: new Set(STATUSES), limit: PAGE, unfolded: new Set(),
        sort: 'rank', open: new Set(), focus: '' };
    const SORTS = { rank: 'À trancher d’abord', count: 'Plus d’ajouts', reading: 'Par lecture', char: 'Par caractère' };
    // A reading given in many additions (个 go⁴: 26) shows its first ones, the rest on demand.
    const FOLD_AT = 7;
    const FOLD_SHOW = 5;
    const folded = (char, reading, list) => list.length >= FOLD_AT && !state.unfolded.has(`${char}|${reading}`);

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
            const decision = p.reading ? decisionOf(p.char, p.reading) : null;
            const title = (kind === 'new-char' ? 'Caractère absent du lexique'
                : `Lecture nouvelle : ${sup(p.reading)} — lexique : ${known}`)
                + (decision ? ` — ${decision.status === 'accepted' ? 'acceptée' : 'refusée'} par ${decision.by}` : '');
            return `<span class="cr-${kind}" title="${esc(title)}">${esc(c)}</span>`;
        }).join('');
    }

    /** The new characters and readings of an addition spelled out (the
     *  slideshow: no hover on a tablet), or ''. */
    function notes(e) {
        if (!data) return '';
        const seen = new Set();
        const items = pairs(e.hanzi, e.pinyin).map((p) => {
            const kind = classify(p.char, p.reading);
            const key = `${p.char}|${p.reading}`;
            if (!kind || seen.has(key)) return '';
            seen.add(key);
            const decision = p.reading ? decisionOf(p.char, p.reading) : null;
            const decided = decision ? ` · ${decision.status === 'accepted' ? '✓ acceptée' : '✕ refusée'} par ${esc(decision.by)}` : '';
            return kind === 'new-char'
                ? `<li><span class="hanzi cr-new-char">${esc(p.char)}</span>${p.reading ? ` ${esc(sup(p.reading))}` : ''} caractère nouveau${decided}</li>`
                : `<li><span class="hanzi cr-new-reading">${esc(p.char)}</span> ${esc(sup(p.reading))} lecture nouvelle
                    (lexique : ${esc((data.lexicon[p.char] || []).map(sup).join(', '))})${decided}</li>`;
        }).filter(Boolean);
        return items.length ? `<ul class="cr-notes">${items.join('')}</ul>` : '';
    }

    // ---- the « Caractères » step ------------------------------------------

    function inScope(a) {
        return STATUSES.includes(a.status) && !(a.ai_pending && a.status === 'draft');
    }

    /** A validator's decision on a reading (visas.js): {status, by} or null. */
    function decisionOf(char, reading) {
        return typeof Visas !== 'undefined' ? Visas.decision(char, reading) : null;
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
        return [...byChar.values()].map((c) => {
            c.newChar = !data.lexicon[c.char];
            c.newReadings = [...c.readings.keys()].filter((r) => classify(c.char, r) === 'new-reading');
            c.mixed = c.readings.size > 1;
            // Readings the lexicon doesn't confirm: each waits for a validator's
            // decision; a refused one still in the additions is to correct.
            const unconfirmed = [...c.readings.keys()].filter((r) => classify(c.char, r));
            c.undecided = unconfirmed.filter((r) => !decisionOf(c.char, r));
            c.refused = [...c.readings.keys()].filter((r) => decisionOf(c.char, r)?.status === 'refused');
            c.count = new Set([...c.readings.values(), c.unaligned].flat().map((a) => a.id)).size;
            // What to look at first: a refused reading still used, a known
            // character read otherwise, differing readings, a new character.
            c.rank = c.refused.length ? 0 : c.newReadings.some((r) => c.undecided.includes(r)) ? 1
                : c.mixed && c.undecided.length ? 2 : c.undecided.length ? 3 : 4;
            return c;
        });
    }

    function toReview(c) {
        return c.rank < 4;
    }

    function matches(c) {
        if (state.filter === 'todo' && !toReview(c)) return false;
        if (state.filter === 'refused' && !c.refused.length) return false;
        if (state.filter === 'new-reading' && !c.newReadings.length) return false;
        if (state.filter === 'mixed' && !c.mixed) return false;
        if (state.filter === 'new-char' && !c.newChar) return false;
        const shown = [...c.readings.values(), c.unaligned].flat().some((a) => state.statuses.has(a.status));
        if (!shown) return false;
        const q = state.search.trim();
        if (!q) return true;
        // Characters typed (屋家): those characters, in any of their forms (髮 = 发).
        const han = [...q].filter((x) => /\p{Script=Han}/u.test(x));
        const forms = typeof HanziForms !== 'undefined' ? HanziForms : null;
        if (han.length) return han.some((x) => x === c.char || (forms && forms.sameText(x, c.char)));
        // Else a reading (ka, ka1, ka¹), a sense, a word, the French of an addition.
        return typeof SearchMatch !== 'undefined' ? SearchMatch.match(haystack(c), q) : haystack(c).toLowerCase().includes(q.toLowerCase());
    }

    /** What a search reads for a character: its readings first. */
    function haystack(c) {
        const info = data.chars[c.char] || {};
        const words = Object.values(info.words || {}).flatMap((w) => w.words || []);
        const adds = [...c.readings.values(), c.unaligned].flat();
        return [...c.readings.keys(), ...(data.lexicon[c.char] || []), info.mandarin || '', info.meaning || '',
            ...words, ...adds.map((a) => `${a.french || ''} ${a.english || ''}`)].join(' ');
    }

    function sorter(x, y) {
        const first = (c) => [...c.readings.keys()].sort()[0] || '~';
        if (state.sort === 'count') return y.count - x.count || x.rank - y.rank || x.char.localeCompare(y.char);
        if (state.sort === 'reading') return first(x).localeCompare(first(y)) || x.char.localeCompare(y.char);
        if (state.sort === 'char') return x.char.localeCompare(y.char);
        return x.rank - y.rank || y.count - x.count || x.char.localeCompare(y.char);
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
            // Visas and the validators' decision, for a reading the lexicon doesn't confirm.
            const decision = decisionOf(c.char, reading);
            const decided = decision ? `<span class="cr-decision is-${decision.status}" title="${esc(`le ${new Date(decision.at).toLocaleDateString('fr-FR')}`)}">${
                decision.status === 'accepted' ? '✓ Acceptée' : '✕ Refusée'} par ${esc(decision.by)}</span>` : '';
            const visa = kind && typeof Visas !== 'undefined' && Visas.ready() ? Visas.html('reading', `${c.char}|${reading}`) : '';
            const decide = kind && typeof Visas !== 'undefined' && Visas.canDecide()
                ? `<button type="button" class="cr-decide is-accept" data-cr-decide="accepted" aria-pressed="${decision?.status === 'accepted'}"
                     title="La lecture est juste (même si le lexique ne l’a pas encore)">✓ Accepter</button>
                   <button type="button" class="cr-decide is-refuse" data-cr-decide="refused" aria-pressed="${decision?.status === 'refused'}"
                     title="La lecture est fausse : à corriger dans ces ajouts">✕ Refuser</button>` : '';
            return `<section class="cr-group${kind ? ` is-${kind}` : ''}${decision ? ` is-${decision.status}` : ''}" data-cr-reading="${esc(reading)}">
                <div class="cr-group-head"><span class="cr-chip cr-reading${kind ? ` is-${kind}` : ''}">${esc(sup(reading))}</span>
                  <span class="cr-what">${kind === 'new-reading' ? 'lecture nouvelle' : kind === 'new-char' ? 'caractère nouveau' : 'lecture du lexique'}
                    · ${shown.length} ajout${shown.length > 1 ? 's' : ''}</span>
                  ${decided}${visa}${decide}
                  ${replace ? `<span class="cr-replaces">Corriger : ${replace}</span>` : ''}</div>
                <ul>${(folded(c.char, reading, shown) ? shown.slice(0, FOLD_SHOW) : shown).map((a) => additionLine(a, c, reading)).join('')}</ul>
                ${folded(c.char, reading, shown) ? `<button type="button" class="cr-unfold" data-cr-unfold>Voir les ${shown.length - FOLD_SHOW} autres ajouts</button>` : ''}</section>`;
        }).join('');
        const unaligned = c.unaligned.filter((a) => state.statuses.has(a.status));
        const loose = unaligned.length ? `<section class="cr-group is-loose"><div class="cr-group-head">
            <span class="cr-what" title="Autant de syllabes que de caractères ? (lecture vide, ton manquant…)">⚠ Lecture non alignée · ${unaligned.length}</span></div>
            <ul>${unaligned.map((a) => additionLine(a, c, null)).join('')}</ul></section>` : '';

        const badgeHtml = badges(c);
        return `<article class="cr-card${toReview(c) ? '' : ' is-seen'}" data-cr-char="${esc(c.char)}">
            <header class="cr-head">
              <span class="hanzi cr-big">${esc(c.char)}</span>
              <span class="cr-uh">${info.mandarin ? `<b>${esc(info.mandarin)}</b> ` : ''}${esc(info.meaning || '')}</span>
              <span class="cr-badges">${badgeHtml}</span>
            </header>
            <div class="cr-compare">
              <div><span class="cr-label">Lexique</span>${lexicon}${examples ? `<ul class="cr-examples">${examples}</ul>` : ''}</div>
              ${withDictionaries ? `<div><span class="cr-label">Dictionnaires</span>${dicts}</div>` : ''}
            </div>
            ${groups}${loose}
        </article>`;
    }

    /** What is left to settle on a character, in short. */
    function badges(c) {
        return [
            c.newChar ? '<span class="cr-badge is-new-char">caractère nouveau</span>' : '',
            c.newReadings.length ? `<span class="cr-badge is-new-reading">${c.newReadings.length} lecture${c.newReadings.length > 1 ? 's' : ''} nouvelle${c.newReadings.length > 1 ? 's' : ''}</span>` : '',
            c.mixed ? `<span class="cr-badge is-mixed">${c.readings.size} lectures différentes</span>` : '',
            c.refused.length ? `<span class="cr-badge is-refused">${c.refused.length} refusée${c.refused.length > 1 ? 's' : ''} à corriger</span>` : '',
            !toReview(c) && c.readings.size ? '<span class="cr-badge is-done">✓ tranché</span>' : '',
        ].join('');
    }

    /** One row of the table; its card under it when open. */
    function row(c) {
        const info = data.chars[c.char] || {};
        const open = state.open.has(c.char);
        const readings = [...c.readings].sort((x, y) => y[1].length - x[1].length).map(([reading, adds]) => {
            const kind = classify(c.char, reading);
            const decision = decisionOf(c.char, reading);
            const n = adds.filter((a) => state.statuses.has(a.status)).length;
            if (!n) return '';
            const what = kind === 'new-reading' ? 'lecture nouvelle' : kind === 'new-char' ? 'caractère nouveau' : 'lecture du lexique';
            const decided = decision ? ` — ${decision.status === 'accepted' ? 'acceptée' : 'refusée'} par ${decision.by}` : '';
            return `<span class="cr-chip cr-reading${kind ? ` is-${kind}` : ''}${decision ? ` is-${decision.status}` : ''}"
                title="${esc(`${what} · ${n} ajout${n > 1 ? 's' : ''}${decided}`)}">${esc(sup(reading))} <small>${n}</small>${
                decision ? (decision.status === 'accepted' ? ' ✓' : ' ✕') : ''}</span>`;
        }).join('');
        const loose = c.unaligned.filter((a) => state.statuses.has(a.status)).length;
        const lexicon = (data.lexicon[c.char] || []).map((r) => esc(sup(r))).join(', ') || '<span class="cr-none">absent</span>';
        const sense = [info.mandarin ? `<b>${esc(info.mandarin)}</b>` : '', esc((info.meaning || '').split(/[;,]/)[0])].filter(Boolean).join(' ');
        return `<tr class="cr-row${toReview(c) ? '' : ' is-seen'}${open ? ' is-open' : ''}" data-cr-row="${esc(c.char)}" tabindex="0"
                aria-expanded="${open}" title="${open ? 'Replier' : 'Détails'} (Entrée) · ↑ ↓ pour parcourir">
              <td class="cr-td-char"><span class="hanzi">${esc(c.char)}</span></td>
              <td class="cr-td-uh">${sense}</td>
              <td class="cr-td-readings">${readings}${loose ? `<span class="cr-chip is-loose" title="Lecture non alignée (autant de syllabes que de caractères ?)">⚠ ${loose}</span>` : ''}</td>
              <td class="cr-td-lex">${lexicon}</td>
              <td class="cr-td-n">${c.count}</td>
              <td class="cr-td-state">${badges(c)}</td>
              <td class="cr-td-open" aria-hidden="true">${open ? '▾' : '▸'}</td>
            </tr>${open ? `<tr class="cr-detail-row"><td colspan="7">${card(c)}</td></tr>` : ''}`;
    }

    function render() {
        if (!box || !data) return;
        const all = characters();
        onCount(all.filter(toReview).length);
        const counts = {
            todo: all.filter(toReview).length, refused: all.filter((c) => c.refused.length).length,
            'new-reading': all.filter((c) => c.newReadings.length).length,
            mixed: all.filter((c) => c.mixed).length, 'new-char': all.filter((c) => c.newChar).length, all: all.length,
        };
        const labels = { todo: 'À trancher', refused: 'Refusées', 'new-reading': 'Lectures nouvelles', mixed: 'Lectures différentes',
            'new-char': 'Caractères nouveaux', all: 'Tous' };
        const statusLabels = AdditionList.statusLabels();
        const shown = all.filter(matches).sort(sorter);
        box.querySelector('[data-cr-filters]').innerHTML = Object.entries(labels).map(([k, l]) =>
            `<button type="button" data-cr-filter="${k}" aria-pressed="${state.filter === k}">${l} <span class="vt-kinds-n">${counts[k]}</span></button>`).join('');
        box.querySelector('[data-cr-statuses]').innerHTML = STATUSES.map((s) =>
            `<label><input type="checkbox" data-cr-status="${s}" ${state.statuses.has(s) ? 'checked' : ''}> ${esc(statusLabels[s] || s)}</label>`).join('');
        const list = box.querySelector('[data-cr-list]');
        list.innerHTML = shown.length ? `<table class="cr-table">
              <thead><tr><th>Car.</th><th class="cr-td-uh">Sens</th><th>Lectures des ajouts</th><th class="cr-td-lex">Lexique</th>
                <th title="Ajouts">Aj.</th><th>À trancher</th><th></th></tr></thead>
              <tbody>${shown.slice(0, state.limit).map(row).join('')}</tbody></table>`
            : '<p class="vt-empty">Rien à relire ici.</p>';
        const n = box.querySelector('[data-cr-shown]');
        if (n) n.textContent = `${shown.length} caractère${shown.length > 1 ? 's' : ''}`;
        box.querySelector('[data-cr-fold]').hidden = !state.open.size;
        // The slideshow: the new readings of the characters shown.
        const slides = slideKeys(all).length;
        box.querySelector('[data-cr-show-n]').textContent = `(${slides})`;
        box.querySelector('[data-cr-show]').disabled = !slides;
        // The row gone through from the keyboard keeps the focus.
        if (state.focus) list.querySelector(`[data-cr-row="${CSS.escape(state.focus)}"]`)?.focus({ preventScroll: true });
        const more = box.querySelector('[data-cr-more]');
        more.hidden = shown.length <= state.limit;
        more.textContent = `Afficher plus (${Math.max(shown.length - state.limit, 0)} restants)`;
    }

    function say(text, isError = false) {
        const s = box.querySelector('[data-cr-status-line]');
        s.textContent = text;
        s.classList.toggle('text-red-700', isError);
    }

    /** Every syllable `reading` of `char` in these additions becomes `next`;
     *  {done, failed} or null. The slideshow doesn't ask (`ask` false). */
    async function replaceReading(char, reading, next, button, { ask = true } = {}) {
        const c = characters().find((x) => x.char === char);
        const adds = (c?.readings.get(reading) || []).filter((a) => state.statuses.has(a.status));
        if (!adds.length) return null;
        const n = adds.length;
        if (ask && !confirm(`Remplacer ${sup(reading)} par ${sup(next)} pour ${char} dans ${n} ajout${n > 1 ? 's' : ''} ?`)) return null;
        let result = null;
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
            result = { done, failed };
            render();
            say(`✓ ${char} : ${sup(reading)} → ${sup(next)} dans ${done} ajout${done > 1 ? 's' : ''}.${failed.length ? ` Échec : ${failed.join(', ')}` : ''}`, failed.length > 0);
        });
        return result;
    }

    // ---- the slideshow: the new readings, one at a time --------------------
    // Gone through quickly, on a tablet or with the keys: the reading big,
    // the lexicon's and the dictionaries' next to it, the additions giving
    // it; corrected in one gesture (→ ka¹, or another reading typed), given
    // a visa, accepted or refused by a validator. Accepted or corrected, the
    // next reading comes by itself; refused, it stays to be corrected.

    const show = { dialog: null, keys: [], pos: 0, lockedUntil: 0, busy: false, message: '' };

    /** The readings to go through, in the table's order (filter, search,
     *  sort): each reading the lexicon doesn't give the character; under
     *  « À trancher » those still undecided or refused, under « Refusées »
     *  the refused ones. */
    function slideKeys(all) {
        return all.filter(matches).sort(sorter).flatMap((c) => [...c.readings]
            .filter(([reading, adds]) => classify(c.char, reading) && adds.some((a) => state.statuses.has(a.status)))
            .filter(([reading]) => {
                const status = decisionOf(c.char, reading)?.status;
                if (state.filter === 'todo') return !status || status === 'refused';
                if (state.filter === 'refused') return status === 'refused';
                return true;
            })
            .sort((x, y) => y[1].length - x[1].length)
            .map(([reading]) => `${c.char}|${reading}`));
    }

    const splitKey = (key) => [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];

    /** A reading as typed (ka2, KA², ka_), or '' when it isn't one. */
    function typedReading(text) {
        const r = String(text || '').trim().toLowerCase()
            .replace(/[¹²³⁴⁵⁶⁷⁸]/gu, (d) => String('¹²³⁴⁵⁶⁷⁸'.indexOf(d) + 1));
        return /^[a-zü]+[0-9_]?$/u.test(r) ? r : '';
    }

    function showDialog() {
        if (show.dialog) return show.dialog;
        const d = document.createElement('dialog');
        d.className = 'vs-dialog cs-dialog';
        d.setAttribute('aria-labelledby', 'cs-count');
        d.innerHTML = `<div class="vs-head"><span id="cs-count" aria-live="polite"></span>
              <button type="button" class="vs-close" data-cs="close" aria-label="Fermer le diaporama">✕</button></div>
            <div class="vs-card" data-cs-card></div>
            <div class="vs-actions" data-cs-actions>
              <button type="button" class="saisie-btn-validate" data-cs-decide="accepted" title="La lecture est juste (même si le lexique ne l’a pas encore)">✓ Accepter la lecture</button>
              <button type="button" class="saisie-btn-reject" data-cs-decide="refused" title="La lecture est fausse : à corriger dans ces ajouts">✕ Refuser</button>
            </div>
            <div class="vs-nav"><button type="button" data-cs-nav="-1">← Précédente</button><button type="button" data-cs-nav="1">Suivante →</button></div>
            <p class="vs-keys" aria-hidden="true"><kbd>←</kbd> <kbd>→</kbd> naviguer · <kbd>A</kbd> accepter · <kbd>R</kbd> refuser ·
              <kbd>1</kbd>…<kbd>5</kbd> corriger par la lecture proposée · <kbd>L</kbd> taper une autre lecture ·
              <kbd>+</kbd> <kbd>-</kbd> votre visa · <kbd>Échap</kbd> fermer</p>`;
        document.body.appendChild(d);
        d.addEventListener('click', onShowClick);
        d.addEventListener('submit', (e) => {
            const form = e.target.closest('[data-cs-other]');
            if (!form) return;
            e.preventDefault();
            const input = form.querySelector('input');
            const next = typedReading(input.value);
            if (!next) { slide('Lecture non reconnue : des lettres puis un chiffre de ton (ka2).', true); return; }
            fix(next, form.querySelector('button'));
        });
        d.addEventListener('keydown', onShowKey);
        d.addEventListener('close', () => render());
        const card = d.querySelector('[data-cs-card]');
        let x0 = null;
        card.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
        card.addEventListener('touchend', (e) => {
            if (x0 === null || e.target.closest('input')) { x0 = null; return; }
            const dx = e.changedTouches[0].clientX - x0;
            x0 = null;
            if (Math.abs(dx) > 60) move(dx < 0 ? 1 : -1);
        });
        document.addEventListener('visas-change', () => { if (d.open) slide(); });
        show.dialog = d;
        return d;
    }

    function openShow() {
        show.keys = slideKeys(characters());
        if (!show.keys.length) { say('Aucune lecture nouvelle à passer en revue avec ce filtre.', true); return; }
        // From the character gone through in the table, if it has one.
        const from = state.focus ? show.keys.findIndex((k) => splitKey(k)[0] === state.focus) : -1;
        show.pos = Math.max(0, from);
        show.message = '';
        const d = showDialog();
        slide();
        if (!d.open) d.showModal();
    }

    function locked() {
        const now = Date.now();
        if (now < show.lockedUntil || show.busy) return true;
        show.lockedUntil = now + 450;
        return false;
    }

    function move(step, { force = false, message = '' } = {}) {
        if (!force && locked()) return;
        const next = Math.min(show.keys.length - 1, Math.max(0, show.pos + step));
        if (next === show.pos) { slide(message || (step > 0 ? 'C’était la dernière lecture.' : '')); return; }
        show.pos = next;
        const card = show.dialog.querySelector('[data-cs-card]');
        card.classList.add('is-changing');
        setTimeout(() => { slide(message); card.classList.remove('is-changing'); card.scrollTop = 0; }, 120);
    }

    /** The current reading, drawn again (after a change: fresh data). */
    function slide(message = '', isError = false) {
        const d = show.dialog;
        if (!d || !data) return;
        const card = d.querySelector('[data-cs-card]');
        const [char, reading] = splitKey(show.keys[show.pos]);
        const c = characters().find((x) => x.char === char);
        const adds = (c?.readings.get(reading) || []).filter((a) => state.statuses.has(a.status));
        d.querySelector('#cs-count').innerHTML = `🔤 Lectures nouvelles · <b>${show.pos + 1} / ${show.keys.length}</b>`;
        d.querySelector('[data-cs-nav="-1"]').disabled = show.pos === 0;
        d.querySelector('[data-cs-nav="1"]').disabled = show.pos === show.keys.length - 1;
        const decider = typeof Visas !== 'undefined' && Visas.canDecide();
        const decision = decisionOf(char, reading);
        d.querySelector('[data-cs-actions]').hidden = !decider;
        d.querySelectorAll('[data-cs-decide]').forEach((b) => {
            b.disabled = !adds.length;
            b.setAttribute('aria-pressed', String(decision?.status === b.dataset.csDecide));
        });
        const line = `<p class="vs-message${isError ? ' is-error' : ''}" role="status">${esc(message)}</p>`;
        if (!c || !adds.length) {
            card.innerHTML = `<div class="hanzi vs-hanzi">${esc(char)}</div><div class="vs-pinyin"><del>${esc(sup(reading))}</del></div>
                <p class="cs-what">Plus aucun ajout ne lit ${esc(char)} ainsi (corrigé).</p>${line}`;
            return;
        }
        const info = data.chars[char] || {};
        const kind = classify(char, reading);
        const words = info.words || {};
        const lexicon = (data.lexicon[char] || []).map((r) => {
            const w = words[r];
            return `<li><span class="cr-chip">${esc(sup(r))}${w ? ` <small>${w.count} mot${w.count > 1 ? 's' : ''}</small>` : ''}</span>
                <span class="cs-words">${esc((w?.words || []).slice(0, 2).join(' · '))}</span></li>`;
        }).join('');
        let dicts = '';
        if (withDictionaries) {
            const grouped = new Map();
            (info.sources || []).forEach((s) => {
                const k = s.wenfa || `?${s.raw}`;
                if (!grouped.has(k)) grouped.set(k, []);
                grouped.get(k).push(s);
            });
            dicts = [...grouped].map(([wenfa, list]) => {
                const doubtful = list.every((s) => s.doubtful);
                const title = list.map((s) => `${s.source} : ${s.raw}${s.doubtful ? ' (⚠ douteuse)' : ''}`).join('\n');
                return `<span class="cr-chip cr-dict${doubtful ? ' is-doubt' : ''}${wenfa === reading ? ' is-same' : ''}" title="${esc(title)}">${doubtful ? '⚠ ' : ''}${
                    esc(wenfa.startsWith('?') ? wenfa.slice(1) : sup(wenfa))} <small>${esc(list.map((s) => s.source.split(' ')[0]).join(', '))}</small></span>`;
            }).join('') || '<span class="cr-none">aucun dictionnaire</span>';
        }
        const n = adds.length;
        const fixes = alternatives(c, reading).map((r, k) => `<button type="button" class="cr-replace" data-cs-fix="${esc(r)}"
            title="Remplacer ${esc(sup(reading))} par ${esc(sup(r))} pour ${esc(char)} dans ${n === 1 ? 'cet ajout' : `ces ${n} ajouts`}"><kbd>${k + 1}</kbd> → ${esc(sup(r))}</button>`).join('');
        const decided = decision ? `<span class="cr-decision is-${decision.status}">${decision.status === 'accepted' ? '✓ Acceptée' : '✕ Refusée'} par ${esc(decision.by)}</span>` : '';
        const visa = typeof Visas !== 'undefined' && Visas.ready() ? Visas.html('reading', `${char}|${reading}`) : '';
        const shown = folded(char, reading, adds) ? adds.slice(0, FOLD_SHOW) : adds;
        card.innerHTML = `<div class="cs-slide" data-cr-char="${esc(char)}" data-cr-reading="${esc(reading)}">
            <div class="cs-reading"><span class="hanzi vs-hanzi">${esc(char)}</span>
              <span class="vs-pinyin cs-py is-${kind}">${esc(sup(reading))}</span></div>
            <div class="cs-what">${kind === 'new-char' ? 'caractère absent du lexique' : 'lecture que le lexique ne donne pas'} · ${n} ajout${n > 1 ? 's' : ''}
              ${info.mandarin || info.meaning ? `<span class="cs-uh">${info.mandarin ? `<b>${esc(info.mandarin)}</b> ` : ''}${esc(info.meaning || '')}</span>` : ''}</div>
            <div class="cs-verdict">${decided}${visa}</div>
            <div class="cr-compare cs-compare">
              <div><span class="cr-label">Lexique</span>${lexicon ? `<ul class="cs-lex">${lexicon}</ul>` : '<span class="cr-none">absent du lexique</span>'}</div>
              ${withDictionaries ? `<div><span class="cr-label">Dictionnaires</span>${dicts}</div>` : ''}
            </div>
            <div class="cs-fix"><span class="cr-label">Corriger</span>${fixes}
              <form data-cs-other class="cs-other"><input type="text" placeholder="autre lecture (ka2)" aria-label="Autre lecture"
                autocomplete="off" autocapitalize="off" spellcheck="false"><button type="submit" class="saisie-btn saisie-btn-neutral">Remplacer</button></form></div>
            <ul class="cs-adds">${shown.map((a) => additionLine(a, c, reading)).join('')}</ul>
            ${shown.length < adds.length ? `<button type="button" class="cr-unfold" data-cr-unfold>Voir les ${adds.length - shown.length} autres ajouts</button>` : ''}
            ${line}</div>`;
    }

    /** Every `reading` of the current character becomes `next`, then the next reading. */
    async function fix(next, button) {
        const [char, reading] = splitKey(show.keys[show.pos]);
        if (next === reading || show.busy) return;
        show.busy = true;
        try {
            const res = await replaceReading(char, reading, next, button, { ask: false });
            if (!res) return;
            const msg = `✓ ${char} : ${sup(reading)} → ${sup(next)} dans ${res.done} ajout${res.done > 1 ? 's' : ''}.`;
            if (res.failed.length) { slide(`${msg} Échec : ${res.failed.join(', ')}`, true); return; }
            show.busy = false;
            move(1, { force: true, message: msg });
        } finally {
            show.busy = false;
        }
    }

    async function decideShown(status, button) {
        const [char, reading] = splitKey(show.keys[show.pos]);
        if (show.busy || typeof Visas === 'undefined' || !Visas.canDecide()) return;
        show.busy = true;
        try {
            await Visas.decide(char, reading, status, button);
        } finally {
            show.busy = false;
        }
        const now = decisionOf(char, reading)?.status;
        if (now === 'accepted') move(1, { force: true, message: `✓ ${char} ${sup(reading)} acceptée.` });
        else if (now === 'refused') slide(`✕ ${char} ${sup(reading)} refusée : choisissez la bonne lecture ci-dessus.`);
        else slide();
    }

    function onShowClick(e) {
        const d = show.dialog;
        if (e.target.closest('[data-cs="close"]')) { d.close(); return; }
        const nav = e.target.closest('[data-cs-nav]');
        if (nav) { move(Number(nav.dataset.csNav)); return; }
        const dec = e.target.closest('[data-cs-decide]');
        if (dec) { decideShown(dec.dataset.csDecide, dec); return; }
        const f = e.target.closest('[data-cs-fix]');
        if (f) { fix(f.dataset.csFix, f); return; }
        const [char, reading] = splitKey(show.keys[show.pos] || '|');
        if (e.target.closest('[data-cr-unfold]')) { state.unfolded.add(`${char}|${reading}`); slide(); return; }
        const ed = e.target.closest('[data-cr-edit]');
        if (ed) edit(Number(ed.dataset.crEdit), char);
    }

    /** ← → (↑ ↓, Page↑ Page↓) previous / next, Début / Fin, A accepter,
     *  R refuser, 1…5 the readings offered, L another reading, + - a visa. */
    function onShowKey(e) {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target.closest?.('input, textarea, select')) return;
        const d = show.dialog;
        const step = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 }[e.key];
        if (step) { e.preventDefault(); move(step); return; }
        if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            move(e.key === 'Home' ? -show.pos : show.keys.length - 1 - show.pos);
            return;
        }
        const key = e.key.toLowerCase();
        if (key === 'l') {
            e.preventDefault();
            d.querySelector('[data-cs-other] input')?.focus();
            return;
        }
        const target = /^[1-9]$/.test(key) ? d.querySelectorAll('[data-cs-fix]')[Number(key) - 1]
            : { a: '[data-cs-decide="accepted"]', r: '[data-cs-decide="refused"]', '+': '[data-vz="ok"]', '-': '[data-vz="ko"]' }[key];
        const button = typeof target === 'string' ? d.querySelector(target) : target;
        if (button && !button.disabled && button.offsetParent !== null) {
            e.preventDefault();
            button.click();
        }
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
            if (e.target.closest('[data-cr-fold]')) { state.open.clear(); render(); return; }
            if (e.target.closest('[data-cr-show]')) { openShow(); return; }
            const r = e.target.closest('[data-cr-row]');
            if (r) { toggleRow(r.dataset.crRow); return; }
            const cardEl = e.target.closest('[data-cr-char]');
            if (!cardEl) return;
            const char = cardEl.dataset.crChar;
            if (e.target.closest('[data-cr-unfold]')) {
                state.unfolded.add(`${char}|${e.target.closest('[data-cr-reading]').dataset.crReading}`);
                render();
                return;
            }
            const dec = e.target.closest('[data-cr-decide]');
            if (dec) { Visas.decide(char, dec.closest('[data-cr-reading]').dataset.crReading, dec.dataset.crDecide, dec); return; }
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
        box.querySelector('[data-cr-search]').addEventListener('input', (e) => {
            state.search = e.target.value;
            state.limit = PAGE;
            state.focus = '';
            render();
        });
        // Entrée in the search: the first character found, open.
        box.querySelector('[data-cr-search]').addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); box.querySelector('[data-cr-row]')?.focus(); return; }
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const first = box.querySelector('[data-cr-row]');
            if (first && !state.open.has(first.dataset.crRow)) toggleRow(first.dataset.crRow);
        });
        box.querySelector('[data-cr-sort]').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
        // The table from the keyboard: ↑ ↓ from row to row, Entrée or Espace opens it.
        box.addEventListener('keydown', (e) => {
            const r = e.target.closest?.('[data-cr-row]');
            if (!r) return;
            const rows = [...box.querySelectorAll('[data-cr-row]')];
            const i = rows.indexOf(r);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
                if (next) { state.focus = next.dataset.crRow; next.focus(); next.scrollIntoView({ block: 'nearest' }); }
                else if (e.key === 'ArrowUp') box.querySelector('[data-cr-search]').focus();
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleRow(r.dataset.crRow);
            } else if (e.key === 'Escape' && state.open.has(r.dataset.crRow)) {
                toggleRow(r.dataset.crRow);
            }
        });
    }

    function toggleRow(char) {
        if (state.open.has(char)) state.open.delete(char); else state.open.add(char);
        state.focus = char;
        render();
    }

    return {
        load,
        pairs,
        classify,
        markHanzi,
        notes,
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
                // Opened for one character (a link, « Retour » from the Saisie): its row open.
                if (car && [...car].length === 1) state.open.add(car);
                box.innerHTML = `<div class="cr-tools">
                    <input type="search" data-cr-search placeholder="Caractère, lecture (ka1), sens, mot…" value="${esc(car)}"
                      aria-label="Chercher un caractère : caractère, lecture, sens, mot ou français"
                      class="min-h-9 w-full sm:w-72 px-3 py-1.5 border border-gray-300 rounded-md text-base bg-white">
                    <label class="cr-sort">Trier <select data-cr-sort class="min-h-9 px-2 border border-gray-300 rounded-md bg-white text-sm">
                      ${Object.entries(SORTS).map(([k, l]) => `<option value="${k}"${state.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
                    <span class="vt-sub" data-cr-shown></span>
                    <button type="button" data-cr-show class="vs-open" title="Les lectures nouvelles une à une, à corriger, accepter ou refuser">▶ Diaporama <span data-cr-show-n></span></button>
                    <button type="button" data-cr-fold class="saisie-btn saisie-btn-neutral" hidden>Tout replier</button>
                    <div class="vt-kinds" role="group" aria-label="Quels caractères" data-cr-filters></div>
                    <div class="cr-statuses" data-cr-statuses></div>
                  </div>
                  <p class="cr-legend"><span class="cr-new-char">字</span> caractère absent du lexique ·
                    <span class="cr-new-reading">字</span> lecture que le lexique ne donne pas à ce caractère
                    (aussi dans les tableaux du suivi) · « → » remplace la lecture dans tous les ajouts du groupe ·
                    👍 👎 votre visa sur une lecture, les validateurs l’acceptent ou la refusent ·
                    <span class="cr-keys">clavier : ↓ depuis la recherche, ↑ ↓ d’une ligne à l’autre, Entrée ouvre ou replie</span>.</p>
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
