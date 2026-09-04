/* =========================================================================
   Hakka transcripter — model (Transcription/EafExporter/ProjectLoader),
   view (LabelView/View) and controller (Controller) for the transcription
   editor page.
   ========================================================================= */

const dico = new Dictionary({ itemSelector: 'li', containerId: '#pron-list' });

/* -------------------------------------------------------------------------
   Small generic helpers
   ------------------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);

function createEl(tag, className = '', attrs = {}, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    Object.entries(attrs).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        if (key === 'id') node.id = value;
        else node.setAttribute(key, value);
    });
    if (html !== undefined) node.innerHTML = html;
    return node;
}

function escapeXML(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function downloadFile(filename, content, type = 'text/plain') {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

function formatTime(n) {
    return Number(n || 0).toFixed(2);
}

function autosizeTextarea(ta) {
    ta.rows = Math.max(1, ta.value.split('\n').length);
}

/** Move the shared label-index input to a given 1-based label number and
 *  trigger the usual "change" refresh (highlight, scroll, audio cue…). */
function goToLabel(oneBasedIndex) {
    const input = $('label-index');
    if (!input) return;
    input.value = Math.max(1, oneBasedIndex);
    input.dispatchEvent(new Event('change'));
}

/** Canonical list + order of the read-only "full transcript" tabs. Shared by
 *  View (to build the tab bar/panels) and LabelView (to build the matching
 *  per-label content for each tab). */
const DISPLAY_TABS = [
    { key: 'hanzi', label: 'Hanzi' },
    { key: 'furigana', label: 'Furigana' },
    { key: 'pinyinHanzi', label: 'Pinyin + Hanzi' },
    { key: 'pinyin', label: 'Pinyin' },
    { key: 'french', label: 'Français' },
    { key: 'words', label: 'Détail' },
];

/** Tab keys whose per-label content spans multiple lines and so need a
 *  block element rather than an inline span. */
const BLOCK_DISPLAY_TABS = new Set(['words']);

/* =========================================================================
   EafExporter — builds an ELAN .eaf XML document from a Transcription
   ========================================================================= */

