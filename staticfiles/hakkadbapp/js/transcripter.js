const dico = new Dictionary({itemSelector: 'li',containerId: '#pron-list'});

class Transcription {
    constructor () {
        this.labels = [{start : 0, end:0, model: new HakkaText(dico, "toto")}];
        this.suggestions = [];
    }

    async saveFilesToFolder(files) {
        try {
            // 1. Let user pick a folder
            const dirHandle = await window.showDirectoryPicker();

            for (const [name, content] of Object.entries(files)) {
                // 2. Create or overwrite file
                const fileHandle = await dirHandle.getFileHandle(name, { create: true });

                // 3. Write into the file
                const writable = await fileHandle.createWritable();
                await writable.write(content); // overwrites existing content
                await writable.close();
            }

            alert("✅ Files saved successfully (overwritten if they existed).");
        } catch (err) {
            console.error("Error saving files:", err);
        }   
    }

    export(){
        const files = {
            "hakka.txt": this.labels.map((l) => `${l.start}\t${l.end}\t${l.model.text}`).join('\n'),
            "french.txt": this.labels.map((l) => `${l.start}\t${l.end}\t${l.model.french}`).join('\n'),
        };
        this.saveFilesToFolder(files);
    }
}

class LabelView {
    constructor(label, e){
        this.dico = dico;
        console.log(label);
        const wrapper = document.createElement('div');
        wrapper.className = 'mt-2 text-center';
        wrapper.id = `chunk-${e}`;
        this.wrapper = wrapper;

        const title = document.createElement('label');
        title.textContent = `${label.start} : ${label.end}`;
        title.htmlFor = `chunk-${e}`;
        this.title = title;
        wrapper.appendChild(title);

        const ta = document.createElement('textarea');
        ta.className = 'w-full rounded p-1 bg-white';
        ta.rows = 1;
        ta.value = label.model.text || '';
        ta.id = `hanzi-${e}`;
        this.ta = ta;
        this.hanzi = this.ta;
        wrapper.appendChild(ta);

        this.suggestions = document.createElement('div');
        this.suggestions.id= "suggested-hanzi"
        wrapper.appendChild(this.suggestions);
        // const ta2 = document.createElement('textarea');
        // ta2.className = 'w-full border rounded p-1 bg-white mt-1';
        // ta2.rows = 1;
        // ta2.placeholder = label.model.syllables.join("") || '';
        // wrapper.appendChild(ta2);

        this.taFrench = document.createElement('textarea');
        this.taFrench.className = 'w-full rounded p-1 bg-white mt-1';
        this.taFrench.rows = 1;
        this.taFrench.placeholder = 'Français';
        this.taFrench.id = `french-${e}`;
        this.taFrench.value = label.model.french;
        wrapper.appendChild(this.taFrench);

        const a = label.audio;
        if (a) {
            const row = document.createElement('div');
            row.className = 'mt-2';

            const title = document.createElement('div');
            title.textContent = a.name;
            title.className = 'text-sm text-gray-700';

            const audio = document.createElement('audio');
            audio.controls = true;
            audio.src = a.url;
            audio.preload = 'metadata';
            audio.className = 'w-full mt-1';

            row.appendChild(title);
            row.appendChild(audio);
            wrapper.appendChild(row);
        }
        this.a = a;

        const pinyinOutput =document.createElement('div');
        pinyinOutput.id = `pinyin-output-${e}`;
        this.pinyinOutput = pinyinOutput;

        const furigana = document.createElement('span');
        this.furigana = furigana;

        const hanziOnly = document.createElement('div');
        hanziOnly.id = `hanzi-only-${e}`;
        this.hanziOnly = hanziOnly;
        this.hanzi = this.hanziOnly;

        const inlinePinyin = document.createElement('div');
        this.inlinePinyin = inlinePinyin;
        this.pinyin = this.inlinePinyin;

        this.french = document.createElement('div');

        this.render(label);
    }

