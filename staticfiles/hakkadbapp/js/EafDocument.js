/* =========================================================================
   EafDocument — an ELAN (.eaf) file, edited in place.

   The parsed XML document stays the source of truth: the editor only
   changes annotation values (and adds the child tiers / annotations it
   needs), so everything else the file holds -- other tiers, linguistic
   types, languages, locales, controlled vocabularies, media descriptor,
   ids -- comes out of serialize() exactly as it went in.

   Model:
   - a speaker is a top-level, time-alignable tier (no PARENT_REF); its
     annotations are the segments, and hold the transcript: the working
     text (romanization as typed, then words separated by spaces with
     pinned readings such as 生(sen1), see Sentence.js);
   - each speaker can have child tiers (Symbolic_Association) by role:
     translation, pinyin, mixed, hanzi (characters only) -- detected from
     their tier id / linguistic type, or created on first write, named
     after the convention already used in the file ("Annette traduction",
     "Annette Levin Hanzi").
   ========================================================================= */

class EafDocument {
    static ROLES = ['translation', 'pinyin', 'mixed', 'hanzi'];

    // Default suffix (tier id = "<speaker> <suffix>"), linguistic type and
    // language of each child role.
    static ROLE_DEFAULTS = {
        hanzi: { suffix: 'Hanzi', type: 'hanzi', lang: 'hak' },
        translation: { suffix: 'Traduction', type: 'traduction', lang: 'fra' },
        pinyin: { suffix: 'Pinyin', type: 'pinyin', lang: 'hak' },
        mixed: { suffix: 'Mixed', type: 'mixed', lang: 'hak' },
    };

    static ROLE_PATTERNS = {
        hanzi: /hanzi|漢字|汉字|caract/i,
        translation: /tradu|transl|fran[cç]|french|\bfra\b/i,
        pinyin: /pinyin|romani/i,
        mixed: /mixed|mixte/i,
    };

    /** A new, empty .eaf (segmentation is then done in ELAN), after the
     *  anavevo model: per participant, a "transcription" tier named
     *  `tierId` ("Annette", PARTICIPANT "Annette Levin") and its child
     *  tiers "<tierId> Traduction", "… Pinyin", "… Mixed", "… Hanzi".
     *  `media`: { name, mime } of the recording, next to the .eaf. */
    static create({ participants, annotator = '', media = null }) {
        const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
        const lines = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            `<ANNOTATION_DOCUMENT AUTHOR="" DATE="${new Date().toISOString()}" FORMAT="3.0" VERSION="3.0" `
                + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.mpi.nl/tools/elan/EAFv3.0.xsd">',
            '    <HEADER MEDIA_FILE="" TIME_UNITS="milliseconds">',
        ];
        if (media) {
            // The absolute path isn't known here: ELAN falls back on the
            // relative one, next to the .eaf.
            lines.push(`        <MEDIA_DESCRIPTOR ${attrs({ MEDIA_URL: `file:///${encodeURI(media.name)}`, MIME_TYPE: media.mime, RELATIVE_MEDIA_URL: `./${media.name}` })}/>`);
        }
        const urn = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        lines.push(
            `        <PROPERTY NAME="URN">urn:nl-mpi-tools-elan-eaf:${urn}</PROPERTY>`,
            '        <PROPERTY NAME="lastUsedAnnotationId">0</PROPERTY>',
            '    </HEADER>',
            '    <TIME_ORDER/>',
        );
        participants.forEach(({ name, tierId }) => {
            lines.push(`    <TIER ${attrs({ ANNOTATOR: annotator, LINGUISTIC_TYPE_REF: 'transcription', PARTICIPANT: name, TIER_ID: tierId })}/>`);
            EafDocument.ROLES.forEach((role) => {
                const d = EafDocument.ROLE_DEFAULTS[role];
                lines.push(`    <TIER ${attrs({ ANNOTATOR: annotator, LINGUISTIC_TYPE_REF: d.type, PARENT_REF: tierId, PARTICIPANT: name, TIER_ID: `${tierId} ${d.suffix}` })}/>`);
            });
        });
        lines.push('    <LINGUISTIC_TYPE GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="transcription" TIME_ALIGNABLE="true"/>');
        EafDocument.ROLES.forEach((role) => {
            lines.push(`    <LINGUISTIC_TYPE CONSTRAINTS="Symbolic_Association" GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="${EafDocument.ROLE_DEFAULTS[role].type}" TIME_ALIGNABLE="false"/>`);
        });
        lines.push(
            '    <CONSTRAINT DESCRIPTION="Time subdivision of parent annotation\'s time interval, no time gaps allowed within this interval" STEREOTYPE="Time_Subdivision"/>',
            '    <CONSTRAINT DESCRIPTION="Symbolic subdivision of a parent annotation. Annotations refering to the same parent are ordered" STEREOTYPE="Symbolic_Subdivision"/>',
            '    <CONSTRAINT DESCRIPTION="1-1 association with a parent annotation" STEREOTYPE="Symbolic_Association"/>',
            '    <CONSTRAINT DESCRIPTION="Time alignable annotations within the parent annotation\'s time interval, gaps are allowed" STEREOTYPE="Included_In"/>',
            '</ANNOTATION_DOCUMENT>',
            '',
        );
        return lines.join('\n');
    }

