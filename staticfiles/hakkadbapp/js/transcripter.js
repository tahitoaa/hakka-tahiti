/* =========================================================================
   ELAN transcription editor (transcripter.html).

   Open a folder holding one .eaf file and its audio; each top-level tier
   is a speaker (one column). What is edited for each segment:
   - the transcript, in the speaker tier itself: the romanization as typed
     at first, converted with the converter's input method into the
     Sentence.js format (words separated by spaces, pinned readings such
     as 生(sen1));
   - Traduction (French), a child tier.
   The other child tiers -- Pinyin (in the "J'affiche en" system), Mixed
   and Hanzi (characters only) -- are derived from the transcript.
   The file itself is an EafDocument: only annotation values change, the
   rest of the ELAN structure is kept as is. "Enregistrer" overwrites the
   opened file after copying the previous version to sauvegardes/ (File
   System Access API); without it, the file is downloaded. Work in progress
   is also kept as a draft in this browser.
   ========================================================================= */

const dico = new Dictionary({ itemSelector: 'li', containerId: '#pron-list' });
const $ = (id) => document.getElementById(id);

const SPEAKER_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2'];
const DRAFT_KEY = 'hakka-eaf-draft';
const BACKUP_DIR = 'sauvegardes';
const MEDIA_RE = /\.(wav|mp3|m4a|ogg|oga|flac|webm|mp4|aac)$/i;
const CAN_WRITE_FILES = 'showDirectoryPicker' in window;

