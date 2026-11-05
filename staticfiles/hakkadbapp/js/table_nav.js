/* Keyboard moves between the cells of every table of the site:
   - ← ↑ → ↓ : the next cell in that direction (in a text field, ← → move the
     caret first and leave the field only at its start / end);
   - Tab / Maj+Tab : the next / previous focusable thing of the cell, then the
     next / previous cell (row after row); at the table's end, out of it.
   A cell is reached through what it holds (a link, a button, a field, a
   « ✎ » editable value), else the cell itself. A table can opt out with
   data-no-nav. Tables re-drawn after an edit (Suivi): the focus goes back
   to the same row and column. */
(function () {
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const cellOf = (el) => el?.closest?.('td, th');
    const tableOf = (cell) => cell?.closest('table');
    const active = (table) => table && !table.hasAttribute('data-no-nav') && !table.closest('[data-no-nav]');

    const rowsOf = (table) => [...table.rows].filter(visible);
    const cellsOf = (row) => [...row.cells].filter(visible);
    const focusables = (cell) => [...cell.querySelectorAll(FOCUSABLE)].filter((el) => visible(el) && cellOf(el) === cell);

    function position(cell) {
        const table = tableOf(cell);
        const rows = rowsOf(table);
        const r = rows.indexOf(cell.parentElement);
        return { table, rows, r, c: cellsOf(cell.parentElement).indexOf(cell) };
    }

    /** Focus inside `cell`: its first (or last) focusable, else the cell. */
    function enter(cell, last = false) {
        const inside = focusables(cell);
        const target = inside.length ? inside[last ? inside.length - 1 : 0] : cell;
        if (target === cell && !cell.hasAttribute('tabindex')) cell.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: false });
        if (target.matches?.('input[type=text], input[type=search], input:not([type])')) target.select?.();
        return target;
    }

    /** After a move from an open field the table may be re-drawn (the field
     *  saved): find the same row (data-id, else index), column and place in
     *  the cell (k-th focusable) again. */
    function keep(table, r, c, rowId, k = 0) {
        const again = () => {
            if (document.activeElement && document.activeElement !== document.body && document.activeElement.isConnected) return;
            if (!table.isConnected) return;
            const rows = rowsOf(table);
            const row = (rowId && rows.find((x) => x.dataset.id === rowId)) || rows[r];
            const cells = row ? cellsOf(row) : [];
            const cell = cells[Math.min(c, cells.length - 1)];
            if (!cell) return;
            const inside = focusables(cell);
            if (inside.length) inside[Math.min(k, inside.length - 1)].focus();
            else enter(cell);
        };
        [0, 120, 450, 1500].forEach((ms) => setTimeout(again, ms));
    }

    function move(cell, dr, dc, last = false) {
        const { table, rows, r, c } = position(cell);
        let rr = r + dr;
        let cc = c + dc;
        if (dc && !dr) {   // Tab-like: wrap to the next / previous row
            const n = cellsOf(rows[r]).length;
            if (cc >= n) { rr = r + 1; cc = 0; }
            if (cc < 0) { rr = r - 1; cc = rr >= 0 ? cellsOf(rows[rr]).length - 1 : 0; }
        }
        const row = rows[rr];
        if (!row) return false;
        const cells = cellsOf(row);
        const target = cells[Math.min(Math.max(cc, 0), cells.length - 1)];
        if (!target) return false;
        enter(target, last);
        keep(table, rr, Math.min(Math.max(cc, 0), cells.length - 1), row.dataset.id);
        return true;
    }

    const isText = (el) => el.matches?.('textarea, input[type=text], input[type=search], input[type=number], input:not([type])');

    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        const el = e.target;
        const cell = cellOf(el);
        if (!cell || !active(tableOf(cell))) return;
        if (el.isContentEditable) return;
        const key = e.key;

        if (key === 'Tab') {
            const inside = focusables(cell);
            const k = inside.indexOf(el);
            const next = e.shiftKey ? inside[k === -1 ? -1 : k - 1] : inside[k + 1];
            if (k !== -1 && next) {
                e.preventDefault();
                const { table, r, c } = position(cell);
                const at = inside.indexOf(next);
                next.focus();
                keep(table, r, c, cell.parentElement.dataset.id, at);
                return;
            }
            if (move(cell, 0, e.shiftKey ? -1 : 1, e.shiftKey)) e.preventDefault();
            return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
        if (el.matches?.('select')) return;                       // its own arrows
        if (el.matches?.('textarea') && (key === 'ArrowUp' || key === 'ArrowDown')) return;
        if (isText(el)) {
            // Left / right move the caret; leave the field only at its edge.
            const start = el.selectionStart ?? 0;
            const end = el.selectionEnd ?? 0;
            const len = (el.value || '').length;
            if (key === 'ArrowLeft' && !(start === 0 && end === 0)) return;
            if (key === 'ArrowRight' && !(start === len && end === len)) return;
        }
        const moved = key === 'ArrowUp' ? move(cell, -1, 0) : key === 'ArrowDown' ? move(cell, 1, 0)
            : move(cell, 0, key === 'ArrowLeft' ? -1 : 1);
        if (moved) e.preventDefault();
    });

    // A click on a plain cell makes it the starting point of the keys.
    document.addEventListener('click', (e) => {
        const cell = cellOf(e.target);
        if (!cell || !active(tableOf(cell)) || e.target.closest(FOCUSABLE)) return;
        if (!cell.hasAttribute('tabindex')) cell.setAttribute('tabindex', '-1');
        cell.focus({ preventScroll: true });
    });

    // Tab reaches a table with nothing focusable: its first body cell can be focused.
    function entries() {
        document.querySelectorAll('table:not([data-no-nav])').forEach((table) => {
            if (table.querySelector('[data-nav-entry]') || table.querySelector(FOCUSABLE)) return;
            const first = table.tBodies[0]?.rows[0]?.cells[0] || table.rows[0]?.cells[0];
            if (first) { first.setAttribute('tabindex', '0'); first.setAttribute('data-nav-entry', ''); }
        });
    }
    let pending = null;
    new MutationObserver(() => { clearTimeout(pending); pending = setTimeout(entries, 300); })
        .observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', entries);
})();