    render(label){
        const inputHanzi = Array.from(label.model.text);
        this.french.innerHTML = this.taFrench.value;
        this.suggestions.innerHTML = this.renderSuggestions(label.model.suggestions);
        this.furigana.innerHTML = inputHanzi
            .filter(e => e != "_")
            .map(h => {
                if (h === '\n') return '<br>';
                if (h == ' ') return '<span class="inline-block w-4"></span>';
                if (isPunctuation(h)) {this.renderFurigana(h,"");}
                if (!isHanzi(h)) {return this.renderBlock(this.renderFurigana("",h))}
                const matches = this.dico.getMatchesForHanzi(h);
                const matchedPinyin = (matches.length === 0) ? '?' : matches.map(p => p.abstractPinyin()).join('/');
                return this.renderFurigana(h, matchedPinyin)
            })
            .join('');

        this.pinyinOutput.innerHTML = inputHanzi
            .filter(e => e != "_")
            .map(h => {
                if (h == '\n') return '<br>';
                if (h == ' ') return '<span class="inline-block w-4"></span>';
                if (h == '。') return '.';
                if (h == '、') return ',';
                const matches = this.dico.getMatchesForHanzi(h).map(p => p.abstractPinyin());
                return matches.length > 1 ? '(' + matches.join('/') + ')' : matches[0];
            })
            .join(' ');


        this.hanziOnly.innerHTML = inputHanzi
            .filter(e => e != "_")
            .map(h => {
                if (h === '\n') return '<br>';
                if (h == ' ') return '<span class="inline-block w-4"></span>';
                return h;
            })
            .join('');

        this.inlinePinyin.innerHTML = inputHanzi
            .filter(e => e != "_")
            .map(h => {
                if (h === '\n') return '<br>';
                if (h == ' ') return '<span class="inline-block w-4"></span>';
                if (isPunctuation(h)) {return h;}
                if (!isHanzi(h)) {return h;}
                const matches = this.dico.getMatchesForHanzi(h);
                const matchedPinyin = (matches.length === 0) ? '?' : matches.map(p => p.abstractPinyin()).join('/');
                return `${matchedPinyin}${h}`
            })
            .join('');

    }