    /** Parses .eaf text; throws a readable Error when it isn't an ELAN file. */
    static parse(text, fileName = 'transcription.eaf') {
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        const error = doc.getElementsByTagName('parsererror')[0];
        if (error) throw new Error(`Fichier XML invalide : ${error.textContent.split('\n')[0]}`);
        if (doc.documentElement.tagName !== 'ANNOTATION_DOCUMENT') {
            throw new Error("Ce n'est pas un fichier ELAN (.eaf) : élément racine ANNOTATION_DOCUMENT absent.");
        }
        return new EafDocument(doc, fileName);
    }

    constructor(doc, fileName) {
        this.doc = doc;
        this.root = doc.documentElement;
        this.fileName = fileName;
        this.index();
    }

    // -----------------------------------------------------------------
    // Reading
    // -----------------------------------------------------------------

    elements(tag, parent = this.root) {
        return Array.from(parent.children).filter((el) => el.tagName === tag);
    }

    tierById(id) {
        return this.elements('TIER').find((t) => t.getAttribute('TIER_ID') === id) || null;
    }

    typeById(id) {
        return this.elements('LINGUISTIC_TYPE').find((t) => t.getAttribute('LINGUISTIC_TYPE_ID') === id) || null;
    }

    isTimeAlignable(tier) {
        const type = this.typeById(tier.getAttribute('LINGUISTIC_TYPE_REF'));
        // No type declared: ELAN's own default is time-alignable.
        return !type || type.getAttribute('TIME_ALIGNABLE') !== 'false';
    }

    roleOf(tier) {
        const text = `${tier.getAttribute('TIER_ID') || ''} ${tier.getAttribute('LINGUISTIC_TYPE_REF') || ''}`;
        return EafDocument.ROLES.find((role) => EafDocument.ROLE_PATTERNS[role].test(text)) || null;
    }

    /** (Re)builds speakers and segments from the document. */
    index() {
        const timeOrder = this.elements('TIME_ORDER')[0];
        this.times = {};
        let last = 0;
        (timeOrder ? this.elements('TIME_SLOT', timeOrder) : []).forEach((slot) => {
            const value = slot.getAttribute('TIME_VALUE');
            // Unaligned slots (no TIME_VALUE) take the previous known time.
            last = value === null ? last : Number(value);
            this.times[slot.getAttribute('TIME_SLOT_ID')] = last;
        });

        const tiers = this.elements('TIER');
        this.speakers = tiers
            .filter((t) => !t.getAttribute('PARENT_REF') && this.isTimeAlignable(t))
            .map((tier, index) => {
                const id = tier.getAttribute('TIER_ID');
                const children = {};
                tiers.filter((t) => t.getAttribute('PARENT_REF') === id).forEach((child) => {
                    const role = this.roleOf(child);
                    if (role && !children[role]) children[role] = child;
                });
                return {
                    index,
                    id,
                    participant: tier.getAttribute('PARTICIPANT') || id,
                    tier,
                    children,
                };
            });

        this.segments = [];
        this.speakers.forEach((speaker) => {
            const refs = {};
            Object.entries(speaker.children).forEach(([role, child]) => {
                refs[role] = {};
                this.elements('ANNOTATION', child).forEach((a) => {
                    const ref = a.firstElementChild;
                    if (ref?.tagName === 'REF_ANNOTATION') {
                        refs[role][ref.getAttribute('ANNOTATION_REF')] = ref;
                    }
                });
            });
            this.elements('ANNOTATION', speaker.tier).forEach((a, order) => {
                const al = a.firstElementChild;
                if (al?.tagName !== 'ALIGNABLE_ANNOTATION') return;
                const id = al.getAttribute('ANNOTATION_ID');
                const value = (el) => el?.getElementsByTagName('ANNOTATION_VALUE')[0]?.textContent ?? '';
                const segment = {
                    key: `${speaker.index}:${id}`,
                    speaker,
                    id,
                    order,
                    start: this.times[al.getAttribute('TIME_SLOT_REF1')] ?? 0,
                    end: this.times[al.getAttribute('TIME_SLOT_REF2')] ?? 0,
                    element: al,
                    transcript: value(al),
                };
                EafDocument.ROLES.forEach((role) => { segment[role] = value(refs[role]?.[id]); });
                this.segments.push(segment);
            });
        });
        this.segments.sort((a, b) => a.start - b.start || a.speaker.index - b.speaker.index || a.order - b.order);
        this.segmentsByKey = new Map(this.segments.map((s) => [s.key, s]));
    }

