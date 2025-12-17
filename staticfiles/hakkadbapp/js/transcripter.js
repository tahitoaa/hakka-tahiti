const dico = new Dictionary({itemSelector: 'li',containerId: '#pron-list'});

class Transcription {
    constructor () {
        this.labels = [
            {start : 1, end:2, model: new HakkaText(dico, "hak_ga_")},
            {start : 0, end:1, model: new HakkaText(dico, "客家話")},
            {start : 0, end:1, model: new HakkaText(dico, "我 唔 食 猪 肉")},
            
        ];
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
    constructor(label, index){
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
        title.id = `start-stop-${this.index}`
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
            new Sentence(this.ta.value);
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

        // const ta2 = document.createElement('textarea');
        // ta2.className = 'w-full border rounded p-1 bg-white mt-1';
        // ta2.rows = 1;
        // ta2.placeholder = label.model.syllables.join("") || '';
        // wrapper.appendChild(ta2);

        this.taFrench = document.createElement('textarea');
        this.taFrench.className = 'w-full rounded p-1 bg-white mt-1';
        this.taFrench.rows = 1;
        this.taFrench.placeholder = 'Français';
        this.taFrench.id = `french-${this.index}`;
        this.taFrench.value = label.model.french;
        wrapper.appendChild(this.taFrench);
        wrapper.appendChild(this.sentenceView)

        const a = label.audio;
        this.a = a;

        const pinyinOutput =document.createElement('div');
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


        this.mixed = document.createElement('div');

        this.render(label);
    }

    render(label){
        this.label = label;
        const inputHanzi = Array.from(label.model.text);
        this.french.innerHTML = this.taFrench.value + ' ';
        this.suggestions.innerHTML = this.renderSuggestions(label.model.suggestions);

        this.sentences = this.ta.value.split('\n').map(s => new Sentence(this.dico, s));
        // console.log(this.sentences);
        this.sentenceView.innerHTML = this.sentences.map(s => s.render()).join('<br>')
        this.furigana.innerHTML = inputHanzi
            .filter(e => e != "_")
            .map(h => {
                if (h === '\n') return '<br>';
                if (h == ' ') return ''; //'<span class="inline-block w-4"></span>';
                if (isPunctuation(h)) {this.renderFurigana(h,"");}
                if (!isHanzi(h)) {return this.renderBlock(this.renderFurigana("",h))}
                const matches = this.dico.getMatchesForHanzi(h);
                const matchedPinyin = (matches.length === 0) ? '?' :
                     matches.map(p => {
                        if (getToneMode())
                            return p.abstractPinyin();
                        else 
                            return p.diacriticsPinyin();
                     }
                    ).join('/');
                return this.renderFurigana(matches.length > 0 ?  matches[0].char() :h, matchedPinyin)
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
                const matches = this.dico.getMatchesForHanzi(h);
                const el = document.createElement('span')
                el.innerText = (matches.length > 0) ? matches[0].char() : h;
                if (isHanzi(el.innerText)) 
                {
                    el.classList.add("hanzi");
                    el.classList.add("text-2xl");
                }
                else {
                    el.classList.add("font-serif");
                    el.classList.add("font-serif");
                } 
                return el.outerHTML;
            })
            .join('');

        this.inlinePinyin.innerHTML = inputHanzi
            .filter(e => e != "_")
            .map(h => {
                if (h === '\n') return '<br>';
                if (h == ' ') return ''; //'<span class="inline-block w-4"></span>';
                if (isPunctuation(h)) {return h;}
                if (!isHanzi(h)) {return h;}
                const matches = this.dico.getMatchesForHanzi(h);
                const matchedPinyin = (matches.length === 0) ? '?' : matches.map(p => p.abstractPinyin()).join('/');
                return `${matchedPinyin} `
            })
            .join('');      


        // const ul = document.createElement('ul');
        // ul.className = 'flex-col hover:shadow-md hover:bg-violet-50 transition-all rounded-xxlborder';
        // [this.furigana, this.french, this.sentenceView].forEach((e) => {
        //     const li = document.createElement('li');
        //     li.className = `
        //         flex-col gap-1 px-3 py-4 
        //         odd:rounded-xl
        //         text-center
        //     `;
        //     li.innerHTML = e.innerHTML;
        //     ul.appendChild(li);
        // });
        this.mixed.innerHTML = '';
        // this.mixed.appendChild(ul);
        const span = document.createElement('span');
        span.innerHTML = this.sentenceView.innerHTML;
        this.mixed.appendChild(span);
    }

    renderSuggestions(suggestions){
        return `<div class="flex gap-2 flex-wrap mb-2">
                    ${suggestions.map((s, i) => {
                        const keyHint = i < 9 ? (i + 1) : String.fromCharCode(65 + i - 9); // 1–9, A–Z
                        return `
                            <div class="suggestion-btn flex p-3 flex-col items-center rounded text-indigo-800 hover:bg-white hover:shadow"
                                    data-label="${this.index}"
                                    data-suggestion="${i}">
                                <div class="text-xs text-gray-600">
                                    ${ keyHint || '?'}
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
                </div>`
    }

    renderChar(char) {
        return `
            <span 
                class="hanzi block text-[1.8rem] leading-[2.4rem] text-black"
                style="letter-spacing: 0.02em;"
            >
                ${char}
            </span>
        `;
    }

    renderKana(kana) {
        return `
            <span 
                class="pinyin block font-serif text-[1.05rem] leading-[1.4rem] text-gray-800 mt-1"
                style="letter-spacing: 0.01em;"
            >
                ${kana}
            </span>
        `;
    }

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

    handleValidate(label) {
        this.label = label;
        // update the model with the current textarea content
        label.model.update(this.ta.value);

        // update only this labelView visuals, fast
        this.render(label);

        // console.log(this.index)
        document.getElementById("label-index").value = this.index + 2;
        document.getElementById("label-index").dispatchEvent(new Event("change"));
        // let the controller know displays must be recomputed
        document.dispatchEvent(new CustomEvent("label-updated", {
            detail: { index: this.index }
    }));
}
}


function getToneMode(){
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
        this.views = []
        this.forms = document.createElement('div');
        this.forms.classList = "no-print"
        this.forms.id = "viewer-forms";
        this.displays = document.createElement('div');
        this.displays.id = "viewer-displays";
        this.container.appendChild(this.forms);
        this.container.appendChild(this.displays);
        this.outputs = {};
        this.audio = null;
        this.audioEl = document.createElement('audio');
        this.container.appendChild(this.audioEl);
        // Create button
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
        
        // Clear the container and make it a flex row
        this.displays.textContent = ''; 
        const container = document.createElement('div'); // Or wherever you want to place 

        container.className = `
            flex flex-wrap justify-stretch items-start gap-2
            print:grid print:grid-cols-1
        `;
        container.innerHTML = ''; // reset  

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
            "hanzi":"", 
            "furigana":"",
            "french":"", 
            "pinyin":"",
            "mixed":""
        }
        Object.entries(this.outputs).forEach(([key, output], i) => {
            // --- Create tab button ---
            const tabBtn = document.createElement('button');
            tabBtn.textContent = key;
            tabBtn.className = `
                px-3 py-1 text-sm rounded 
                bg-gray-200 hover:bg-gray-300 
                transition
            `;
            tabsBar.appendChild(tabBtn);

            // --- Create panel ---
            const panel = document.createElement('div');
            panel.id = 'panel-' + key;
            panel.className = `
                p-6 text-justify leading-relaxed
                h-[calc(100vh-90px)]
                overflow-y-auto
                print:overflow-visible
                bg-white
                ${i === 0 ? "" : "hidden"}
            `;
            panels.appendChild(panel);

            // --- Tab switching ---
            tabBtn.addEventListener('click', () => {
                // hide all
                panels.querySelectorAll('div').forEach(p => p.classList.add('hidden'));
                // show selected
                panel.classList.remove('hidden');

                // visual active state
                tabsBar.querySelectorAll('button').forEach(b => {
                    b.classList.remove('bg-blue-500', 'text-white');
                    b.classList.add('bg-gray-200');
                });
                tabBtn.classList.remove('bg-gray-200');
                tabBtn.classList.add('bg-blue-500', 'text-white');
            });

            // Default: first tab is selected visually
            if (i === 0) {
                tabBtn.classList.remove('bg-gray-200');
                tabBtn.classList.add('bg-blue-500', 'text-white');
            }
        });
        this.displays.appendChild(container);
        new CopyButton('#output-hanzi-body');   
    }

    render(data){
        // 1. Clear previous content
        this.forms.textContent = '';  // safer than innerHTML if just removing children
        this.views = new Array(data.labels.length);              // reset the array explicitly

        this.renderAudio();
        // 2. Rebuild views from scratch
        data.labels.forEach((label, i) => {
            this.renderLabel(label, i);
        })
        // 4. Re-render display section if necessary
        this.renderDisplays()
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

    renderDisplays(){
        this.outputs = {
            "hanzi":"", 
            "furigana":"",
            "french":"", 
            "pinyin":"",
            "mixed":""
        }

        this.views.forEach((labelView, e) => { 
            for (const [key, value] of Object.entries(this.outputs)) {
                const el = document.createElement('span');
                el.classList.add("rounded px-3 py-1 hover:bg-violet-200".split(' '))
                el.id =`${key}-${e}`
                el.innerHTML = labelView[key].innerHTML
                this.outputs[key] += el.outerHTML;
            }
        });

        Object.entries(this.outputs).forEach(([key, output], i) => {
            const panel = document.getElementById('panel-'+key);
            panel.innerHTML = output;
        });

    }

    renderLabel(label, i){
        const labelView = new LabelView(label, i);
        if (this.forms.children[i]) {
            this.forms.replaceChild(labelView.wrapper,  this.forms.children[i]);
        } else this.forms.appendChild(labelView.wrapper);
        this.views[i] = labelView;
    }
}

class Controller {
    constructor() {
        this.model = new Transcription();
        this.view = new View();
        this.view.render(this.model);
        // this.view.views.forEach(v=> { v.suggestions.addEventListener("click", event=> this.handleSelection(event))});
        this.dico = dico;
        this.view.importProns.addEventListener('click', e => {
                    this.dico.handleImportProns(e).then(() => {
                        this.view.render(this.model);
                        // this.view.views.forEach(v=> { v.suggestions.addEventListener("click", event=> this.handleSelection(event))});                
                        // this.view.index.dispatchEvent(new Event("change"));
                    })
                });
        // this.view.container.addEventListener('change', e => this.handleInput(e));
        // document.getElementById('import-labels').addEventListener('click', e => this.handleImportLabels(e));
        // document.getElementById('import-audios').addEventListener('click', e => this.handleImportAudios(e));
        this.view.container.addEventListener("click", e => this.handleSelection(e));
        document.getElementById('import-project').addEventListener('click', e => this.handleImportLocalProject(e));
        document.getElementById('select-project').addEventListener('change', e => this.handleImportHostedProject(e));
        document.getElementById('export-project').addEventListener('click', e => this.model.export());
        document.getElementById('label-index').addEventListener('change', e => this.handleIndexChange(e));
        document.getElementById('viewer-displays').addEventListener('click', this.handleClickOnDisplays.bind(this));
        window.addEventListener("keydown", e => this.handlePaging(e));
        window.addEventListener("keyup", this.handleCtrlS);
        this.view.index.dispatchEvent(new Event("change"));
        this.mode = document.getElementById('toogle-hanzi')
        document.getElementById('toggle-hanzi').addEventListener('click', this.handleToggleTrad.bind(this))
        
        document.addEventListener("label-updated", (e) => {
            // console.log("Label updated:", e.detail.index);
            this.view.renderDisplays(this.model); // fast refresh of right panel
        });

        document.addEventListener("keydown", (event) => {
            // console.log(event)
            if (event.shiftKey) {
                event.preventDefault();
                // console.log(event)
                const key = event.key;

                // Only allow digits 1–9
                if (!/^[1-9]$/.test(key)) return;

                // Convert key to index (1 → 0, 2 → 1 ...)
                const suggestionIndex = parseInt(key, 10) - 1;

                // Get current label index from input
                const currentIndex = parseInt(this.view.index.value, 10) - 1;

                const view = this.view.views[currentIndex];
                if (!view) return;

                // console.log(view.suggestions)
                if (suggestionIndex >= view.suggestions.length) return; // nothing to click
                
                const el = view.suggestions.querySelector(`[data-suggestion="${suggestionIndex}"]`);
                if (el)el.click();
            }

        });

    }

    handleCtrlS(event){
        if (event.key === "s" && event.ctrlKey){
            event.preventDefault();
            this.model.export();
        }
    }

    handleToggleTrad(event){
        // console.log("handleToggleTrad", event)
        this.view.views.forEach((v,i) => {
            // console.log(event) 
            // v.suggestions.addEventListener("click", event=> this.handleSelection(event));    v.render(this.model.labels[i]);
        });
        this.view.index.dispatchEvent(new Event("change"));
    }

    handleClickOnDisplays(event) {
        // console.log("handleClickOnDisplays", event)
        const el = event.target.closest('span[id]');
        if (!el) return;

        // Match IDs ending with a dash-number like "xxx-0"
        const match = el.id.match(/^(.*-\d+)$/);
        if (match) {
            // console.log('Clicked element group:', match[1]);
        }
        const i = parseInt(match[0].split('-')[1]);

        // console.log("Clicked on display", i,event)
        if (!isNaN(i)){
            this.view.index.value = (i+1);
            this.view.index.dispatchEvent(new Event("change"));
        }
    }

    handleClick(event) {
        // console.log("handleclick", event)
        // const e = event;
        // const input = document.getElementById('label-index');
        // let v = Math.max(1, parseInt(input.value || '1', 10));
        // // if (event.target.tagName !== 'BUTTON') return; // only react to button clicks
        // this.model.labels[v-1].model.select(event.target.value);
        // this.view.render(this.model) 
        // // this.view.views.forEach(v=> { v.suggestions.addEventListener("click", event=> this.handleSelection(event))});document.getElementById('label-index').dispatchEvent(new Event("change"));
        // e.preventDefault();
        // document.getElementById('hanzi-'+(v-1)).focus();
    }

    handleSelection(event) {
        const btn = event.target.closest(".suggestion-btn");
        if (!btn) return; // click outside suggestions

        const labelIndex = parseInt(btn.dataset.label, 10);
        const suggestionIndex = parseInt(btn.dataset.suggestion, 10);

        const label = this.model.labels[labelIndex];
        if (!label) return;
        // Apply the selection: update only this model
        label.model.select(suggestionIndex);

        // Re-render ONLY the corresponding LabelView
        this.view.renderLabel(label, labelIndex)

        const labelView = this.view.views[labelIndex];
        labelView.wrapper.classList.add('visible');

        // Restore focus (nice usability)
        const ta = document.getElementById(`hanzi-${labelIndex}`);
        if (ta) ta.focus();
        this.view.index.dispatchEvent(new Event("change"));
    }

    getMax(){
        return window.app && app.model && Array.isArray(app.model.labels) ? app.model.labels.length : 1;
    }

    handlePaging(event){
        const e = event;
        if (e.key == 'PageDown' || e.key == 'PageUp') {
            // console.log("handlePaging", event)
            e.preventDefault();
            const input = document.getElementById('label-index');
            let v = Math.max(1, parseInt(input.value || '1', 10));

            if (e.key === 'PageDown') v += 1;
            else if (e.key === 'PageUp') v = Math.max(1, v - 1);

            // clamp to number of labels if available
            // v = Math.min(v, this.getMax());

            input.value = v;
            input.dispatchEvent(new Event('change'));
        }
    }

    handleIndexChange(event){
        // console.log("handleIndexChange", event)
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
                n.classList.add('rounded-xl')
                const margin = "m-10"
                const highlight = 'bg-violet-300';
                if (n.id === `${key}-${idx}`) {
                    n.classList.add(highlight);
                    n.classList.add(margin)
                    n.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest'    
                    });
                } else {
                    n.classList.remove(highlight);
                    n.classList.remove(margin)
                }
            });
        }

        // Focus same type of element in the new index
        const focusedId = document.activeElement?.id;
        if (focusedId) {
            const type = focusedId.split('-')[0]; // e.g., 'hanzi', 'french', etc.
            const newFocusId = `${type}-${idx}`;   // Use new idx instead of i+1
            const newFocusEl = document.getElementById(newFocusId);
            if (newFocusEl) newFocusEl.focus();
        }
    }

async handleImportHostedProject(event) {
    try {
        const projectPath = event.target.value;
        const files = {}
        files.hakka   = projectPath + "hakka.txt";
        files.french  = projectPath + "french.txt";
        files.audio   = projectPath + "audio.wav";
        files.pron    = projectPath + "prononciations.csv";

        if (!files) {
            alert("No file paths provided.");
            return;
        }

        this.model = new Transcription();
        this.view = new View();

        // --- Load hakka.txt ---
        if (files.hakka) {
            const text = await fetch(files.hakka).then(r => r.text()).catch(e => alert("Fichier introuvable : hakka.txt"));
            if (text) {
                const lines = text.split(/\r?\n/).filter(Boolean);
                this.model.labels = lines.map(line => {
                    const [start, end, content] = line.split("\t");
                    return {
                        start: parseFloat(start),
                        end: parseFloat(end),
                        model: new HakkaText(dico, content || "")
                    };
                });
            }
        }

        // --- Load french.txt ---
        if (files.french) {
            const text = await fetch(files.french).then(r => r.text()).catch(e => alert("Fichier introuvable : french.txt"));
            if (text) {
                const lines = text.split(/\r?\n/).filter(Boolean);
                lines.forEach((l, i) => {
                    const parts = l.split("\t");
                    if (this.model.labels?.[i]) {
                        this.model.labels[i].model.french = parts[2];
                    }
                });
            }

        }

        // --- Load audio file ---
        if (files.audio) {
            this.view.audio = {
                name: "audio",
                url: files.audio
            };
        }

        // --- Load prononciations.csv ---
        if (files.pron) {
            const text = await fetch(files.pron).then(r => r.text()).catch(e => alert("Fichier introuvable : prononciation.txt"));
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

        // --- Render UI ---
        this.view.render(this.model);
        // this.view.views.forEach(v => v.suggestions.addEventListener("click", event => this.handleSelection(event)));
        this.view.displays.addEventListener("click", this.handleClickOnDisplays.bind(this));
        this.view.index.dispatchEvent(new Event("change"));

        alert("Project successfully loaded!");

    } catch (err) {
        console.error(err);
        alert("Failed to import project.");
    }
}


    async handleImportLocalProject(event){
        if (!window.showDirectoryPicker) {
            alert("Your browser does not support the File System Access API required for folder picking.");
            return;
        }
        try {
            alert("Vous êtes sur le point de charger un nouveau projet. Les modifications non enregistrées seront perdues.")

            const dirHandle = await window.showDirectoryPicker();
            const audios = [];

            this.model = new Transcription();
            this.view = new View();

            // find and read hanzi.txt first (if present) to populate labels
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
                        if (this.model?.labels[i]) this.model.labels[i].model.french = line[2];
                    });
                    break;
                }
            }


            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind == 'file' && name == 'audio.wav')
                {
                    const lower = name.toLowerCase();
                    const file = await handle.getFile();
                    const url = URL.createObjectURL(file);
                    this.view.audio = {name,file,url}
                }
            }

            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind !== 'file') continue;
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

            const pronunciations = [];
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && entry.name == 'prononciations.csv' ) {
                    const file = await entry.getFile();
                    const text = await file.text();
                    const lines = text.split('\n').filter(line => line.trim());
                    // Skip header if present
                    let start = 0;
                    if (lines[0].toLowerCase().includes('char') && lines[0].toLowerCase().includes('initial')) start = 1;
                    for (let i = start; i < lines.length; i++) {
                        const [char, initial, final, tone] = lines[i].split(',');
                        const p = new Pronunciation({ simp: char, trad: char, initial, final, tone })
                        // console.log(p);
                        pronunciations.push(p);
                    }
                    this.dico.addPronunciations(pronunciations);
                    alert(`Loaded ${pronunciations.length} pronunciations from folder.`);
                }
            }
            this.view.render(this.model); 
            // this.view.views.forEach(v=> { v.suggestions.addEventListener("click", event=> this.handleClick(event))});    
            this.view.displays.addEventListener('click', this.handleClickOnDisplays.bind(this));
            this.view.index.dispatchEvent(new Event("change"));

        } catch (err) {
            console.error(err);
            alert("Failed to import audios.");
        }
    }
}

const app = new Controller();