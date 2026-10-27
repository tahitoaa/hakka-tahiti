/* =========================================================================
   ELAN transcription editor (transcripter.html).

   Open one .eaf file and its audio; each top-level tier is a speaker (one
   column). For each segment, the speaker tier holds the romanization as
   typed; the editor fills the child tiers with the converter's input
   method: Hanzi (working text, pinned readings included), Traduction, and
   the derived Pinyin (in the "J'affiche en" system) and Mixed lines.
   The file itself is an EafDocument: only annotation values change, the
   rest of the ELAN structure is kept as is. Work in progress is kept as a
   draft in this browser; "Télécharger le .eaf" produces the file.
   ========================================================================= */

const dico = new Dictionary({ itemSelector: 'li', containerId: '#pron-list' });
const $ = (id) => document.getElementById(id);

const SPEAKER_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2'];
const DRAFT_KEY = 'hakka-eaf-draft';

function escapeHtml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(ms) {
    const s = Math.max(0, ms) / 1000;
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** Hanzi tier text without pinned readings: 生(sen1) -> 生. */
function plainHanzi(text) {
    return String(text || '').replace(/\([^()]*\)/g, '');
}

/** Pinyin and mixed lines derived from the Hanzi working text, the pinyin
 *  in the system picked in "J'affiche en". */
function deriveFromHanzi(text) {
    const sentences = String(text || '').split('\n').filter((l) => l.trim()).map((l) => new Sentence(dico, l));
    const hanzi = sentences.map((s) => s.renderHanziLine()).join(' ').trim();
    const pinyin = sentences.map((s) => s.renderDisplayPinyinLine()).join(' ').trim();
    return { pinyin, mixed: [pinyin, hanzi].filter(Boolean).join(' ') };
}

/** 'empty' | 'partial' (romanized syllables left to convert) | 'done'. */
function segmentState(segment) {
    if (!segment.hanzi.trim()) return 'empty';
    return /\p{L}[\p{L}'’]*[_1-8]/u.test(plainHanzi(segment.hanzi)) ? 'partial' : 'done';
}

const STATE_MARKS = { empty: '○', partial: '◐', done: '●' };
const STATE_TITLES = { empty: 'hanzi à saisir', partial: 'hanzi en cours', done: 'hanzi saisis' };

/* -------------------------------------------------------------------------
   Segment editor (opened under a row)
   ------------------------------------------------------------------------- */

class SegmentEditor {
    constructor(app, segment) {
        this.app = app;
        this.segment = segment;
        const hasHanzi = !!segment.hanzi;
        // Start from the Hanzi tier, or from the romanization to convert it.
        this.prefill = hasHanzi ? segment.hanzi : segment.romanization;
        this.touched = hasHanzi;
        this.model = new HakkaText(dico, this.prefill);
        this.build();
        this.renderIme();
    }

    build() {
        const s = this.segment;
        const color = SPEAKER_COLORS[s.speaker.index % SPEAKER_COLORS.length];
        this.row = document.createElement('div');
        this.row.className = 'eaf-row eaf-editor-row';
        this.row.innerHTML = `
            <div class="eaf-editor" style="--c:${color}">
              <div class="eaf-editor-head">
                <span class="eaf-dot"></span><b>${escapeHtml(s.speaker.participant)}</b>
                <span class="text-gray-500">${formatTime(s.start)} → ${formatTime(s.end)}</span>
                <button type="button" class="eaf-btn eaf-btn-light" data-act="play" title="Alt+Entrée">▶ Écouter</button>
                <span class="grow"></span>
                <button type="button" class="eaf-btn eaf-btn-light" data-act="prev" title="Alt+↑">↑ Précédent</button>
                <button type="button" class="eaf-btn eaf-btn-light" data-act="next" title="Alt+↓">↓ Suivant</button>
                <button type="button" class="eaf-btn eaf-btn-light" data-act="close" title="Échap">✕</button>
              </div>
              <label class="eaf-field"><span>Romanisation<br><small>tier « ${escapeHtml(s.speaker.id)} »</small></span>
                <textarea data-role="romanization" rows="1" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea></label>
              <div class="eaf-field"><span>Hanzi</span>
                <div class="eaf-ime">
                  <textarea data-role="hanzi" class="hanzi-input" rows="2" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
                  <div data-role="suggestions" class="flex gap-1.5 flex-wrap"></div>
                  <div data-role="preview" class="eaf-preview"></div>
                </div>
              </div>
              <label class="eaf-field"><span>Traduction</span>
                <textarea data-role="translation" rows="1"></textarea></label>
              <div class="eaf-field"><span>Pinyin <small>(auto)</small></span><div data-role="pinyin" class="eaf-derived"></div></div>
              <div class="eaf-field"><span>Mixte <small>(auto)</small></span><div data-role="mixed" class="eaf-derived"></div></div>
            </div>`;
        const q = (sel) => this.row.querySelector(sel);
        this.romanization = q('[data-role="romanization"]');
        this.hanzi = q('[data-role="hanzi"]');
        this.translation = q('[data-role="translation"]');
        this.preview = q('[data-role="preview"]');
        this.pinyinOut = q('[data-role="pinyin"]');
        this.mixedOut = q('[data-role="mixed"]');

        this.romanization.value = s.romanization;
        this.hanzi.value = this.prefill;
        this.translation.value = s.translation;
        this.pinyinOut.textContent = s.pinyin;
        this.mixedOut.textContent = s.mixed;

        this.suggestionBar = new SuggestionBar(q('[data-role="suggestions"]'), {
            anchorTo: this.hanzi,
            shortcutLabel: 'Alt',
            onSelect: (i) => this.select(i),
        });

        this.romanization.addEventListener('input', () => {
            this.app.write(s, 'romanization', this.romanization.value);
            // Not converted yet: the Hanzi field follows the romanization.
            if (!this.touched) {
                this.hanzi.value = this.romanization.value;
                this.renderIme();
            }
        });
        this.hanzi.addEventListener('input', () => { this.touched = true; this.renderIme(); this.commitHanzi(); });
        this.translation.addEventListener('input', () => this.app.write(s, 'translation', this.translation.value));
        this.row.addEventListener('click', (event) => {
            const act = event.target.closest('[data-act]')?.dataset.act;
            if (act === 'play') this.app.play(s);
            if (act === 'prev') this.app.step(-1);
            if (act === 'next') this.app.step(1);
            if (act === 'close') this.app.close();
        });
        [this.romanization, this.hanzi, this.translation].forEach(autosize);
    }

    renderIme() {
        this.model.update({ hanzi: this.hanzi.value });
        this.suggestionBar.render(this.model.suggestions);
        this.preview.innerHTML = this.model.sentences.map((x) => x.renderTokens()).join('');
    }

    select(index) {
        if (!this.model.suggestions[index]) return;
        this.touched = true;
        this.model.select(index);
        this.hanzi.value = this.model.text;
        autosize(this.hanzi);
        this.renderIme();
        this.commitHanzi();
        this.hanzi.focus();
    }

    commitHanzi() {
        if (!this.touched) return;
        const text = this.hanzi.value;
        const derived = deriveFromHanzi(text);
        this.app.write(this.segment, 'hanzi', text, { silent: true });
        this.app.write(this.segment, 'pinyin', derived.pinyin, { silent: true });
        this.app.write(this.segment, 'mixed', derived.mixed);
        this.pinyinOut.textContent = derived.pinyin;
        this.mixedOut.textContent = derived.mixed;
    }

    /** Display system changed: recompute the derived lines if edited. */
    refreshDerived() {
        this.renderIme();
        if (this.touched) this.commitHanzi();
    }

    focus() {
        this.hanzi.focus();
    }
}

function autosize(textarea) {
    const fit = () => { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight + 2}px`; };
    textarea.addEventListener('input', fit);
    requestAnimationFrame(fit);
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
        this.dirty = false;           // changes since the last download
        this.editor = null;
        this.playing = null;

        this.audio = $('eaf-audio');
        this.bindFiles();
        this.bindKeyboard();
        this.audio.addEventListener('timeupdate', () => this.checkStop());
        $('eaf-download').addEventListener('click', () => this.download());
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
    }

    // ---- files ---------------------------------------------------------

    bindFiles() {
        const app = $('eaf-app');
        $('eaf-file-input').addEventListener('change', (e) => this.openFiles(e.target.files));
        ['dragenter', 'dragover'].forEach((t) => app.addEventListener(t, (e) => {
            e.preventDefault(); app.classList.add('eaf-dragging');
        }));
        ['dragleave', 'drop'].forEach((t) => app.addEventListener(t, (e) => {
            e.preventDefault(); app.classList.remove('eaf-dragging');
        }));
        app.addEventListener('drop', (e) => this.openFiles(e.dataTransfer.files));
    }

    async openFiles(fileList) {
        const files = Array.from(fileList || []);
        const eafFile = files.find((f) => /\.eaf$/i.test(f.name));
        const media = files.find((f) => /^(audio|video)\//.test(f.type) || /\.(wav|mp3|m4a|ogg|flac|webm|mp4)$/i.test(f.name));
        if (!eafFile && !media) {
            this.message('Aucun fichier .eaf ni audio reconnu.');
            return;
        }
        if (eafFile) {
            if (this.dirty && !confirm('Des modifications non téléchargées seront perdues. Ouvrir le nouveau fichier ?')) return;
            try {
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
        this.eaf = EafDocument.parse(xml, fileName);
        this.edited.clear();
        this.hidden.clear();
        this.dirty = fromDraft;
        this.editor = null;
        this.message('');
        if (!this.eaf.speakers.length) throw new Error("Ce fichier ne contient aucun tier principal aligné sur le temps (locuteur).");
        if (!fromDraft) this.offerDraft(fileName);
        else $('eaf-draft').hidden = true;
        this.render();
        $('eaf-download').disabled = false;
        this.updateInfo();
    }

    setAudio(file) {
        if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
        this.audioUrl = URL.createObjectURL(file);
        this.audioName = file.name;
        this.audio.src = this.audioUrl;
        $('eaf-audio-bar').hidden = false;
        $('eaf-app').classList.add('has-audio');
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
            parts.push(`<b>${escapeHtml(this.eaf.fileName)}</b> · ${n} locuteur${n > 1 ? 's' : ''} · ${this.eaf.segments.length} segments`);
        }
        parts.push(this.audioName ? `audio : ${escapeHtml(this.audioName)}` : (this.eaf ? '<span class="text-amber-700">audio non ouvert</span>' : ''));
        $('eaf-file-info').innerHTML = parts.filter(Boolean).join(' · ') || $('eaf-file-info').innerHTML;
        this.updateProgress();
    }

    updateProgress() {
        if (!this.eaf) return;
        const done = this.eaf.segments.filter((s) => segmentState(s) === 'done').length;
        $('eaf-progress').textContent = `${done} / ${this.eaf.segments.length} segments en hanzi${this.dirty ? ' · non téléchargé' : ''}`;
        this.eaf.speakers.forEach((sp) => {
            const el = document.querySelector(`[data-speaker-count="${sp.index}"]`);
            if (!el) return;
            const segs = this.eaf.segments.filter((s) => s.speaker === sp);
            el.textContent = `${segs.filter((s) => segmentState(s) === 'done').length}/${segs.length}`;
        });
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
                <div class="eaf-speaker-head" style="--c:${SPEAKER_COLORS[sp.index % SPEAKER_COLORS.length]}">
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
        this.eaf.segments.forEach((seg) => {
            if (!columnOf.has(seg.speaker.index)) return;
            const cells = speakers.map((sp) => sp === seg.speaker ? `<div class="eaf-cell">${this.cardHtml(seg)}</div>` : '<div class="eaf-cell"></div>');
            html.push(`<div class="eaf-row" data-key="${escapeHtml(seg.key)}">
                <div class="eaf-time"><button type="button" data-play="${escapeHtml(seg.key)}" title="Écouter">▶ ${formatTime(seg.start)}</button></div>
                ${cells.join('')}</div>`);
        });
        $('eaf-rows').innerHTML = html.join('');
        $('eaf-rows').onclick = (event) => {
            const play = event.target.closest('[data-play]');
            if (play) { this.play(this.eaf.segmentsByKey.get(play.dataset.play)); return; }
            const card = event.target.closest('.eaf-seg');
            if (card) this.open(this.eaf.segmentsByKey.get(card.dataset.key));
        };
        this.updateProgress();
    }

    cardHtml(seg) {
        const color = SPEAKER_COLORS[seg.speaker.index % SPEAKER_COLORS.length];
        const state = segmentState(seg);
        const main = seg.hanzi
            ? `<div class="eaf-seg-main hanzi">${escapeHtml(plainHanzi(seg.hanzi))}</div>`
            : `<div class="eaf-seg-main is-todo">${escapeHtml(seg.romanization || '—')}</div>`;
        const sub = [seg.pinyin, seg.translation].filter(Boolean).map((t) => `<div class="eaf-seg-sub">${escapeHtml(t)}</div>`).join('');
        const active = this.editor?.segment === seg ? ' is-active' : '';
        return `<button type="button" class="eaf-seg${active}" data-key="${escapeHtml(seg.key)}" style="--c:${color}">
            <span class="eaf-seg-state" title="${STATE_TITLES[state]}" style="color:${color}">${STATE_MARKS[state]}</span>
            <span class="eaf-speaker-tag">${escapeHtml(seg.speaker.participant)}</span>${main}${sub}</button>`;
    }

    rowOf(seg) {
        return $('eaf-rows').querySelector(`.eaf-row[data-key="${CSS.escape(seg.key)}"]`);
    }

    refreshCard(seg) {
        const card = this.rowOf(seg)?.querySelector('.eaf-seg');
        if (card) card.outerHTML = this.cardHtml(seg);
    }

    // ---- editing -------------------------------------------------------

    open(seg) {
        if (!seg) return;
        this.close();
        this.editor = new SegmentEditor(this, seg);
        const row = this.rowOf(seg);
        row.after(this.editor.row);
        this.refreshCard(seg);
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        this.editor.focus();
        if (this.audioUrl) this.play(seg);
    }

    close() {
        if (!this.editor) return;
        const seg = this.editor.segment;
        this.editor.row.remove();
        this.editor = null;
        this.refreshCard(seg);
    }

    /** Next/previous visible segment. */
    step(delta) {
        if (!this.eaf) return;
        const visible = this.eaf.segments.filter((s) => !this.hidden.has(s.speaker.index));
        const i = this.editor ? visible.indexOf(this.editor.segment) : -1;
        const target = visible[Math.min(visible.length - 1, Math.max(0, i + delta))];
        if (target) this.open(target);
    }

    write(seg, role, value, { silent = false } = {}) {
        if ((seg[role] ?? '') === value) return;
        this.eaf.setText(seg, role, value);
        this.edited.add(seg.key);
        this.dirty = true;
        if (!silent) {
            this.refreshCard(seg);
            this.updateProgress();
            this.scheduleDraft();
        }
    }

    refreshDerived() {
        if (!this.eaf) return;
        // Recompute pinyin/mixed of the segments edited in this session in
        // the newly displayed system (the others keep what the file has).
        this.edited.forEach((key) => {
            const seg = this.eaf.segmentsByKey.get(key);
            if (!seg?.hanzi) return;
            const derived = deriveFromHanzi(seg.hanzi);
            this.write(seg, 'pinyin', derived.pinyin, { silent: true });
            this.write(seg, 'mixed', derived.mixed);
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

    checkStop() {
        if (this.stopAt != null && this.audio.currentTime >= this.stopAt) {
            this.audio.pause();
            this.stopAt = null;
            this.setPlaying(null);
        }
    }

    setPlaying(seg) {
        document.querySelectorAll('.eaf-seg.is-playing').forEach((el) => el.classList.remove('is-playing'));
        if (seg) this.rowOf(seg)?.querySelector('.eaf-seg')?.classList.add('is-playing');
    }

    // ---- keyboard ------------------------------------------------------

    bindKeyboard() {
        window.addEventListener('keydown', (event) => {
            if (!this.eaf) return;
            if (event.key === 'Escape' && this.editor) { this.close(); return; }
            if (!event.altKey) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); this.step(1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); this.step(-1); }
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

    download() {
        if (!this.eaf) return;
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
        } catch (e) { /* quota or private mode: the download still works */ }
    }

    readDraft() {
        try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
    }

    /** Offers to restore the draft: on page load (any draft), or after
     *  opening a file with the same name as an unsaved draft. */
    offerDraft(openedName = null) {
        const draft = this.readDraft();
        const box = $('eaf-draft');
        box.hidden = true;
        if (!draft?.xml || (openedName && (draft.fileName !== openedName || !draft.dirty))) return;
        const when = new Date(draft.savedAt).toLocaleString('fr-FR');
        box.innerHTML = `<span>Brouillon de <b>${escapeHtml(draft.fileName)}</b> enregistré dans ce navigateur le ${escapeHtml(when)}${draft.dirty ? ' (non téléchargé)' : ''}.</span>
            <button type="button" class="eaf-btn eaf-btn-light" data-draft="restore">Reprendre le brouillon</button>
            <button type="button" class="eaf-btn eaf-btn-light" data-draft="discard">${openedName ? 'Garder le fichier ouvert' : 'Ignorer'}</button>`;
        box.hidden = false;
        box.onclick = (event) => {
            const act = event.target.closest('[data-draft]')?.dataset.draft;
            if (act === 'restore') {
                try { this.load(draft.xml, draft.fileName, { fromDraft: true }); this.checkMedia(); } catch (err) { this.message(err.message); }
            }
            if (act === 'discard') box.hidden = true;
        };
    }
}

window.transcriber = new TranscriberApp();