class EafExporter {
    static build(model) {
        const labels = Array.isArray(model.labels) ? model.labels : [];
        const meta = model.eafMeta || {};
        const tiers = meta.tierNames || {};

        const author = meta.author || '';
        const date = meta.date || new Date().toISOString();
        const participant = meta.participant || 'Participant 1';

        const baseTier = participant;
        const hanziTier = `${baseTier} ${tiers.hakka || 'Hanzi'}`;
        const frenchTier = `${baseTier} ${tiers.french || 'Traduction'}`;
        const pinyinTier = `${baseTier} ${tiers.pinyin || 'Pinyin'}`;
        const mixedTier = `${baseTier} ${tiers.mixed || 'Mixed'}`;

        const mediaUrl = model.media?.url || '';
        const mediaMimeType = model.media?.mimeType || 'audio/x-wav';
        const relativeMediaUrl = model.media?.relativeUrl || '';

        const urn = meta.urn || `urn:nl-mpi-tools-elan-eaf:${crypto.randomUUID()}`;

        let tsCounter = 1;
        let annCounter = 1;

        const timeSlots = [];
        const baseAnnotations = [];
        const frenchAnnotations = [];
        const hanziAnnotations = [];
        const pinyinAnnotations = [];
        const mixedAnnotations = [];

        labels.forEach((label) => {
            const start = Math.round((label.start || 0) * 1000);
            const end = Math.round((label.end || 0) * 1000);

            const ts1 = `ts${tsCounter++}`;
            const ts2 = `ts${tsCounter++}`;

            const baseId = `a${annCounter++}`;
            const frenchId = `a${annCounter++}`;
            const hanziId = `a${annCounter++}`;
            const pinyinId = `a${annCounter++}`;
            const mixedId = `a${annCounter++}`;

            const hanziText = label.model?.hanzi || '';
            const frenchText = label.model?.french || '';
            const pinyinText = label.model?.pinyin || '';
            const baseText = pinyinText;
            const mixedText = [pinyinText, hanziText].filter(Boolean).join(' ').trim();

            timeSlots.push(
                `<TIME_SLOT TIME_SLOT_ID="${ts1}" TIME_VALUE="${start}"/>`,
                `<TIME_SLOT TIME_SLOT_ID="${ts2}" TIME_VALUE="${end}"/>`
            );

            baseAnnotations.push(EafExporter.alignableAnnotation(baseId, ts1, ts2, baseText));
            frenchAnnotations.push(EafExporter.refAnnotation(frenchId, baseId, frenchText));
            hanziAnnotations.push(EafExporter.refAnnotation(hanziId, baseId, hanziText));
            pinyinAnnotations.push(EafExporter.refAnnotation(pinyinId, baseId, pinyinText));
            mixedAnnotations.push(EafExporter.refAnnotation(mixedId, baseId, mixedText));
        });

        const lastUsedAnnotationId = annCounter - 1;
        const relativeMediaAttr = relativeMediaUrl
            ? ` RELATIVE_MEDIA_URL="${escapeXML(relativeMediaUrl)}"`
            : '';

        return `<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="${escapeXML(author)}" DATE="${escapeXML(date)}"
    FORMAT="3.0" VERSION="3.0"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:noNamespaceSchemaLocation="http://www.mpi.nl/tools/elan/EAFv3.0.xsd">
    <HEADER MEDIA_FILE="" TIME_UNITS="milliseconds">
        <MEDIA_DESCRIPTOR
            MEDIA_URL="${escapeXML(mediaUrl)}"
            MIME_TYPE="${escapeXML(mediaMimeType)}"${relativeMediaAttr}/>
        <PROPERTY NAME="URN">${escapeXML(urn)}</PROPERTY>
        <PROPERTY NAME="lastUsedAnnotationId">${lastUsedAnnotationId}</PROPERTY>
    </HEADER>
    <TIME_ORDER>
        ${timeSlots.join('\n        ')}
    </TIME_ORDER>

    <TIER ANNOTATOR="${escapeXML(author)}" LINGUISTIC_TYPE_REF="transcription"
        PARTICIPANT="${escapeXML(participant)}" TIER_ID="${escapeXML(baseTier)}">
        ${baseAnnotations.join('\n        ')}
    </TIER>

    <TIER LINGUISTIC_TYPE_REF="traduction" PARENT_REF="${escapeXML(baseTier)}"
        PARTICIPANT="${escapeXML(participant)}" TIER_ID="${escapeXML(frenchTier)}">
        ${frenchAnnotations.join('\n        ')}
    </TIER>

    <TIER ANNOTATOR="${escapeXML(author)}" LINGUISTIC_TYPE_REF="hanzi"
        PARENT_REF="${escapeXML(baseTier)}" PARTICIPANT="${escapeXML(participant)}"
        TIER_ID="${escapeXML(hanziTier)}">
        ${hanziAnnotations.join('\n        ')}
    </TIER>

    <TIER ANNOTATOR="${escapeXML(author)}" LINGUISTIC_TYPE_REF="pinyin"
        PARENT_REF="${escapeXML(baseTier)}" PARTICIPANT="${escapeXML(participant)}"
        TIER_ID="${escapeXML(pinyinTier)}">
        ${pinyinAnnotations.join('\n        ')}
    </TIER>

    <TIER ANNOTATOR="${escapeXML(author)}" LINGUISTIC_TYPE_REF="mixed"
        PARENT_REF="${escapeXML(baseTier)}" PARTICIPANT="${escapeXML(participant)}"
        TIER_ID="${escapeXML(mixedTier)}">
        ${mixedAnnotations.join('\n        ')}
    </TIER>

    <LINGUISTIC_TYPE GRAPHIC_REFERENCES="false"
        LINGUISTIC_TYPE_ID="transcription" TIME_ALIGNABLE="true"/>
    <LINGUISTIC_TYPE CONSTRAINTS="Symbolic_Association"
        GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="traduction" TIME_ALIGNABLE="false"/>
    <LINGUISTIC_TYPE CONSTRAINTS="Symbolic_Association"
        GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="hanzi" TIME_ALIGNABLE="false"/>
    <LINGUISTIC_TYPE CONSTRAINTS="Symbolic_Association"
        GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="pinyin" TIME_ALIGNABLE="false"/>
    <LINGUISTIC_TYPE CONSTRAINTS="Symbolic_Association"
        GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="mixed" TIME_ALIGNABLE="false"/>

    <CONSTRAINT
        DESCRIPTION="Time subdivision of parent annotation's time interval, no time gaps allowed within this interval"
        STEREOTYPE="Time_Subdivision"/>
    <CONSTRAINT
        DESCRIPTION="Symbolic subdivision of a parent annotation. Annotations refering to the same parent are ordered"
        STEREOTYPE="Symbolic_Subdivision"/>
    <CONSTRAINT DESCRIPTION="1-1 association with a parent annotation"
        STEREOTYPE="Symbolic_Association"/>
    <CONSTRAINT
        DESCRIPTION="Time alignable annotations within the parent annotation's time interval, gaps are allowed"
        STEREOTYPE="Included_In"/>
</ANNOTATION_DOCUMENT>`;
    }

    static alignableAnnotation(id, ts1, ts2, value) {
        return `<ANNOTATION>
            <ALIGNABLE_ANNOTATION ANNOTATION_ID="${id}"
                TIME_SLOT_REF1="${ts1}" TIME_SLOT_REF2="${ts2}">
                <ANNOTATION_VALUE>${escapeXML(value)}</ANNOTATION_VALUE>
            </ALIGNABLE_ANNOTATION>
        </ANNOTATION>`;
    }

    static refAnnotation(id, refId, value) {
        return `<ANNOTATION>
            <REF_ANNOTATION ANNOTATION_ID="${id}" ANNOTATION_REF="${refId}">
                <ANNOTATION_VALUE>${escapeXML(value)}</ANNOTATION_VALUE>
            </REF_ANNOTATION>
        </ANNOTATION>`;
    }
}

