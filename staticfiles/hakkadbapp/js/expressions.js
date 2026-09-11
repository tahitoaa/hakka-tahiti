document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("expressions");
  const output = document.getElementById("output");
  if (!container || !output) return;

  // --- Build dictionary once ---
  const dico = new Dictionary({
    itemSelector: "li",
    containerId: "#pron-list",
  });

  // Platform's own recorded data for each expression (from the latest
  // platform_to_vercel snapshot stored on a Traces row), keyed by the
  // expression's concatenated hanzi -- same key Expression.text collapses to
  // once its spaces are stripped. Each entry is
  // { primary, secondary, target, components }, straight off the platform's
  // JSON, nothing recomputed. {} when no snapshot has been taken yet.
  let PLATFORM_COMPONENTS = {};
  try {
    PLATFORM_COMPONENTS = JSON.parse(document.getElementById("expr-platform-data")?.textContent || "{}") || {};
  } catch (e) {}
  // Distinguishes "no platform snapshot has ever been taken" (nothing to
  // compare against -- not an anomaly) from "this specific expression has
  // no counterpart in an existing snapshot" (it may genuinely be missing on
  // the platform -- worth flagging).
  const hasAnySnapshot = Object.keys(PLATFORM_COMPONENTS).length > 0;

  function platformWordMap(components) {
    // component keys are "<pinyin> <hanzi>" (one word, one space) -> map by
    // hanzi so a local token's resolved character(s) can be looked up directly.
    const map = {};
    Object.keys(components || {}).forEach((key) => {
      const idx = key.lastIndexOf(" ");
      if (idx === -1) return;
      map[key.slice(idx + 1)] = key.slice(0, idx);
    });
    return map;
  }

  // Compares what Sentence.js's matcher resolves for this expression's
  // tokens (today's local dictionary, i.e. how Vercel/the DB decomposes it)
  // against the platform's own recorded decomposition (the raw value from
  // the last platform_to_vercel snapshot -- nothing recomputed). Three kinds
  // of anomaly:
  //  - componentMismatches: a Vercel token's hanzi isn't one of the
  //    platform's words at all (wrong/unexpected segmentation or entry).
  //  - pronunciationMismatches: the hanzi matches but the platform's raw
  //    pinyin isn't among ANY of the readings Vercel/the DB considers valid
  //    for that hanzi today. A hanzi can be genuinely ambiguous (several
  //    dictionary entries sharing the same characters with different
  //    tones/readings) -- findMatches() returns every one of them in the
  //    group, sorted best-guess first; only the single best guess used to
  //    be compared, so a platform pinyin that matched a *valid but
  //    non-first* reading was wrongly flagged. Now the full candidate list
  //    is checked, and (for display) kept alongside the platform's value so
  //    the ambiguity itself is visible, not hidden behind "the" Vercel pinyin.
  //  - extraComponents: a platform word has no matching Vercel token at all
  //    (something the platform decomposition invented, or a leftover from a
  //    stale entry).
  // Single source of truth for both the per-card badges and the comparison
  // table -- both must agree on what counts as an anomaly.
  function computeMismatches(sentence, hanziConcat) {
    const vercelTokens = sentence.matches.map((group) => {
      if (!group || !group.length) return null;
      const first = group[0];
      const hanzi = (first.dataset || first)?.simp || "";
      if (!hanzi) return null;
      // Every candidate reading Vercel/the DB has on file for this hanzi
      // today, not just the best guess -- this is the ambiguity set.
      const pinyinCandidates = uniq(
        group.map((m) => sentence.renderPinyin((m.dataset || m).pinyin || "")).filter(Boolean)
      );
      return { hanzi, pinyin: pinyinCandidates[0] || "", pinyinCandidates };
    }).filter(Boolean);

    const platformEntry = PLATFORM_COMPONENTS[hanziConcat];
    if (!platformEntry) {
      return {
        hasPlatformMatch: false, vercelTokens, platformTokens: [],
        platformPrimary: "", platformSecondary: "", platformTarget: "",
        componentMismatches: [], pronunciationMismatches: [], extraComponents: [],
      };
    }

    // Platform's decomposition is used exactly as stored -- no recomputation.
    const byHanzi = platformWordMap(platformEntry.components);
    const platformTokens = Object.keys(byHanzi).map((hanzi) => ({ hanzi, pinyin: byHanzi[hanzi] }));
    const vercelHanziSet = new Set(vercelTokens.map((t) => t.hanzi));

    const componentMismatches = [];
    const pronunciationMismatches = [];
    vercelTokens.forEach(({ hanzi, pinyin, pinyinCandidates }) => {
      if (!(hanzi in byHanzi)) {
        componentMismatches.push({ hanzi, pinyin });
      } else if (!pinyinCandidates.includes(byHanzi[hanzi])) {
        pronunciationMismatches.push({ hanzi, platformPinyin: byHanzi[hanzi], vercelPinyins: pinyinCandidates });
      }
    });
    const extraComponents = platformTokens.filter((t) => !vercelHanziSet.has(t.hanzi));

    return {
      hasPlatformMatch: true, vercelTokens, platformTokens,
      platformPrimary: platformEntry.primary || "", platformSecondary: platformEntry.secondary || "", platformTarget: platformEntry.target || "",
      componentMismatches, pronunciationMismatches, extraComponents,
    };
  }

  // --- Parse data once (no DOM reads after this) ---
  // Everything a filter/search/sort pass needs is precomputed here, once,
  // so applyFilters() below is a single O(n) pass with no re-parsing,
  // re-lowercasing or DOM reads per item.
  const items = Array.from(container.children).map((div, index) => {
    const sentence = new Sentence(dico, div.dataset.text, div.dataset.french, div.dataset.rendering);

    const category = String(div.dataset.category ?? sentence.category ?? "");
    const status = String(div.dataset.status ?? sentence.status ?? "").trim();
    // Expression.category is comma-separated (an expression can carry several
    // themes) -- matching it against a single selected theme means checking
    // membership in this list, not exact string equality against the raw
    // "theme1, theme2" value (that exact-match was the previous filter's bug:
    // an expression with more than one theme could never match any of them).
    const categories = category.split(",").map((c) => c.trim()).filter(Boolean);
    const text = div.dataset.text ?? "";
    const french = div.dataset.french ?? "";
    const english = div.dataset.english ?? "";
    const rendering = div.dataset.rendering ?? "";
    const hanziConcat = text.replace(/\s+/g, "");

    const {
      hasPlatformMatch, vercelTokens, platformTokens,
      platformPrimary, platformSecondary, platformTarget,
      componentMismatches, pronunciationMismatches, extraComponents,
    } = computeMismatches(sentence, hanziConcat);
    // Only a real anomaly when a snapshot exists but this expression isn't
    // in it -- when there's no snapshot at all, every item would otherwise
    // look "missing" even though nothing has actually been compared.
    const notFoundOnPlatform = hasAnySnapshot && !hasPlatformMatch;
    // Found on the platform, but its `components` dict is entirely empty --
    // a different situation than "some words missing" below: the platform
    // never decomposed this expression into words at all.
    const emptyComponentsOnPlatform = hasPlatformMatch && platformTokens.length === 0;
    // "No components in platform" (as asked) covers both: nothing to look
    // up because the expression itself isn't there, or it's there but empty.
    const noComponentsOnPlatform = notFoundOnPlatform || emptyComponentsOnPlatform;
    // "Missing components" is the partial case: the platform DOES have a
    // decomposition for this expression, just not a complete one.
    const missingComponentsOnPlatform = hasPlatformMatch && platformTokens.length > 0 && componentMismatches.length > 0;

    const pinyinLine = sentence.renderPinyinLine();
    // forceSimp: this feeds the Vercel/platform comparison below, and the
    // platform's own data is always simplified -- letting the sitewide
    // Trad./Simp. toggle leak in here would make a correct match look like
    // a spelling mismatch as soon as someone flips it to traditional.
    const hanziLine = sentence.renderHanziLine(true);
    const hakkaVercel = `${pinyinLine} ${hanziLine}`.trim();
    // Plain literal-string comparison of the whole "pinyin hanzi" field, on
    // top of (not instead of) the word-by-word decomposition checks above --
    // it can catch a difference (e.g. stray formatting, a segmentation the
    // component-level checks don't fully capture) even when no single word
    // pair was individually flagged.
    const hakkaDiffers = hasPlatformMatch && hakkaVercel !== (platformTarget || "").trim();

    const mismatchBadges = [
      notFoundOnPlatform
        ? `<span class="meta-chip mismatch" title="Aucune expression plateforme ne correspond à ce hanzi">&#9888; introuvable sur la plateforme</span>`
        : "",
      emptyComponentsOnPlatform
        ? `<span class="meta-chip mismatch" title="La plateforme n'a aucun composant enregistré pour cette expression">&#9888; aucun composant</span>`
        : "",
      ...componentMismatches.map((m) =>
        `<span class="meta-chip mismatch" title="Absent de la décomposition plateforme">&#9888; manque : ${escapeHtml(m.hanzi)}</span>`),
      ...pronunciationMismatches.map((m) =>
        `<span class="meta-chip mismatch" title="Plateforme (brut) : ${escapeAttr(m.platformPinyin)} &mdash; Vercel/DB (calculé) : ${escapeAttr(m.vercelPinyins.join('/'))}">&#9888; ton ${escapeHtml(m.hanzi)} : ${escapeHtml(m.platformPinyin)} / ${escapeHtml(m.vercelPinyins.join('·'))}</span>`),
      ...extraComponents.map((m) =>
        `<span class="meta-chip mismatch" title="Présent côté plateforme mais absent de la décomposition Vercel">&#9888; en trop : ${escapeHtml(m.hanzi)}</span>`),
      hakkaDiffers
        ? `<span class="meta-chip mismatch" title="Plateforme (brut) : ${escapeAttr(platformTarget)} &mdash; Vercel/DB (calculé) : ${escapeAttr(hakkaVercel)}">&#9888; orthographe hakka différente</span>`
        : "",
    ].join("");
    const hasMismatch = noComponentsOnPlatform || missingComponentsOnPlatform || pronunciationMismatches.length > 0 || extraComponents.length > 0 || hakkaDiffers;

    return {
      index,
      category,
      categories,
      status,
      text,
      french,
      english,
      pinyinLine,
      hanziLine,
      hakkaVercel,
      hakkaDiffers,
      hasPlatformMatch,
      notFoundOnPlatform,
      emptyComponentsOnPlatform,
      noComponentsOnPlatform,
      missingComponentsOnPlatform,
      vercelTokens,
      platformTokens,
      platformPrimary,
      platformSecondary,
      platformTarget,
      componentMismatches,
      pronunciationMismatches,
      extraComponents,
      hasMismatch,
      // sentence.render() bakes the current Trad./Simp. mode into a plain
      // string rather than re-reading the DOM -- kept as a function (not
      // just the initial `.html` value below) so refreshHanziMode() can
      // regenerate it after the sitewide toggle changes.
      buildHtml() {
        return `<li class="expr-card${hasMismatch ? " has-mismatch" : ""}" data-category="${escapeAttr(category)}" data-status="${escapeAttr(status)}">
              <div class="expr-index">phrase ${index}</div>
              ${sentence.render()}
              <div class="expr-meta">
                ${categories.map((c) => `<span class="meta-chip">${escapeHtml(c)}</span>`).join("")}
                ${status ? `<span class="meta-chip">${escapeHtml(status)}</span>` : ""}
                ${mismatchBadges}
              </div>
            </li>`;
      },
      get html() {
        return this._html ?? (this._html = this.buildHtml());
      },
      refreshHtml() {
        this._html = this.buildHtml();
      },
      // Single precomputed lowercase haystack: one indexOf() per item per
      // search instead of several .includes() calls across separate fields.
      search: `${text} ${french} ${rendering} ${category} ${status}`.toLowerCase(),
    };
  });

  // --- UI ---
  const controls = buildControls(items);
  document.getElementById("expr-controls")?.appendChild(controls);
  const overview = document.getElementById("expr-overview");

  // --- State ---
  const state = {
    category: "",
    status: "",
    sort: "INDEX_ASC",
    q: "",
    mismatchOnly: false,
  };

  // --- Render pipeline ---
  let currentRenderToken = 0;

  function applyFilters() {
    let res = items.filter((it) => {
      if (state.category && !it.categories.includes(state.category)) return false;
      if (state.status && it.status !== state.status) return false;
      if (state.mismatchOnly && !it.hasMismatch) return false;
      if (state.q && it.search.indexOf(state.q) === -1) return false;
      return true;
    });
    return sortItems(res, state.sort);
  }

  function renderList(list) {
    const token = ++currentRenderToken;
    output.textContent = "";

    const BATCH = 40;
    let i = 0;

    const step = () => {
      if (token !== currentRenderToken) return;
      const frag = document.createDocumentFragment();
      const end = Math.min(i + BATCH, list.length);
      for (; i < end; i++) {
        frag.appendChild(htmlToElement(list[i].html));
      }
      output.appendChild(frag);
      if (i < list.length) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  }

  // Fixed for the whole session (today's dictionary vs. the last platform
  // snapshot don't change while the page is open) -- computed once instead
  // of on every rerender, and always reflects the whole dataset regardless
  // of the current filters, so the scope of the problem stays visible even
  // while looking at a filtered subset.
  const totalComponentMismatches = items.reduce((n, it) => n + it.componentMismatches.length + it.extraComponents.length, 0);
  const totalPronunciationMismatches = items.reduce((n, it) => n + it.pronunciationMismatches.length, 0);

  function rerender() {
    const list = applyFilters();
    renderList(list);
    updateOverview(overview, list.length, items.length, totalComponentMismatches, totalPronunciationMismatches);
    document.getElementById("expr-empty").hidden = list.length !== 0;
  }

  // --- Wire controls ---
  controls.querySelectorAll("[data-role='category-chip']").forEach((chip) => {
    chip.addEventListener("click", () => {
      controls.querySelectorAll("[data-role='category-chip']").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.category = chip.dataset.value;
      rerender();
    });
  });
  controls.querySelectorAll("[data-role='status-chip']").forEach((chip) => {
    chip.addEventListener("click", () => {
      controls.querySelectorAll("[data-role='status-chip']").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.status = chip.dataset.value;
      rerender();
    });
  });
  controls.querySelector("[data-role='sort']")?.addEventListener("change", (e) => {
    state.sort = e.target.value;
    rerender();
  });
  document.getElementById("expr-search")?.addEventListener("input", debounce((e) => {
    state.q = e.target.value.trim().toLowerCase();
    rerender();
  }, 120));
  document.getElementById("expr-mismatch-filter")?.addEventListener("click", (e) => {
    state.mismatchOnly = !state.mismatchOnly;
    e.target.classList.toggle("active", state.mismatchOnly);
    e.target.dataset.active = String(state.mismatchOnly);
    rerender();
  });

  function setupTheme() {
    // The attribute lives on <html>, not the local #expr-app div, so it also
    // drives Sentence.js's sitewide dark-mode CSS variables (base.html) --
    // one flag for both the page chrome and the shared sentence renderer.
    const btn = document.getElementById("expr-theme-toggle");
    const root = document.documentElement;
    if (!btn) return;
    let stored = null;
    try { stored = localStorage.getItem("hakka-theme"); } catch (e) {}
    if (stored) root.setAttribute("data-theme", stored);
    btn.addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("hakka-theme", next); } catch (e) {}
    });
  }
  setupTheme();
  // The comparison view forces simp regardless of the toggle (see
  // hanziLine above) since it's checked against the platform's always-
  // simplified data, so it never needs to react to this event.
  setupCompareTable(items);

  // The card list's html is baked (via Sentence.render()) with whichever
  // Trad./Simp. mode was active when it was built -- regenerate it when the
  // sitewide toggle changes instead of only on the next filter interaction.
  document.addEventListener("hanzi-mode-change", () => {
    items.forEach((it) => it.refreshHtml());
    rerender();
  });

  // Initial render
  rerender();
});

