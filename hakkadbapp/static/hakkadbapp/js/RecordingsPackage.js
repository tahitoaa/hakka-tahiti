/* RecordingsPackage.js — « À enregistrer » → « Préparer l'import plateforme ».

   1. Choisir un dossier local : ses fichiers .wav (sous-dossiers compris),
      nommés selon la convention de la page (on1lok6.wav, 我爱屋家.wav).
   2. Les noms seuls partent au serveur (/api/a-enregistrer/paquet), qui
      renvoie les mots et expressions correspondants au format JSON de la
      plateforme.
   3. Une liste à cocher : les éléments sans audio sont cochés ; ceux qui en
      ont déjà un ne le sont pas (cocher = écraser leur audio) ; les ajouts
      validés (nouveaux éléments) s'ajoutent ou non d'une case.
   4. Le zip est fait ici, dans le navigateur (les audios ne quittent pas
      l'ordinateur) : wordCorpus.json, expressionCorpus.json,
      themeCorpus.json et les .wav à la racine, comme l'export habituel ;
      le champ « audio » de chaque élément est le nom de son fichier (la
      plateforme crée son identifiant à l'import). */
(function () {
    'use strict';

    /* ---------- Zip sans compression (le .wav ne se compresse guère) ---------- */
    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c >>> 0;
        }
        return t;
    })();
    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    /** Blob d'un zip à partir de [{ name, bytes: Uint8Array }]. Noms en UTF-8 (bit 11). */
    function makeZip(entries) {
        const enc = new TextEncoder(), parts = [], central = [];
        const now = new Date();
        const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
        const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
        let offset = 0;
        for (const { name, bytes } of entries) {
            const nameBytes = enc.encode(name), crc = crc32(bytes), size = bytes.length;
            const local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
            local.setUint16(8, 0, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
            local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true);
            local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
            parts.push(local.buffer, nameBytes, bytes);
            const cd = new DataView(new ArrayBuffer(46));
            cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
            cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true); cd.setUint16(12, time, true);
            cd.setUint16(14, date, true); cd.setUint32(16, crc, true); cd.setUint32(20, size, true);
            cd.setUint32(24, size, true); cd.setUint16(28, nameBytes.length, true);
            cd.setUint32(42, offset, true);
            central.push(cd.buffer, nameBytes);
            offset += 30 + nameBytes.length + size;
        }
        const centralSize = central.reduce((n, p) => n + p.byteLength, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
        end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
        return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
    }

    /* ---------- Page ---------- */
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const csrf = () => (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
    const button = document.getElementById('rec-pack-open');
    const input = document.getElementById('rec-pack-input');
    const dialog = document.getElementById('rec-pack');
    if (!button || !input || !dialog) return;
    const body = dialog.querySelector('[data-pack="body"]');
    const status = dialog.querySelector('[data-pack="status"]');
    const go = dialog.querySelector('[data-pack="zip"]');
    let files = new Map(), result = null;

    button.addEventListener('click', () => input.click());
    dialog.addEventListener('click', (e) => { if (e.target.closest('[data-pack="close"]')) dialog.close(); });
    body.addEventListener('change', () => { if (result) update(); });

    input.addEventListener('change', async () => {
        files = new Map();
        const doubles = [];
        for (const f of input.files) {
            if (!/\.wav$/i.test(f.name)) continue;
            if (files.has(f.name)) doubles.push(f.name); else files.set(f.name, f);
        }
        input.value = '';
        body.innerHTML = '';
        go.disabled = true;
        dialog.showModal();
        if (!files.size) { status.textContent = 'Aucun fichier .wav dans ce dossier.'; return; }
        status.textContent = `${files.size} fichier${files.size > 1 ? 's' : ''} .wav lus, recherche des éléments…`;
        try {
            const r = await fetch('/api/a-enregistrer/paquet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                body: JSON.stringify({ names: [...files.keys()] }),
            });
            result = await r.json();
            if (!r.ok) throw new Error(result.error || r.status);
        } catch (err) {
            status.textContent = `Échec : ${err.message}`;
            return;
        }
        if (doubles.length) result.warnings.unshift(`Présents deux fois dans le dossier (le premier est pris) : ${doubles.join(', ')}`);
        render();
    });

    function row(item, i, checked) {
        const kind = item.kind === 'word' ? 'Mot' : 'Expression';
        return `<label class="rec-pack-row"><input type="checkbox" data-i="${i}"${checked ? ' checked' : ''}>
            <span class="rec-file">${esc(item.file)}</span> <span class="text-gray-500">${kind}</span>
            <span class="rec-pack-label">${esc(item.label)}</span></label>`;
    }

    function render() {
        const groups = { fresh: [], replace: [], added: [] };
        result.items.forEach((item, i) => {
            if (item.origin === 'addition') groups.added.push(row(item, i, false));
            else if (item.has_audio) groups.replace.push(row(item, i, false));
            else groups.fresh.push(row(item, i, true));
        });
        const section = (title, rows, extra = '') => rows.length
            ? `<section class="rec-pack-section"><h3>${title} <small>(${rows.length})</small></h3>${extra}${rows.join('')}</section>` : '';
        body.innerHTML = [
            section('Sans audio sur la plateforme', groups.fresh),
            section('Ont déjà un audio sur la plateforme : cocher pour l\'écraser', groups.replace),
            section('Ajouts validés, pas encore sur la plateforme (nouveaux éléments)', groups.added,
                    '<label class="rec-pack-row rec-pack-all"><input type="checkbox" data-pack="all-added"> <b>Ajouter les ajouts validés</b></label>'),
            result.unmatched.length ? `<details class="rec-pack-section"><summary>Fichiers sans élément correspondant (${result.unmatched.length})</summary>
                <p class="rec-file">${result.unmatched.map(esc).join('<br>')}</p></details>` : '',
            result.warnings.length ? `<details class="rec-pack-section"><summary>Avertissements (${result.warnings.length})</summary>
                <ul>${result.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : '',
        ].join('');
        body.querySelector('[data-pack="all-added"]')?.addEventListener('change', (e) => {
            result.items.forEach((item, i) => {
                if (item.origin === 'addition') body.querySelector(`input[data-i="${i}"]`).checked = e.target.checked;
            });
            update();
        });
        update();
    }

    const chosen = () => [...body.querySelectorAll('input[data-i]:checked')].map((c) => result.items[Number(c.dataset.i)]);
    function update() {
        const n = chosen().length;
        status.textContent = `${files.size} fichier${files.size > 1 ? 's' : ''} .wav lus · ${result.items.length} élément${result.items.length > 1 ? 's' : ''} trouvé${result.items.length > 1 ? 's' : ''} · ${n} retenu${n > 1 ? 's' : ''}.`;
        go.disabled = !n;
    }

    go.addEventListener('click', async () => {
        const items = chosen();
        if (!items.length) return;
        go.disabled = true;
        status.textContent = 'Fabrication du zip…';
        const words = {}, expressions = {}, themes = {}, audio = new Set();
        for (const item of items) {
            const payload = { ...item.payload, audio: item.file };
            (item.kind === 'word' ? words : expressions)[item.id] = payload;
            (payload.themes || []).forEach((t) => { if (result.themes[t]) themes[t] = result.themes[t]; });
            audio.add(item.file);
        }
        const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
        const json = (o) => new TextEncoder().encode(JSON.stringify(sorted(o), null, 2));
        const entries = [
            { name: 'wordCorpus.json', bytes: json(words) },
            { name: 'expressionCorpus.json', bytes: json(expressions) },
            { name: 'themeCorpus.json', bytes: json(themes) },
        ];
        try {
            for (const name of [...audio].sort()) entries.push({ name, bytes: new Uint8Array(await files.get(name).arrayBuffer()) });
        } catch (err) {
            status.textContent = `Lecture d'un fichier impossible : ${err.message}`;
            go.disabled = false;
            return;
        }
        if (result.warnings.length) entries.push({ name: 'warnings.txt', bytes: new TextEncoder().encode(result.warnings.join('\n') + '\n') });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(makeZip(entries));
        a.download = `import-plateforme-${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        status.textContent = `Zip prêt : ${Object.keys(words).length} mot(s), ${Object.keys(expressions).length} expression(s), ${audio.size} audio(s).`;
        go.disabled = false;
    });
})();