function escapeHtml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(ms) {
    const s = Math.max(0, ms) / 1000;
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** Transcript text without pinned readings: 生(sen1) -> 生. */
function plainHanzi(text) {
    return String(text || '').replace(/\([^()]*\)/g, '');
}

/** Hanzi, pinyin and mixed lines derived from the transcript, the pinyin
 *  in the system picked in "J'affiche en". The Hanzi line keeps characters
 *  only: syllables not converted yet are left out. */
function deriveFromTranscript(text) {
    const sentences = String(text || '').split('\n').filter((l) => l.trim()).map((l) => new Sentence(dico, l));
    const hanzi = sentences.map((s) => s.renderHanziLine().replace(/[\p{Script=Latin}\d_'’?]+/gu, '')).join(' ').trim();
    const pinyin = sentences.map((s) => s.renderDisplayPinyinLine()).join(' ').trim();
    return { hanzi, pinyin, mixed: [pinyin, hanzi].filter(Boolean).join(' ') };
}

const HAN_RE = /\p{Script=Han}/u;

/** 'empty' (no character yet) | 'partial' (romanized syllables left to
 *  convert) | 'done'. */
function segmentState(segment) {
    if (!HAN_RE.test(segment.transcript)) return 'empty';
    return /\p{L}[\p{L}'’]*[_1-8]/u.test(plainHanzi(segment.transcript)) ? 'partial' : 'done';
}

const STATE_MARKS = { empty: '○', partial: '◐', done: '●' };
const STATE_TITLES = { empty: 'hanzi à saisir', partial: 'hanzi en cours', done: 'hanzi saisis' };

function speakerColor(speaker) {
    return SPEAKER_COLORS[speaker.index % SPEAKER_COLORS.length];
}

/** Index of the last item with key(item) <= value (-1 if none); `items`
 *  sorted by key. */
function lastAtOrBefore(items, value, key) {
    let lo = 0, hi = items.length - 1, found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (key(items[mid]) <= value) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
}

/* -------------------------------------------------------------------------
   Folder access (File System Access API) and the remembered last file
   ------------------------------------------------------------------------- */

const handleStore = {
    open() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('hakka-eaf', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('handles');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    async get(key) {
        try {
            const db = await this.open();
            return await new Promise((resolve) => {
                const req = db.transaction('handles').objectStore('handles').get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch (e) { return null; }
    },
    async set(key, value) {
        try {
            const db = await this.open();
            db.transaction('handles', 'readwrite').objectStore('handles').put(value, key);
        } catch (e) { /* only the "Rouvrir" shortcut is lost */ }
    },
};

async function ensurePermission(handle, mode = 'readwrite') {
    if (await handle.queryPermission({ mode }) === 'granted') return true;
    return await handle.requestPermission({ mode }) === 'granted';
}

/** Follows a media path relative to `dir` ("./a.wav", "sub/a.wav"). */
async function resolveRelative(dir, path) {
    const parts = String(path || '').replace(/^file:\/+/, '').split(/[\\/]/).filter((p) => p && p !== '.');
    if (!parts.length || parts.includes('..')) return null;
    try {
        let current = dir;
        for (const part of parts.slice(0, -1)) current = await current.getDirectoryHandle(decodeURIComponent(part));
        return await current.getFileHandle(decodeURIComponent(parts[parts.length - 1]));
    } catch (e) { return null; }
}

function backupStamp(date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/* -------------------------------------------------------------------------
   Segment editor (opened under a row)
   ------------------------------------------------------------------------- */

class SegmentEditor {
    constructor(app, segment) {
        this.app = app;
        this.segment = segment;
        this.touched = false;         // transcript typed in this editor
        this.model = new HakkaText(dico, segment.transcript);
        this.build();
        this.renderIme();
    }

    build() {
        const s = this.segment;
        this.row = document.createElement('div');
        this.row.className = 'eaf-row eaf-editor-row';
        this.row.innerHTML = `
            <div class="eaf-editor" style="--c:${speakerColor(s.speaker)}">
              <div class="eaf-editor-head">
                <span class="eaf-dot"></span><b>${escapeHtml(s.speaker.participant)}</b>
                <span class="text-gray-500">${formatTime(s.start)} → ${formatTime(s.end)}</span>
                <button type="button" class="eaf-btn eaf-btn-light" data-act="play" title="Alt+Entrée">▶ Écouter</button>
                <span class="grow"></span>
                <button type="button" class="eaf-btn eaf-btn-light" data-act="prev" title="Alt+↑">↑ Précédent</button>
                <button type="button" class="eaf-btn eaf-btn-light" data-act="next" title="Alt+↓">↓ Suivant</button>
                <button type="button" class="eaf-btn eaf-btn-light" data-act="close" title="Échap">✕</button>
              </div>
              <div class="eaf-field"><span>Transcript<br><small>tier « ${escapeHtml(s.speaker.id)} »</small></span>
                <div class="eaf-ime">
                  <textarea data-role="transcript" class="hanzi-input" rows="2" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
                  <div data-role="suggestions" class="flex gap-1.5 flex-wrap"></div>
                  <div data-role="preview" class="eaf-preview"></div>
                </div>
              </div>
              <label class="eaf-field"><span>Français</span>
                <textarea data-role="translation" rows="1"></textarea></label>
              <div class="eaf-field"><span>Pinyin <small>(auto)</small></span><div data-role="pinyin" class="eaf-derived"></div></div>
              <div class="eaf-field"><span>Mixte <small>(auto)</small></span><div data-role="mixed" class="eaf-derived"></div></div>
              <div class="eaf-field"><span>Hanzi <small>(auto)</small></span><div data-role="hanzi" class="eaf-derived hanzi"></div></div>
            </div>`;
        const q = (sel) => this.row.querySelector(sel);
        this.transcript = q('[data-role="transcript"]');
        this.translation = q('[data-role="translation"]');
        this.preview = q('[data-role="preview"]');
        this.hanziOut = q('[data-role="hanzi"]');
        this.pinyinOut = q('[data-role="pinyin"]');
        this.mixedOut = q('[data-role="mixed"]');

        this.transcript.value = s.transcript;
        this.translation.value = s.translation;
        this.showDerived(s);

        this.suggestionBar = new SuggestionBar(q('[data-role="suggestions"]'), {
            anchorTo: this.transcript,
            shortcutLabel: 'Alt',
            onSelect: (i) => this.select(i),
        });

        this.transcript.addEventListener('input', () => { this.touched = true; this.renderIme(); this.commit(); });
        this.translation.addEventListener('input', () => this.app.write(s, 'translation', this.translation.value));
        this.row.addEventListener('click', (event) => {
            const act = event.target.closest('[data-act]')?.dataset.act;
            if (act === 'play') this.app.play(s);
            if (act === 'prev') this.app.step(-1);
            if (act === 'next') this.app.step(1);
            if (act === 'close') this.app.close();
        });
        [this.transcript, this.translation].forEach(autosize);
    }

    showDerived(values) {
        this.hanziOut.textContent = values.hanzi;
        this.pinyinOut.textContent = values.pinyin;
        this.mixedOut.textContent = values.mixed;
    }

    renderIme() {
        this.model.update({ hanzi: this.transcript.value });
        this.suggestionBar.render(this.model.suggestions);
        this.preview.innerHTML = this.model.sentences.map((x) => x.renderTokens()).join('');
    }

    select(index) {
        if (!this.model.suggestions[index]) return;
        this.touched = true;
        this.model.select(index);
        this.transcript.value = this.model.text;
        this.transcript.dispatchEvent(new Event('input'));
        this.transcript.focus();
    }

    /** Writes the transcript and the lines derived from it. */
    commit() {
        const text = this.transcript.value;
        const derived = deriveFromTranscript(text);
        this.app.write(this.segment, 'transcript', text, { silent: true });
        this.app.write(this.segment, 'pinyin', derived.pinyin, { silent: true });
        this.app.write(this.segment, 'mixed', derived.mixed, { silent: true });
        this.app.write(this.segment, 'hanzi', derived.hanzi, { silent: true });
        this.app.changed(this.segment);
        this.showDerived(derived);
    }

    /** Display system changed: recompute the derived lines if edited. */
    refreshDerived() {
        this.renderIme();
        if (this.touched) this.commit();
    }

    focus() {
        this.transcript.focus();
    }
}

function autosize(textarea) {
    const fit = () => { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight + 2}px`; };
    textarea.addEventListener('input', fit);
    requestAnimationFrame(fit);
}

/* -------------------------------------------------------------------------
   Overview: the whole recording at a glance (one lane per speaker, each
   segment colored by state), the part of the page on screen, the playhead.
   Click or drag to move through the page; double-click opens a segment.
   ------------------------------------------------------------------------- */

class Overview {
    constructor(app, canvas, tooltip) {
        this.app = app;
        this.canvas = canvas;
        this.tooltip = tooltip;
        this.view = null;          // { start, end } ms of the rows on screen
        this.dragging = false;

        canvas.addEventListener('pointerdown', (e) => {
            this.dragging = true;
            canvas.setPointerCapture(e.pointerId);
            this.app.scrollToTime(this.timeAt(e));
        });
        canvas.addEventListener('pointermove', (e) => {
            if (this.dragging) this.app.scrollToTime(this.timeAt(e), { smooth: false });
            this.hover(e);
        });
        ['pointerup', 'pointercancel'].forEach((t) => canvas.addEventListener(t, () => { this.dragging = false; }));
        canvas.addEventListener('pointerleave', () => { this.tooltip.hidden = true; });
        canvas.addEventListener('dblclick', (e) => {
            const seg = this.segmentAt(e) || this.app.segmentAtTime(this.timeAt(e));
            if (seg) this.app.open(seg);
        });
        new ResizeObserver(() => this.draw()).observe(canvas.parentElement);
    }

    get duration() {
        const eaf = this.app.eaf;
        const end = eaf?.segments.reduce((m, s) => Math.max(m, s.end), 0) || 0;
        const audio = Number.isFinite(this.app.audio.duration) ? this.app.audio.duration * 1000 : 0;
        return Math.max(end, audio, 1);
    }

    layout() {
        const lanes = this.app.eaf?.speakers.length || 1;
        const laneH = lanes > 4 ? 7 : 10;
        return { lanes, laneH, top: 3, height: 3 + lanes * (laneH + 2) + 1 };
    }

    timeAt(event) {
        const rect = this.canvas.getBoundingClientRect();
        return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * this.duration;
    }

    segmentAt(event) {
        const eaf = this.app.eaf;
        if (!eaf) return null;
        const rect = this.canvas.getBoundingClientRect();
        const { laneH, top } = this.layout();
        const lane = Math.floor((event.clientY - rect.top - top) / (laneH + 2));
        const speaker = eaf.speakers[lane];
        if (!speaker) return null;
        const t = this.timeAt(event);
        const tolerance = (this.duration / rect.width) * 2;
        return eaf.segments.find((s) => s.speaker === speaker && s.start - tolerance <= t && t <= s.end + tolerance) || null;
    }

    hover(event) {
        const seg = this.segmentAt(event);
        const t = this.timeAt(event);
        const text = seg ? `${seg.speaker.participant} · ${formatTime(seg.start)} · ${seg.hanzi || plainHanzi(seg.transcript) || '—'}` : formatTime(t);
        this.tooltip.textContent = text;
        this.tooltip.hidden = false;
        const box = this.canvas.parentElement.getBoundingClientRect();
        const x = event.clientX - box.left;
        this.tooltip.style.left = `${Math.min(Math.max(0, x - 40), box.width - this.tooltip.offsetWidth)}px`;
    }

    setView(view) {
        this.view = view;
        this.draw();
    }

    draw() {
        const eaf = this.app.eaf;
        const canvas = this.canvas;
        const width = canvas.parentElement.clientWidth;
        if (!eaf || !width) return;
        const { lanes, laneH, top, height } = this.layout();
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            canvas.style.height = `${height}px`;
        }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        const duration = this.duration;
        const x = (ms) => (ms / duration) * width;

        // Lanes and minute ticks.
        ctx.fillStyle = '#F6EFE4';
        for (let i = 0; i < lanes; i++) ctx.fillRect(0, top + i * (laneH + 2), width, laneH);
        const step = duration > 30 * 60000 ? 300000 : 60000;
        ctx.fillStyle = '#DDD0BD';
        for (let t = step; t < duration; t += step) ctx.fillRect(Math.round(x(t)), 0, 1, height);

        // Segments: faint when empty, half when in progress, full when done.
        const alpha = { empty: 0.25, partial: 0.6, done: 1 };
        eaf.segments.forEach((seg) => {
            const hidden = this.app.hidden.has(seg.speaker.index);
            ctx.globalAlpha = alpha[segmentState(seg)] * (hidden ? 0.3 : 1);
            ctx.fillStyle = speakerColor(seg.speaker);
            ctx.fillRect(x(seg.start), top + seg.speaker.index * (laneH + 2), Math.max(1.5, x(seg.end) - x(seg.start)), laneH);
        });
        ctx.globalAlpha = 1;

        // Rows on screen.
        if (this.view) {
            const x0 = x(this.view.start);
            const w = Math.max(3, x(this.view.end) - x0);
            ctx.fillStyle = 'rgba(67, 56, 202, 0.12)';
            ctx.fillRect(x0, 0, w, height);
            ctx.strokeStyle = '#9B1C1C';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x0 + 0.75, 0.75, w - 1.5, height - 1.5);
        }

        // Segment being edited.
        const active = this.app.editor?.segment;
        if (active) {
            ctx.strokeStyle = '#261F1C';
            ctx.lineWidth = 2;
            ctx.strokeRect(x(active.start) - 1, top + active.speaker.index * (laneH + 2) - 1,
                Math.max(3, x(active.end) - x(active.start)) + 2, laneH + 2);
        }

        // Playhead.
        if (this.app.audioUrl) {
            ctx.fillStyle = '#dc2626';
            ctx.fillRect(Math.round(x(this.app.audio.currentTime * 1000)) - 1, 0, 2, height);
        }
    }
}

/* -------------------------------------------------------------------------
   New file: an empty .eaf for a recording and its participants
   (EafDocument.create), written next to the audio, then opened.
   ------------------------------------------------------------------------- */

const NEW_PREFS_KEY = 'hakka-eaf-new';

function mediaMime(file) {
    const ext = (/\.(\w+)$/.exec(file.name)?.[1] || '').toLowerCase();
    return { wav: 'audio/x-wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac', mp4: 'video/mp4' }[ext]
        || file.type || 'audio/x-wav';
}

class NewFileForm {
    constructor(app) {
        this.app = app;
        this.box = $('eaf-new');
        this.dir = null;
        this.audios = [];             // file handles of the folder's recordings
        this.audioFile = null;        // without folder access
        this.list = $('eaf-new-participants');

        $('eaf-new-open').addEventListener('click', () => this.show());
        this.box.querySelector('[data-new="close"]').addEventListener('click', () => { this.box.hidden = true; });
        $('eaf-new-dir').hidden = !CAN_WRITE_FILES;
        $('eaf-new-audio-label').hidden = CAN_WRITE_FILES;
        $('eaf-new-dir').addEventListener('click', () => this.pickFolder());
        $('eaf-new-audio').addEventListener('change', () => this.audioChanged());
        $('eaf-new-audio-file').addEventListener('change', (e) => {
            this.audioFile = e.target.files[0] || null;
            this.audioChanged();
        });
        $('eaf-new-add').addEventListener('click', () => { this.addRow(); this.list.lastElementChild.querySelector('input').focus(); });
        this.list.addEventListener('input', (e) => {
            const row = e.target.closest('.eaf-new-row');
            if (e.target.dataset.p === 'tier') row.dataset.manual = e.target.value ? '1' : '';
            if (e.target.dataset.p === 'name' && !row.dataset.manual) {
                row.querySelector('[data-p="tier"]').value = e.target.value.trim().split(/\s+/)[0] || '';
            }
            this.preview();
        });
        this.list.addEventListener('click', (e) => {
            if (!e.target.closest('[data-p="remove"]')) return;
            e.target.closest('.eaf-new-row').remove();
            if (!this.list.children.length) this.addRow();
            this.preview();
        });
        $('eaf-new-name').addEventListener('input', () => { $('eaf-new-name').dataset.manual = '1'; });
        $('eaf-new-create').addEventListener('click', () => this.create());

        const prefs = this.readPrefs();
        $('eaf-new-annotator').value = prefs.annotator || '';
    }

    readPrefs() {
        try { return JSON.parse(localStorage.getItem(NEW_PREFS_KEY) || '{}'); } catch (e) { return {}; }
    }

    show() {
        this.box.hidden = false;
        if (!this.list.children.length) { this.addRow(); this.addRow(); }
        this.preview();
        this.box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    addRow(name = '', tierId = '') {
        const row = document.createElement('div');
        row.className = 'eaf-new-row';
        row.innerHTML = `
            <input data-p="name" type="text" placeholder="Nom complet (ex. Annette Levin)" autocomplete="off">
            <input data-p="tier" type="text" placeholder="Tier (ex. Annette)" autocomplete="off">
            <button type="button" class="eaf-btn eaf-btn-light eaf-btn-sm" data-p="remove" title="Retirer">✕</button>`;
        row.querySelector('[data-p="name"]').value = name;
        row.querySelector('[data-p="tier"]').value = tierId;
        this.list.appendChild(row);
    }

    async pickFolder() {
        let dir;
        try {
            dir = await window.showDirectoryPicker({ id: 'hakka-eaf', mode: 'readwrite' });
        } catch (e) { return; }
        const audios = [];
        for await (const entry of dir.values()) if (entry.kind === 'file' && MEDIA_RE.test(entry.name)) audios.push(entry);
        audios.sort((a, b) => a.name.localeCompare(b.name));
        this.dir = dir;
        this.audios = audios;
        const select = $('eaf-new-audio');
        select.innerHTML = audios.map((h, i) => `<option value="${i}">${escapeHtml(h.name)}</option>`).join('')
            || '<option value="">(aucun audio dans ce dossier)</option>';
        select.hidden = false;
        $('eaf-new-audio-info').textContent = `dossier : ${dir.name}`;
        this.audioChanged();
    }

    /** The selected recording: a File-like { name } (folder) or the File. */
    audioEntry() {
        if (this.dir) return this.audios[Number($('eaf-new-audio').value)] || null;
        return this.audioFile;
    }

    audioChanged() {
        const audio = this.audioEntry();
        const name = $('eaf-new-name');
        if (audio && !name.dataset.manual) name.value = audio.name.replace(/\.[^.]+$/, '.eaf');
        this.preview();
    }

    /** Participants as typed, with the problems that block creation. */
    collect() {
        const participants = Array.from(this.list.children).map((row) => ({
            name: row.querySelector('[data-p="name"]').value.trim(),
            tierId: row.querySelector('[data-p="tier"]').value.trim(),
        })).filter((p) => p.name || p.tierId);
        const errors = [];
        if (!participants.length) errors.push('ajoutez au moins un participant');
        participants.forEach((p) => {
            if (!p.name) errors.push(`nom complet manquant pour le tier « ${p.tierId} »`);
            if (!p.tierId) errors.push(`nom de tier manquant pour « ${p.name} »`);
        });
        const ids = participants.map((p) => p.tierId).filter(Boolean);
        const dup = ids.find((id, i) => ids.indexOf(id) !== i);
        if (dup) errors.push(`le tier « ${dup} » est utilisé deux fois : nommez-les différemment (ex. nom complet)`);
        if (!this.audioEntry()) errors.push("choisissez l'enregistrement audio");
        let fileName = $('eaf-new-name').value.trim();
        if (fileName && !/\.eaf$/i.test(fileName)) fileName += '.eaf';
        if (!fileName) errors.push('donnez un nom au fichier');
        else if (/[\\/:*?"<>|]/.test(fileName)) errors.push('le nom du fichier contient un caractère interdit');
        return { participants, fileName, errors };
    }

    preview() {
        const { participants, errors } = this.collect();
        const suffixes = EafDocument.ROLES.map((r) => EafDocument.ROLE_DEFAULTS[r].suffix);
        $('eaf-new-preview').innerHTML = participants.filter((p) => p.tierId).map((p) =>
            `<div><b>${escapeHtml(p.tierId)}</b> <span class="text-gray-500">(${escapeHtml(p.name || '?')})</span> → ${
                suffixes.map((s) => escapeHtml(`${p.tierId} ${s}`)).join(' · ')}</div>`).join('');
        $('eaf-new-error').textContent = errors.length ? `À compléter : ${errors.join(' ; ')}.` : '';
        $('eaf-new-create').disabled = errors.length > 0;
    }

    async create() {
        const { participants, fileName, errors } = this.collect();
        if (errors.length || !this.app.confirmDiscard()) return;
        const audio = this.audioEntry();
        const audioFile = this.dir ? await audio.getFile() : audio;
        const annotator = $('eaf-new-annotator').value.trim();
        try { localStorage.setItem(NEW_PREFS_KEY, JSON.stringify({ annotator })); } catch (e) { /* convenience only */ }
        const xml = EafDocument.create({ participants, annotator, media: { name: audioFile.name, mime: mediaMime(audioFile) } });

        if (!this.dir) {
            // No folder access: download it, and edit it here meanwhile.
            this.app.dir = null;
            this.app.fileHandle = null;
            this.app.load(xml, fileName);
            this.app.download();
            this.app.setAudio(audioFile);
            this.box.hidden = true;
            this.app.message(`${fileName} a été téléchargé : placez-le dans le dossier de « ${audioFile.name} », puis segmentez-le dans ELAN.`);
            return;
        }
        try {
            let handle = null;
            try { handle = await this.dir.getFileHandle(fileName); } catch (e) { /* new file */ }
            if (handle) {
                if (!confirm(`${fileName} existe déjà dans ce dossier. Le remplacer par un fichier vide ? (L'ancien sera copié dans ${BACKUP_DIR}/.)`)) return;
                const backups = await this.dir.getDirectoryHandle(BACKUP_DIR, { create: true });
                const old = await handle.getFile();
                await this.app.writeFile(await backups.getFileHandle(fileName.replace(/(\.eaf)?$/i, `.${backupStamp()}.eaf`), { create: true }), await old.text());
            } else {
                handle = await this.dir.getFileHandle(fileName, { create: true });
            }
            await this.app.writeFile(handle, xml);
            this.app.dirty = false;
            await this.app.openHandle(this.dir, handle);
            this.box.hidden = true;
            this.app.message(`${fileName} créé dans « ${this.dir.name} » (${participants.length} participant${participants.length > 1 ? 's' : ''}). Ouvrez-le dans ELAN pour découper les segments, puis rouvrez-le ici pour les transcrire.`);
        } catch (err) {
            $('eaf-new-error').textContent = `Création impossible : ${err.message}`;
        }
    }
}

/* -------------------------------------------------------------------------
   Share with the working group: publishes the transcript (as shown) and a
   compressed copy of the audio to /ecouter/ (views.api_transcription_*).
   The .wav is compressed here (mp3-worker.js), then PUT straight to the
   storage with a URL signed by the server.
   ------------------------------------------------------------------------- */

const SHARE = window.TRANSCRIPT_SHARE || {};
const UPLOAD_AS_IS = /\.(mp3|m4a)$/i;     // already compressed: sent as is
const MAX_AUDIO_BYTES = 48 * 1024 * 1024; // the storage's per-file limit (50 MB)

function getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

async function postJson(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify(body),
    });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(answer.error || `Erreur ${response.status}`);
    return answer;
}

function formatBytes(n) {
    return n > 1e6 ? `${(n / 1e6).toFixed(n > 1e8 ? 0 : 1)} Mo` : `${Math.round(n / 1e3)} ko`;
}

class SharePanel {
    constructor(app) {
        this.app = app;
        this.box = $('eaf-share');
        this.shared = null;           // what the server already has
        this.busy = false;
        $('eaf-share-open').addEventListener('click', () => this.show());
        this.box.querySelector('[data-share="close"]').addEventListener('click', () => { if (!this.busy) this.box.hidden = true; });
        $('eaf-share-publish').addEventListener('click', () => this.publish());
    }

    audioSource() {
        const f = this.app.audioFile;
        return f ? `${f.name}:${f.size}:${f.lastModified}` : '';
    }

    async show() {
        const eaf = this.app.eaf;
        if (!eaf) return;
        this.box.hidden = false;
        $('eaf-share-result').hidden = true;
        $('eaf-share-step').textContent = '';
        $('eaf-share-progress').hidden = true;
        const data = this.app.exportData();
        const done = data.segments.filter((s) => TranscriptDocument.hanzi(s)).length;
        const hiddenCount = eaf.speakers.length - data.participants.length;
        $('eaf-share-content').innerHTML = `${data.participants.map((p) => `<b>${escapeHtml(p.name)}</b>`).join(', ')} · ${data.segments.length} segments, ${done} en hanzi`
            + (hiddenCount ? ` <span class="text-amber-700">(${hiddenCount} locuteur${hiddenCount > 1 ? 's' : ''} masqué${hiddenCount > 1 ? 's' : ''}, non inclus)</span>` : '');
        this.showAudio();
        $('eaf-share-status').textContent = 'Vérification…';
        $('eaf-share-publish').disabled = true;
        try {
            const response = await fetch(`${SHARE.lookup}?urn=${encodeURIComponent(eaf.property('URN'))}`);
            const answer = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(answer.error || `Erreur ${response.status}`);
            this.shared = answer.shared;
            $('eaf-share-title').value = this.shared?.title || $('eaf-share-title').value || eaf.fileName.replace(/\.eaf$/i, '');
            $('eaf-share-status').innerHTML = this.shared
                ? `Déjà partagé, mis à jour le ${escapeHtml(new Date(this.shared.updated_at).toLocaleString('fr-FR'))} : <a class="underline" target="_blank" href="${escapeHtml(this.shared.url)}">ouvrir la page</a>. Publier la met à jour.`
                : 'Pas encore partagé.';
            this.showAudio();
            $('eaf-share-publish').disabled = false;
        } catch (err) {
            $('eaf-share-status').innerHTML = `${escapeHtml(err.message)} <a class="underline" href="${escapeHtml(SHARE.login)}">Se connecter</a>`;
        }
    }

    showAudio() {
        const f = this.app.audioFile;
        let text;
        if (!f) text = '<span class="text-amber-700">audio non ouvert : seul le texte sera publié</span>';
        else if (this.shared && this.shared.audio_source === this.audioSource()) text = `${escapeHtml(f.name)} — déjà envoyé, pas renvoyé`;
        else if (UPLOAD_AS_IS.test(f.name)) text = `${escapeHtml(f.name)} (${formatBytes(f.size)}) — envoyé tel quel`;
        else text = `${escapeHtml(f.name)} (${formatBytes(f.size)}) — compressé en MP3 avant l'envoi (~${formatBytes(this.app.audio.duration * 5000 || f.size / 30)})`;
        $('eaf-share-audio').innerHTML = text;
    }

    step(text, progress = null) {
        $('eaf-share-step').textContent = text;
        const bar = $('eaf-share-progress');
        bar.hidden = progress === null;
        if (progress !== null) bar.value = progress;
    }

    async publish() {
        const eaf = this.app.eaf;
        const title = $('eaf-share-title').value.trim();
        if (!eaf || this.busy) return;
        if (!title) { this.step('Donnez un titre.'); return; }
        // The URN ties the shared page to this .eaf (ELAN writes one).
        const newUrn = !eaf.property('URN');
        if (newUrn) {
            eaf.setProperty('URN', `urn:nl-mpi-tools-elan-eaf:${crypto.randomUUID()}`);
            this.app.dirty = true;
            this.app.updateProgress();
        }
        this.busy = true;
        $('eaf-share-publish').disabled = true;
        try {
            const file = this.app.audioFile;
            const source = this.audioSource();
            const sendAudio = file && !(this.shared && this.shared.audio_source === source);
            let audio = null;
            if (sendAudio) {
                audio = UPLOAD_AS_IS.test(file.name) ? file : await this.compress(file);
                if (audio.size > MAX_AUDIO_BYTES) throw new Error(`Audio trop lourd (${formatBytes(audio.size)}, maximum ${formatBytes(MAX_AUDIO_BYTES)}) : coupez l'enregistrement en plusieurs parties.`);
            }
            this.step('Publication du texte…');
            const mime = !audio ? '' : audio === file ? mediaMime(file) : audio.type;
            const answer = await postJson(SHARE.publish, {
                urn: eaf.property('URN'),
                title,
                fileName: eaf.fileName,
                data: this.app.exportData(),
                audio: audio ? { source, mime } : null,
            });
            if (answer.upload) {
                await this.upload(answer.upload.url, audio, mime);
                this.step("Enregistrement de l'audio…");
                await postJson(SHARE.audioDone.replace('00000000-0000-0000-0000-000000000000', answer.id),
                    { path: answer.upload.path, source, mime });
            }
            await this.show();
            const box = $('eaf-share-result');
            box.innerHTML = `<span>${answer.created ? 'Publié' : 'Mis à jour'} : <a class="underline" target="_blank" href="${escapeHtml(answer.url)}">${escapeHtml(answer.url)}</a></span>
                <button type="button" class="eaf-btn eaf-btn-light eaf-btn-sm" data-copy>Copier le lien</button>`;
            box.hidden = false;
            box.querySelector('[data-copy]').onclick = (e) => navigator.clipboard?.writeText(answer.url).then(() => { e.target.textContent = 'Copié'; });
            if (newUrn) this.step("Enregistrez le fichier : il garde maintenant l'identifiant qui le relie à cette page.");
        } catch (err) {
            this.step(`Échec : ${err.message}`);
        } finally {
            this.busy = false;
            $('eaf-share-publish').disabled = false;
        }
    }

    compress(file) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(SHARE.worker);
            this.step('Compression de l\'audio…', 0);
            worker.onmessage = ({ data }) => {
                if (data.progress !== undefined) this.step(`Compression de l'audio… ${Math.round(data.progress * 100)} %`, data.progress);
                if (data.blob) { worker.terminate(); resolve(data.blob); }
                if (data.error) { worker.terminate(); reject(new Error(data.error)); }
            };
            worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'compression impossible')); };
            worker.postMessage({ file, lameUrl: new URL(SHARE.lame, location.href).href });
        });
    }

    /** PUT to the signed storage URL, with progress (fetch has none). */
    upload(url, blob, mime) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url);
            xhr.setRequestHeader('Content-Type', mime);
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) this.step(`Envoi de l'audio… ${formatBytes(e.loaded)} / ${formatBytes(e.total)}`, e.loaded / e.total);
            };
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve()
                : reject(new Error(`envoi de l'audio refusé (${xhr.status}) ${xhr.responseText.slice(0, 200)}`)));
            xhr.onerror = () => reject(new Error("envoi de l'audio interrompu (connexion ?)"));
            this.step("Envoi de l'audio…", 0);
            xhr.send(blob);
        });
    }
}