/* =========================================================================
   ProjectLoader — shared parsing helpers for hakka/french/pinyin project
   files, used by both the "local folder" and "hosted project" importers.
   ========================================================================= */

class ProjectLoader {
    static parseHakka(text) {
        return text
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => {
                const [start, end, content] = line.split('\t');
                return {
                    start: parseFloat(start) || 0,
                    end: parseFloat(end) || 0,
                    model: new HakkaText(dico, content || ''),
                };
            });
    }

    static applyFrench(labels, text) {
        if (!text) return;
        text.split(/\r?\n/).filter(Boolean).forEach((line, i) => {
            const parts = line.split('\t');
            if (labels[i]) labels[i].model.french = parts[2] || '';
        });
    }

    static applyPinyin(labels, text) {
        if (!text) return;
        text.split(/\r?\n/).filter(Boolean).forEach((line, i) => {
            const parts = line.split('\t');
            if (labels[i]) labels[i].pinyin = parts[2] || '';
        });
    }

    static parsePronunciationsCsv(text) {
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (!lines.length) return [];
        const hasHeader = lines[0].toLowerCase().includes('char') && lines[0].toLowerCase().includes('initial');
        return lines.slice(hasHeader ? 1 : 0).map((line) => {
            const [char, initial, final, tone] = line.split(',');
            return new Pronunciation({ simp: char, trad: char, initial, final, tone });
        });
    }

    /** Returns the 0-based label index encoded in a per-label audio file
     *  name such as "audio-3.wav", or null if the name doesn't match. */
    static matchNumberedAudioFile(name) {
        const match = name.match(/^audio-(\d+)\.(mp3|wav|ogg|m4a|flac|webm)$/i);
        return match ? parseInt(match[1], 10) - 1 : null;
    }
}

/* =========================================================================
   Transcription — the data model: an ordered list of time-aligned labels
   plus the metadata needed to export an EAF/ELAN document.
   ========================================================================= */

class Transcription {
    constructor() {
        this.labels = [
            { start: 1, end: 2, model: new HakkaText(dico, 'hak_ga_') },
            { start: 2, end: 3, model: new HakkaText(dico, '客家話') },
            { start: 3, end: 5, model: new HakkaText(dico, '我 唔 食 猪 肉') },
        ];

        this.media = {
            url: '',
            name: '',
            mimeType: 'audio/x-wav',
        };

        this.eafMeta = {
            author: '',
            participant: 'Speaker1',
            date: new Date().toISOString(),
            tierNames: {
                hakka: 'Hanzi',
                french: 'Traduction',
                pinyin: 'Pinyin',
                mixed: 'Mixed',
            },
        };
    }

    /** Insert a fresh, empty label right after `index` and return its
     *  (0-based) position. The new slot starts where the previous one ends,
     *  so the timeline stays gap-free by default. */
    addLabelAfter(index) {
        const prev = this.labels[index] || this.labels[this.labels.length - 1];
        const start = prev ? prev.end : 0;
        const newLabel = { start, end: start + 2, model: new HakkaText(dico, '') };
        this.labels.splice(index + 1, 0, newLabel);
        return index + 1;
    }

    removeLabel(index) {
        if (this.labels.length <= 1) return;
        this.labels.splice(index, 1);
    }

    async saveFilesToFolder(files) {
        try {
            const dirHandle = await window.showDirectoryPicker();

            for (const [name, content] of Object.entries(files)) {
                const fileHandle = await dirHandle.getFileHandle(name, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(content);
                await writable.close();
            }

            alert('✅ Fichiers enregistrés (écrasés s\'ils existaient déjà).');
        } catch (err) {
            console.error('Error saving files:', err);
        }
    }

    export() {
        const files = {
            'hakka.txt': this.labels.map((l) => `${l.start}\t${l.end}\t${l.model.text}`).join('\n'),
            'french.txt': this.labels.map((l) => `${l.start}\t${l.end}\t${l.model.french || ''}`).join('\n'),
            'pinyin.txt': this.labels.map((l) => `${l.start}\t${l.end}\t${l.pinyin || l.model?.pinyin || ''}`).join('\n'),
        };
        this.saveFilesToFolder(files);
    }

    exportEAF() {
        downloadFile('transcription.eaf', EafExporter.build(this), 'application/xml');
    }
}

/* =========================================================================
   LabelView — the editable form + live preview for a single label.
   ========================================================================= */

class LabelView {
    constructor(label, index, { onChange, onValidate, onInsertAfter, onDelete, onSelectSuggestion } = {}) {
        this.label = label;
        this.index = index;
        this.onChange = onChange;
        this.onValidate = onValidate;

        this.wrapper = createEl('div', 'chunk mt-2 rounded-lg bg-indigo-50/60 p-3 shadow-sm', { id: `chunk-${index}` });
        this.wrapper.appendChild(this.buildHeader(label, index, onInsertAfter, onDelete));

        this.ta = this.buildHanziInput(label);
        this.suggestionsEl = createEl('div', 'flex gap-1.5 flex-wrap');
        const hanziField = createEl('div', 'relative');
        hanziField.append(this.ta, this.suggestionsEl);
        this.wrapper.appendChild(hanziField);

        this.suggestionBar = new SuggestionBar(this.suggestionsEl, {
            anchorTo: this.ta,
            onSelect: (suggestionIndex) => onSelectSuggestion?.(suggestionIndex),
        });

        this.taFrench = this.buildFrenchInput(label);
        this.wrapper.appendChild(this.taFrench);

        this.preview = createEl('div', 'mt-2');
        this.wrapper.appendChild(this.preview);

        this.outputs = {};
        this.render(label);
    }

