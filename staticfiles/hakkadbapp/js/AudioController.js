class AudioController {
    constructor() {
        this.playingAudio = null;
        this.autoMode = false;

        this.full = document.getElementById('audio');

        // Buttons
        this.playButton  = document.getElementById("play-button");
        this.pauseButton = document.getElementById("pause-button");
        this.loopButton  = document.getElementById("loop-button");
        this.autoButton  = document.getElementById("auto-button");

        // Bind all handlers
        this.playButton?.addEventListener("click",  e => this.playCurrent(false));
        this.pauseButton?.addEventListener("click", () => this.stop());
        this.loopButton?.addEventListener("click",  e => this.playCurrent(true));
        this.autoButton?.addEventListener("click",  e => this.toggleAuto());


        document.getElementById('label-index').addEventListener('change', e => this.playCurrent());
        window.addEventListener("keyup", (e) => this.handlePaging.bind(this)(e));
        window.addEventListener("keyup", (e) => {if (e.key === " " && e.target.tagName != "TEXTAREA") this.playCurrent(false)});
        window.addEventListener("keyup", (e) => {if (e.ctrlKey && e.key === " ") this.playCurrent(false)});
    }

    handlePaging(event){
        const e = event;
        const input = document.getElementById('label-index');
        if (e.key !== 'PageDown' && e.key !== 'PageUp') return;
        this.playCurrent(false);
    }

    /** Return current 0-based index from #label-index */
    getCurrentIndex() {
        return Math.max(1, parseInt(document.getElementById("label-index").value || "1", 10)) - 1;
    }

    /** Update index and trigger re-render */
    setCurrentIndex(idx) {
        const input = document.getElementById("label-index");
        input.value = idx + 1;
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    /** Return <audio> element or build one from model */
    getAudioForIndex(idx) {
        const chunk = document.querySelector(`#viewer #chunk-${idx}`);
        if (chunk) {
            const el = chunk.querySelector("audio");
            if (el) return el;
        }
        const model = window.app?.model?.labels?.[idx];
        return model?.audio ? new Audio(model.audio.url) : null;
    }

    /** Stop current audio */
    stop() {
        if (this.playingAudio) {
            this.playingAudio.pause();
            this.playingAudio.onended = null;
        }
        this.playingAudio = null;
        this.autoMode = false;
    }

    /** Play current index, with optional looping */
    playCurrent(loop = false) {
        this.stop(); // clear previous state
        const idx = this.getCurrentIndex();
        const audio = this.getAudioForIndex(idx);
        if (!audio) return;

        this.playingAudio = audio;
        this.playingAudio.loop = loop;
        this.playingAudio.currentTime = 0;
        this.playingAudio.onended = null;
        this.playingAudio.play().catch(console.warn)
    }

    /** Toggle auto mode on/off */
    toggleAuto() {
        this.autoMode = !this.autoMode;
        if (this.autoMode) this.playSequential(this.getCurrentIndex());
        else this.stop();
    }

    /** Sequentially play through all audios */
    playSequential(idx) {
        this.stop();
        const audio = this.getAudioForIndex(idx);
        if (!audio) {
            console.log("⚠️ No audio at index", idx);
            this.autoMode = false;
            return;
        }

        this.playingAudio = audio;
        this.playingAudio.loop = false;
        this.playingAudio.currentTime = 0;

        this.playingAudio.onended = () => {
            if (!this.autoMode) return;
            const nextIdx = idx + 1;
            const total = app.model.labels.length;
            if (nextIdx < total) {
                this.setCurrentIndex(nextIdx);
                this.playSequential(nextIdx);
            } else {
                console.log("✅ Finished all audios.");
                this.autoMode = false;
                this.stop();
            }
        };

        this.playingAudio.play().catch(console.warn);
    }
}

const audioController = new AudioController();