/* -------------------------------------------------------------------------
   Application
   ------------------------------------------------------------------------- */

class TranscriberApp {
    constructor() {
        this.eaf = null;
        this.audioUrl = null;
        this.audioName = '';
        this.hidden = new Set();      // speaker indexes not shown
        this.edited = new Set();      // segment keys changed this session
        this.dirty = false;           // changes since the last save
        this.editor = null;
        this.playing = null;
        this.dir = null;              // folder handle (File System Access API)
        this.fileHandle = null;       // the opened .eaf in that folder
        this.diskModified = 0;        // its lastModified when read / written
        this.rows = [];               // board rows, in time order
        this.rowSegs = [];

        this.audio = $('eaf-audio');
        this.overview = new Overview(this, $('eaf-overview'), $('eaf-overview-tip'));
        this.newFile = new NewFileForm(this);
        this.share = new SharePanel(this);
        $('eaf-pdf').addEventListener('click', () => this.exportPdf());
        this.bindFiles();
        this.bindKeyboard();
        this.bindNavigation();
        this.audio.addEventListener('timeupdate', () => this.onTime());
        this.audio.addEventListener('loadedmetadata', () => this.overview.draw());
        this.audio.addEventListener('play', () => this.tick());
        $('eaf-save').addEventListener('click', () => this.save());
        document.addEventListener('romanization-change', () => this.refreshDerived());
        document.addEventListener('romanization-input-change', () => this.editor?.renderIme());
        // "Lectures": lexicon, a dictionary or all sources (shared with Écrire).
        window.readingSources = new ReadingSourceSwitch({
            root: $('source-switch'),
            status: $('source-status'),
            summary: $('settings-summary'),
            dico,
            onChange: () => this.editor?.renderIme(),
        });
        window.addEventListener('beforeunload', (event) => {
            if (this.dirty) { event.preventDefault(); event.returnValue = ''; }
        });
        this.offerDraft();
        this.offerReopen();
    }