// Standalone comparative view: one card per expression, laying Vercel's own
// computation (french, english/tahitien, hakka, word-by-word decomposition,
// plus the raw hanzi+disambiguation text used at import) in a left column
// against the platform's own recorded values (same fields where it has a
// counterpart) in a right column -- same shape as the E-reo/Vercel diff
// panel in commands/analytics.html. Any field pair that disagrees is
// outlined in red so a platform-side error can be spotted and then fixed by
// hand on the e-reo platform. Deliberately its own filter state, separate
// from the card list above: it's a distinct diagnostic tool, not another
// view of the same browsing controls.
function setupCompareTable(items) {
  const list = document.getElementById("expr-compare-list");
  const emptyEl = document.getElementById("expr-compare-empty");
  const categorySelect = document.getElementById("expr-compare-category");
  const anomalyToggle = document.getElementById("expr-compare-anomaly-filter");
  const searchInput = document.getElementById("expr-compare-search");
  const countEl = document.getElementById("expr-compare-count");
  if (!list || !categorySelect || !anomalyToggle || !searchInput) return;

  const categories = uniq(items.flatMap((x) => x.categories)).sort((a, b) => a.localeCompare(b));
  categorySelect.innerHTML = `<option value="">Toutes les catégories</option>` +
    categories.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");

  // Anomalies-only by default: the whole point of this view is to surface
  // the expressions that need manual fixing on the platform, not to re-list
  // every expression (the card view above already does that).
  // group: "" shows every group, otherwise only the one whose key matches.
  const state = { category: "", q: "", anomalyOnly: true, group: "" };

  // isAnomaly flags the token in red; ambiguous (only ever true for a
  // Vercel token, via pinyinCandidates) shows every reading the dictionary
  // considers valid for that hanzi today, not just the best guess, so it's
  // visible *why* a platform pinyin might legitimately differ from "the"
  // Vercel pinyin -- it may simply be picking a different valid candidate.
  function renderDecompToken(t, isAnomaly) {
    const ambiguous = Array.isArray(t.pinyinCandidates) && t.pinyinCandidates.length > 1;
    const pyDisplay = ambiguous ? t.pinyinCandidates.map(escapeHtml).join(" / ") : escapeHtml(t.pinyin || "");
    const title = ambiguous ? ` title="Plusieurs lectures possibles pour ce caractère dans le dictionnaire"` : "";
    return `<span class="decomp-token${isAnomaly ? " mismatch" : ""}${ambiguous ? " ambiguous" : ""}"${title}><span class="py">${pyDisplay}</span>${escapeHtml(t.hanzi)}</span>`;
  }

  // A plain "value differs" field pair (fr, english/tahitien, hakka) -- two
  // boxes side by side, red-outlined on both sides when they don't match.
  // extraClass carries the source tint (col-vercel / col-platform).
  function valBox(value, extraClass, isDiff) {
    if (!value) return `<div class="val-box empty ${extraClass}">vide</div>`;
    return `<div class="val-box ${extraClass}${isDiff ? " diff" : ""}">${escapeHtml(value)}</div>`;
  }

  function diffField(label, vercelValue, platformValue, hasPlatform) {
    const isDiff = hasPlatform && vercelValue.trim() !== platformValue.trim();
    const platformCell = hasPlatform
      ? valBox(platformValue, "col-platform", isDiff)
      : `<div class="val-box empty col-platform">n/a</div>`;
    return `<div class="diff-field">
      <div class="field-name">${escapeHtml(label)}</div>
      <div class="field-value">${valBox(vercelValue, "col-vercel", isDiff)}${platformCell}</div>
    </div>`;
  }

  function cardHtml(it) {
    const vercelDecomp = it.vercelTokens.length
      ? it.vercelTokens.map((t) => renderDecompToken(t, it.componentMismatches.some((m) => m.hanzi === t.hanzi))).join("")
      : `<span class="no-match">&mdash;</span>`;

    let platformDecomp;
    if (it.notFoundOnPlatform) {
      platformDecomp = `<span class="no-match mismatch">introuvable</span>`;
    } else if (!it.hasPlatformMatch) {
      platformDecomp = `<span class="no-match">Aucun instantané</span>`;
    } else if (!it.platformTokens.length) {
      platformDecomp = `<span class="no-match mismatch">aucun composant</span>`;
    } else {
      platformDecomp = it.platformTokens.map((t) => renderDecompToken(
        t,
        it.extraComponents.some((m) => m.hanzi === t.hanzi) || it.pronunciationMismatches.some((m) => m.hanzi === t.hanzi)
      )).join("");
    }

    const anomalyBadges = [
      it.notFoundOnPlatform ? `<span class="meta-chip mismatch">introuvable</span>` : "",
      it.emptyComponentsOnPlatform ? `<span class="meta-chip mismatch">aucun composant</span>` : "",
      ...it.componentMismatches.map((m) => `<span class="meta-chip mismatch">manque : ${escapeHtml(m.hanzi)}</span>`),
      ...it.pronunciationMismatches.map((m) =>
        `<span class="meta-chip mismatch">ton ${escapeHtml(m.hanzi)} : ${escapeHtml(m.platformPinyin)} / ${escapeHtml(m.vercelPinyins.join("·"))}</span>`),
      ...it.extraComponents.map((m) => `<span class="meta-chip mismatch">en trop : ${escapeHtml(m.hanzi)}</span>`),
      it.hakkaDiffers ? `<span class="meta-chip mismatch">orthographe hakka différente</span>` : "",
    ].join("");
    const statusBadge = !it.hasPlatformMatch && !it.notFoundOnPlatform
      ? `<span class="no-match">n/a</span>`
      : (anomalyBadges || `<span class="ok-badge">&#10003; OK</span>`);

    return `<div class="compare-card${it.hasMismatch ? " has-mismatch" : ""}">
      <div class="compare-card-head">
        <span class="idx">#${it.index}</span>
        ${it.category ? `<span class="cat">${escapeHtml(it.category)}</span>` : ""}
        ${statusBadge}
      </div>
      <div class="diff-header"><span>Champ</span><div class="cols"><span>Vercel / base</span><span>Plateforme</span></div></div>
      ${diffField("Français", it.french, it.platformPrimary, it.hasPlatformMatch)}
      ${diffField("English / tahitien", it.english, it.platformSecondary, it.hasPlatformMatch)}
      <div class="diff-field">
        <div class="field-name">Hakka</div>
        <div class="field-value">
          <div class="val-box col-vercel hanzi mono${it.hakkaDiffers ? " diff" : ""}">${escapeHtml(it.hakkaVercel) || '<span class="no-match">&mdash;</span>'}</div>
          ${it.hasPlatformMatch
            ? `<div class="val-box col-platform hanzi mono${it.hakkaDiffers ? " diff" : ""}">${escapeHtml(it.platformTarget) || '<span class="no-match">&mdash;</span>'}</div>`
            : `<div class="val-box empty col-platform">n/a</div>`}
        </div>
      </div>
      <div class="diff-field">
        <div class="field-name">Sentence</div>
        <div class="field-value">
          <div class="val-box col-vercel">${vercelDecomp}</div>
          <div class="val-box col-platform">${platformDecomp}</div>
        </div>
      </div>
      <div class="diff-field single">
        <div class="field-name">Format Excel</div>
        <div class="field-value"><div class="val-box col-vercel mono">${escapeHtml(it.text) || '<span class="no-match">&mdash;</span>'}</div></div>
      </div>
    </div>`;
  }

  // Ordered by category, per the brief -- ties broken alphabetically by
  // français so each group stays stable and scannable.
  const byCategoryThenFrench = (a, b) => a.category.localeCompare(b.category) || a.french.localeCompare(b.french);

  // Three named groups, so a given kind of platform-side problem can be
  // worked through end-to-end instead of hunting for it in one long mixed
  // list. Not mutually exclusive -- an expression can need fixing in more
  // than one way and will show up once per group that applies to it.
  // "other" is a catch-all for anomalies that fit none of the three (a
  // stray extra word on the platform, or a tone-only mismatch that doesn't
  // show up in the whole-string hakka comparison), so nothing silently
  // disappears from view; "ok" only appears once "Écarts uniquement" is
  // switched off, as the complete-audit counterpart to the other groups.
  const GROUPS = [
    { key: "no-components", title: "Sans composant sur la plateforme", match: (it) => it.noComponentsOnPlatform },
    { key: "missing-components", title: "Composants manquants sur la plateforme", match: (it) => it.missingComponentsOnPlatform },
    { key: "hakka-diff", title: "Orthographe hakka différente", match: (it) => it.hakkaDiffers },
    {
      key: "other", title: "Autres écarts",
      match: (it) => it.hasMismatch && !it.noComponentsOnPlatform && !it.missingComponentsOnPlatform && !it.hakkaDiffers,
    },
  ];

  // "Tous" plus one chip per group -- picking one narrows the view down to
  // just that group instead of scrolling through all of them.
  const groupChipsEl = document.getElementById("expr-compare-group-chips");
  if (groupChipsEl) {
    groupChipsEl.innerHTML = `<button type="button" class="chip active" data-role="group-chip" data-value="">Tous</button>` +
      GROUPS.map((g) => `<button type="button" class="chip" data-role="group-chip" data-value="${escapeAttr(g.key)}">${escapeHtml(g.title)}</button>`).join("") +
      `<button type="button" class="chip" data-role="group-chip" data-value="ok">Aucun écart</button>`;
    groupChipsEl.querySelectorAll("[data-role='group-chip']").forEach((chip) => {
      chip.addEventListener("click", () => {
        groupChipsEl.querySelectorAll("[data-role='group-chip']").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        state.group = chip.dataset.value;
        // Picking the "Aucun écart" group only makes sense with the
        // anomalies-only toggle off -- flip it automatically instead of
        // showing an empty result the user has to puzzle over.
        if (state.group === "ok" && state.anomalyOnly) {
          state.anomalyOnly = false;
          anomalyToggle.classList.remove("active");
          anomalyToggle.dataset.active = "false";
        }
        apply();
      });
    });
  }

  function apply() {
    let res = items.filter((it) => {
      if (state.category && !it.categories.includes(state.category)) return false;
      if (state.anomalyOnly && !it.hasMismatch) return false;
      if (state.q && it.search.indexOf(state.q) === -1) return false;
      return true;
    });

    let groups = GROUPS.map((g) => ({ ...g, items: res.filter(g.match).sort(byCategoryThenFrench) }));
    if (!state.anomalyOnly) {
      groups.push({ key: "ok", title: "Aucun écart", items: res.filter((it) => !it.hasMismatch).sort(byCategoryThenFrench) });
    }
    if (state.group) {
      groups = groups.filter((g) => g.key === state.group);
    }
    const nonEmpty = groups.filter((g) => g.items.length > 0);

    list.innerHTML = nonEmpty.map((g) => `
      <div class="compare-group">
        <h3 class="compare-group-title">${escapeHtml(g.title)} <span class="count-badge">${g.items.length}</span></h3>
        ${g.items.map(cardHtml).join("")}
      </div>
    `).join("");

    if (emptyEl) emptyEl.hidden = res.length !== 0;
    if (countEl) countEl.textContent = `${res.length} / ${items.length}`;
  }

  categorySelect.addEventListener("change", (e) => { state.category = e.target.value; apply(); });
  anomalyToggle.addEventListener("click", (e) => {
    state.anomalyOnly = !state.anomalyOnly;
    e.target.classList.toggle("active", state.anomalyOnly);
    e.target.dataset.active = String(state.anomalyOnly);
    // The "Aucun écart" group only exists when this toggle is off -- back
    // out to "Tous" instead of leaving that chip active over an empty result.
    if (state.anomalyOnly && state.group === "ok" && groupChipsEl) {
      state.group = "";
      groupChipsEl.querySelectorAll("[data-role='group-chip']").forEach((c) => c.classList.toggle("active", c.dataset.value === ""));
    }
    apply();
  });
  searchInput.addEventListener("input", debounce((e) => { state.q = e.target.value.trim().toLowerCase(); apply(); }, 120));

  apply();
}

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
  const categories = uniq(items.flatMap((x) => x.categories)).sort((a, b) => a.localeCompare(b));
  const statuses = uniq(items.map((x) => x.status).filter(Boolean)).sort((a, b) => a.localeCompare(b));

  const wrap = document.createElement("div");
  wrap.style.display = "contents";

  const categoryChips = `
    <div class="chip-group" data-group="category">
      <button type="button" class="chip active" data-role="category-chip" data-value="">Tous</button>
      ${categories.map((c) => `<button type="button" class="chip" data-role="category-chip" data-value="${escapeAttr(c)}">${escapeHtml(c)}</button>`).join("")}
    </div>`;

  // Only worth a filter dimension when there's actually more than one value
  // to discriminate between -- an empty/constant column is dead UI weight.
  const statusChips = statuses.length > 1 ? `
    <div class="chip-group" data-group="status">
      <button type="button" class="chip active" data-role="status-chip" data-value="">Tous statuts</button>
      ${statuses.map((s) => `<button type="button" class="chip" data-role="status-chip" data-value="${escapeAttr(s)}">${escapeHtml(s)}</button>`).join("")}
    </div>` : "";

  wrap.innerHTML = `
    ${categoryChips}
    ${statusChips}
    <select data-role="sort" class="sort-select">
      <option value="INDEX_ASC">Tri : ordre &uarr;</option>
      <option value="INDEX_DESC">Tri : ordre &darr;</option>
      <option value="CATEGORY_ASC">Tri : thème</option>
      <option value="STATUS_ASC">Tri : statut</option>
    </select>
  `;
  return wrap;
}

function updateOverview(el, shown, total, componentMismatches, pronunciationMismatches) {
  if (!el) return;
  const tiles = [
    { value: total, label: "Expressions au total" },
    { value: shown, label: "Affichées" },
    { value: componentMismatches, label: "Composants en écart" },
    { value: pronunciationMismatches, label: "Prononciations en écart" },
  ];
  el.innerHTML = tiles.map((t) =>
    `<div class="stat-tile"><div class="value">${t.value}</div><div class="label">${t.label}</div></div>`
  ).join("");
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