    buildHeader(label, index, onInsertAfter, onDelete) {
        const header = createEl('div', 'flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 mb-1');

        const badge = createEl('span', 'font-semibold text-gray-700');
        badge.textContent = `#${index + 1}`;

        const actions = createEl('div', 'flex items-center gap-1');

        const insertBtn = createEl('button', 'min-h-9 px-3 py-1 rounded bg-white hover:bg-indigo-100 active:bg-indigo-200 border touch-manipulation', {
            type: 'button', title: 'Insérer une nouvelle étiquette après celle-ci (Ctrl+Entrée)',
        });
        insertBtn.textContent = '+ Étiquette';
        insertBtn.addEventListener('click', () => onInsertAfter?.());

        const deleteBtn = createEl('button', 'min-h-9 min-w-9 px-3 py-1 rounded bg-white hover:bg-red-100 active:bg-red-200 border touch-manipulation', {
            type: 'button', title: 'Supprimer cette étiquette',
        });
        deleteBtn.textContent = '🗑';
        deleteBtn.addEventListener('click', () => onDelete?.());

        actions.append(insertBtn, deleteBtn);
        header.append(badge, this.buildTimeControls(label, index), actions);
        return header;
    }

    buildTimeControls(label, index) {
        const wrap = createEl('div', 'flex items-center gap-1');

        this.timeLabel = createEl('span', 'font-mono text-xs text-gray-500', { id: `start-stop-${index}` });
        this.syncTimeLabel();

        const startInput = createEl('input', 'w-16 text-xs rounded border px-1 py-0.5 bg-white', {
            type: 'number', step: '0.01', value: label.start, title: 'Début (secondes)',
        });
        const separator = createEl('span', 'text-xs text-gray-400', {}, '–');
        const endInput = createEl('input', 'w-16 text-xs rounded border px-1 py-0.5 bg-white', {
            type: 'number', step: '0.01', value: label.end, title: 'Fin (secondes)',
        });

        const applyTimes = () => {
            this.label.start = parseFloat(startInput.value) || 0;
            this.label.end = parseFloat(endInput.value) || 0;
            this.syncTimeLabel();
        };
        startInput.addEventListener('change', applyTimes);
        endInput.addEventListener('change', applyTimes);

        wrap.append(this.timeLabel, startInput, separator, endInput);
        return wrap;
    }

    syncTimeLabel() {
        this.timeLabel.textContent = `${formatTime(this.label.start)} : ${formatTime(this.label.end)}`;
    }

    buildHanziInput(label) {
        const ta = createEl('textarea', 'hanzi w-full rounded p-2 text-base bg-white border focus:outline-none focus:ring-2 focus:ring-indigo-300', {
            id: `hanzi-${this.index}`, rows: 1, placeholder: 'Hakka : romanisation et/ou hanzi…',
            autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
        });
        ta.value = label.model.text || '';
        autosizeTextarea(ta);

        ta.addEventListener('input', () => {
            this.label.model.update({ hanzi: ta.value });
            autosizeTextarea(ta);
            this.render(this.label);
            this.onChange?.();
        });

        ta.addEventListener('keydown', (event) => this.handleValidationKeydown(event));

        return ta;
    }

    buildFrenchInput(label) {
        const ta = createEl('textarea', 'w-full rounded p-1 text-base bg-white border mt-1 focus:outline-none focus:ring-2 focus:ring-indigo-300', {
            id: `french-${this.index}`, rows: 1, placeholder: 'Traduction française…',
        });
        ta.value = label.model.french || '';
        autosizeTextarea(ta);

        ta.addEventListener('input', () => {
            this.label.model.french = ta.value;
            autosizeTextarea(ta);
            this.render(this.label);
            this.onChange?.();
        });

        ta.addEventListener('keydown', (event) => this.handleValidationKeydown(event));

        return ta;
    }

    /** Shared Enter-key behaviour for both textareas: Shift+Enter inserts a
     *  newline, Ctrl/Cmd+Enter is left alone (handled globally to add a new
     *  label), plain Enter validates and moves to the next label. */
    handleValidationKeydown(event) {
        if (event.key !== 'Enter') return;
        if (event.ctrlKey || event.metaKey) return;
        if (event.shiftKey) return;
        event.preventDefault();
        this.onValidate?.();
    }