    // ---- files ---------------------------------------------------------

    bindFiles() {
        const app = $('eaf-app');
        $('eaf-open-dir').hidden = !CAN_WRITE_FILES;
        $('eaf-open-dir').addEventListener('click', () => this.pickFolder());
        $('eaf-file-input').addEventListener('change', (e) => { this.openFiles(e.target.files); e.target.value = ''; });
        ['dragenter', 'dragover'].forEach((t) => app.addEventListener(t, (e) => {
            e.preventDefault(); app.classList.add('eaf-dragging');
        }));
        ['dragleave', 'drop'].forEach((t) => app.addEventListener(t, (e) => {
            e.preventDefault(); app.classList.remove('eaf-dragging');
        }));
        app.addEventListener('drop', (e) => this.openDropped(e.dataTransfer));
    }

    confirmDiscard() {
        return !this.dirty || confirm('Des modifications ne sont pas enregistrées et seront perdues. Continuer ?');
    }

    async pickFolder() {
        if (!this.confirmDiscard()) return;
        let dir;
        try {
            dir = await window.showDirectoryPicker({ id: 'hakka-eaf', mode: 'readwrite' });
        } catch (e) { return; /* cancelled */ }
        await this.openFolder(dir);
    }

    /** Lists the folder's .eaf files: opens the only one, else lets the
     *  user pick (the most recent first). */
    async openFolder(dir, preferredName = null) {
        const eafs = [];
        for await (const entry of dir.values()) {
            if (entry.kind === 'file' && /\.eaf$/i.test(entry.name)) eafs.push(entry);
        }
        if (!eafs.length) {
            this.message(`Aucun fichier .eaf dans le dossier « ${dir.name} ».`);
            return;
        }
        const preferred = eafs.find((h) => h.name === preferredName);
        if (preferred || eafs.length === 1) {
            await this.openHandle(dir, preferred || eafs[0]);
            return;
        }
        const dated = await Promise.all(eafs.map(async (h) => ({ h, at: (await h.getFile()).lastModified })));
        dated.sort((a, b) => b.at - a.at);
        const box = $('eaf-choose');
        box.innerHTML = `<span>Dossier <b>${escapeHtml(dir.name)}</b> : quel fichier ouvrir ?</span>` + dated.map(({ h, at }, i) =>
            `<button type="button" class="eaf-btn eaf-btn-light" data-pick="${i}">${escapeHtml(h.name)}
               <small class="text-gray-500">&nbsp;${escapeHtml(new Date(at).toLocaleString('fr-FR'))}</small></button>`).join('');
        box.hidden = false;
        box.onclick = (event) => {
            const pick = event.target.closest('[data-pick]');
            if (!pick) return;
            box.hidden = true;
            this.openHandle(dir, dated[Number(pick.dataset.pick)].h);
        };
    }

