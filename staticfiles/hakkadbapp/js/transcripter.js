const dico = new Dictionary({ itemSelector: 'li', containerId: '#pron-list' });

class Transcription {
    constructor() {
        this.labels = [
            { start: 1, end: 2, model: new HakkaText(dico, "hak_ga_"), pinyin: "" },
            { start: 0, end: 1, model: new HakkaText(dico, "客家話"), pinyin: "" },
            { start: 0, end: 1, model: new HakkaText(dico, "我 唔 食 猪 肉"), pinyin: "" },
        ];

        this.media = {
            url: "",
            name: "",
            mimeType: "audio/x-wav",
        };

        this.eafMeta = {
            author: "",
            participant: "Speaker1",
            date: new Date().toISOString(),
            tiers: {
                base: "Transcription",
                translation: "Traduction",
                hanzi: "Hanzi",
            },
            linguisticTypes: {
                alignable: "default-lt",
                ref: "ref-lt",
            }
        };

        this.suggestions = [];
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

            alert("✅ Files saved successfully (overwritten if they existed).");
        } catch (err) {
            console.error("Error saving files:", err);
        }
    }

exportEAF() {
    const labels = Array.isArray(this.labels) ? this.labels : [];

    const author = this.eafMeta?.author || "";
    const date = this.eafMeta?.date || new Date().toISOString();
    const participant = this.eafMeta?.participant || "Participant 1";

    const baseTier = participant;
    const translationTier = `${baseTier} Traduction`;
    const hanziTier = `${baseTier} Hanzi`;
    const pinyinTier = `${baseTier} Pinyin`;
    const mixedTier = `${baseTier} Mixed`;

    const mediaUrl = this.media?.url || "";
    const mediaMimeType = this.media?.mimeType || "audio/x-wav";
    const relativeMediaUrl = this.media?.relativeUrl || "";

    const urn = this.eafMeta?.urn || `urn:nl-mpi-tools-elan-eaf:${crypto.randomUUID()}`;

    let tsCounter = 1;
    let annCounter = 1;

    const timeSlots = [];
    const baseAnnotations = [];
    const translationAnnotations = [];
    const hanziAnnotations = [];
    const pinyinAnnotations = [];
    const mixedAnnotations = [];

    labels.forEach((label) => {
        const start = Math.round((label.start || 0) * 1000);
        const end = Math.round((label.end || 0) * 1000);

        const ts1 = `ts${tsCounter++}`;
        const ts2 = `ts${tsCounter++}`;

        const baseId = `a${annCounter++}`;
        const translationId = `a${annCounter++}`;
        const hanziId = `a${annCounter++}`;
        const pinyinId = `a${annCounter++}`;
        const mixedId = `a${annCounter++}`;

        const hanziText = label.model?.text || "";
        const translationText = label.model?.french || "";
        const pinyinText = label.pinyin || label.model?.pinyin || "";
        const baseText = pinyinText;
        const mixedText = [pinyinText, hanziText].filter(Boolean).join(" ").trim();

        timeSlots.push(
            `<TIME_SLOT TIME_SLOT_ID="${ts1}" TIME_VALUE="${start}"/>`,
            `<TIME_SLOT TIME_SLOT_ID="${ts2}" TIME_VALUE="${end}"/>`
        );

        baseAnnotations.push(`
        <ANNOTATION>
            <ALIGNABLE_ANNOTATION ANNOTATION_ID="${baseId}"
                TIME_SLOT_REF1="${ts1}" TIME_SLOT_REF2="${ts2}">
                <ANNOTATION_VALUE>${this.escapeXML(baseText)}</ANNOTATION_VALUE>
            </ALIGNABLE_ANNOTATION>
        </ANNOTATION>`.trim());

        translationAnnotations.push(`
        <ANNOTATION>
            <REF_ANNOTATION ANNOTATION_ID="${translationId}" ANNOTATION_REF="${baseId}">
                <ANNOTATION_VALUE>${this.escapeXML(translationText)}</ANNOTATION_VALUE>
            </REF_ANNOTATION>
        </ANNOTATION>`.trim());

        hanziAnnotations.push(`
        <ANNOTATION>
            <REF_ANNOTATION ANNOTATION_ID="${hanziId}" ANNOTATION_REF="${baseId}">
                <ANNOTATION_VALUE>${this.escapeXML(hanziText)}</ANNOTATION_VALUE>
            </REF_ANNOTATION>
        </ANNOTATION>`.trim());

        pinyinAnnotations.push(`
        <ANNOTATION>
            <REF_ANNOTATION ANNOTATION_ID="${pinyinId}" ANNOTATION_REF="${baseId}">
                <ANNOTATION_VALUE>${this.escapeXML(pinyinText)}</ANNOTATION_VALUE>
            </REF_ANNOTATION>
        </ANNOTATION>`.trim());

        mixedAnnotations.push(`
        <ANNOTATION>
            <REF_ANNOTATION ANNOTATION_ID="${mixedId}" ANNOTATION_REF="${baseId}">
                <ANNOTATION_VALUE>${this.escapeXML(mixedText)}</ANNOTATION_VALUE>
            </REF_ANNOTATION>
        </ANNOTATION>`.trim());
    });

    const lastUsedAnnotationId = annCounter - 1;
    const relativeMediaAttr = relativeMediaUrl
        ? ` RELATIVE_MEDIA_URL="${this.escapeXML(relativeMediaUrl)}"`
        : "";

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="${this.escapeXML(author)}" DATE="${this.escapeXML(date)}"
    FORMAT="3.0" VERSION="3.0"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:noNamespaceSchemaLocation="http://www.mpi.nl/tools/elan/EAFv3.0.xsd">
    <HEADER MEDIA_FILE="" TIME_UNITS="milliseconds">
        <MEDIA_DESCRIPTOR
            MEDIA_URL="${this.escapeXML(mediaUrl)}"
            MIME_TYPE="${this.escapeXML(mediaMimeType)}"${relativeMediaAttr}/>
        <PROPERTY NAME="URN">${this.escapeXML(urn)}</PROPERTY>
        <PROPERTY NAME="lastUsedAnnotationId">${lastUsedAnnotationId}</PROPERTY>
    </HEADER>
    <TIME_ORDER>
        ${timeSlots.join("\n        ")}
    </TIME_ORDER>

    <TIER ANNOTATOR="${this.escapeXML(author)}" LINGUISTIC_TYPE_REF="transcription"
        PARTICIPANT="${this.escapeXML(participant)}" TIER_ID="${this.escapeXML(baseTier)}">
        ${baseAnnotations.join("\n        ")}
    </TIER>

    <TIER LINGUISTIC_TYPE_REF="traduction" PARENT_REF="${this.escapeXML(baseTier)}"
        PARTICIPANT="${this.escapeXML(participant)}" TIER_ID="${this.escapeXML(translationTier)}">
        ${translationAnnotations.join("\n        ")}
    </TIER>

    <TIER ANNOTATOR="${this.escapeXML(author)}" LINGUISTIC_TYPE_REF="hanzi"
        PARENT_REF="${this.escapeXML(baseTier)}" PARTICIPANT="${this.escapeXML(participant)}"
        TIER_ID="${this.escapeXML(hanziTier)}">
        ${hanziAnnotations.join("\n        ")}
    </TIER>

    <TIER ANNOTATOR="${this.escapeXML(author)}" LINGUISTIC_TYPE_REF="pinyin"
        PARENT_REF="${this.escapeXML(baseTier)}" PARTICIPANT="${this.escapeXML(participant)}"
        TIER_ID="${this.escapeXML(pinyinTier)}">
        ${pinyinAnnotations.join("\n        ")}
    </TIER>

    <TIER ANNOTATOR="${this.escapeXML(author)}" LINGUISTIC_TYPE_REF="mixed"
        PARENT_REF="${this.escapeXML(baseTier)}" PARTICIPANT="${this.escapeXML(participant)}"
        TIER_ID="${this.escapeXML(mixedTier)}">
        ${mixedAnnotations.join("\n        ")}
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

    this.downloadFile("transcription.eaf", xml, "application/xml");
}

    escapeXML(str = '') {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    downloadFile(filename, content, type = "text/plain") {
        const blob = new Blob([content], { type });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    export() {
        const files = {
            "hakka.txt": this.labels.map((l) => `${l.start}\t${l.end}\t${l.model.text}`).join('\n'),
            "french.txt": this.labels.map((l) => `${l.start}\t${l.end}\t${l.model.french || ''}`).join('\n'),
            "pinyin.txt": this.labels.map((l) => `${l.start}\t${l.end}\t${l.pinyin || l.model?.pinyin || ''}`).join('\n')
        };
        this.saveFilesToFolder(files);
    }
}

class LabelView {
    constructor(label, index) {
        this.label = label;
        this.index = index;
        this.dico = dico;

        const wrapper = document.createElement('div');
        wrapper.className = 'mt-2 text-center';
        wrapper.id = `chunk-${this.index}`;
        this.wrapper = wrapper;

        const title = document.createElement('label');
        title.textContent = `${label.start} : ${label.end}`;
        title.htmlFor = `chunk-${this.index}`;
        title.id = `start-stop-${this.index}`;
        this.title = title;
        wrapper.appendChild(title);

        const ta = document.createElement('textarea');
        ta.className = 'w-full rounded p-1 bg-white';
        ta.rows = 1;
        ta.value = label.model.text || '';
        ta.id = `hanzi-${this.index}`;
        this.ta = ta;
        this.hanzi = this.ta;
        ta.addEventListener("input", (event) => {
            // Recompute suggestions
            this.label.model.update({"hanzi": this.ta.value});
            // update only this labelView visuals, fast
            this.render(this.label);
            return new Sentence(this.ta.value);
        })
        ta.addEventListener("keydown", (event) => {
            // SHIFT + ENTER → new line
            if (event.key === "Enter" && event.shiftKey) {
                return; // let textarea insert a newline
            }

            // ENTER without shift → validate
            if (event.key === "Enter") {
                event.preventDefault();               // stop newline
                
                this.handleValidate(this.label);           // validate changes
            }
        });
        wrapper.appendChild(ta);

        this.suggestions = document.createElement('div');
        this.suggestions.id= "suggested-hanzi"
        wrapper.appendChild(this.suggestions);

        this.sentences = this.ta.value.split('\n').map(s => new Sentence(this.dico, s));
        this.sentenceView = document.createElement('div');

        this.taFrench = document.createElement('textarea');
        this.taFrench.className = 'w-full rounded p-1 bg-white mt-1';
        this.taFrench.rows = 1;
        this.taFrench.placeholder = 'Français';
        this.taFrench.id = `french-${this.index}`;
        this.taFrench.value = label.model.french || '';
        this.taFrench.addEventListener("input", () => {
            this.label.model.french = this.taFrench.value;
            this.render(this.label);
            document.dispatchEvent(new CustomEvent("label-updated", {
                detail: { index: this.index }
            }));
        });
        wrapper.appendChild(this.taFrench);

        this.taPinyin = document.createElement('textarea');
        this.taPinyin.className = 'w-full rounded p-1 bg-white mt-1';
        this.taPinyin.rows = 1;
        this.taPinyin.placeholder = 'Pinyin';
        this.taPinyin.id = `pinyin-${this.index}`;
        this.taPinyin.value = label.pinyin || '';
        this.taPinyin.addEventListener("input", () => {
            this.label.pinyin = this.taPinyin.value;
            this.render(this.label);
            document.dispatchEvent(new CustomEvent("label-updated", {
                detail: { index: this.index }
            }));
        });
        // wrapper.appendChild(this.taPinyin);

        wrapper.appendChild(this.sentenceView);

        const a = label.audio;
        this.a = a;

        const pinyinOutput = document.createElement('div');
        pinyinOutput.id = `pinyin-output-${this.index}`;
        this.pinyinOutput = pinyinOutput;

        const furigana = document.createElement('span');
        this.furigana = furigana;

        const hanziOnly = document.createElement('div');
        hanziOnly.classList.add("hanzi");
        hanziOnly.id = `hanzi-only-${this.index}`;
        this.hanziOnly = hanziOnly;
        this.hanzi = this.hanziOnly;

        const inlinePinyin = document.createElement('div');
        this.inlinePinyin = inlinePinyin;
        this.pinyin = this.inlinePinyin;

        this.french = document.createElement('div');
        this.render(label);
    }

    render(label) {
        this.label = label;
        this.french.innerHTML = this.taFrench.value + ' ';
        this.suggestions.innerHTML = this.renderSuggestions(label.model.suggestions);

        this.sentences = this.ta.value.split('\n').map(s => new Sentence(this.dico, s));
        this.sentenceView.innerHTML = this.sentences.map(s => s.render()).join('<br>');
        this.furigana.innerHTML = this.sentences.map(s => s.renderFurigana()).join('<br>');
        this.pinyinOutput.innerHTML = this.sentences.map(s => s.renderPinyinLine()).join('<br>');
        this.hanziOnly.innerHTML = this.sentences.map(s => s.renderHanziLine()).join('<br>');
        this.inlinePinyin.innerHTML = this.taPinyin.value || this.sentences.map(s => s.renderPinyinLine()).join('<br>');
    }

    renderSuggestions(suggestions) {
        return `<div class="flex gap-2 flex-wrap mb-2">
                    ${suggestions.map((s, i) => {
            const keyHint = i < 9 ? (i + 1) : String.fromCharCode(65 + i - 9);
            return `
                            <div class="suggestion-btn flex p-3 flex-col items-center rounded text-indigo-800 hover:bg-white hover:shadow"
                                    data-label="${this.index}"
                                    data-suggestion="${i}">
                                <div class="text-xs text-gray-600">
                                    ${keyHint || '?'}
                                </div>
                                <button 
                                    id="suggested-${keyHint}" 
                                    class="text-small font-semibold" 
                                    value="${i}">
                                    ${s.pron.char() || '?'}
                                </button>
                                <div class="text-xs text-gray-600">
                                    ${s.pron.abstractPinyin() || '?'}
                                </div>
                            </div>`;
        }).join('')}
                </div>`;
    }

    renderUnknownChars() {
        return Array.from(this.dico.unknowns.values())
            .map(char => {
                return `
                        <li>
                            <label>${char}</label>
                            <input class="bg-white w-4" type="text" id="initial-for-${char}">
                            <input class="bg-white w-6" type="text" id="final-for-${char}">
                            <input class="bg-white w-3" type="text" id="tone-for-${char}">
                        </li>
                        `;
            });
    }

    renderUnknownProns(syllables) {
        return Array.from(syllables)
            .map((syl, i) => {
                return `
                            <tr>
                                <td>${syl}</td>
                                <td>
                                <input id="char-for-syl-${i}" class="bg-white" type="text">
                                </td>
                            </tr>
                            `;
            }).join('');
    }

    handleValidate(label) {
        this.label = label;
        label.model.update(this.ta.value);
        label.model.french = this.taFrench.value;
        label.pinyin = this.taPinyin.value;

        this.render(label);

        document.getElementById("label-index").value = this.index + 2;
        document.getElementById("label-index").dispatchEvent(new Event("change"));

        document.dispatchEvent(new CustomEvent("label-updated", {
            detail: { index: this.index }
        }));
    }
}

function getToneMode() {
    return document.getElementById('tone-digital').ariaChecked;
}

class View {
    constructor() {
        this.container = document.getElementById("viewer");
        this.container.innerHTML = '';
        this.importProns = document.getElementById("import-prons");
        this.importLabels = document.getElementById("import-labels");
        this.index = document.getElementById("label-index");
        this.dico = dico;
        this.views = [];
        this.forms = document.createElement('div');
        this.forms.classList = "no-print";
        this.forms.id = "viewer-forms";

        this.metaForm = document.createElement('div');
        this.metaForm.id = "eaf-meta-form";
        this.metaForm.className = "no-print bg-white rounded p-3 mb-4 shadow-sm";

        this.displays = document.createElement('div');
        this.displays.id = "viewer-displays";

        this.container.appendChild(this.forms);
        this.container.appendChild(this.displays);

        this.outputs = {};
        this.audio = null;
        this.audioEl = document.createElement('audio');
        this.container.appendChild(this.audioEl);

        const toneWrapper = document.createElement("div");
        toneWrapper.className = "flex items-center gap-3 p-2";
        toneWrapper.innerHTML = `
            <label class="flex items-center gap-1 text-sm cursor-pointer">
                <input type="radio" name="toneMode" id="tone-digital" value="digital" checked>
                Digital
            </label>

            <label class="flex items-center gap-1 text-sm cursor-pointer">
                <input type="radio" name="toneMode" id="tone-diacritic" value="diacritic">
                Diacritic
            </label>
        `;

        this.displays.textContent = '';
        const container = document.createElement('div');

        container.className = `
            flex flex-wrap justify-stretch items-start gap-2
        `;
        container.innerHTML = '';

        const tabsBar = document.createElement('div');
        tabsBar.className = `
            flex flex-wrap gap-1 p-2 sticky top-0 z-20 bg-white shadow
        `;
        container.appendChild(tabsBar);

        const panels = document.createElement('div');
        panels.className = 'w-full';
        this.container.appendChild(toneWrapper);
        container.appendChild(panels);

        this.outputs = {
            "furigana": "",
            "hanzi": "",
            "french": "",
            "pinyin": "",
        };

        Object.entries(this.outputs).forEach(([key, output], i) => {
            const tabBtn = document.createElement('button');
            tabBtn.textContent = key;
            tabBtn.className = `
                px-3 py-1 text-sm rounded 
                bg-gray-200 hover:bg-gray-300 
                transition
            `;
            tabsBar.appendChild(tabBtn);

            const panel = document.createElement('div');
            panel.id = 'panel-' + key;
            panel.className = `
                p-6 text-justify leading-relaxed
                overflow-y-auto
                print:overflow-visible
                print:p-20
                bg-white
                ${i === 0 ? "" : "hidden"}
            `;
            panels.appendChild(panel);

            tabBtn.addEventListener('click', () => {
                panels.querySelectorAll('div').forEach(p => p.classList.add('hidden'));
                panel.classList.remove('hidden');

                tabsBar.querySelectorAll('button').forEach(b => {
                    b.classList.remove('bg-blue-500', 'text-white');
                    b.classList.add('bg-gray-200');
                });
                tabBtn.classList.remove('bg-gray-200');
                tabBtn.classList.add('bg-blue-500', 'text-white');
            });

            if (i === 0) {
                tabBtn.classList.remove('bg-gray-200');
                tabBtn.classList.add('bg-blue-500', 'text-white');
            }
        });

        this.displays.appendChild(container);
        new CopyButton('#output-hanzi-body');
    }

    toDatetimeLocalValue(value) {
        if (!value) return "";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "";
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    renderMetaForm(model) {
        this.metaForm.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <label class="flex flex-col text-sm">
                <span>Author</span>
                <input id="eaf-author" class="bg-white rounded p-2 border" type="text" value="${model.eafMeta?.author || ''}">
            </label>
            <label class="flex flex-col text-sm md:col-span-2">
                <span>Media URL / file path</span>
                <input
                    id="eaf-media-url"
                    class="bg-white rounded p-2 border"
                    type="text"
                    placeholder="file:///C:/audio.wav or https://example.com/audio.wav"
                    value="${model.media?.url || ''}">
            </label>

            <label class="flex flex-col text-sm">
                <span>Participant / Speaker</span>
                <input id="eaf-participant" class="bg-white rounded p-2 border" type="text" value="${model.eafMeta?.participant || 'Speaker1'}">
            </label>

            <label class="flex flex-col text-sm">
                <span>Date</span>
                <input id="eaf-date" class="bg-white rounded p-2 border" type="datetime-local" value="${this.toDatetimeLocalValue(model.eafMeta?.date)}">
            </label>

            <label class="flex flex-col text-sm">
                <span>Media MIME type</span>
                <input id="eaf-mimetype" class="bg-white rounded p-2 border" type="text" value="${model.media?.mimeType || 'audio/x-wav'}">
            </label>

            <label class="flex flex-col text-sm">
                <span>Hakka tier name</span>
                <input id="eaf-tier-hakka" class="bg-white rounded p-2 border" type="text" value="${model.eafMeta?.tiers?.hakka || 'Hakka'}">
            </label>

            <label class="flex flex-col text-sm">
                <span>French tier name</span>
                <input id="eaf-tier-french" class="bg-white rounded p-2 border" type="text" value="${model.eafMeta?.tiers?.french || 'French'}">
            </label>

            <label class="flex flex-col text-sm">
                <span>Pinyin tier name</span>
                <input id="eaf-tier-pinyin" class="bg-white rounded p-2 border" type="text" value="${model.eafMeta?.tiers?.pinyin || 'Pinyin'}">
            </label>

            <label class="flex flex-col text-sm">
                <span>Alignable linguistic type</span>
                <input id="eaf-lt-alignable" class="bg-white rounded p-2 border" type="text" value="${model.eafMeta?.linguisticTypes?.alignable || 'default-lt'}">
            </label>

            <label class="flex flex-col text-sm">
                <span>Ref linguistic type</span>
                <input id="eaf-lt-ref" class="bg-white rounded p-2 border" type="text" value="${model.eafMeta?.linguisticTypes?.ref || 'ref-lt'}">
            </label>
        </div>
        `;
    }

    render(data) {
        this.forms.textContent = '';
        this.forms.appendChild(this.metaForm);
        this.renderMetaForm(data);

        this.views = new Array(data.labels.length);

        this.renderAudio();

        data.labels.forEach((label, i) => {
            this.renderLabel(label, i);
        });

        this.renderDisplays();
    }

    renderAudio() {
        if (this.audio) {
            this.audioEl.id = "audio";
            this.audioEl.controls = true;
            this.audioEl.src = this.audio.url;
            this.audioEl.preload = 'metadata';
            this.audioEl.className = 'w-full mt-1';
        }
    }

    renderDisplays() {
        this.outputs = {
            "hanzi": "",
            "furigana": "",
            "french": "",
            "pinyin": "",
        };

        this.views.forEach((labelView, e) => {
            for (const [key, value] of Object.entries(this.outputs)) {
                const el = document.createElement('span');
                el.classList.add("rounded", "px-3", "py-1", "hover:bg-violet-200");
                el.id = `${key}-${e}`;
                el.innerHTML = labelView[key].innerHTML;
                this.outputs[key] += el.outerHTML;
            }
        });

        Object.entries(this.outputs).forEach(([key, output], i) => {
            const panel = document.getElementById('panel-' + key);
            panel.innerHTML = output;
        });
    }

    renderLabel(label, i) {
        const labelView = new LabelView(label, i);
        if (this.forms.children[i + 1]) {
            this.forms.replaceChild(labelView.wrapper, this.forms.children[i + 1]);
        } else {
            this.forms.appendChild(labelView.wrapper);
        }
        this.views[i] = labelView;
    }
}

class Controller {
    constructor() {
        this.model = new Transcription();
        this.view = new View();
        this.view.render(this.model);
        this.dico = dico;

        this.view.importProns.addEventListener('click', e => {
            this.dico.handleImportProns(e).then(() => {
                this.view.render(this.model);
            });
        });

        this.view.container.addEventListener("click", e => this.handleSelection(e));
        document.getElementById('import-project').addEventListener('click', e => this.handleImportLocalProject(e));
        document.getElementById('select-project').addEventListener('change', e => this.handleImportHostedProject(e));
        document.getElementById('export-project').addEventListener('click', e => this.model.export());
        document.getElementById('export-eaf')?.addEventListener('click', () => {
            this.syncEafMetaFromForm();
            this.model.exportEAF();
        });
        document.getElementById('label-index').addEventListener('change', e => this.handleIndexChange(e));
        document.getElementById('viewer-displays').addEventListener('click', this.handleClickOnDisplays.bind(this));
        window.addEventListener("keydown", e => this.handlePaging(e));
        window.addEventListener("keyup", this.handleCtrlS.bind(this));
        this.view.forms.addEventListener("input", (event) => {
            if (event.target.closest("#eaf-meta-form")) {
                this.syncEafMetaFromForm();
            }
        });

        this.view.index.dispatchEvent(new Event("change"));
        this.mode = document.getElementById('toogle-hanzi');
        document.getElementById('toggle-hanzi').addEventListener('click', this.handleToggleTrad.bind(this));

        document.addEventListener("label-updated", () => {
            this.view.renderDisplays(this.model);
        });

        document.addEventListener("keydown", (event) => {
            if (event.shiftKey) {
                event.preventDefault();
                const key = event.key;
                if (!/^[1-9]$/.test(key)) return;

                const suggestionIndex = parseInt(key, 10) - 1;
                const currentIndex = parseInt(this.view.index.value, 10) - 1;
                const view = this.view.views[currentIndex];
                if (!view) return;
                if (suggestionIndex >= view.suggestions.length) return;

                const el = view.suggestions.querySelector(`[data-suggestion="${suggestionIndex}"]`);
                if (el) el.click();
            }
        });
    }

    syncEafMetaFromForm() {
        this.model.eafMeta.author = document.getElementById("eaf-author")?.value || "";
        this.model.eafMeta.participant = document.getElementById("eaf-participant")?.value || "Speaker1";

        const rawDate = document.getElementById("eaf-date")?.value || "";
        this.model.eafMeta.date = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();

        this.model.media.mimeType = document.getElementById("eaf-mimetype")?.value || "audio/x-wav";

        this.model.eafMeta.tiers.hakka = document.getElementById("eaf-tier-hakka")?.value || "Hakka";
        this.model.eafMeta.tiers.french = document.getElementById("eaf-tier-french")?.value || "French";
        this.model.eafMeta.tiers.pinyin = document.getElementById("eaf-tier-pinyin")?.value || "Pinyin";

        this.model.eafMeta.linguisticTypes.alignable = document.getElementById("eaf-lt-alignable")?.value || "default-lt";
        this.model.eafMeta.linguisticTypes.ref = document.getElementById("eaf-lt-ref")?.value || "ref-lt";
        this.model.media.url = document.getElementById("eaf-media-url")?.value || "";
    }

    handleCtrlS(event) {
        if (event.key === "s" && event.ctrlKey) {
            event.preventDefault();
            this.model.export();
        }
    }

    handleToggleTrad(event) {
        this.view.views.forEach((v, i) => {});
        this.view.index.dispatchEvent(new Event("change"));
    }

    handleClickOnDisplays(event) {
        const el = event.target.closest('span[id]');
        if (!el) return;

        const match = el.id.match(/^(.*-\d+)$/);
        const i = parseInt(match[0].split('-')[1]);

        if (!isNaN(i)) {
            this.view.index.value = (i + 1);
            this.view.index.dispatchEvent(new Event("change"));
        }
    }

    handleSelection(event) {
        const btn = event.target.closest(".suggestion-btn");
        if (!btn) return;

        const labelIndex = parseInt(btn.dataset.label, 10);
        const suggestionIndex = parseInt(btn.dataset.suggestion, 10);

        const label = this.model.labels[labelIndex];
        if (!label) return;

        label.model.select(suggestionIndex);

        this.view.renderLabel(label, labelIndex);

        const labelView = this.view.views[labelIndex];
        labelView.wrapper.classList.add('visible');

        const ta = document.getElementById(`hanzi-${labelIndex}`);
        if (ta) ta.focus();
        this.view.index.dispatchEvent(new Event("change"));
    }

    getMax() {
        return window.app && app.model && Array.isArray(app.model.labels) ? app.model.labels.length : 1;
    }

    handlePaging(event) {
        const e = event;
        if (e.key == 'PageDown' || e.key == 'PageUp') {
            e.preventDefault();
            const input = document.getElementById('label-index');
            let v = Math.max(1, parseInt(input.value || '1', 10));

            if (e.key === 'PageDown') v += 1;
            else if (e.key === 'PageUp') v = Math.max(1, v - 1);

            input.value = v;
            input.dispatchEvent(new Event('change'));
        }
    }

    handleIndexChange(event) {
        const v = Math.max(1, parseInt(event.target.value || '1', 10));
        const idx = v - 1;
        const nodes = document.getElementById("viewer").querySelectorAll('[id^="chunk-"]');
        nodes.forEach(n => {
            if (n.id === `chunk-${idx}`) n.classList.add('visible');
            else n.classList.remove('visible');
        });

        for (var key in this.view.outputs) {
            const spans = document.getElementById("viewer").querySelectorAll(`span[id^="${key}-"]`);
            spans.forEach(n => {
                n.classList.add('rounded-xl');
                const margin = "m-10";
                const highlight = 'bg-violet-300';
                if (n.id === `${key}-${idx}`) {
                    n.classList.add(highlight);
                    n.classList.add(margin);
                    n.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest'
                    });
                } else {
                    n.classList.remove(highlight);
                    n.classList.remove(margin);
                }
            });
        }

        const focusedId = document.activeElement?.id;
        if (focusedId) {
            const type = focusedId.split('-')[0];
            const newFocusId = `${type}-${idx}`;
            const newFocusEl = document.getElementById(newFocusId);
            if (newFocusEl) newFocusEl.focus();
        }
    }

    async handleImportHostedProject(event) {
        try {
            const projectPath = event.target.value;
            const files = {};
            files.hakka = projectPath + "hakka.txt";
            files.french = projectPath + "french.txt";
            files.pinyin = projectPath + "pinyin.txt";
            files.audio = projectPath + "audio.wav";
            files.pron = projectPath + "prononciations.csv";

            this.model = new Transcription();
            this.view = new View();

            if (files.hakka) {
                const text = await fetch(files.hakka).then(r => r.text()).catch(() => alert("Fichier introuvable : hakka.txt"));
                if (text) {
                    const lines = text.split(/\r?\n/).filter(Boolean);
                    this.model.labels = lines.map(line => {
                        const [start, end, content] = line.split("\t");
                        return {
                            start: parseFloat(start),
                            end: parseFloat(end),
                            model: new HakkaText(dico, content || ""),
                            pinyin: ""
                        };
                    });
                }
            }

            if (files.french) {
                const text = await fetch(files.french).then(r => r.text()).catch(() => alert("Fichier introuvable : french.txt"));
                if (text) {
                    const lines = text.split(/\r?\n/).filter(Boolean);
                    lines.forEach((l, i) => {
                        const parts = l.split("\t");
                        if (this.model.labels?.[i]) {
                            this.model.labels[i].model.french = parts[2] || "";
                        }
                    });
                }
            }

            if (files.pinyin) {
                const text = await fetch(files.pinyin).then(r => r.text()).catch(() => null);
                if (text) {
                    const lines = text.split(/\r?\n/).filter(Boolean);
                    lines.forEach((l, i) => {
                        const parts = l.split("\t");
                        if (this.model.labels?.[i]) {
                            this.model.labels[i].pinyin = parts[2] || "";
                        }
                    });
                }
            }

            if (files.audio) {
                this.view.audio = {
                    name: "audio",
                    url: files.audio
                };
                this.model.media = {
                    name: "audio",
                    url: files.audio,
                    mimeType: "audio/x-wav",
                };
            }

            if (files.pron) {
                const text = await fetch(files.pron).then(r => r.text()).catch(() => alert("Fichier introuvable : prononciation.txt"));
                if (text) {
                    const lines = text.split(/\r?\n/).filter(Boolean);
                    const pronunciations = [];
                    const start = lines[0].includes("char") ? 1 : 0;

                    for (let i = start; i < lines.length; i++) {
                        const [char, initial, final, tone] = lines[i].split(",");
                        pronunciations.push(
                            new Pronunciation({ simp: char, trad: char, initial, final, tone })
                        );
                    }
                    this.dico.addPronunciations(pronunciations);
                }
            }

            this.view.render(this.model);
            this.view.displays.addEventListener("click", this.handleClickOnDisplays.bind(this));
            this.view.index.dispatchEvent(new Event("change"));

            alert("Project successfully loaded!");

        } catch (err) {
            console.error(err);
            alert("Failed to import project.");
        }
    }

    async handleImportLocalProject(event) {
        if (!window.showDirectoryPicker) {
            alert("Your browser does not support the File System Access API required for folder picking.");
            return;
        }
        try {
            alert("Vous êtes sur le point de charger un nouveau projet. Les modifications non enregistrées seront perdues.");

            const dirHandle = await window.showDirectoryPicker();
            const audios = [];

            this.model = new Transcription();
            this.view = new View();

            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind !== 'file') continue;
                if (name.toLowerCase() === 'hakka.txt') {
                    const file = await handle.getFile();
                    const text = await file.text();
                    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
                    this.model.labels = lines.map(l => {
                        const line = l.split('\t');
                        return {
                            start: parseFloat(line[0]),
                            end: parseFloat(line[1]),
                            model: new HakkaText(dico, line[2] || ''),
                            pinyin: ""
                        };
                    });
                    break;
                }
            }

            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind !== 'file') continue;
                if (name.toLowerCase() === 'french.txt') {
                    const file = await handle.getFile();
                    const text = await file.text();
                    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
                    lines.forEach((l, i) => {
                        const line = l.split('\t');
                        if (this.model?.labels[i]) this.model.labels[i].model.french = line[2] || "";
                    });
                    break;
                }
            }

            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind !== 'file') continue;
                if (name.toLowerCase() === 'pinyin.txt') {
                    const file = await handle.getFile();
                    const text = await file.text();
                    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
                    lines.forEach((l, i) => {
                        const line = l.split('\t');
                        if (this.model?.labels[i]) this.model.labels[i].pinyin = line[2] || "";
                    });
                    break;
                }
            }

            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind == 'file' && name == 'audio.wav') {
                    const file = await handle.getFile();
                    const url = URL.createObjectURL(file);
                    this.view.audio = { name, file, url };
                    this.model.media = {
                        name,
                        file,
                        url,
                        mimeType: "audio/x-wav",
                    };
                }
            }

            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind !== 'file') continue;
                const lower = name.toLowerCase();
                const file = await handle.getFile();
                const url = URL.createObjectURL(file);
                if (/\.(mp3|wav|ogg|m4a|flac|webm)$/i.test(lower)) {
                    const audio = { name, file, url };
                    audios.push(audio);
                    const i = parseInt(name.split("-")[1]);
                    if (this.model?.labels[i]) this.model.labels[i - 1].audio = audio;
                }
            }

            const pronunciations = [];
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && entry.name == 'prononciations.csv') {
                    const file = await entry.getFile();
                    const text = await file.text();
                    const lines = text.split('\n').filter(line => line.trim());
                    let start = 0;
                    if (lines[0].toLowerCase().includes('char') && lines[0].toLowerCase().includes('initial')) start = 1;
                    for (let i = start; i < lines.length; i++) {
                        const [char, initial, final, tone] = lines[i].split(',');
                        const p = new Pronunciation({ simp: char, trad: char, initial, final, tone });
                        pronunciations.push(p);
                    }
                    this.dico.addPronunciations(pronunciations);
                    alert(`Loaded ${pronunciations.length} pronunciations from folder.`);
                }
            }

            this.view.render(this.model);
            this.view.displays.addEventListener('click', this.handleClickOnDisplays.bind(this));
            this.view.index.dispatchEvent(new Event("change"));

        } catch (err) {
            console.error(err);
            alert("Failed to import audios.");
        }
    }
}

const app = new Controller();