    // -----------------------------------------------------------------
    // Writing
    // -----------------------------------------------------------------

    /** Sets one value of a segment: 'transcript' is the speaker tier's own
     *  annotation; any other role goes to that child tier (created if need
     *  be). Writing '' where nothing exists yet creates nothing. */
    setText(segment, role, value) {
        value = value ?? '';
        if (role === 'transcript') {
            this.setValue(segment.element, value);
            segment.transcript = value;
            return;
        }
        if (!EafDocument.ROLES.includes(role)) throw new Error(`Rôle inconnu : ${role}`);
        let child = segment.speaker.children[role];
        if (!child) {
            if (!value) return;
            child = this.createChildTier(segment.speaker, role);
        }
        let ref = this.elements('ANNOTATION', child)
            .map((a) => a.firstElementChild)
            .find((r) => r?.tagName === 'REF_ANNOTATION' && r.getAttribute('ANNOTATION_REF') === segment.id);
        if (!ref) {
            if (!value) return;
            ref = this.createRefAnnotation(child, segment);
        }
        this.setValue(ref, value);
        segment[role] = value;
    }

    /** "Transcript" child tiers (left by an earlier version of the editor,
     *  which kept the transcript there): their values move to the speaker
     *  tier, and the tiers are removed. Returns the segments changed. */
    absorbTranscriptTiers() {
        let moved = 0;
        this.speakers.forEach((speaker) => {
            const tiers = this.elements('TIER').filter((t) =>
                t.getAttribute('PARENT_REF') === speaker.id && /transcri/i.test(t.getAttribute('TIER_ID') || ''));
            tiers.forEach((tier) => {
                this.elements('ANNOTATION', tier).forEach((a) => {
                    const ref = a.firstElementChild;
                    const value = ref?.getElementsByTagName('ANNOTATION_VALUE')[0]?.textContent ?? '';
                    const segment = this.segmentsByKey.get(`${speaker.index}:${ref?.getAttribute('ANNOTATION_REF')}`);
                    if (!segment || !value || value === segment.transcript) return;
                    this.setText(segment, 'transcript', value);
                    moved++;
                });
                if (tier.previousSibling?.nodeType === 3) tier.previousSibling.remove();
                tier.remove();
            });
        });
        return moved;
    }

    setValue(annotation, value) {
        let el = annotation.getElementsByTagName('ANNOTATION_VALUE')[0];
        if (!el) el = annotation.appendChild(this.doc.createElement('ANNOTATION_VALUE'));
        el.textContent = value;
    }

    nextAnnotationId() {
        const property = this.lastUsedProperty();
        // The highest id in use is looked up once, then counted on.
        if (this.maxAnnotationId === undefined) {
            let max = Number(property?.textContent) || 0;
            Array.from(this.root.getElementsByTagName('*')).forEach((el) => {
                const m = /^a(\d+)$/.exec(el.getAttribute('ANNOTATION_ID') || '');
                if (m) max = Math.max(max, Number(m[1]));
            });
            this.maxAnnotationId = max;
        }
        const next = ++this.maxAnnotationId;
        if (property) property.textContent = String(next);
        return `a${next}`;
    }