    async openHandle(dir, handle) {
        try {
            const file = await handle.getFile();
            this.dir = dir;
            this.fileHandle = handle;
            this.diskModified = file.lastModified;
            this.load(await file.text(), file.name);
            handleStore.set('last', { dir, name: handle.name });
            $('eaf-reopen').hidden = true;
        } catch (err) {
            this.message(err.message);
            return;
        }
        // The audio: the file's media reference, else the folder's only one.
        let media = null;
        const ref = this.eaf.mediaReference();
        if (ref) media = await resolveRelative(dir, ref.relative) || await resolveRelative(dir, ref.name);
        if (!media) {
            const audios = [];
            for await (const entry of dir.values()) if (entry.kind === 'file' && MEDIA_RE.test(entry.name)) audios.push(entry);
            if (audios.length === 1) media = audios[0];
            else if (audios.length > 1) {
                this.message(`Plusieurs enregistrements dans le dossier et aucun ne correspond à « ${ref?.name || '?'} » : ouvrez l'audio avec « Fichiers… ».`);
            }
        }
        if (media) this.setAudio(await media.getFile());
        else if (!this.audioName) this.updateInfo();
        this.checkMedia();
    }

    async openDropped(transfer) {
        // A dropped folder (Chromium) is opened like a picked one.
        const items = Array.from(transfer.items || []);
        if (CAN_WRITE_FILES && items.length === 1 && items[0].getAsFileSystemHandle) {
            const handle = await items[0].getAsFileSystemHandle();
            if (handle?.kind === 'directory') {
                if (this.confirmDiscard() && await ensurePermission(handle)) await this.openFolder(handle);
                return;
            }
        }
        this.openFiles(transfer.files);
    }

