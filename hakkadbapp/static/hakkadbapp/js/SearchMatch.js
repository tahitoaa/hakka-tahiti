/* =========================================================================
   SearchMatch — what every search box of the site understands (loaded by
   base.html):
   - case, accents and superscript tones folded (ka¹ = ka1, jiā = jia);
   - several words: each one must be found, in any order (maison zen);
   - syllables typed apart, with or without their tone, find a word
     written in one block: « zen lao », « zen1 lao » or « zenlao » find
     zen1lao1 (and zen¹lao¹).
   SearchMatch.compile(query) -> test(text): to filter many items with the
   same query; SearchMatch.match(text, query) for one.
   ========================================================================= */
const SearchMatch = {
    SUP: '⁰¹²³⁴⁵⁶⁷⁸',

    /** Lowercase, no diacritics, superscript tones as digits, ’ as '. */
    fold(text) {
        return String(text ?? '').toLowerCase()
            .replace(/[⁰¹²³⁴⁵⁶⁷⁸]/g, (c) => String(SearchMatch.SUP.indexOf(c)))
            .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/’/g, "'");
    },

    /** The text without tones (digits, « _ ») nor spaces between syllables. */
    compact(folded) {
        return folded.replace(/[0-8_]/g, '').replace(/[\s'-]+/g, '');
    },

    /** A latin syllable as typed (letters, optional tone). */
    SYLLABLE: /^[a-zü'ɛɔŋəɨ]+[0-8_]?$/u,

    compile(query) {
        const q = SearchMatch.fold(query).trim();
        if (!q) return () => true;
        const terms = q.split(/\s+/);
        const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Syllables apart (zen lao, zen1 lao): one after the other, each tone optional.
        const syllables = terms.length > 1 && terms.every((t) => SearchMatch.SYLLABLE.test(t))
            ? new RegExp(terms.map((t) => esc(t) + (/[0-8_]$/.test(t) ? '' : '[0-8_]?')).join("[\\s'-]*"), 'u')
            : null;
        // One block without tones (zenlao): against the text without its tones.
        const block = terms.length === 1 && /^[a-zü'ɛɔŋəɨ]{3,}$/u.test(q) ? q.replace(/'/g, '') : '';
        return (text) => {
            const hay = SearchMatch.fold(text);
            if (terms.every((t) => hay.includes(t))) return true;
            if (syllables && syllables.test(hay)) return true;
            return !!block && SearchMatch.compact(hay).includes(block);
        };
    },

    match(text, query) {
        return SearchMatch.compile(query)(text);
    },
};