    render(label) {
        this.label = label;
        this.sentences = this.ta.value.split('\n').map((line) => new Sentence(dico, line));

        this.suggestionBar.render(label.model.suggestions);
        this.preview.innerHTML = this.sentences.map((s) => s.render()).join('<br>');

        const frenchLine = this.taFrench.value || '';
        this.outputs = {
            hanzi: createEl('div', 'hanzi', {}, this.sentences.map((s) => s.renderHanziLine()).join('<br>')),
            furigana: createEl('div', '', {}, this.sentences.map((s) => s.renderFurigana()).join('<br>')),
            pinyinHanzi: createEl('div', 'hanzi', {}, this.sentences.map((s) => `${s.renderPinyinLine()} ${s.renderHanziLine()}`).join('<br>')),
            pinyin: createEl('div', '', {}, this.sentences.map((s) => s.renderPinyinLine()).join('<br>')),
            french: createEl('div', '', {}, frenchLine),
            words: createEl('div', '', {},
                `<span class="block mb-2 text-sm italic text-gray-700">${frenchLine}</span>` +
                this.sentences.map((s) => s.renderTokens()).join('<br>')),
        };
    }
}

/* =========================================================================
   View — page chrome: metadata form, list of label forms, and the
   read-only tabbed "full transcript" displays.
   ========================================================================= */

class View {
    constructor({ onInsertLabelAfter, onDeleteLabel, onSelectSuggestion } = {}) {
        this.onInsertLabelAfter = onInsertLabelAfter;
        this.onDeleteLabel = onDeleteLabel;
        this.onSelectSuggestion = onSelectSuggestion;

        this.container = $('viewer');
        this.container.innerHTML = '';

        this.importProns = $('import-prons');
        this.index = $('label-index');
        this.total = $('label-total');
        this.views = [];
        this.model = null;
        this.audio = null;

        this.eafDialog = $('eaf-meta-dialog');
        this.metaFields = $('eaf-meta-fields');

        this.forms = createEl('div', 'no-print', { id: 'viewer-forms' });
        this.labelsContainer = createEl('div', 'space-y-3');
        this.forms.append(this.labelsContainer);

        this.displays = createEl('div', '', { id: 'viewer-displays' });

        this.audioEl = document.createElement('audio');
        this.container.append(this.forms, this.displays, this.audioEl, this.buildHelpBox());

        this.panels = {};
        this.buildTabs();
    }

    buildHelpBox() {
        const box = createEl('details', 'no-print text-[11px] text-gray-400 mt-4 max-w-md mx-auto');
        box.innerHTML = `
            <summary class="cursor-pointer hover:text-gray-600 select-none">Raccourcis clavier</summary>
            <ul class="mt-2 list-disc list-inside space-y-0.5 text-gray-500">
                <li><b>Entrée</b> : valider et passer à l'étiquette suivante</li>
                <li><b>Maj + Entrée</b> : nouvelle ligne</li>
                <li><b>Ctrl + Entrée</b> : insérer une nouvelle étiquette après la courante</li>
                <li><b>Page précédente / suivante</b> : étiquette précédente / suivante</li>
                <li><b>Maj + 1…9</b> : choisir une suggestion de caractère</li>
                <li><b>Espace</b> : lire l'extrait audio de l'étiquette courante</li>
                <li><b>Ctrl + S</b> : exporter le projet (fichiers .txt)</li>
            </ul>`;
        return box;
    }

    buildTabs() {
        const wrapper = createEl('div', 'flex flex-wrap justify-stretch items-start gap-2');
        const tabsBar = createEl('div', 'flex flex-wrap gap-1 p-2 sticky top-0 z-20 bg-white shadow');
        const panels = createEl('div', 'w-full');

        DISPLAY_TABS.forEach(({ key, label }, i) => {
            const tabBtn = createEl('button', 'px-3 py-1 text-sm rounded bg-gray-200 hover:bg-gray-300 transition', { type: 'button' });
            tabBtn.textContent = label;

            // Each tab gets its own `relative` wrapper so a CopyButton can be
            // pinned to its corner; the wrapper (not the panel itself) is
            // what gets shown/hidden when switching tabs.
            const panelWrapper = createEl('div', `relative print:overflow-visible ${i === 0 ? '' : 'hidden'}`, { id: `panel-wrapper-${key}` });
            const extraPadding = (key === 'pinyinHanzi' || key === 'furigana') ? 'pr-14' : '';
            const panel = createEl('div', `p-6 text-justify leading-relaxed print:overflow-visible print:p-20 bg-white ${extraPadding}`, { id: `panel-${key}` });
            panelWrapper.appendChild(panel);
            this.panels[key] = panel;
            panels.appendChild(panelWrapper);

            tabBtn.addEventListener('click', () => {
                panels.querySelectorAll(':scope > div').forEach((p) => p.classList.add('hidden'));
                panelWrapper.classList.remove('hidden');
                tabsBar.querySelectorAll('button').forEach((b) => b.classList.remove('bg-blue-500', 'text-white'));
                tabsBar.querySelectorAll('button').forEach((b) => b.classList.add('bg-gray-200'));
                tabBtn.classList.remove('bg-gray-200');
                tabBtn.classList.add('bg-blue-500', 'text-white');
            });

            if (i === 0) tabBtn.classList.add('bg-blue-500', 'text-white');
            tabsBar.appendChild(tabBtn);
        });

        wrapper.append(tabsBar, panels);
        this.displays.appendChild(wrapper);

        new CopyButton('#panel-pinyinHanzi', { label: 'Copier pinyin + hanzi' });
        new CopyButton('#panel-furigana', {
            label: 'Copier le furigana',
            getText: () => this.panels.pinyinHanzi.innerText,
        });
    }

