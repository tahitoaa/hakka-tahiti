document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("expressions");
  const output = document.getElementById("output");
  if (!container || !output) return;

  // --- Build dictionary once ---
  const dico = new Dictionary({
    itemSelector: "li",
    containerId: "#pron-list",
  });

  // --- Parse data once (no DOM reads after this) ---
  const items = Array.from(container.children).map((div, index) => {
    const sentence = new Sentence(dico, div.dataset.text, div.dataset.french, div.dataset.rendering);

    // If category/status are not in dataset, you can read from sentence if available.
    const category = div.dataset.category ?? sentence.category ?? "";
    const status = div.dataset.status ?? sentence.status ?? "";

    return {
      index,
      category: String(category),
      status: String(status),
      // precompute html once to avoid rerender cost when filtering/sorting
      html: `<li class="border bg-white p-2" data-category="${escapeAttr(category)}" data-status="${escapeAttr(status)}">
              <div class="text-xs opacity-70">phrase ${index}</div>
              ${sentence.render()}
              <div class="mt-1 text-xs">
                <span class="inline-block mr-2 px-2 py-0.5 rounded bg-gray-100">cat: ${escapeHtml(category)}</span>
                <span class="inline-block px-2 py-0.5 rounded bg-gray-100">status: ${escapeHtml(status)}</span>
              </div>
            </li>`,
      // for sorting/searching
      text: (div.dataset.text ?? "").toLowerCase(),
      french: (div.dataset.french ?? "").toLowerCase(),
    };
  });

  // Optional: remove original children from DOM to reduce weight
  // (Keep container only for data source; output is the actual list)
  // container.innerHTML = ""; // uncomment if safe

  // --- UI (minimal; you can move this to your HTML) ---
  const controls = buildControls(items);
  output.parentElement?.insertBefore(controls, output);

  // --- State ---
  const state = {
    category: "ALL",
    status: "ALL",
    sort: "INDEX_ASC",
    q: "",
  };

  // --- Render pipeline ---
  let currentRenderToken = 0;

  function applyFilters() {
    const q = state.q.trim().toLowerCase();

    let res = items.filter((it) => {
      if (state.category !== "ALL" && it.category !== state.category) return false;
      if (state.status !== "ALL" && it.status !== state.status) return false;
      if (q) {
        // basic search across text + french
        if (!it.text.includes(q) && !it.french.includes(q)) return false;
      }
      return true;
    });

    res = sortItems(res, state.sort);
    return res;
  }

  function renderList(list) {
    // Cancel any previous incremental render
    const token = ++currentRenderToken;

    // Clear fast
    output.textContent = "";

    // Incremental batch render for smooth scroll
    const BATCH = 40;
    let i = 0;

    const step = () => {
      if (token !== currentRenderToken) return; // canceled
      const frag = document.createDocumentFragment();

      const end = Math.min(i + BATCH, list.length);
      for (; i < end; i++) {
        const li = htmlToElement(list[i].html);
        frag.appendChild(li);
      }
      output.appendChild(frag);

      if (i < list.length) {
        // Yield to browser (keeps UI responsive)
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  }

  function rerender() {
    const list = applyFilters();
    renderList(list);
    updateCount(controls, list.length, items.length);
  }

  // --- Wire controls ---
  controls.querySelector("[data-role='category']")?.addEventListener("change", (e) => {
    state.category = e.target.value;
    rerender();
  });
  controls.querySelector("[data-role='status']")?.addEventListener("change", (e) => {
    state.status = e.target.value;
    rerender();
  });
  controls.querySelector("[data-role='sort']")?.addEventListener("change", (e) => {
    state.sort = e.target.value;
    rerender();
  });
  controls.querySelector("[data-role='q']")?.addEventListener("input", debounce((e) => {
    state.q = e.target.value;
    rerender();
  }, 120));

  // Initial render
  rerender();
});

/* ---------------- helpers ---------------- */

function sortItems(arr, mode) {
  const copy = arr.slice();
  switch (mode) {
    case "INDEX_DESC":
      copy.sort((a, b) => b.index - a.index);
      break;
    case "CATEGORY_ASC":
      copy.sort((a, b) => a.category.localeCompare(b.category) || a.index - b.index);
      break;
    case "STATUS_ASC":
      copy.sort((a, b) => a.status.localeCompare(b.status) || a.index - b.index);
      break;
    default:
      copy.sort((a, b) => a.index - b.index);
  }
  return copy;
}

function buildControls(items) {
  const categories = ["ALL", ...uniq(items.map((x) => x.category).filter(Boolean)).sort()];
  const statuses = ["ALL", ...uniq(items.map((x) => x.status).filter(Boolean)).sort()];

  const wrap = document.createElement("div");
  wrap.className = "sticky top-0 z-10 bg-white border p-2 flex flex-wrap gap-2 items-center";

  wrap.innerHTML = `
    <input data-role="q" class="border rounded px-2 py-1 text-sm" placeholder="search..." />
    <select data-role="category" class="border rounded px-2 py-1 text-sm">
      ${categories.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("")}
    </select>
    <select data-role="status" class="border rounded px-2 py-1 text-sm">
      ${statuses.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("")}
    </select>
    <select data-role="sort" class="border rounded px-2 py-1 text-sm">
      <option value="INDEX_ASC">Sort: index ↑</option>
      <option value="INDEX_DESC">Sort: index ↓</option>
      <option value="CATEGORY_ASC">Sort: category</option>
      <option value="STATUS_ASC">Sort: status</option>
    </select>
    <span data-role="count" class="text-xs opacity-70 ml-auto"></span>
  `;
  return wrap;
}

function updateCount(controls, shown, total) {
  const el = controls.querySelector("[data-role='count']");
  if (el) el.textContent = `${shown} / ${total}`;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function htmlToElement(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Minimal escaping to avoid breaking attributes / HTML
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) {
  return escapeHtml(s).replaceAll("`", "&#096;");
}
