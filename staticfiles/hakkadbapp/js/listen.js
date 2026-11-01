/* =========================================================================
   Listening page of a shared transcription (transcription_listen.html),
   made for phones: the segments (TranscriptDocument), the audio. Touch a
   segment to listen from there (or to that segment only, "phrase par
   phrase"); while playing, the segment heard stays right below the audio.
   Which lines are shown (hanzi, pinyin, français) and where the listener
   stopped are kept in this browser.
   ========================================================================= */

(function () {
    const $ = (id) => document.getElementById(id);
    const t = JSON.parse($('transcript-data').textContent);
    const audio = $('tr-audio');
    const list = $('tr-segments');
    const key = (name) => `hakka-listen:${$('tr-app').dataset.id}:${name}`;
    const store = {
        get(name, fallback) { try { const v = localStorage.getItem(key(name)); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
        set(name, value) { try { localStorage.setItem(key(name), JSON.stringify(value)); } catch (e) { /* convenience only */ } },
    };

    $('tr-head').innerHTML = TranscriptDocument.renderHeader(t);
    list.innerHTML = TranscriptDocument.renderSegments(t);
    const rows = Array.from(list.querySelectorAll('.tr-seg'));

    // Lines shown: same choice for every transcription.
    const SHOW_KEY = 'hakka-listen:show';
    let show;
    try { show = JSON.parse(localStorage.getItem(SHOW_KEY)) || {}; } catch (e) { show = {}; }
    document.querySelectorAll('[data-show]').forEach((box) => {
        const line = box.dataset.show;
        box.checked = show[line] !== false;
        const apply = () => document.body.classList.toggle(`tr-hide-${line}`, !box.checked);
        apply();
        box.addEventListener('change', () => {
            show[line] = box.checked;
            try { localStorage.setItem(SHOW_KEY, JSON.stringify(show)); } catch (e) { /* convenience only */ }
            apply();
        });
    });

    $('tr-print').addEventListener('click', () => window.print());
    if (!audio) return;

    let stopAt = null;
    let current = -1;

    function scrollToRow(row) {
        const bar = $('tr-bar');
        window.scrollTo({ top: window.scrollY + row.getBoundingClientRect().top - bar.offsetHeight - 4, behavior: 'smooth' });
    }

    function setCurrent(i, { scroll = true } = {}) {
        if (i === current) return;
        rows[current]?.classList.remove('is-playing');
        current = i;
        const row = rows[i];
        if (!row) return;
        row.classList.add('is-playing');
        if (scroll && $('tr-follow').checked) scrollToRow(row);
    }

    /** Last segment started at or before `ms`. */
    function segmentAt(ms) {
        let lo = 0, hi = t.segments.length - 1, found = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (t.segments[mid].start <= ms) { found = mid; lo = mid + 1; } else hi = mid - 1;
        }
        return found;
    }

    list.addEventListener('click', (event) => {
        const row = event.target.closest('.tr-seg');
        if (!row) return;
        const i = Number(row.dataset.i);
        const seg = t.segments[i];
        audio.currentTime = seg.start / 1000;
        stopAt = $('tr-one').checked ? seg.end / 1000 : null;
        setCurrent(i, { scroll: false });
        audio.play().catch(() => {});
    });

    audio.addEventListener('timeupdate', () => {
        if (stopAt !== null && audio.currentTime >= stopAt) {
            audio.pause();
            stopAt = null;
            return;
        }
        const i = segmentAt(audio.currentTime * 1000);
        // In a silence, the segment just heard stays highlighted.
        if (i >= 0 && audio.currentTime * 1000 <= t.segments[i].end + 1500) setCurrent(i);
        store.set('time', Math.floor(audio.currentTime));
    });

    // Back where the listener stopped last time (not playing).
    audio.addEventListener('loadedmetadata', () => {
        const time = store.get('time', 0);
        if (time > 5 && time < audio.duration - 5) {
            audio.currentTime = time;
            const i = segmentAt(time * 1000);
            if (i >= 0) { setCurrent(i, { scroll: false }); }
            $('tr-resume').textContent = `reprise à ${TranscriptDocument.time(time * 1000)}`;
        }
    }, { once: true });
})();