    renderSuggestions(suggestions){
        return `<div class="flex gap-2 flex-wrap mb-2">
                    ${suggestions.map((pron, i) => {
                        const keyHint = i < 9 ? (i + 1) : String.fromCharCode(65 + i - 9); // 1–9, A–Z
                        return `
                            <div class="flex flex-col items-center rounded hover:bg-gray-200 hover:shadow">
                                <button 
                                    id="suggested-${keyHint}" 
                                    class="text-small font-semibold" 
                                    value="${i}">
                                    ${pron.simp || '?'}
                                </button>
                                <div class="text-xs text-gray-600">
                                    ${pron.abstractPinyin() || '?'}
                                </div>
                            </div>`;
                        }).join('')}
                </div>`
    }
    renderChar(char){return `<span class="block text-base font-semibold text-black">${char}</span>`}
    renderKana(kana){return `<span class="block text-sm">${kana}</span>`}
    renderBlock(content){return `<span class="inline-block text-center align-center">${content}</span>`;}
    renderFurigana(char, kana){return this.renderBlock(`${this.renderKana(kana)}${this.renderChar(char)}`)}
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
                        `
                    });
    }

    renderUnknownProns(syllables){
        return Array.from(syllables)
                        .map((syl,i) => {
                            return `
                            <tr>
                                <td>${syl}</td>
                                <td>
                                <input id="char-for-syl-${i}" class="bg-white" type="text">
                                </td>
                            </tr>
                            `
                        }).join('');
    }
}

class View {
    constructor() {
        this.container = document.getElementById("viewer");
        this.importProns = document.getElementById("import-prons");
        this.importLabels = document.getElementById("import-labels");
        this.index = document.getElementById("label-index");
        this.dico = dico;
        this.views = []
        this.forms = document.createElement('div');
        this.forms.classList = "no-print"
        this.forms.id = "viewer-forms";
        this.displays = document.createElement('div');
        this.displays.id = "viewer-displays";
        this.container.appendChild(this.forms);
        this.container.appendChild(this.displays);
        this.outputs = {};
    }

    render(data){
        // 1. Clear previous content
        this.forms.textContent = '';  // safer than innerHTML if just removing children
        this.views = [];              // reset the array explicitly

        // 2. Rebuild views from scratch
        this.views = data.labels.map((label, i) => {
            const labelView = new LabelView(label, i);
            this.forms.appendChild(labelView.wrapper);
            return labelView;
        });
        // 4. Re-render display section if necessary
        this.renderDisplays(data);
    }

    renderDisplays(data){
        // 3. Update display info
        this.displays.textContent = `La transcription contient ${data.labels.length} étiquettes.`;
        this.outputs = {
            "hanzi":"", 
            "furigana":"",
            "french":"", 
            "pinyin":""
        }
        this.views.forEach((labelView, e) => { 
            for (const [key, value] of Object.entries(this.outputs)) {
                this.outputs[key] += `<div class="inline-block rounded px-3 print:px-1 print:py-1 py-2" id="${key}-${e}">`+ labelView[key].innerHTML + '</div>';
            }
        });

        // Clear the container and make it a flex row
        this.displays.textContent = ''; 
        const container = document.createElement('div'); // Or wherever you want to place 
        container.className = "flex print:block"
        container.innerHTML = ''; // reset

        Object.entries(this.outputs).forEach(([key, output], i) => {

            const col = document.createElement('div');
            col.className = 'justify-items-end flex-grow rounded m-1 transition-all duration-200 bg-white break-after: page;';

            const header = document.createElement('div');
            header.className = '';

            const toggleBtn = document.createElement('button');
            toggleBtn.textContent ='➖';
            toggleBtn.className = 'no-print text-sm hover:shadow';

            const body = document.createElement('div');
            body.className = 'text-justify p-2 overflow-y-auto h-120 no-print-height';
            body.innerHTML = output;

            toggleBtn.addEventListener('click', () => {
                const isCollapsed = col.classList.contains('collapsed');

                if (isCollapsed) {
                    // Expand
                    col.classList.remove('collapsed', 'flex-none');
                    col.classList.add('flex-grow');
                    body.classList.remove('hidden');
                    toggleBtn.textContent = '➖';
                } else {
                    // Collapse
                    col.classList.add('collapsed', 'flex-none', 'print:hidden');
                    col.classList.remove('flex-grow');
                    body.classList.add('hidden');
                    toggleBtn.textContent = '➕';
                }
            });

            if (i === 0 || i == 3)
                toggleBtn.dispatchEvent(new Event("click"))

            header.appendChild(toggleBtn);
            col.appendChild(header);
            col.appendChild(body);
            container.appendChild(col);
        });


        this.displays.appendChild(container);
    }
}

class Controller {
    constructor() {
        this.model = new Transcription();
        this.view = new View();
        this.view.render(this.model);
        this.view.views.forEach(v=> { v.suggestions.addEventListener("click", event=> this.handleClick(event))});
        this.dico = dico;
        this.view.importProns.addEventListener('click', e => {
                    this.dico.handleImportProns(e).then(() => {
                        this.view.render(this.model);
                        this.view.views.forEach(v=> { v.suggestions.addEventListener("click", event=> this.handleClick(event))});
                        this.view.index.dispatchEvent(new Event("change"));
                    })
                });
        this.view.container.addEventListener('focusout', e => this.handleInput(e));
        // document.getElementById('import-labels').addEventListener('click', e => this.handleImportLabels(e));
        // document.getElementById('import-audios').addEventListener('click', e => this.handleImportAudios(e));
        document.getElementById('import-project').addEventListener('click', e => this.handleImportProject(e));
        document.getElementById('export-project').addEventListener('click', e => this.model.export());
        document.getElementById('label-index').addEventListener('change', e => this.handleIndexChange(e));
        document.getElementById('viewer-displays').addEventListener('click', e => this.handleClickOnDisplays(e));
        window.addEventListener("keydown", e => this.handlePaging(e));
        this.view.index.dispatchEvent(new Event("change"));
    }

    handleClickOnDisplays(event) {
        const i = parseInt(event.target.id.split("-")[1]);
        if (!isNaN(i)){
            this.view.index.value = i+1;
            this.view.index.dispatchEvent(new Event("change"));
        }
    }

    handleClick(event) {
        const e = event;
        const input = document.getElementById('label-index');
        console.log(event)
        let v = Math.max(1, parseInt(input.value || '1', 10));
        // if (event.target.tagName !== 'BUTTON') return; // only react to button clicks
        this.model.labels[v-1].model.select(event.target.value);
        this.view.render(this.model);
        this.view.views.forEach(v=> { v.suggestions.addEventListener("click", event=> this.handleClick(event))});
        e.preventDefault();
    }

    handlePaging(event){
        const e = event;
        const input = document.getElementById('label-index');
        if (e.key !== 'PageDown' && e.key !== 'PageUp') return;
        // avoid interfering when typing in a text field
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

        e.preventDefault();
        let v = Math.max(1, parseInt(input.value || '1', 10));
        if (e.key === 'PageDown') v += 1;
        else if (e.key === 'PageUp') v = Math.max(1, v - 1);

        // clamp to number of labels if available
        const max = window.app && app.model && Array.isArray(app.model.labels) ? app.model.labels.length : null;
        if (max) v = Math.min(v, max);

        input.value = v;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    handleIndexChange(event){
        const v = Math.max(1, parseInt(event.target.value || '1', 10));
        const idx = v - 1;
        const nodes = document.getElementById("viewer").querySelectorAll('[id^="chunk-"]');
        nodes.forEach(n => {
            if (n.id === `chunk-${idx}`) n.classList.add('visible');
            else n.classList.remove('visible');
        });

        for (var key in this.view.outputs) {
            const spans = document.getElementById("viewer").querySelectorAll(`[id^="${key}-"]`);
            spans.forEach(n => {
                const highlight = 'bg-violet-300';
                if (n.id === `${key}-${idx}`) {
                    n.classList.add(highlight);
                    n.scrollIntoView({
                        behavior: 'smooth', // smooth scrolling
                        block: 'nearest'    // scroll just enough to show it
                    });
                }
                else n.classList.remove(highlight);
            });
        }
    }

    handleInput(event){
        console.log(event)
        const target = event.target;
        const i = parseInt(target.id.split('-')[1]);
        if (!this.model.labels[i]) return;
        const update = {};
        if (target.id.includes("french-")) 
            update["french"] = target.value;
        if (target.id.includes("hanzi-"))
            update["hanzi"] = target.value;
        this.model.labels[i].model.update(update);
        this.view.views[i].render(this.model.labels[i])
        this.view.renderDisplays(this.model);
        this.view.index.value = i+1;
        this.view.index.dispatchEvent(new Event("change"));
        event.preventDefault();
    }

    // handleImportAudios(event){
    //     if (!window.showDirectoryPicker) {
    //         alert("Your browser does not support the File System Access API required for folder picking.");
    //         return;
    //     }
    //     (async () => {
    //         try {
    //             const dirHandle = await window.showDirectoryPicker();
    //             const audios = [];

    //             for await (const [name, handle] of dirHandle.entries()) {
    //                 if (handle.kind !== 'file') continue;
    //                 const lower = name.toLowerCase();
    //                 if (!/\.(mp3|wav|ogg|m4a|flac|webm)$/i.test(lower)) continue;

    //                 const file = await handle.getFile();
    //                 const url = URL.createObjectURL(file);
    //                 const audio = {name,file,url}
    //                 audios.push(audio);
    //                 const i = parseInt(name.split("-")[1]);
    //                 if (this.model?.labels[i]) this.model.labels[i-1].audio = audio;
    //             }
    //             this.view.render(this.model)
    //         } catch (err) {
    //             console.error(err);
    //             alert("Failed to import audios.");
    //         }
    //     })();
    // }

    // handleImportLabels(event){
    //     if (!window.showDirectoryPicker) {
    //         alert("Your browser does not support the File System Access API required for folder picking.");
    //         return;
    //     }
    //     (async () => {
    //         try {
    //             const fileHandle = await window.showOpenFilePicker();
    //             const file = await fileHandle[0].getFile();
    //             const text = await file.text();
    //             const lines = text.split("\n");
    //             this.model.labels = lines.map(l => {
    //                 const line = l.split('\t');
    //                 const data =  {
    //                     start: parseFloat(line[0]),
    //                     end: parseFloat(line[1]),
    //                     model: new HakkaText(dico, line[2]),
    //                 }
    //                 return data;
    //             })

    //             this.view.render(this.model)
    //         } catch (err) {
    //             console.error(err);
    //             alert("Failed to import.");
    //         }
    //     })();
    // }

    async handleImportProject(event){
        if (!window.showDirectoryPicker) {
            alert("Your browser does not support the File System Access API required for folder picking.");
            return;
        }
        try {
            alert("Vous êtes sur le point de charger un nouveau projet. Les modifications non enregistrées seront perdues.")
            const dirHandle = await window.showDirectoryPicker();
            const audios = [];

            this.model = new Transcription();

            // find and read hanzi.txt first (if present) to populate labels
            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind !== 'file') continue;
                if (name.toLowerCase() === 'hakka.txt') {
                    console.log(name);
                    const file = await handle.getFile();
                    const text = await file.text();
                    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
                    this.model.labels = lines.map(l => {
                        const line = l.split('\t');
                        return {
                            start: parseFloat(line[0]),
                            end: parseFloat(line[1]),
                            model: new HakkaText(dico, line[2] || ''),
                        };
                    });
                    break;
                }
            }

            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind !== 'file') continue;
                if (name.toLowerCase() === 'french.txt') {
                    const file = await handle.getFile();
                    console.log(name);
                    const text = await file.text();
                    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
                    lines.forEach((l, i) => {
                        const line = l.split('\t');
                        if (this.model?.labels[i]) this.model.labels[i].model.french = line[2];
                    });
                    break;
                }
            }

            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind !== 'file') continue;
                console.log(name);
                const lower = name.toLowerCase();
                const file = await handle.getFile();
                const url = URL.createObjectURL(file);
                if (/\.(mp3|wav|ogg|m4a|flac|webm)$/i.test(lower)) {
                    const audio = {name,file,url}
                    audios.push(audio);
                    const i = parseInt(name.split("-")[1]);
                    if (this.model?.labels[i]) this.model.labels[i-1].audio = audio;
                } 
            }
            this.view.render(this.model);
            this.view.views.forEach(v=> { v.suggestions.addEventListener("click", event=> this.handleClick(event))});
            
            this.view.index.dispatchEvent(new Event("change"));
        } catch (err) {
            console.error(err);
            alert("Failed to import audios.");
        }
    }
}

const app = new Controller();