    /** Files picked or dropped one by one: no folder to save into, the
     *  .eaf is downloaded instead. */
    async openFiles(fileList) {
        const files = Array.from(fileList || []);
        const eafFile = files.find((f) => /\.eaf$/i.test(f.name));
        const media = files.find((f) => /^(audio|video)\//.test(f.type) || MEDIA_RE.test(f.name));
        if (!eafFile && !media) {
            this.message('Aucun fichier .eaf ni audio reconnu.');
            return;
        }
        if (eafFile) {
            if (!this.confirmDiscard()) return;
            try {
                this.dir = null;
                this.fileHandle = null;
                this.load(await eafFile.text(), eafFile.name);
            } catch (err) {
                this.message(err.message);
                return;
            }
        }
        if (media) this.setAudio(media);
        this.checkMedia();
    }

    load(xml, fileName, { fromDraft = false } = {}) {
        const eaf = EafDocument.parse(xml, fileName);
        if (!eaf.speakers.length) throw new Error("Ce fichier ne contient aucun tier principal aligné sur le temps (locuteur).");
        this.eaf = eaf;
        this.edited.clear();
        this.hidden.clear();
        this.dirty = fromDraft;
        this.editor = null;
        this.message('');
        $('eaf-choose').hidden = true;
        const moved = this.migrate();
        if (moved) {
            this.message(`${moved} segment${moved > 1 ? 's' : ''} : le transcript (texte avec espaces et lectures, jusqu'ici dans le tier Hanzi ou Transcript) a été repris dans le tier principal, et le tier Hanzi ne garde que les caractères. Enregistrez pour l'appliquer au fichier (l'ancienne version sera sauvegardée).`);
        }
        if (!fromDraft) this.offerDraft(fileName);
        else $('eaf-draft').hidden = true;
        this.render();
        ['eaf-save', 'eaf-pdf', 'eaf-share-open'].forEach((id) => { $(id).disabled = false; });
        $('eaf-share').hidden = true;
        $('eaf-audio-bar').hidden = false;
        this.updateInfo();
        requestAnimationFrame(() => this.updateView());
    }

    /** Earlier files kept the transcript in a child tier: "Transcript"
     *  (moved, then removed) or Hanzi, when the speaker tier still holds
     *  the bare romanization (moved; Hanzi keeps the characters). */
    migrate() {
        let moved = this.eaf.absorbTranscriptTiers();
        if (moved) this.dirty = true;
        this.eaf.segments.forEach((seg) => {
            if (!seg.hanzi || HAN_RE.test(seg.transcript)) return;
            const hanzi = deriveFromTranscript(seg.hanzi).hanzi;
            this.write(seg, 'transcript', seg.hanzi, { silent: true });
            if (hanzi !== seg.hanzi) this.write(seg, 'hanzi', hanzi, { silent: true });
            moved++;
        });
        return moved;
    }

    setAudio(file) {
        if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
        this.audioUrl = URL.createObjectURL(file);
        this.audioName = file.name;
        this.audioFile = file;
        this.audio.src = this.audioUrl;
        this.audio.hidden = false;
        $('eaf-audio-bar').hidden = false;
        this.updateInfo();
    }

    checkMedia() {
        if (!this.eaf || !this.audioName) return;
        const expected = this.eaf.mediaFileName();
        if (expected && expected.toLowerCase() !== this.audioName.toLowerCase()) {
            this.message(`L'audio ouvert (« ${this.audioName} ») n'est pas celui référencé par le fichier (« ${expected} ») : vérifiez qu'il s'agit du bon enregistrement.`);
        }
    }

    updateInfo() {
        const parts = [];
        if (this.eaf) {
            const n = this.eaf.speakers.length;
            const where = this.dir ? `${escapeHtml(this.dir.name)}/` : '';
            parts.push(`<b>${where}${escapeHtml(this.eaf.fileName)}</b> · ${n} locuteur${n > 1 ? 's' : ''} · ${this.eaf.segments.length} segments`);
        }
        parts.push(this.audioName ? `audio : ${escapeHtml(this.audioName)}` : (this.eaf ? '<span class="text-amber-700">audio non ouvert</span>' : ''));
        $('eaf-file-info').innerHTML = parts.filter(Boolean).join(' · ') || $('eaf-file-info').innerHTML;
        $('eaf-save').textContent = this.fileHandle ? 'Enregistrer' : 'Télécharger le .eaf';
        $('eaf-save').title = this.fileHandle
            ? `Ctrl+S — écrase ${this.eaf.fileName}, l'ancienne version est copiée dans ${BACKUP_DIR}/`
            : 'Ctrl+S — ouvert sans dossier : le fichier est téléchargé';
        this.updateProgress();
    }

    updateProgress() {
        if (!this.eaf) return;
        const done = this.eaf.segments.filter((s) => segmentState(s) === 'done').length;
        $('eaf-progress').textContent = `${done} / ${this.eaf.segments.length} segments en hanzi`;
        $('eaf-dirty').hidden = !this.dirty;
        this.eaf.speakers.forEach((sp) => {
            const el = document.querySelector(`[data-speaker-count="${sp.index}"]`);
            if (!el) return;
            const segs = this.eaf.segments.filter((s) => s.speaker === sp);
            el.textContent = `${segs.filter((s) => segmentState(s) === 'done').length}/${segs.length}`;
        });
        this.overview.draw();
    }

    message(text) {
        const box = $('eaf-messages');
        box.textContent = text;
        box.hidden = !text;
    }

    // ---- board ---------------------------------------------------------

    visibleSpeakers() {
        return this.eaf.speakers.filter((s) => !this.hidden.has(s.index));
    }

    render() {
        const speakers = this.visibleSpeakers();
        const board = $('eaf-board');
        board.hidden = false;
        board.style.setProperty('--eaf-cols', `4.2rem repeat(${speakers.length}, minmax(0, 1fr))`);

        $('eaf-header').innerHTML = `<div>Temps</div>` + speakers.map((sp) => `
                <div class="eaf-speaker-head" style="--c:${speakerColor(sp)}">
                  <label title="Afficher / masquer ce locuteur">
                    <input type="checkbox" checked data-toggle-speaker="${sp.index}">
                    <span class="eaf-dot"></span><span class="eaf-speaker-name">${escapeHtml(sp.participant)}</span>
                  </label>
                  <span class="eaf-speaker-count" data-speaker-count="${sp.index}"></span>
                </div>`).join('');
        // Hidden speakers stay reachable to show them again.
        const hiddenList = this.eaf.speakers.filter((s) => this.hidden.has(s.index));
        if (hiddenList.length) {
            $('eaf-header').insertAdjacentHTML('beforeend', `<div style="grid-column:1/-1" class="eaf-hidden-list">Masqués : ${
                hiddenList.map((sp) => `<label><input type="checkbox" data-toggle-speaker="${sp.index}"> ${escapeHtml(sp.participant)}</label>`).join(' ')}</div>`);
        }
        $('eaf-header').querySelectorAll('[data-toggle-speaker]').forEach((box) => box.addEventListener('change', () => {
            const index = Number(box.dataset.toggleSpeaker);
            if (box.checked) this.hidden.delete(index);
            else if (this.visibleSpeakers().length > 1) this.hidden.add(index);
            this.close();
            this.render();
        }));

        const columnOf = new Map(speakers.map((sp, i) => [sp.index, i]));
        const html = [];
        this.rowSegs = this.eaf.segments.filter((seg) => columnOf.has(seg.speaker.index));
        this.rowSegs.forEach((seg) => {
            const cells = speakers.map((sp) => sp === seg.speaker ? `<div class="eaf-cell">${this.cardHtml(seg)}</div>` : '<div class="eaf-cell"></div>');
            html.push(`<div class="eaf-row" data-key="${escapeHtml(seg.key)}">
                <div class="eaf-time"><button type="button" data-play="${escapeHtml(seg.key)}" title="Écouter">▶ ${formatTime(seg.start)}</button></div>
                ${cells.join('')}</div>`);
        });
        $('eaf-rows').innerHTML = html.join('') || `<div class="eaf-empty">Aucun segment pour l'instant : découpez l'enregistrement dans ELAN
            (une annotation par prise de parole, dans le tier du locuteur), enregistrez, puis rouvrez le fichier ici.</div>`;
        this.rows = html.length ? Array.from($('eaf-rows').children) : [];
        $('eaf-rows').onclick = (event) => {
            const play = event.target.closest('[data-play]');
            if (play) { this.play(this.eaf.segmentsByKey.get(play.dataset.play)); return; }
            const card = event.target.closest('.eaf-seg');
            if (card) this.open(this.eaf.segmentsByKey.get(card.dataset.key));
        };
        this.updateProgress();
        this.updateView();
    }

    cardHtml(seg) {
        const color = speakerColor(seg.speaker);
        const state = segmentState(seg);
        const main = state !== 'empty'
            ? `<div class="eaf-seg-main hanzi">${escapeHtml(seg.hanzi || plainHanzi(seg.transcript))}</div>`
            : `<div class="eaf-seg-main is-todo">${escapeHtml(seg.transcript || '—')}</div>`;
        const sub = [seg.pinyin, seg.translation].filter(Boolean).map((t) => `<div class="eaf-seg-sub">${escapeHtml(t)}</div>`).join('');
        const active = this.editor?.segment === seg ? ' is-active' : '';
        const playing = this.playing === seg ? ' is-playing' : '';
        return `<button type="button" class="eaf-seg${active}${playing}" data-key="${escapeHtml(seg.key)}" style="--c:${color}">
            <span class="eaf-seg-state" title="${STATE_TITLES[state]}" style="color:${color}">${STATE_MARKS[state]}</span>
            <span class="eaf-speaker-tag">${escapeHtml(seg.speaker.participant)}</span>${main}${sub}</button>`;
    }

    rowOf(seg) {
        const i = this.rowSegs.indexOf(seg);
        return i >= 0 ? this.rows[i] : null;
    }

    refreshCard(seg) {
        const card = this.rowOf(seg)?.querySelector('.eaf-seg');
        if (card) card.outerHTML = this.cardHtml(seg);
    }

    // ---- navigation ----------------------------------------------------

    bindNavigation() {
        let pending = false;
        const update = () => {
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => { pending = false; this.updateView(); });
        };
        window.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        // Rows scroll in under the sticky bar and column header.
        const bar = $('eaf-audio-bar');
        new ResizeObserver(() => {
            $('eaf-app').style.setProperty('--eaf-bar-h', `${bar.hidden ? 0 : bar.offsetHeight}px`);
        }).observe(bar);
        $('eaf-todo-prev').addEventListener('click', () => this.stepTodo(-1));
        $('eaf-todo-next').addEventListener('click', () => this.stepTodo(1));
    }

