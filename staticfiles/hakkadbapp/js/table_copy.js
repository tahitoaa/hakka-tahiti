/* « 📋 Copier la sélection » above every table of the site (data-no-copy to
   opt out). What is copied, as tab-separated text (pastes as cells in a
   spreadsheet), with the header row:
   1. the ticked rows (a checked box in the row), else
   2. the rows (or, within one row, the cells) the mouse selection covers, else
   3. the row of the focused cell (keyboard, table_nav.js), else
   4. every visible row.
   Columns empty for every copied row (tick boxes, buttons) are left out. */
(function () {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    // A cell's text as shown, without its buttons and fields (✎, 📋, 💬, tick boxes);
    // a header as written (not in the capitals of its style).
    function text(cell) {
        if (cell.tagName === 'TH') return (cell.textContent || '').replace(/\s+/g, ' ').trim();
        let t = cell.innerText || '';
        cell.querySelectorAll('button, select, [role=button]:not([data-edit])').forEach((b) => {
            const bt = b.innerText || '';
            if (bt) t = t.replace(bt, ' ');
        });
        return t.replace(/\s+/g, ' ').trim();
    }

    function bodyRows(table) {
        return [...table.rows].filter((r) => visible(r) && !r.closest('thead') && !r.classList.contains('vt-detail')
            && [...r.cells].some((c) => c.tagName === 'TD'));
    }
    function headRow(table) {
        return table.tHead ? [...table.tHead.rows].filter(visible).pop() : null;
    }

    /** [rows, cells or null] chosen by the rules above, and how. */
    function chosen(table) {
        const rows = bodyRows(table);
        const ticked = rows.filter((r) => r.querySelector('input[type=checkbox]:checked'));
        if (ticked.length) return [ticked, null, 'cochée'];
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.rangeCount) {
            const range = sel.getRangeAt(0);
            const hit = rows.filter((r) => range.intersectsNode(r));
            if (hit.length === 1) {
                const cells = [...hit[0].cells].filter((c) => range.intersectsNode(c));
                return [hit, cells, 'sélectionnée'];
            }
            if (hit.length) return [hit, null, 'sélectionnée'];
        }
        const focused = document.activeElement?.closest?.('td, th');
        if (focused && table.contains(focused) && rows.includes(focused.parentElement)) return [[focused.parentElement], null, 'active'];
        return [rows, null, 'tout'];
    }

    function tsv(table) {
        const [rows, cells, how] = chosen(table);
        const head = headRow(table);
        // Column indexes kept: the chosen cells, else those with some text in the copied rows.
        let cols;
        if (cells) cols = cells.map((c) => c.cellIndex);
        else {
            const width = Math.max(0, ...rows.map((r) => r.cells.length));
            cols = [...Array(width).keys()].filter((i) => rows.some((r) => r.cells[i] && text(r.cells[i])));
        }
        const line = (r) => cols.map((i) => (r.cells[i] ? text(r.cells[i]) : '')).join('\t');
        const lines = rows.map(line);
        if (head && (rows.length > 1 || !cells)) lines.unshift(line(head));
        return { value: lines.join('\n'), count: rows.length, how };
    }

    async function write(value) {
        try { await navigator.clipboard.writeText(value); return true; } catch (e) { /* older browsers, http */ }
        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
    }

    function attach() {
        document.querySelectorAll('table:not([data-no-copy])').forEach((table) => {
            if (table.dataset.copyReady || table.closest('[data-no-copy]')) return;
            table.dataset.copyReady = '1';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tc-copy';
            button.textContent = '📋 Copier la sélection';
            button.title = 'Lignes cochées, ou sélectionnées à la souris, sinon tout le tableau (colonnes séparées par des tabulations)';
            // Keep the mouse selection: the button must not take it away.
            button.addEventListener('mousedown', (e) => e.preventDefault());
            button.addEventListener('click', async () => {
                const { value, count, how } = tsv(table);
                if (!count) { button.textContent = 'Rien à copier'; }
                else {
                    const ok = await write(value);
                    const what = how === 'tout' ? `tout le tableau (${count} ligne${count > 1 ? 's' : ''})`
                        : `${count} ligne${count > 1 ? 's' : ''} ${how}${count > 1 ? 's' : ''}`;
                    button.textContent = ok ? `✓ Copié : ${what}` : 'Copie impossible';
                }
                clearTimeout(button._t);
                button._t = setTimeout(() => { button.textContent = '📋 Copier la sélection'; }, 2500);
            });
            const anchor = table.closest('.vt-wrap, .sx-wrap, .overflow-x-auto') || table;
            anchor.parentNode.insertBefore(button, anchor);
        });
    }
    let pending = null;
    new MutationObserver(() => { clearTimeout(pending); pending = setTimeout(attach, 300); })
        .observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', attach);
})();
