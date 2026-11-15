/* =========================================================================
   HanziForms — the simplified and traditional forms of a character.
   The lexicon stores one form of each character; its simp / trad come from
   OpenCC, which keeps a single traditional form (发 -> 發), while a text, a
   dictionary or a Chinese keyboard may give another one (髮), or the other
   way round. components/data.html gives the table of every other form of
   the lexicon's characters -> its simplified one (髮 發 -> 发,
   templatetags hanzi_forms_json); here:
   - canon(text): each character in its simplified form;
   - pick(list, char): the readings of `char` -- those written so first,
     else those of another form of it (乾 keeps its own if the lexicon has
     it, and is never read as 干);
   - sameText(a, b): the same word, whatever the forms.
   ========================================================================= */
const HanziForms = {
    table: null,

    load() {
        if (this.table) return this.table;
        try {
            const el = typeof document !== 'undefined' && document.getElementById?.('hanzi-forms');
            this.table = el ? JSON.parse(el.textContent) : {};
        } catch (e) {
            this.table = {};
        }
        return this.table;
    },

    /** Tests (and pages without the lexicon's data) set the table directly. */
    use(table) {
        this.table = table || {};
    },

    canon(text) {
        const table = this.load();
        return [...String(text || '')].map((c) => table[c] || c).join('');
    },

    /** A traditional form of another character (髮 for 发). */
    isOtherForm(char) {
        const s = this.load()[char];
        return !!s && s !== char;
    },

    sameText(a, b) {
        return a === b || (!!a && !!b && this.canon(a) === this.canon(b));
    },

    /** The items of `list` for `char` (keys(item): its forms, simp and trad):
     *  written so first, else written in another form of it. */
    pick(list, char, keys = (p) => [p.simp, p.trad]) {
        const exact = list.filter((p) => keys(p).includes(char));
        if (exact.length || !char) return exact;
        const c = this.canon(char);
        if (c === char && !Object.keys(this.load()).length) return exact;
        return list.filter((p) => keys(p).some((h) => h && this.canon(h) === c));
    },
};