    toDatetimeLocalValue(value) {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    metaField(id, label, type, value, { extraClass = '', placeholder = '' } = {}) {
        return `
            <label class="flex flex-col text-sm ${extraClass}">
                <span>${label}</span>
                <input id="${id}" class="bg-white rounded p-2 border" type="${type}" placeholder="${escapeXML(placeholder)}" value="${escapeXML(value)}">
            </label>`;
    }

    renderMetaForm(model) {
        const meta = model.eafMeta || {};
        const tiers = meta.tierNames || {};

        this.metaFields.innerHTML = `
            ${this.metaField('eaf-author', 'Auteur', 'text', meta.author || '')}
            ${this.metaField('eaf-media-url', 'URL / chemin du média', 'text', model.media?.url || '', {
                extraClass: 'md:col-span-2',
                placeholder: 'file:///C:/audio.wav ou https://example.com/audio.wav',
            })}
            ${this.metaField('eaf-participant', 'Participant / locuteur', 'text', meta.participant || 'Speaker1')}
            ${this.metaField('eaf-date', 'Date', 'datetime-local', this.toDatetimeLocalValue(meta.date))}
            ${this.metaField('eaf-mimetype', 'Type MIME du média', 'text', model.media?.mimeType || 'audio/x-wav')}
            ${this.metaField('eaf-tier-hakka', 'Nom du tier Hanzi', 'text', tiers.hakka || 'Hanzi')}
            ${this.metaField('eaf-tier-french', 'Nom du tier Français', 'text', tiers.french || 'Traduction')}
            ${this.metaField('eaf-tier-pinyin', 'Nom du tier Pinyin', 'text', tiers.pinyin || 'Pinyin')}
            ${this.metaField('eaf-tier-mixed', 'Nom du tier Mixte', 'text', tiers.mixed || 'Mixed')}`;
    }

    render(model) {
        this.model = model;
        this.renderMetaForm(model);

        this.labelsContainer.innerHTML = '';
        this.views = model.labels.map((label, i) => this.mountLabel(label, i));

        this.renderAudio();
        this.renderDisplays();
        this.syncIndexBounds();
    }

    syncIndexBounds() {
        const total = Math.max(1, this.model.labels.length);
        this.index.max = String(total);
        if (this.total) this.total.textContent = `/ ${total}`;
    }

    createLabelView(label, i) {
        return new LabelView(label, i, {
            onChange: () => this.renderDisplays(),
            onValidate: () => goToLabel(i + 2),
            onInsertAfter: () => this.onInsertLabelAfter?.(i),
            onDelete: () => this.onDeleteLabel?.(i),
            onSelectSuggestion: (suggestionIndex) => this.onSelectSuggestion?.(i, suggestionIndex),
        });
    }

    mountLabel(label, i) {
        const labelView = this.createLabelView(label, i);
        this.labelsContainer.appendChild(labelView.wrapper);
        return labelView;
    }

    /** Rebuild a single label's form/preview in place (used after picking a
     *  suggestion, so the rest of the list doesn't need to re-render). */
    replaceLabelAt(i) {
        const label = this.model.labels[i];
        const labelView = this.createLabelView(label, i);
        const old = this.labelsContainer.children[i];
        if (old) this.labelsContainer.replaceChild(labelView.wrapper, old);
        else this.labelsContainer.appendChild(labelView.wrapper);
        this.views[i] = labelView;
        return labelView;
    }

    renderAudio() {
        if (!this.audio) {
            this.audioEl.removeAttribute('id');
            this.audioEl.removeAttribute('controls');
            this.audioEl.removeAttribute('src');
            return;
        }
        this.audioEl.id = 'audio';
        this.audioEl.controls = true;
        this.audioEl.src = this.audio.url;
        this.audioEl.preload = 'metadata';
        this.audioEl.className = 'w-full mt-1';
    }

    renderDisplays() {
        DISPLAY_TABS.forEach(({ key }) => {
            const panel = this.panels[key];
            panel.innerHTML = '';
            this.views.forEach((labelView, i) => {
                const tag = BLOCK_DISPLAY_TABS.has(key) ? 'div' : 'span';
                const item = createEl(tag, `rounded px-3 py-1 cursor-pointer hover:bg-violet-200 ${i % 2 ? 'bg-gray-50' : ''}`, {
                    id: `${key}-${i}`,
                    title: `#${i + 1} · ${formatTime(labelView.label.start)}–${formatTime(labelView.label.end)}s`,
                });
                item.innerHTML = labelView.outputs[key]?.innerHTML || '';
                panel.appendChild(item);
            });
        });
    }
}

/* =========================================================================
   Controller — wires the model and view together, handles import/export
   and keyboard shortcuts.
   ========================================================================= */

class Controller {
    constructor() {
        this.model = new Transcription();
        this.view = new View({
            onInsertLabelAfter: (i) => this.insertLabelAfter(i),
            onDeleteLabel: (i) => this.deleteLabel(i),
            onSelectSuggestion: (labelIndex, suggestionIndex) => this.applySuggestion(labelIndex, suggestionIndex),
        });
        this.view.render(this.model);

        this.bindStaticControls();
        this.bindKeyboard();

        goToLabel(1);
    }

