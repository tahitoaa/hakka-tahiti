/* =========================================================================
   mp3-worker.js — compresses a .wav recording to a small mono MP3 for the
   shared transcriptions (speech: 22 kHz, 40 kbit/s, ~18 MB per hour),
   without blocking the page. The WAV is read piece by piece (a 1-hour
   .wav is ~600 MB, too much to decode at once), mixed down to mono,
   resampled, and fed to lamejs (vendor/lamejs, LGPL).

   Any other format (ogg, aac, opus, webm, flac, 3gp, a video's sound...)
   is decoded by the page (transcripter.js, decodeAudioData: workers have
   no AudioContext) and arrives here as mono samples.

   In:  { file: File, lameUrl } (a .wav) or { pcm: Float32Array, rate, lameUrl }
   Out: { progress: 0..1 } … then { blob } or { error }
   ========================================================================= */

const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

self.onmessage = async ({ data }) => {
    try {
        importScripts(data.lameUrl);
        const progress = (p) => self.postMessage({ progress: p });
        const blob = data.pcm ? await encodePcm(data.pcm, data.rate, progress) : await encodeWav(data.file, progress);
        self.postMessage({ blob });
    } catch (err) {
        self.postMessage({ error: err.message || String(err) });
    }
};

async function readBytes(file, start, length) {
    return new DataView(await file.slice(start, start + length).arrayBuffer());
}

function fourCC(view, offset) {
    return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

/** fmt and data chunks of a RIFF/WAVE file. */
async function readHeader(file) {
    const riff = await readBytes(file, 0, 12);
    if (riff.byteLength < 12 || fourCC(riff, 0) !== 'RIFF' || fourCC(riff, 8) !== 'WAVE') {
        throw new Error("Ce n'est pas un fichier WAV lisible.");
    }
    let offset = 12;
    let fmt = null;
    while (offset + 8 <= file.size) {
        const head = await readBytes(file, offset, 8);
        const id = fourCC(head, 0);
        const size = head.getUint32(4, true);
        if (id === 'fmt ') {
            const f = await readBytes(file, offset + 8, Math.min(size, 40));
            let format = f.getUint16(0, true);
            if (format === 0xFFFE && size >= 26) format = f.getUint16(24, true); // WAVE_FORMAT_EXTENSIBLE
            fmt = {
                format,
                channels: f.getUint16(2, true),
                rate: f.getUint32(4, true),
                blockAlign: f.getUint16(12, true),
                bits: f.getUint16(14, true),
            };
        } else if (id === 'data') {
            if (!fmt) throw new Error('Fichier WAV sans description du format.');
            const start = offset + 8;
            // A size of 0 / 0xFFFFFFFF: written while recording, read to the end.
            const length = size && size !== 0xFFFFFFFF ? Math.min(size, file.size - start) : file.size - start;
            return { ...fmt, start, length };
        }
        offset += 8 + size + (size & 1);
    }
    throw new Error('Fichier WAV sans données audio.');
}

/** Reads sample `i` of channel `c` in a block, as -1..1. */
function sampleReader(fmt) {
    const bytes = fmt.bits / 8;
    if (fmt.format === 3 && fmt.bits === 32) return (v, o) => v.getFloat32(o, true);
    if (fmt.format === 3 && fmt.bits === 64) return (v, o) => v.getFloat64(o, true);
    if (fmt.format !== 1) throw new Error(`Format WAV non pris en charge (code ${fmt.format}).`);
    if (bytes === 1) return (v, o) => (v.getUint8(o) - 128) / 128;
    if (bytes === 2) return (v, o) => v.getInt16(o, true) / 32768;
    if (bytes === 3) return (v, o) => ((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16))) / 8388608;
    if (bytes === 4) return (v, o) => v.getInt32(o, true) / 2147483648;
    throw new Error(`WAV en ${fmt.bits} bits non pris en charge.`);
}

async function encodeWav(file, onProgress) {
    const fmt = await readHeader(file);
    const read = sampleReader(fmt);
    const bytesPerSample = fmt.bits / 8;
    return encodeMono(fmt.rate, Math.floor(fmt.length / fmt.blockAlign), async (frame, frames) => {
        const view = await readBytes(file, fmt.start + frame * fmt.blockAlign, frames * fmt.blockAlign);
        const mono = new Float32Array(frames);
        for (let i = 0; i < frames; i++) {
            let sum = 0;
            const base = i * fmt.blockAlign;
            for (let c = 0; c < fmt.channels; c++) sum += read(view, base + c * bytesPerSample);
            mono[i] = sum / fmt.channels;
        }
        return mono;
    }, onProgress);
}

/** Mono samples already decoded by the page (any format the browser reads). */
function encodePcm(pcm, rate, onProgress) {
    return encodeMono(rate, pcm.length, async (frame, frames) => pcm.subarray(frame, frame + frames), onProgress);
}

/** Resamples mono blocks (readBlock(frame, frames) -> Float32Array, -1..1) to a speech MP3. */
async function encodeMono(rate, totalFrames, readBlock, onProgress) {
    if (!totalFrames) throw new Error('Aucun son dans ce fichier.');
    const outRate = MP3_RATES.filter((r) => r <= Math.min(rate, 22050)).pop() || 8000;
    const kbps = outRate >= 22050 ? 40 : outRate >= 16000 ? 32 : 24;
    const encoder = new lamejs.Mp3Encoder(1, outRate, kbps);
    const ratio = rate / outRate;              // >= 1: box-average downsampling
    const chunks = [];

    const framesPerBlock = rate * 10;
    let carry = new Float32Array(0);           // source samples not consumed yet
    let pos = 0;                               // fractional position in carry

    for (let frame = 0; frame < totalFrames; frame += framesPerBlock) {
        const frames = Math.min(framesPerBlock, totalFrames - frame);
        const block = await readBlock(frame, frames);
        const buffer = new Float32Array(carry.length + frames);
        buffer.set(carry);
        buffer.set(block, carry.length);
        const out = new Int16Array(Math.floor((buffer.length - pos) / ratio) + 1);
        let n = 0;
        while (pos + ratio <= buffer.length) {
            const from = Math.floor(pos);
            const to = Math.max(from + 1, Math.floor(pos + ratio));
            let sum = 0;
            for (let k = from; k < to; k++) sum += buffer[k];
            const value = Math.max(-1, Math.min(1, sum / (to - from)));
            out[n++] = value < 0 ? value * 32768 : value * 32767;
            pos += ratio;
        }
        const used = Math.floor(pos);
        carry = buffer.slice(used);
        pos -= used;
        const mp3 = encoder.encodeBuffer(out.subarray(0, n));
        if (mp3.length) chunks.push(new Uint8Array(mp3));
        onProgress((frame + frames) / totalFrames);
    }
    const tail = encoder.flush();
    if (tail.length) chunks.push(new Uint8Array(tail));
    return new Blob(chunks, { type: 'audio/mpeg' });
}