    /** Top of the visible part of the board, below the sticky elements. */
    stickyBottom() {
        return $('eaf-header').getBoundingClientRect().bottom;
    }

    /** Time range of the rows on screen, for the overview. */
    updateView() {
        if (!this.eaf || !this.rows.length) return;
        const top = this.stickyBottom();
        const bottom = window.innerHeight;
        const first = Math.min(this.rows.length - 1,
            lastAtOrBefore(this.rows, top, (r) => r.getBoundingClientRect().bottom) + 1);
        const last = Math.max(first, lastAtOrBefore(this.rows, bottom, (r) => r.getBoundingClientRect().top));
        const view = { start: this.rowSegs[first].start, end: Math.max(this.rowSegs[last].end, this.rowSegs[last].start) };
        this.overview.setView(view);
        $('eaf-view-range').textContent = `à l'écran : ${formatTime(view.start)} – ${formatTime(view.end)}`;
    }

    /** Visible segment at time t: the last one starting before it. */
    segmentAtTime(t) {
        const i = lastAtOrBefore(this.rowSegs, t, (s) => s.start);
        return this.rowSegs[Math.max(0, i)] || null;
    }

    scrollToTime(t, { smooth = true } = {}) {
        const seg = this.segmentAtTime(t);
        this.scrollRowToTop(seg && this.rowOf(seg), { smooth });
    }

    /** Scrolls `row` to just below the sticky audio bar and column header. */
    scrollRowToTop(row, { smooth = true } = {}) {
        if (!row) return;
        const bar = $('eaf-audio-bar');
        const covered = (bar.hidden ? 0 : bar.offsetHeight) + $('eaf-header').offsetHeight;
        window.scrollTo({ top: window.scrollY + row.getBoundingClientRect().top - covered, behavior: smooth ? 'smooth' : 'auto' });
    }

    /** Next/previous visible segment whose transcript isn't done, from the
     *  segment being edited or the rows on screen. */
    stepTodo(delta) {
        if (!this.eaf) return;
        let from = this.editor ? this.rowSegs.indexOf(this.editor.segment) : -1;
        if (from < 0) {
            // From the first row on screen, included when going down.
            const first = lastAtOrBefore(this.rows, this.stickyBottom(), (r) => r.getBoundingClientRect().bottom) + 1;
            from = delta > 0 ? first - 1 : first;
        }
        for (let i = from + delta; i >= 0 && i < this.rowSegs.length; i += delta) {
            if (segmentState(this.rowSegs[i]) !== 'done') { this.open(this.rowSegs[i]); return; }
        }
        this.message(delta > 0 ? 'Plus aucun segment à compléter après celui-ci.' : 'Plus aucun segment à compléter avant celui-ci.');
    }

    // ---- editing -------------------------------------------------------

    open(seg) {
        if (!seg) return;
        this.close();
        this.editor = new SegmentEditor(this, seg);
        const row = this.rowOf(seg);
        if (!row) return;
        row.after(this.editor.row);
        this.refreshCard(seg);
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        this.editor.focus();
        if (this.audioUrl) this.play(seg);
        this.overview.draw();
    }

    close() {
        if (!this.editor) return;
        const seg = this.editor.segment;
        this.editor.row.remove();
        this.editor = null;
        this.refreshCard(seg);
        this.overview.draw();
    }

    /** Next/previous visible segment. */
    step(delta) {
        if (!this.eaf) return;
        const i = this.editor ? this.rowSegs.indexOf(this.editor.segment) : -1;
        const target = this.rowSegs[Math.min(this.rowSegs.length - 1, Math.max(0, i + delta))];
        if (target) this.open(target);
    }

    write(seg, role, value, { silent = false } = {}) {
        if ((seg[role] ?? '') === value) return;
        this.eaf.setText(seg, role, value);
        this.edited.add(seg.key);
        this.dirty = true;
        if (!silent) this.changed(seg);
    }

    /** After writes to `seg`: its card, the progress, the draft. */
    changed(seg) {
        this.refreshCard(seg);
        this.updateProgress();
        this.scheduleDraft();
    }

    refreshDerived() {
        if (!this.eaf) return;
        // Recompute the lines derived from the transcripts edited in this
        // session in the newly displayed system (the others keep what the
        // file has).
        this.edited.forEach((key) => {
            const seg = this.eaf.segmentsByKey.get(key);
            if (!seg?.transcript) return;
            const derived = deriveFromTranscript(seg.transcript);
            this.write(seg, 'pinyin', derived.pinyin, { silent: true });
            this.write(seg, 'mixed', derived.mixed, { silent: true });
            this.write(seg, 'hanzi', derived.hanzi, { silent: true });
            this.changed(seg);
        });
        this.editor?.refreshDerived();
    }

    // ---- audio ---------------------------------------------------------

    play(seg) {
        if (!seg) return;
        if (!this.audioUrl) {
            this.message("Ouvrez l'enregistrement audio pour écouter les segments.");
            return;
        }
        this.audio.currentTime = seg.start / 1000;
        this.stopAt = seg.end / 1000;
        this.setPlaying(seg);
        this.audio.play().catch(() => {});
    }