    lastUsedProperty() {
        const header = this.elements('HEADER')[0];
        if (!header) return null;
        let property = this.elements('PROPERTY', header).find((p) => p.getAttribute('NAME') === 'lastUsedAnnotationId');
        if (!property) {
            property = this.doc.createElement('PROPERTY');
            property.setAttribute('NAME', 'lastUsedAnnotationId');
            property.textContent = '0';
            this.insertWithIndent(header, property, null);
        }
        return property;
    }

    createRefAnnotation(child, segment) {
        const wrapper = this.doc.createElement('ANNOTATION');
        const ref = this.doc.createElement('REF_ANNOTATION');
        ref.setAttribute('ANNOTATION_ID', this.nextAnnotationId());
        ref.setAttribute('ANNOTATION_REF', segment.id);
        ref.appendChild(this.doc.createElement('ANNOTATION_VALUE'));
        wrapper.appendChild(ref);
        // Keep the child tier in the same order as its parent's annotations.
        const orderOf = new Map(this.elements('ANNOTATION', segment.speaker.tier)
            .map((a, i) => [a.firstElementChild?.getAttribute('ANNOTATION_ID'), i]));
        const before = this.elements('ANNOTATION', child).find((a) =>
            (orderOf.get(a.firstElementChild?.getAttribute('ANNOTATION_REF')) ?? -1) > segment.order);
        this.insertWithIndent(child, wrapper, before || null);
        return ref;
    }

    /** Suffix for a role's tier id, following the file's own convention:
     *  the suffix of an existing tier with that role, else the default in
     *  the file's case style (all-lowercase suffixes -> lowercase). */
    suffixFor(role) {
        const suffixes = [];
        for (const speaker of this.speakers) {
            for (const [r, child] of Object.entries(speaker.children)) {
                const id = child.getAttribute('TIER_ID');
                if (!id.startsWith(`${speaker.id} `)) continue;
                const suffix = id.slice(speaker.id.length + 1);
                if (r === role) return suffix;
                suffixes.push(suffix);
            }
        }
        const fallback = EafDocument.ROLE_DEFAULTS[role].suffix;
        return suffixes.length && suffixes.every((s) => s === s.toLowerCase()) ? fallback.toLowerCase() : fallback;
    }

    /** Linguistic type for a role: the one an existing tier of that role
     *  uses, else an existing type with the default name, else a new
     *  Symbolic_Association type. */
    typeFor(role) {
        for (const speaker of this.speakers) {
            const child = speaker.children[role];
            if (child) return child.getAttribute('LINGUISTIC_TYPE_REF');
        }
        const name = EafDocument.ROLE_DEFAULTS[role].type;
        if (!this.typeById(name)) {
            const type = this.doc.createElement('LINGUISTIC_TYPE');
            type.setAttribute('CONSTRAINTS', 'Symbolic_Association');
            type.setAttribute('GRAPHIC_REFERENCES', 'false');
            type.setAttribute('LINGUISTIC_TYPE_ID', name);
            type.setAttribute('TIME_ALIGNABLE', 'false');
            const types = this.elements('LINGUISTIC_TYPE');
            this.insertWithIndent(this.root, type, types.length ? types[types.length - 1].nextSibling : this.afterTiers());
            this.ensureSymbolicAssociationConstraint();
        }
        return name;
    }

    ensureSymbolicAssociationConstraint() {
        if (this.elements('CONSTRAINT').some((c) => c.getAttribute('STEREOTYPE') === 'Symbolic_Association')) return;
        const constraint = this.doc.createElement('CONSTRAINT');
        constraint.setAttribute('DESCRIPTION', '1-1 association with a parent annotation');
        constraint.setAttribute('STEREOTYPE', 'Symbolic_Association');
        // Schema order: ... LINGUISTIC_TYPE, LOCALE, LANGUAGE, CONSTRAINT, ...
        const anchor = ['CONSTRAINT', 'CONTROLLED_VOCABULARY', 'LEXICON_REF', 'REF_LINK_SET', 'EXTERNAL_REF']
            .map((tag) => this.elements(tag)[0]).find(Boolean) || null;
        this.insertWithIndent(this.root, constraint, anchor);
    }

