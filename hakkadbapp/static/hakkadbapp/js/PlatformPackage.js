/* PlatformPackage.js — page « Plateforme » → « Préparer un zip pour e-reo ».

   Un formulaire : ajouts validés, corrections « À faire », audios d'un
   dossier local (les .wav nommés comme dans « À enregistrer », sous-dossiers
   compris), au choix. Les noms des .wav seuls partent au serveur
   (/api/plateforme/paquet), qui renvoie les éléments au format JSON de la
   plateforme. Puis une liste à cocher : corrections, ajouts et éléments sans
   audio cochés ; un audio qui remplacerait celui de la plateforme ne l'est
   pas (« remplacer son audio »). Le zip est fait ici (les audios ne quittent
   pas l'ordinateur) : wordCorpus.json, expressionCorpus.json,
   themeCorpus.json et les .wav à la racine ; le champ « audio » d'un élément
   avec un nouvel audio est le nom de son fichier (e-reo crée son
   identifiant à l'import). */
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

    /* ---------- Formulaire ---------- */
    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const csrf = () => (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
    const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
    const dialog = document.getElementById('plat-pack');
    const opener = document.getElementById('plat-pack-open');
    if (!dialog || !opener) return;
    const $ = (name) => dialog.querySelector(`[data-pack="${name}"]`);
    const form = $('form'), list = $('list'), status = $('status'), go = $('zip'), folderInput = $('folder-input');
    let files = new Map(), doubles = [], result = null;

    opener.addEventListener('click', () => dialog.showModal());
    $('close').addEventListener('click', () => dialog.close());
    $('folder').addEventListener('click', () => folderInput.click());
    folderInput.addEventListener('change', () => {
        files = new Map();
        doubles = [];
        for (const f of folderInput.files) {
            if (!/\.wav$/i.test(f.name)) continue;
            if (files.has(f.name)) doubles.push(f.name); else files.set(f.name, f);
        }
        folderInput.value = '';
        $('folder-status').textContent = files.size ? `${plural(files.size, 'fichier')} .wav` : 'aucun .wav dans ce dossier';
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const additions = form.elements.additions.checked, corrections = form.elements.corrections.checked;
        if (!additions && !corrections && !files.size) { status.textContent = 'Cochez au moins une case, ou choisissez un dossier.'; return; }
        list.innerHTML = '';
        go.disabled = true;
        status.textContent = 'Recherche des éléments…';
        try {
            const r = await fetch('/api/plateforme/paquet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                body: JSON.stringify({ additions, corrections, names: [...files.keys()] }),
            });
            result = await r.json();
            if (!r.ok) throw new Error(result.error || r.status);
        } catch (err) {
            status.textContent = `Échec : ${err.message}`;
            result = null;
            return;
        }
        if (doubles.length) result.warnings.unshift(`Présents deux fois dans le dossier (le premier est pris) : ${doubles.join(', ')}`);
        render(additions);
    });

    /** Une ligne : la case « dans le zip » ; pour un audio qui remplacerait
     *  celui de la plateforme, une seconde case « remplacer l'audio ». */
    function row(item, i, checked) {
        const kind = item.kind === 'word' ? 'Mot' : 'Expression';
        const replace = item.file && item.has_audio
            ? ` <label class="plat-replace"><input type="checkbox" data-replace="${i}"> remplacer son audio</label>` : '';
        const changes = item.changes.map((c) => `<span class="plat-change">✎ ${esc(c)}</span>`).join('');
        return `<div class="plat-item"><label><input type="checkbox" data-i="${i}"${checked ? ' checked' : ''}>
            ${esc(item.label)}</label> <small>${kind}${item.file ? ` · ${esc(item.file)}` : ''}</small>${replace}${changes}</div>`;
    }

    function render(additions) {
        const groups = { corrections: [], audio: [], replace: [], added: [] };
        result.items.forEach((item, i) => {
            if (item.origin === 'addition') groups.added.push(row(item, i, additions || !!item.file));
            else if (item.changes.length) groups.corrections.push(row(item, i, true));
            else if (item.has_audio) groups.replace.push(row(item, i, false));
            else groups.audio.push(row(item, i, true));
        });
        const section = (title, rows) => rows.length
            ? `<section class="plat-section"><h4>${title} (${rows.length})</h4>${rows.join('')}</section>` : '';
        list.innerHTML = [
            section('Corrections', groups.corrections),
            section('Ajouts validés (nouveaux éléments)', groups.added),
            section('Audios, éléments sans audio sur la plateforme', groups.audio),
            section('Audios, éléments qui ont déjà un audio : cocher pour le remplacer', groups.replace),
            result.unmatched.length ? `<details class="plat-section"><summary>Fichiers sans élément correspondant (${result.unmatched.length})</summary>
                <p class="plat-mono">${result.unmatched.map(esc).join('<br>')}</p></details>` : '',
            result.warnings.length ? `<details class="plat-section"><summary>Avertissements (${result.warnings.length})</summary>
                <ul>${result.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : '',
        ].join('') || '<p class="plat-hint">Rien à mettre dans le zip.</p>';
        update();
    }

    // « Remplacer son audio » coché : l'élément va dans le zip.
    list.addEventListener('change', (e) => {
        const i = e.target.dataset.replace;
        if (i !== undefined && e.target.checked) list.querySelector(`input[data-i="${i}"]`).checked = true;
        if (result) update();
    });

    /** [{ item, audio: bool }] cochés. */
    const chosen = () => [...list.querySelectorAll('input[data-i]:checked')].map((c) => {
        const item = result.items[Number(c.dataset.i)];
        const replace = list.querySelector(`input[data-replace="${c.dataset.i}"]`);
        return { item, audio: !!item.file && (!item.has_audio || !!replace?.checked) };
    });
    function update() {
        const picked = chosen();
        status.textContent = `${plural(picked.length, 'élément')} retenu${picked.length > 1 ? 's' : ''}, `
            + `${plural(picked.filter((p) => p.audio).length, 'audio')}.`;
        go.disabled = !picked.length;
    }

    go.addEventListener('click', async () => {
        const picked = chosen();
        if (!picked.length) return;
        go.disabled = true;
        status.textContent = 'Fabrication du zip…';
        const words = {}, expressions = {}, themes = {}, audio = new Set();
        for (const { item, audio: withAudio } of picked) {
            const payload = withAudio ? { ...item.payload, audio: item.file } : item.payload;
            (item.kind === 'word' ? words : expressions)[item.id] = payload;
            (payload.themes || []).forEach((t) => { if (result.themes[t]) themes[t] = result.themes[t]; });
            if (withAudio) audio.add(item.file);
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
        a.download = `pour-ereo-${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        status.textContent = `Zip prêt : ${plural(Object.keys(words).length, 'mot')}, `
            + `${plural(Object.keys(expressions).length, 'expression')}, ${plural(audio.size, 'audio')}.`;
        go.disabled = false;
    });
})();