    onTime() {
        if (this.stopAt != null && this.audio.currentTime >= this.stopAt) {
            this.audio.pause();
            this.stopAt = null;
            this.setPlaying(null);
        } else if (this.stopAt == null && !this.audio.paused) {
            // Played from the audio bar: follow along in the page.
            const t = this.audio.currentTime * 1000;
            const seg = this.rowSegs.filter((s) => s.start <= t && t < s.end).pop() || null;
            // In the gaps between segments, the last one heard stays up.
            if (seg && seg !== this.playing) {
                this.setPlaying(seg);
                if ($('eaf-follow').checked && !this.editor) this.scrollRowToTop(this.rowOf(seg));
            }
        }
        this.overview.draw();
    }

    /** Smooth playhead while playing (timeupdate is ~4 Hz). */
    tick() {
        if (this.audio.paused) return;
        this.overview.draw();
        requestAnimationFrame(() => this.tick());
    }

    setPlaying(seg) {
        this.playing = seg;
        document.querySelectorAll('.eaf-seg.is-playing').forEach((el) => el.classList.remove('is-playing'));
        if (seg) this.rowOf(seg)?.querySelector('.eaf-seg')?.classList.add('is-playing');
    }

    // ---- keyboard ------------------------------------------------------

    bindKeyboard() {
        window.addEventListener('keydown', (event) => {
            if (!this.eaf) return;
            if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') { event.preventDefault(); this.save(); return; }
            if (event.key === 'Escape' && this.editor) { this.close(); return; }
            if (!event.altKey) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); this.step(1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); this.step(-1); }
            else if (event.key === 'PageDown') { event.preventDefault(); this.stepTodo(1); }
            else if (event.key === 'PageUp') { event.preventDefault(); this.stepTodo(-1); }
            else if (event.key === 'Enter' && this.editor) { event.preventDefault(); this.play(this.editor.segment); }
            else if (/^Digit[1-9]$/.test(event.code) && this.editor) {
                // event.code, not event.key: Alt+digit types nothing and works
                // the same on AZERTY and QWERTY keyboards.
                event.preventDefault();
                this.editor.select(Number(event.code.slice(5)) - 1);
            }
        });
    }

    // ---- output --------------------------------------------------------

    /** The transcript as the group reads it (TranscriptDocument): the
     *  speakers shown, their segments with hanzi, pinyin and French. Lines
     *  never derived (segments not edited here) are derived now. */
    exportData() {
        const speakers = this.visibleSpeakers();
        const column = new Map(speakers.map((sp, i) => [sp.index, i]));
        const segments = this.eaf.segments.filter((s) => column.has(s.speaker.index)).map((s) => {
            let { hanzi, pinyin } = s;
            if (HAN_RE.test(s.transcript) && (!hanzi || !pinyin)) {
                const derived = deriveFromTranscript(s.transcript);
                hanzi = hanzi || derived.hanzi;
                pinyin = pinyin || derived.pinyin;
            }
            return {
                start: s.start, end: s.end, speaker: column.get(s.speaker.index),
                hanzi, pinyin, translation: s.translation, transcript: s.transcript,
            };
        });
        return {
            title: $('eaf-share-title').value.trim() || this.eaf.fileName.replace(/\.eaf$/i, ''),
            fileName: this.eaf.fileName,
            audioName: this.audioName || this.eaf.mediaFileName(),
            participants: speakers.map((sp) => ({ name: sp.participant, tier: sp.id })),
            segments,
        };
    }

    exportPdf() {
        if (!this.eaf) return;
        if (!TranscriptDocument.print(this.exportData())) {
            this.message("Le navigateur a bloqué le nouvel onglet : autorisez les fenêtres pour ce site, puis recommencez.");
        }
    }

    async save() {
        if (!this.eaf) return;
        if (!this.fileHandle) { this.download(); return; }
        const button = $('eaf-save');
        button.disabled = true;
        try {
            if (!await ensurePermission(this.dir)) throw new Error("Accès en écriture au dossier refusé.");
            // The previous version goes to sauvegardes/ before overwriting.
            const current = await this.fileHandle.getFile();
            if (current.lastModified !== this.diskModified
                && !confirm(`${this.eaf.fileName} a été modifié sur le disque depuis son ouverture (par ELAN ?). L'écraser quand même ? (L'autre version sera gardée dans ${BACKUP_DIR}/.)`)) {
                return;
            }
            const backups = await this.dir.getDirectoryHandle(BACKUP_DIR, { create: true });
            const backupName = this.eaf.fileName.replace(/(\.eaf)?$/i, `.${backupStamp()}.eaf`);
            await this.writeFile(await backups.getFileHandle(backupName, { create: true }), await current.text());
            await this.writeFile(this.fileHandle, this.eaf.serialize());
            this.diskModified = (await this.fileHandle.getFile()).lastModified;
            this.dirty = false;
            this.saveDraft();
            this.updateProgress();
            this.flash(`Enregistré à ${new Date().toLocaleTimeString('fr-FR')} · ancienne version : ${BACKUP_DIR}/${backupName}`);
        } catch (err) {
            this.message(`Enregistrement impossible : ${err.message}`);
        } finally {
            button.disabled = false;
        }
    }

    async writeFile(handle, text) {
        // createWritable() writes to a temporary file, swapped in on close().
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
    }

    flash(text) {
        const el = $('eaf-saved');
        el.textContent = text;
        el.hidden = false;
        clearTimeout(this.flashTimer);
        this.flashTimer = setTimeout(() => { el.hidden = true; }, 6000);
    }

    download() {
        const blob = new Blob([this.eaf.serialize()], { type: 'application/xml' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = this.eaf.fileName.replace(/(\.eaf)?$/i, '.eaf');
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        this.dirty = false;
        this.saveDraft();
        this.updateProgress();
    }

    scheduleDraft() {
        clearTimeout(this.draftTimer);
        this.draftTimer = setTimeout(() => this.saveDraft(), 1200);
    }

    saveDraft() {
        if (!this.eaf) return;
        try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify({
                fileName: this.eaf.fileName,
                xml: this.eaf.serialize(),
                savedAt: new Date().toISOString(),
                dirty: this.dirty,
            }));
        } catch (e) { /* quota or private mode: saving the file still works */ }
    }

    readDraft() {
        try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
    }

    /** Offers to restore an unsaved draft: on page load, or after opening a
     *  file with the same name. Restoring keeps the opened file as the one
     *  "Enregistrer" writes to. */
    offerDraft(openedName = null) {
        const draft = this.readDraft();
        const box = $('eaf-draft');
        box.hidden = true;
        if (!draft?.xml || !draft.dirty || (openedName && draft.fileName !== openedName)) return;
        const when = new Date(draft.savedAt).toLocaleString('fr-FR');
        box.innerHTML = `<span>Modifications non enregistrées de <b>${escapeHtml(draft.fileName)}</b>, gardées dans ce navigateur le ${escapeHtml(when)}.</span>
            <button type="button" class="eaf-btn eaf-btn-light" data-draft="restore">Les reprendre</button>
            <button type="button" class="eaf-btn eaf-btn-light" data-draft="discard">${openedName ? 'Garder le fichier ouvert' : 'Ignorer'}</button>`;
        box.hidden = false;
        box.onclick = (event) => {
            const act = event.target.closest('[data-draft]')?.dataset.draft;
            if (act === 'restore') {
                try {
                    if (!openedName) { this.dir = null; this.fileHandle = null; }
                    this.load(draft.xml, draft.fileName, { fromDraft: true });
                    this.checkMedia();
                } catch (err) { this.message(err.message); }
            }
            if (act === 'discard') box.hidden = true;
        };
    }

    /** "Rouvrir": the last file opened from a folder. */
    async offerReopen() {
        if (!CAN_WRITE_FILES) return;
        const last = await handleStore.get('last');
        if (!last?.dir || this.eaf) return;
        const button = $('eaf-reopen');
        button.textContent = `Rouvrir ${last.dir.name}/${last.name}`;
        button.hidden = false;
        button.onclick = async () => {
            if (!this.confirmDiscard()) return;
            if (!await ensurePermission(last.dir)) { this.message('Accès au dossier refusé.'); return; }
            await this.openFolder(last.dir, last.name);
        };
    }
}

window.transcriber = new TranscriberApp();
