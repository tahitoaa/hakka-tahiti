/* =========================================================================
   HanziInfo — Mandarin reading(s) and short English meaning of a character,
   from the Unicode Unihan database (data/hanzi_info.json, built by
   `manage.py build_hanzi_info`). Loaded once, only when a page needs it:
   - a character's page and any [data-hanzi-info="家"] element (filled in);
   - the Caractères tab tooltip (caracters.js) and the character
     suggestions' tooltip (CharacterInput.js), through HanziInfo.text().
   ========================================================================= */
const HanziInfo = (() => {
    const URL = (document.currentScript?.dataset.url) || '/static/hakkadbapp/data/hanzi_info.json';
    let chars = null;
    let loading = null;

    function load() {
        loading ??= fetch(URL).then((r) => (r.ok ? r.json() : { chars: {} })).then((data) => {
            chars = data.chars || {};
            document.dispatchEvent(new CustomEvent('hanzi-info-ready'));
            return chars;
        }).catch(() => { chars = {}; return chars; });
        return loading;
    }

    /** {mandarin: "jiā jià", meaning: "house, home"} or null (not loaded, unknown). */
    function get(char) {
        const entry = chars?.[char];
        return entry ? { mandarin: entry[0].split(' ').filter(Boolean).join(', '), meaning: entry[1] } : null;
    }

    /** One line for a tooltip: "Mandarin : jiā, jià — house, home". */
    function text(char) {
        const info = get(char);
        if (!info) return '';
        return [info.mandarin && `Mandarin : ${info.mandarin}`, info.meaning].filter(Boolean).join(' — ');
    }

    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    /** HTML for a tooltip or a box ('' when unknown). */
    function html(char) {
        const info = get(char);
        if (!info) return '';
        return `<span class="hzi-line">${info.mandarin ? `<b>Mandarin</b> ${esc(info.mandarin)}` : ''}`
            + `${info.mandarin && info.meaning ? ' · ' : ''}${info.meaning ? `<span lang="en">${esc(info.meaning)}</span>` : ''}</span>`;
    }

    /** Fills every [data-hanzi-info] element under `root`. */
    function decorate(root = document) {
        const els = [...root.querySelectorAll('[data-hanzi-info]')];
        if (!els.length) return;
        load().then(() => els.forEach((el) => {
            const char = [...el.dataset.hanziInfo].find((c) => get(c)) || el.dataset.hanziInfo;
            const content = html(char);
            el.innerHTML = content ? `${content} <span class="hzi-src">Unihan</span>` : '';
            el.hidden = !content;
        }));
    }

    document.addEventListener('DOMContentLoaded', () => decorate());
    return { load, get, text, html, decorate };
})();