    bindStaticControls() {
        this.view.importProns?.addEventListener('click', (e) => {
            dico.handleImportProns(e).then(() => this.view.render(this.model));
        });

        this.view.displays.addEventListener('click', (e) => this.handleClickOnDisplays(e));
        this.view.index.addEventListener('change', (e) => this.handleIndexChange(e));

        $('import-project')?.addEventListener('click', () => this.handleImportLocalProject());
        $('select-project')?.addEventListener('change', (e) => this.handleImportHostedProject(e));
        $('export-project')?.addEventListener('click', () => this.model.export());
        $('toggle-hanzi')?.addEventListener('click', () => this.view.index.dispatchEvent(new Event('change')));

        $('nav-prev')?.addEventListener('click', () => goToLabel(this.currentIndex()));
        $('nav-next')?.addEventListener('click', () => goToLabel(this.currentIndex() + 2));
        $('nav-new-label')?.addEventListener('click', () => this.insertLabelAfter(this.currentIndex()));

        this.bindEafDialog();
    }

    bindEafDialog() {
        const dialog = this.view.eafDialog;
        if (!dialog) return;

        $('export-eaf')?.addEventListener('click', () => {
            this.view.renderMetaForm(this.model);
            dialog.showModal();
        });

        dialog.addEventListener('input', (e) => {
            if (e.target.closest('#eaf-meta-fields')) this.syncEafMetaFromForm();
        });

        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) dialog.close();
        });