    afterTiers() {
        const tiers = this.elements('TIER');
        return tiers.length ? tiers[tiers.length - 1].nextSibling : null;
    }

    createChildTier(speaker, role) {
        const tier = this.doc.createElement('TIER');
        const annotator = speaker.tier.getAttribute('ANNOTATOR');
        if (annotator) tier.setAttribute('ANNOTATOR', annotator);
        const lang = EafDocument.ROLE_DEFAULTS[role].lang;
        if (this.elements('LANGUAGE').some((l) => l.getAttribute('LANG_ID') === lang)) tier.setAttribute('LANG_REF', lang);
        tier.setAttribute('LINGUISTIC_TYPE_REF', this.typeFor(role));
        tier.setAttribute('PARENT_REF', speaker.id);
        const participant = speaker.tier.getAttribute('PARTICIPANT');
        if (participant) tier.setAttribute('PARTICIPANT', participant);
        let id = `${speaker.id} ${this.suffixFor(role)}`;
        for (let n = 2; this.tierById(id); n++) id = `${speaker.id} ${this.suffixFor(role)} ${n}`;
        tier.setAttribute('TIER_ID', id);

        // Right after the speaker's own block (its tier and existing children).
        const ids = new Set([speaker.id, ...Object.values(speaker.children).map((c) => c.getAttribute('TIER_ID'))]);
        const block = this.elements('TIER').filter((t) => ids.has(t.getAttribute('TIER_ID')) || ids.has(t.getAttribute('PARENT_REF')));
        this.insertWithIndent(this.root, tier, block[block.length - 1].nextSibling);
        speaker.children[role] = tier;
        return tier;
    }

    /** Inserts `node` before `before` (or appends), copying the indentation
     *  of the surrounding text so the file stays readable. */
    insertWithIndent(parent, node, before) {
        const first = parent.firstElementChild?.previousSibling;
        const indent = first?.nodeType === 3 ? first.nodeValue : '\n';
        if (before && before.parentNode !== parent) before = null;
        // Appending: go before the closing whitespace, not after it.
        if (!before && parent.lastChild?.nodeType === 3) before = parent.lastChild;
        // `before` is the whitespace preceding an element: insert ahead of it.
        if (before?.nodeType !== 3 && before?.previousSibling?.nodeType === 3) before = before.previousSibling;
        parent.insertBefore(this.doc.createTextNode(indent), before);
        parent.insertBefore(node, before);
    }

    // -----------------------------------------------------------------
    // Output
    // -----------------------------------------------------------------

    serialize() {
        this.root.setAttribute('DATE', new Date().toISOString());
        const xml = new XMLSerializer().serializeToString(this.doc);
        // Browsers differ on keeping the declaration; always one, on its own line.
        const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
        return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
    }

    /** A HEADER <PROPERTY NAME="…"> value (ELAN writes "URN"), or ''. */
    property(name) {
        const header = this.elements('HEADER')[0];
        return header ? (this.elements('PROPERTY', header).find((p) => p.getAttribute('NAME') === name)?.textContent || '') : '';
    }

    setProperty(name, value) {
        const header = this.elements('HEADER')[0];
        if (!header) return;
        let property = this.elements('PROPERTY', header).find((p) => p.getAttribute('NAME') === name);
        if (!property) {
            property = this.doc.createElement('PROPERTY');
            property.setAttribute('NAME', name);
            this.insertWithIndent(header, property, null);
        }
        property.textContent = value;
    }

    mediaFileName() {
        return this.mediaReference()?.name || '';
    }

    /** The recording the file refers to: its path relative to the .eaf
     *  (RELATIVE_MEDIA_URL, may be empty) and its file name. */
    mediaReference() {
        const media = this.root.getElementsByTagName('MEDIA_DESCRIPTOR')[0];
        const url = media?.getAttribute('RELATIVE_MEDIA_URL') || media?.getAttribute('MEDIA_URL') || '';
        if (!url) return null;
        return {
            relative: media.getAttribute('RELATIVE_MEDIA_URL') || '',
            name: decodeURIComponent(url.split(/[\\/]/).pop() || ''),
        };
    }
}
