/* PlatformUpload.js — « Analyse du lexique » → « Importer un export de la
   plateforme » (propriétaire). Le zip téléchargé sur la plateforme est
   ouvert ici : seuls wordCorpus.json, expressionCorpus.json et
   themeCorpus.json en sont lus (n'importe où dans le zip ; les audios sont
   ignorés et ne sont pas lus), puis envoyés compressés à
   /api/plateforme/importer, qui fait ce que fait `platform_to_vercel --yes`. */
(function () {
    'use strict';
    const NAMES = { 'wordcorpus.json': 'words', 'expressioncorpus.json': 'expressions', 'themecorpus.json': 'themes' };

    /** {words, expressions, themes} lus dans le zip `file` (un File). */
    async function readCorpora(file) {
        // Fin du zip : l'enregistrement « fin du répertoire central ».
        const tailSize = Math.min(file.size, 65557);
        const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
        let eocd = -1;
        for (let i = tailSize - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        if (eocd < 0) throw new Error('ce fichier n\'est pas un zip.');
        const count = tail.getUint16(eocd + 10, true);
        const cdSize = tail.getUint32(eocd + 12, true), cdOffset = tail.getUint32(eocd + 16, true);
        if (cdOffset === 0xFFFFFFFF) throw new Error('zip trop gros (zip64) : non pris en charge.');
        const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
        const dec = new TextDecoder();
        const found = {};
        for (let i = 0, p = 0; i < count; i++) {
            const method = cd.getUint16(p + 10, true), compSize = cd.getUint32(p + 20, true);
            const nameLen = cd.getUint16(p + 28, true), extraLen = cd.getUint16(p + 30, true), commentLen = cd.getUint16(p + 32, true);
            const local = cd.getUint32(p + 42, true);
            const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
            const key = NAMES[name.split('/').pop().toLowerCase()];
            if (key && !name.split('/').some((part) => part.startsWith('__MACOSX'))) {
                if (found[key]) throw new Error(`${name} : présent deux fois dans le zip.`);
                found[key] = { name, method, compSize, local };
            }
            p += 46 + nameLen + extraLen + commentLen;
        }
        const out = { folder: '' };
        for (const key of ['words', 'expressions', 'themes']) {
            const e = found[key];
            if (!e) throw new Error(`${Object.keys(NAMES).find((n) => NAMES[n] === key).replace('corpus', 'Corpus')} absent du zip.`);
            const head = new DataView(await file.slice(e.local, e.local + 30).arrayBuffer());
            const start = e.local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
            const blob = file.slice(start, start + e.compSize);
            let text;
            if (e.method === 0) text = await blob.text();
            else if (e.method === 8) text = await new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
            else throw new Error(`${e.name} : méthode de compression ${e.method} non prise en charge.`);
            try { out[key] = JSON.parse(text); } catch { throw new Error(`${e.name} : JSON illisible.`); }
            if (key === 'words') out.folder = e.name.split('/').slice(0, -1).join('/');
        }
        return out;
    }

    const csrf = () => (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
    const box = document.getElementById('plat-up');
    if (!box) return;
    const input = box.querySelector('input[type=file]');
    const status = box.querySelector('[data-up="status"]');
    const confirmBtn = box.querySelector('[data-up="go"]');
    const forceBox = box.querySelector('[data-up="force"]');
    let corpora = null, source = '';
    const n = (o) => Object.keys(o || {}).length;

    input.addEventListener('change', async () => {
        const file = input.files[0];
        corpora = null;
        confirmBtn.hidden = true;
        forceBox.hidden = true;
        if (!file) return;
        status.textContent = 'Lecture du zip…';
        try {
            corpora = await readCorpora(file);
        } catch (err) {
            status.textContent = `Impossible : ${err.message}`;
            return;
        }
        source = file.name + (corpora.folder ? ` (${corpora.folder})` : '');
        status.textContent = `${file.name} : ${n(corpora.words)} mots, ${n(corpora.expressions)} expressions, ${n(corpora.themes)} thèmes. `
            + 'L\'import vide puis reconstruit le lexique du site.';
        confirmBtn.hidden = false;
    });

    confirmBtn.addEventListener('click', async () => {
        if (!corpora) return;
        confirmBtn.disabled = true;
        status.textContent = 'Import en cours (jusqu\'à une minute)…';
        const json = JSON.stringify({ source, words: corpora.words, expressions: corpora.expressions, themes: corpora.themes,
                                      force: forceBox.querySelector('input').checked });
        try {
            const body = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
            const r = await fetch('/api/plateforme/importer', {
                method: 'POST', body,
                headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'X-CSRFToken': csrf() },
            });
            const res = await r.json().catch(() => ({ error: `réponse ${r.status}` }));
            if (res.shrink) forceBox.hidden = false;
            if (!r.ok) throw new Error(res.error || r.status);
            status.textContent = `Import terminé : ${res.words} mots (${res.pronunciations} prononciations), ${res.expressions} expressions. `
                + `Remarques rattachées : ${res.moved}, sans mot correspondant : ${res.orphaned}.`
                + (res.word_logs.length ? ` ${res.word_logs.length} ligne(s) de mots ignorée(s).` : '')
                + (res.unknown_tokens.length ? ` ${res.unknown_tokens.length} mot(s) inconnu(s) dans les expressions.` : '')
                + ' Rechargez la page pour voir les chiffres à jour.';
            const details = [...res.word_logs, ...res.unknown_tokens];
            box.querySelector('[data-up="log"]').textContent = details.join('\n');
            box.querySelector('[data-up="logbox"]').hidden = !details.length;
            confirmBtn.hidden = true;
            corpora = null;
        } catch (err) {
            status.textContent = `Échec : ${err.message}`;
        } finally {
            confirmBtn.disabled = false;
        }
    });
})();
