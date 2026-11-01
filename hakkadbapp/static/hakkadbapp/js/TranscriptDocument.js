/* =========================================================================
   TranscriptDocument — a transcription as read by the working group: the
   segments in order, each with its speaker, time, hanzi, pinyin and
   French. One rendering for the listening page (transcription_listen.html)
   and for the PDF export of "Transcrire" (a printable page).

   Data (as published, see transcripts.clean_data):
     { title, fileName?, audioName?, updatedAt?,
       participants: [{ name, tier }],
       segments: [{ start, end, speaker, hanzi, pinyin, translation, transcript }] }
   ========================================================================= */

const TranscriptDocument = {
    COLORS: ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2'],

    color(index) {
        return this.COLORS[index % this.COLORS.length];
    },

    escape(text) {
        return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    time(ms) {
        const s = Math.max(0, ms) / 1000;
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = String(Math.floor(s % 60)).padStart(2, '0');
        return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
    },

    /** Hanzi of a segment: its Hanzi tier, else the transcript's characters
     *  ('' while it is still romanization only). */
    hanzi(segment) {
        if (segment.hanzi) return segment.hanzi;
        const plain = String(segment.transcript || '').replace(/\([^()]*\)/g, '');
        return /\p{Script=Han}/u.test(plain) ? plain.replace(/[\p{Script=Latin}\d_'’]+/gu, '').trim() : '';
    },

    duration(t) {
        return t.segments.reduce((m, s) => Math.max(m, s.end), 0);
    },

    renderHeader(t, { exportedAt = null } = {}) {
        const done = t.segments.filter((s) => this.hanzi(s)).length;
        const people = t.participants.map((p, i) =>
            `<span class="tr-person" style="--c:${this.color(i)}"><span class="tr-dot"></span>${this.escape(p.name)}</span>`).join('');
        const facts = [
            `${t.segments.length} segments (${done} en hanzi)`,
            `durée ${this.time(this.duration(t))}`,
            t.audioName ? `audio : ${this.escape(t.audioName)}` : '',
            t.updatedAt ? `mis à jour le ${this.escape(new Date(t.updatedAt).toLocaleString('fr-FR'))}` : '',
            exportedAt ? `exporté le ${this.escape(exportedAt.toLocaleString('fr-FR'))}` : '',
        ].filter(Boolean).join(' · ');
        return `<header class="tr-header">
            <h1 class="tr-title">${this.escape(t.title)}</h1>
            <div class="tr-people">${people}</div>
            <div class="tr-facts">${facts}</div>
          </header>`;
    },

    /** The segments, one <article> each (data-i = index in t.segments). */
    renderSegments(t) {
        return `<ol class="tr-list">${t.segments.map((s, i) => {
            const person = t.participants[s.speaker] || { name: '?' };
            const hanzi = this.hanzi(s);
            const lines = [
                hanzi ? `<div class="tr-hanzi" lang="zh">${this.escape(hanzi)}</div>`
                    : `<div class="tr-raw">${this.escape(s.transcript || '—')}</div>`,
                hanzi && s.pinyin ? `<div class="tr-pinyin">${this.escape(s.pinyin)}</div>` : '',
                s.translation ? `<div class="tr-fr" lang="fr">${this.escape(s.translation)}</div>` : '',
            ].join('');
            return `<li class="tr-seg" data-i="${i}" style="--c:${this.color(s.speaker)}">
                <div class="tr-meta"><span class="tr-who">${this.escape(person.name)}</span>
                  <span class="tr-when">${this.time(s.start)}</span></div>
                <div class="tr-text">${lines}</div></li>`;
        }).join('')}</ol>`;
    },

    CSS: `
      .tr-header { margin-bottom: 1rem; }
      .tr-title { font-size: 1.4rem; font-weight: 700; line-height: 1.2; margin: 0 0 0.4rem; }
      .tr-people { display: flex; flex-wrap: wrap; gap: 0.3rem 0.9rem; font-size: 0.9rem; font-weight: 600; }
      .tr-person { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--c); }
      .tr-dot { width: 0.6rem; height: 0.6rem; border-radius: 9999px; background: var(--c); }
      .tr-facts { margin-top: 0.3rem; font-size: 0.78rem; color: #8C8478; }
      .tr-list { list-style: none; margin: 0; padding: 0; }
      .tr-seg { display: grid; grid-template-columns: 6.5rem minmax(0, 1fr); gap: 0 0.75rem; padding: 0.55rem 0.6rem;
                border-left: 4px solid var(--c); border-bottom: 1px solid #F6EFE4; break-inside: avoid; page-break-inside: avoid; }
      .tr-meta { font-size: 0.75rem; color: #8C8478; padding-top: 0.2rem; }
      .tr-who { display: block; font-weight: 600; color: var(--c); overflow-wrap: anywhere; }
      .tr-when { font-variant-numeric: tabular-nums; }
      .tr-hanzi { font-size: 1.3rem; line-height: 1.45; overflow-wrap: anywhere; }
      .tr-raw { font-size: 0.95rem; color: #B5AA9B; font-style: italic; overflow-wrap: anywhere; }
      .tr-pinyin { font-size: 0.9rem; color: #544D45; overflow-wrap: anywhere; }
      .tr-fr { font-size: 0.95rem; color: #261F1C; margin-top: 0.15rem; overflow-wrap: anywhere; }
      @media (max-width: 520px) {
        .tr-seg { grid-template-columns: minmax(0, 1fr); }
        .tr-meta { display: flex; gap: 0.5rem; padding: 0 0 0.15rem; }
        .tr-who { display: inline; }
      }
      @media print {
        .tr-seg, .tr-person, .tr-dot { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .tr-seg { grid-template-columns: 6.5rem minmax(0, 1fr); padding: 0.35rem 0.5rem; }
        .tr-meta { display: block; }
        .tr-who { display: block; }
        .tr-hanzi { font-size: 13pt; }
        .tr-pinyin, .tr-fr { font-size: 10pt; }
      }`,

    /** A standalone printable page (the PDF export): opened in a new tab,
     *  the print dialog offers "Enregistrer au format PDF". */
    print(t) {
        const win = window.open('', '_blank');
        if (!win) return false;
        win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>${this.escape(t.title)}</title>
            <style>
              @page { size: A4; margin: 14mm 12mm; }
              body { font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
                     color: #261F1C; background: #fff; margin: 0 auto; padding: 16px; max-width: 52rem; }
              @media print { body { padding: 0; max-width: none; } }
              ${this.CSS}
            </style></head><body>
            ${this.renderHeader(t, { exportedAt: new Date() })}
            ${this.renderSegments(t)}
            </body></html>`);
        win.document.close();
        // Let the fonts settle before the print dialog (once).
        let printed = false;
        const printOnce = () => { if (!printed) { printed = true; win.focus(); win.print(); } };
        (win.document.fonts?.ready || Promise.resolve()).then(() => setTimeout(printOnce, 200));
        setTimeout(printOnce, 2000);
        return true;
    },
};