        $('eaf-dialog-cancel')?.addEventListener('click', () => dialog.close());
        $('eaf-dialog-export')?.addEventListener('click', () => {
            this.syncEafMetaFromForm();
            this.model.exportEAF();
            dialog.close();
        });
    }

    bindKeyboard() {
        window.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                this.model.export();
                return;
            }

            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                this.insertLabelAfter(this.currentIndex());
                return;
            }

            if (event.key === 'PageDown' || event.key === 'PageUp') {
                event.preventDefault();
                goToLabel(this.currentIndex() + (event.key === 'PageDown' ? 2 : 0));
                return;
            }

            if (event.shiftKey && /^[1-9]$/.test(event.key)) {
                const active = document.activeElement;
                const blockedField = active?.tagName === 'TEXTAREA' && !active.id.startsWith('hanzi-');
                if (blockedField) return;

                const idx = this.currentIndex();
                const label = this.model.labels[idx];
                const suggestionIndex = parseInt(event.key, 10) - 1;
                if (!label || suggestionIndex >= label.model.suggestions.length) return;

                event.preventDefault();
                this.applySuggestion(idx, suggestionIndex);
            }
        });
    }

    currentIndex() {
        return Math.max(1, parseInt(this.view.index.value || '1', 10)) - 1;
    }

    syncEafMetaFromForm() {
        const meta = this.model.eafMeta;
        meta.author = $('eaf-author')?.value || '';
        meta.participant = $('eaf-participant')?.value || 'Speaker1';

        const rawDate = $('eaf-date')?.value || '';
        meta.date = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();

        this.model.media.mimeType = $('eaf-mimetype')?.value || 'audio/x-wav';
        this.model.media.url = $('eaf-media-url')?.value || '';

        meta.tierNames.hakka = $('eaf-tier-hakka')?.value || 'Hanzi';
        meta.tierNames.french = $('eaf-tier-french')?.value || 'Traduction';
        meta.tierNames.pinyin = $('eaf-tier-pinyin')?.value || 'Pinyin';
        meta.tierNames.mixed = $('eaf-tier-mixed')?.value || 'Mixed';
    }

    handleClickOnDisplays(event) {
        const target = event.target.closest('[id]');
        if (!target) return;
        const match = target.id.match(/-(\d+)$/);
        if (!match) return;
        goToLabel(parseInt(match[1], 10) + 1);
    }

    applySuggestion(labelIndex, suggestionIndex) {
        const label = this.model.labels[labelIndex];
        if (!label) return;

        label.model.select(suggestionIndex);
        this.view.replaceLabelAt(labelIndex);
        this.view.renderDisplays();

        goToLabel(labelIndex + 1);
        $(`hanzi-${labelIndex}`)?.focus();
    }

    insertLabelAfter(index) {
        const newIndex = this.model.addLabelAfter(index);
        this.view.render(this.model);
        goToLabel(newIndex + 1);
        $(`hanzi-${newIndex}`)?.focus();
    }

    deleteLabel(index) {
        if (this.model.labels.length <= 1) {
            alert('Impossible de supprimer la dernière étiquette.');
            return;
        }
        if (!confirm('Supprimer cette étiquette ?')) return;

        this.model.removeLabel(index);
        this.view.render(this.model);
        goToLabel(Math.min(index, this.model.labels.length - 1) + 1);
    }

    handleIndexChange(event) {
        const total = Math.max(1, this.model.labels.length);
        const value = Math.min(total, Math.max(1, parseInt(event.target.value || '1', 10)));
        event.target.value = value;
        const idx = value - 1;

        this.view.labelsContainer.querySelectorAll('[id^="chunk-"]').forEach((n) => {
            n.classList.toggle('visible', n.id === `chunk-${idx}`);
        });

        DISPLAY_TABS.forEach(({ key }) => {
            this.view.panels[key].querySelectorAll(`[id^="${key}-"]`).forEach((n) => {
                const isActive = n.id === `${key}-${idx}`;
                n.classList.toggle('bg-violet-300', isActive);
                n.classList.toggle('ring-2', isActive);
                n.classList.toggle('ring-violet-400', isActive);
                if (isActive) n.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
        });

        const focused = document.activeElement;
        if (focused?.id) {
            const type = focused.id.split('-')[0];
            $(`${type}-${idx}`)?.focus();
        }
    }

    async handleImportLocalProject() {
        if (!window.showDirectoryPicker) {
            alert("Votre navigateur ne supporte pas la sélection de dossier (File System Access API).");
            return;
        }
        if (!confirm("Vous êtes sur le point de charger un nouveau projet. Les modifications non enregistrées seront perdues.")) {
            return;
        }

        try {
            const dirHandle = await window.showDirectoryPicker();
            const filesByName = new Map();
            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind === 'file') filesByName.set(name.toLowerCase(), handle);
            }

            const readText = async (name) => {
                const handle = filesByName.get(name.toLowerCase());
                return handle ? (await handle.getFile()).text() : null;
            };

            const [hakkaText, frenchText, pinyinText, pronText] = await Promise.all([
                readText('hakka.txt'), readText('french.txt'), readText('pinyin.txt'), readText('prononciations.csv'),
            ]);

            if (!hakkaText) {
                alert('Fichier introuvable : hakka.txt');
                return;
            }

            this.model = new Transcription();
            this.model.labels = ProjectLoader.parseHakka(hakkaText);
            ProjectLoader.applyFrench(this.model.labels, frenchText);
            ProjectLoader.applyPinyin(this.model.labels, pinyinText);

            const audioHandle = filesByName.get('audio.wav');
            if (audioHandle) {
                const file = await audioHandle.getFile();
                const url = URL.createObjectURL(file);
                this.model.media = { name: 'audio.wav', file, url, mimeType: 'audio/x-wav' };
                this.view.audio = { name: 'audio.wav', file, url };
            }

            for (const [name, handle] of filesByName) {
                const labelIndex = ProjectLoader.matchNumberedAudioFile(name);
                if (labelIndex !== null && this.model.labels[labelIndex]) {
                    const file = await handle.getFile();
                    this.model.labels[labelIndex].audio = { name, file, url: URL.createObjectURL(file) };
                }
            }

            if (pronText) {
                const prons = ProjectLoader.parsePronunciationsCsv(pronText);
                dico.addPronunciations(prons);
                alert(`${prons.length} prononciations chargées depuis le dossier.`);
            }

            this.view.render(this.model);
            goToLabel(1);
        } catch (err) {
            console.error(err);
            alert("Échec de l'import du dossier.");
        }
    }

    async handleImportHostedProject(event) {
        const projectPath = event.target.value;
        if (!projectPath) return;

        try {
            const readText = (name) => fetch(projectPath + name)
                .then((r) => (r.ok ? r.text() : null))
                .catch(() => null);

            const [hakkaText, frenchText, pinyinText, pronText] = await Promise.all([
                readText('hakka.txt'), readText('french.txt'), readText('pinyin.txt'), readText('prononciations.csv'),
            ]);

            if (!hakkaText) {
                alert('Fichier introuvable : hakka.txt');
                return;
            }

            this.model = new Transcription();
            this.model.labels = ProjectLoader.parseHakka(hakkaText);
            ProjectLoader.applyFrench(this.model.labels, frenchText);
            ProjectLoader.applyPinyin(this.model.labels, pinyinText);

            const audioUrl = projectPath + 'audio.wav';
            this.model.media = { name: 'audio.wav', url: audioUrl, mimeType: 'audio/x-wav' };
            this.view.audio = { name: 'audio.wav', url: audioUrl };

            if (pronText) {
                dico.addPronunciations(ProjectLoader.parsePronunciationsCsv(pronText));
            }

            this.view.render(this.model);
            goToLabel(1);
            alert('Transcription chargée !');
        } catch (err) {
            console.error(err);
            alert("Échec de l'import du projet.");
        }
    }
}

const app = new Controller();
