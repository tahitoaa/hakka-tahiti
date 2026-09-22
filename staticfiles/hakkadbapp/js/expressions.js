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
  // platform_to_vercel snapshot stored on a Traces row), keyed by
  // Expression.platform_id -- the platform's own id, carried through
  // verbatim on every import (see models.Expression.platform_id). NOT
  // keyed by hanzi text: Expression.text can carry a disambiguation
  // annotation (segment_hanzi_by_pinyin's "-(pinyin)" override, see
  // platform_to_vercel.py) the platform's own raw hanzi never has, so a
  // perfectly round-tripped expression could fail that exact-string match
  // and show up as "introuvable" even though it plainly came from the
  // platform -- keying by the real id is a direct, always-correct join
  // instead. Each entry is { primary, secondary, target, components },
  // straight off the platform's JSON, nothing recomputed. {} when no
  // snapshot has been taken yet.
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
  function computeMismatches(sentence, platformId) {
    const vercelTokens = sentence.matches.map((group) => {
      if (!group || !group.length) return null;
      const first = group[0];
      const hanzi = (first.dataset || first)?.simp || "";
      // Punctuation (", ", "?", "，", "？", "。", "…", "..."...) never
      // resolves to a dictionary word and never appears in the platform's
      // own `components` either -- import_expressions_v2.py already
      // treats it the same way (its own "mot inconnu" check skips exactly
      // this set). Left in, every phrase ending in a comma or an ellipsis
      // showed a spurious "manque : ..." /"manque : ?" badge -- a
      // punctuation mark isn't a missing word, it's not a word at all.
      if (!hanzi || isPunctuationToken(hanzi)) return null;
      // Every candidate reading Vercel/the DB has on file for this hanzi
      // today, not just the best guess -- this is the ambiguity set.
      const pinyinCandidates = uniq(
        group.map((m) => sentence.renderPinyin((m.dataset || m).pinyin || "")).filter(Boolean)
      );
      return { hanzi, pinyin: pinyinCandidates[0] || "", pinyinCandidates };
    }).filter(Boolean);

    const platformEntry = platformId ? PLATFORM_COMPONENTS[platformId] : undefined;
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
  const items = Array.from(container.children).map((div, index) => {
    const text = div.dataset.text ?? "";
    const french = div.dataset.french ?? "";
    const english = div.dataset.english ?? "";
    const rendering = div.dataset.rendering ?? "";
    const platformId = div.dataset.platformId ?? "";
    const excelFormat = div.dataset.excelFormat ?? "";
    const platformSplit = div.dataset.platformSplit ?? "";
    // What actually drives the Vercel/base Hakka + Décomposition below:
    // the Split field once someone has entered one (it's there specifically
    // to disambiguate this expression, so it's always the most trusted
    // reading available) -- otherwise the platform's own hakka string,
    // reconstructed into a decomposable hanzi phrase server-side (see
    // views.expressions()), so a not-yet-annotated expression still
    // compares against a real segmentation instead of Expression.text's
    // raw import phrase (which is what produced most of "les
    // écarts" this comparison exists to catch in the first place).
    // Expression.text is the last-resort fallback, for an expression with
    // no split and no platform match to reconstruct from at all.
    const sourceText = (excelFormat && excelFormat.trim()) ? excelFormat : (platformSplit || text);
    const sentence = new Sentence(dico, sourceText, french, rendering);

    const category = String(div.dataset.category ?? sentence.category ?? "");
    const status = String(div.dataset.status ?? sentence.status ?? "").trim();
    // Expression.category is comma-separated (an expression can carry several
    // themes) -- matching it against a single selected theme means checking
    // membership in this list, not exact string equality against the raw
    // "theme1, theme2" value.
    const categories = category.split(",").map((c) => c.trim()).filter(Boolean);

    const {
      hasPlatformMatch, vercelTokens, platformTokens,
      platformPrimary, platformSecondary, platformTarget,
      componentMismatches, pronunciationMismatches, extraComponents,
    } = computeMismatches(sentence, platformId);
    // No platform_id at all (needs a fresh `platform_to_vercel --yes` run)
    // is a different situation from "has one but it's not in the current
    // snapshot" (genuinely deleted/renamed on the platform, or the
    // snapshot predates this expression) -- surfaced as a distinct badge
    // below rather than lumped into the same "introuvable" message.
    const missingPlatformId = !platformId;
    const notFoundOnPlatform = hasAnySnapshot && !hasPlatformMatch && !missingPlatformId;
    const emptyComponentsOnPlatform = hasPlatformMatch && platformTokens.length === 0;
    const noComponentsOnPlatform = notFoundOnPlatform || emptyComponentsOnPlatform || missingPlatformId;
    const missingComponentsOnPlatform = hasPlatformMatch && platformTokens.length > 0 && componentMismatches.length > 0;

    const pinyinLine = sentence.renderPinyinLine();
    // forceSimp: this feeds the Vercel/platform comparison below, and the
    // platform's own data is always simplified -- letting the sitewide
    // Trad./Simp. toggle leak in here would make a correct match look like
    // a spelling mismatch as soon as someone flips it to traditional.
    const hanziLine = sentence.renderHanziLine(true);
    const hakkaVercel = `${pinyinLine} ${hanziLine}`.trim();
    const hakkaDiffers = hasPlatformMatch && hakkaVercel !== (platformTarget || "").trim();
    // Split further into two distinct anomaly categories (see the legend):
    // if stripping punctuation marks from both sides makes them equal, the
    // only actual disagreement is punctuation -- a formatting nit, not a
    // real spelling/segmentation difference. Otherwise the underlying
    // content itself differs, which is the "-> nettoyage manuel sur la
    // plateforme" case: export_corpus() would create a new platform row
    // next to the old one instead of updating it (see duplicates.html's
    // own split_diff, computed the same way server-side).
    const punctuationMismatch = hakkaDiffers && stripPunctuationMarks(hakkaVercel) === stripPunctuationMarks(platformTarget);
    const spellingMismatch = hakkaDiffers && !punctuationMismatch;

    const hasMismatch = noComponentsOnPlatform || missingComponentsOnPlatform || pronunciationMismatches.length > 0 || extraComponents.length > 0 || hakkaDiffers;

    return {
      index,
      id: div.dataset.id ?? "",
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
      punctuationMismatch,
      spellingMismatch,
      hasPlatformMatch,
      missingPlatformId,
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
      // Persistent per-expression data (see hakkadbapp/expression_mesh.py) --
      // commentaire/excelFormat are mutated in place after a successful save
      // so a later filter/search pass reflects the latest value.
      commentaire: div.dataset.commentaire ?? "",
      excelFormat,
      useInExport: div.dataset.useInExport === "1",
      // Computed server-side (views.expressions/expression_mesh.
      // compute_export_readiness_map) from the Split's actual token
      // resolution -- whether every token disambiguates to exactly one
      // Word and the recomputed hakka has no unresolved ("~") hanzi. Only
      // gates turning the checkbox ON; see the "change" handler below and
      // expression_mesh_entry's own server-side re-check.
      exportOk: div.dataset.exportOk === "1",
      exportBlockReason: div.dataset.exportBlockReason || "",
      entryUrl: div.dataset.entryUrl || "",
      resetUrl: div.dataset.resetUrl || "",
      // Single precomputed lowercase haystack: one indexOf() per item per
      // search instead of several .includes() calls across separate fields.
      search: `${text} ${french} ${rendering} ${category} ${status}`.toLowerCase(),
    };
  });

  // --- Rendering helpers -------------------------------------------------

  // isAnomaly flags the token in red; ambiguous (only ever true for a
  // Vercel token, via pinyinCandidates) shows every reading the dictionary
  // considers valid for that hanzi today, not just the best guess.
  function renderDecompToken(t, isAnomaly) {
    const ambiguous = Array.isArray(t.pinyinCandidates) && t.pinyinCandidates.length > 1;
    const pyDisplay = ambiguous ? t.pinyinCandidates.map(escapeHtml).join(" / ") : escapeHtml(t.pinyin || "");
    const title = ambiguous ? ` title="Plusieurs lectures possibles pour ce caractère dans le dictionnaire"` : "";
    return `<span class="decomp-token${isAnomaly ? " mismatch" : ""}${ambiguous ? " ambiguous" : ""}"${title}><span class="py">${pyDisplay}</span>${escapeHtml(t.hanzi)}</span>`;
  }

  // One colored chip per anomaly *category* (see the legend in the page
  // header) -- `label` may contain raw HTML (an already-escaped hanzi plus
  // an HTML entity like &#9888;), `title` is plain text and gets escaped here.
  function metaChip(kind, label, title) {
    return `<span class="meta-chip cat-${kind}"${title ? ` title="${escapeAttr(title)}"` : ""}>${label}</span>`;
  }

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

  // The live analysis shown under the Split field: Sentence.js's own
  // per-token decomposition chips (renderTokens() -- same one/multi/unknown
  // match badges used everywhere else on the site) so a bad segmentation
  // or an unresolved word is still visible token by token, plus a plain
  // "pinyin hanzi" summary line in the platform's own format
  // (renderPinyinLine/renderHanziLine -- the same pair the Hakka row above
  // builds `hakkaVercel` from) instead of Sentence.render()'s own
  // furigana/ruby + copy-button preview box, since what this needs to be
  // compared against (the Hakka row, the platform's raw target) is already
  // in that plain format. Run directly against whatever text is currently
  // in the textarea (not the saved value), so typing shows the effect
  // immediately, before hitting "Enregistrer". forceSimp=true for the same
  // reason as hakkaVercel: the platform's own data is always simplified.
  function renderSplitAnalysis(splitValue, french) {
    const sentence = new Sentence(dico, splitValue, french, "");
    const line = `${sentence.renderPinyinLine()} ${sentence.renderHanziLine(true)}`.trim();
    return `
      ${sentence.renderTokens()}
      <div class="val-box col-vercel hanzi mono" style="margin-top:6px;">${escapeHtml(line) || '<span class="no-match">&mdash;</span>'}</div>
    `;
  }

  function cardHtml(it) {
    const vercelDecomp = it.vercelTokens.length
      ? it.vercelTokens.map((t) => renderDecompToken(t, it.componentMismatches.some((m) => m.hanzi === t.hanzi))).join("")
      : `<span class="no-match">&mdash;</span>`;

    let platformDecomp;
    if (it.missingPlatformId) {
      platformDecomp = `<span class="no-match mismatch">pas de platform_id</span>`;
    } else if (it.notFoundOnPlatform) {
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

    // Categorized instead of one flat red "mismatch" -- see the legend in
    // the page header. Each category maps to a distinct, high-contrast
    // color so the *kind* of anomaly (and what to do about it) is visible
    // at a glance across a whole list of cards, not just "something's off".
    const anomalyBadges = [
      it.missingPlatformId
        ? metaChip("platform", "&#9888; pas de platform_id", "Relancez platform_to_vercel --yes pour le renseigner")
        : "",
      it.notFoundOnPlatform ? metaChip("platform", "introuvable sur la plateforme") : "",
      it.emptyComponentsOnPlatform ? metaChip("components", "aucun composant plateforme") : "",
      ...it.componentMismatches.map((m) => metaChip("components", `manque : ${escapeHtml(m.hanzi)}`)),
      ...it.extraComponents.map((m) => metaChip("components", `en trop : ${escapeHtml(m.hanzi)}`)),
      ...it.pronunciationMismatches.map((m) =>
        metaChip("pronunciation", `ton ${escapeHtml(m.hanzi)} : ${escapeHtml(m.platformPinyin)} / ${escapeHtml(m.vercelPinyins.join("·"))}`)),
      it.spellingMismatch
        ? metaChip("spelling", "orthographe différente", "Export = doublon sur la plateforme -- suppression manuelle de l'ancienne entrée après import")
        : "",
      it.punctuationMismatch ? metaChip("punctuation", "ponctuation différente") : "",
    ].join("");
    const statusBadge = !it.hasPlatformMatch && !it.notFoundOnPlatform && !it.missingPlatformId
      ? `<span class="no-match">n/a</span>`
      : (anomalyBadges || `<span class="ok-badge">&#10003; OK</span>`);

    const editableSection = it.entryUrl
      ? `<div class="diff-field single">
          <div class="field-name">Commentaire</div>
          <div class="field-value"><textarea class="note-textarea" rows="1" data-role="commentaire">${escapeHtml(it.commentaire)}</textarea></div>
        </div>
        <div class="diff-field single">
          <div class="field-name">Split</div>
          <div class="field-value">
            <textarea class="note-textarea mono" rows="2" data-role="split">${escapeHtml(it.excelFormat)}</textarea>
            <div class="split-actions">
              <button type="button" class="split-save" data-role="split-save">Enregistrer</button>
              <button type="button" class="split-reset" data-role="split-reset">&#8634; État plateforme</button>
              <span class="split-status" data-role="split-status"></span>
            </div>
            <div class="split-analysis" data-role="split-analysis"></div>
          </div>
        </div>`
      : `<div class="diff-field single">
          <div class="field-name">Commentaire</div>
          <div class="field-value"><span class="no-match">Pas de platform_id -- relancez <span class="mono">platform_to_vercel --yes</span></span></div>
        </div>`;

    return `<div class="compare-card${it.hasMismatch ? " has-mismatch" : ""}" data-index="${it.index}">
      <div class="compare-card-head">
        <span class="idx">#${it.index}</span>
        ${it.category ? `<span class="cat">${escapeHtml(it.category)}</span>` : ""}
        ${statusBadge}
        ${it.entryUrl ? `
        <label class="use-export-toggle${it.useInExport ? " is-on" : ""}${(it.useInExport && !it.exportOk) ? " needs-review" : ""}"
          data-role="use-export-label"${it.exportBlockReason ? ` title="${escapeAttr(it.exportBlockReason)}"` : ""}>
          <input type="checkbox" data-role="use-in-export" ${it.useInExport ? "checked" : ""} ${(!it.useInExport && !it.exportOk) ? "disabled" : ""}>
          Utiliser dans l'export${(it.useInExport && !it.exportOk) ? " &#9888;" : ""}
        </label>` : ""}
      </div>
      <div class="diff-header"><span>Champ</span><div class="cols"><span>Vercel / base</span><span>Plateforme</span></div></div>
      ${diffField("Français", it.french, it.platformPrimary, it.hasPlatformMatch)}
      ${diffField("English", it.english, it.platformSecondary, it.hasPlatformMatch)}
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
        <div class="field-name">Décomposition</div>
        <div class="field-value">
          <div class="val-box col-vercel">${vercelDecomp}</div>
          <div class="val-box col-platform">${platformDecomp}</div>
        </div>
      </div>
      ${editableSection}
    </div>`;
  }

  // --- Build every row once; filtering only shows/hides/reorders it -----
  // (never rebuilds HTML -- a per-row Sentence.render() call for the split
  // analysis makes a full rebuild on every keystroke in the search box
  // noticeably slower once there are a few hundred expressions).
  output.innerHTML = items.map(cardHtml).join("");
  const rowByIndex = Array.from(output.children);

  // --- UI ---
  const categorySelect = document.getElementById("expr-category");
  const anomalySelect = document.getElementById("expr-anomaly-filter");
  const searchInput = document.getElementById("expr-search");
  const countEl = document.getElementById("expr-count");
  const emptyEl = document.getElementById("expr-empty");
  const overview = document.getElementById("expr-overview");

  const categories = uniq(items.flatMap((x) => x.categories)).sort((a, b) => a.localeCompare(b));
  if (categorySelect) {
    categorySelect.innerHTML = `<option value="">Toutes les catégories</option>` +
      categories.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
  }
  // ?q=<hanzi> pre-fills the search -- how duplicates.html's "Désambiguïser
  // dans les expressions" link jumps here already filtered to just the
  // expressions that use a given (duplicated) word's hanzi, instead of
  // making someone retype it.
  const initialQuery = new URLSearchParams(window.location.search).get("q") || "";
  const state = { category: "", anomalyType: "", q: initialQuery.trim().toLowerCase() };
  if (searchInput && initialQuery) searchInput.value = initialQuery;

  // Same breakdown the old two-section page used to offer via separate
  // group chips -- folded into the single "écarts" select above instead
  // of a second row of controls, so the filter bar stays to two dropdowns
  // + a search box no matter how many ways there are to slice "anomaly".
  // "any"/"ok" bracket the specific types: any mismatch at all, or none.
  const ANOMALY_TYPES = {
    any: (it) => it.hasMismatch,
    "no-components": (it) => it.noComponentsOnPlatform,
    "missing-components": (it) => it.missingComponentsOnPlatform,
    "pronunciation-diff": (it) => it.pronunciationMismatches.length > 0,
    "spelling-diff": (it) => it.spellingMismatch,
    "punctuation-diff": (it) => it.punctuationMismatch,
    other: (it) => it.hasMismatch && !it.noComponentsOnPlatform && !it.missingComponentsOnPlatform &&
      !it.pronunciationMismatches.length && !it.spellingMismatch && !it.punctuationMismatch,
    ok: (it) => !it.hasMismatch,
  };

  const totalComponentMismatches = items.reduce((n, it) => n + it.componentMismatches.length + it.extraComponents.length, 0);
  const totalPronunciationMismatches = items.reduce((n, it) => n + it.pronunciationMismatches.length, 0);

  function applyFilters() {
    const anomalyMatch = ANOMALY_TYPES[state.anomalyType];
    return items.filter((it) => {
      if (state.category && !it.categories.includes(state.category)) return false;
      if (anomalyMatch && !anomalyMatch(it)) return false;
      if (state.q && it.search.indexOf(state.q) === -1) return false;
      return true;
    });
  }

  function rerender() {
    const list = applyFilters();
    const matched = new Set(list.map((it) => it.index));
    list.forEach((it, pos) => { rowByIndex[it.index].style.order = pos; });
    rowByIndex.forEach((row, i) => { row.style.display = matched.has(i) ? "" : "none"; });
    updateOverview(overview, list.length, items.length, totalComponentMismatches, totalPronunciationMismatches);
    if (countEl) countEl.textContent = `${list.length} / ${items.length}`;
    if (emptyEl) emptyEl.hidden = list.length !== 0;
  }

  categorySelect?.addEventListener("change", (e) => { state.category = e.target.value; rerender(); });
  anomalySelect?.addEventListener("change", (e) => { state.anomalyType = e.target.value; rerender(); });
  searchInput?.addEventListener("input", debounce((e) => {
    state.q = e.target.value.trim().toLowerCase();
    rerender();
  }, 120));

  // --- Per-row editing (event delegation -- rows are built once, above) -

  function getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function jsonOrThrow(response) {
    return response.json().then((data) => {
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    });
  }

  function rowFor(el) {
    const card = el.closest(".compare-card");
    if (!card) return null;
    return items[Number(card.dataset.index)];
  }

  function setSplitStatus(card, text, isError) {
    const el = card.querySelector('[data-role="split-status"]');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("split-status--error", !!isError);
  }

  // The analysis is deliberately NOT rendered for all rows up front -- an
  // extra Sentence construction + dictionary match per expression, on top
  // of the one `items` above already builds for every row, was enough to
  // make the page hang with a few hundred expressions. Rendering it
  // lazily -- once on first focus, then live on every keystroke -- keeps
  // the initial render to exactly the rows someone actually opens.
  output.addEventListener("focusin", (e) => {
    const textarea = e.target.closest('[data-role="split"]');
    if (!textarea || textarea.dataset.analysisRendered) return;
    textarea.dataset.analysisRendered = "1";
    const it = rowFor(textarea);
    if (!it) return;
    const card = textarea.closest(".compare-card");
    const analysisEl = card.querySelector('[data-role="split-analysis"]');
    if (analysisEl) analysisEl.innerHTML = renderSplitAnalysis(textarea.value, it.french);
  });

  // Live split analysis on every keystroke -- pure client-side, no request.
  output.addEventListener("input", (e) => {
    const textarea = e.target.closest('[data-role="split"]');
    if (!textarea) return;
    const it = rowFor(textarea);
    if (!it) return;
    const card = textarea.closest(".compare-card");
    const analysisEl = card.querySelector('[data-role="split-analysis"]');
    if (analysisEl) analysisEl.innerHTML = renderSplitAnalysis(textarea.value, it.french);
  });

  // Commentaire auto-saves on blur (focusout bubbles, unlike blur) -- one
  // field, no need for an explicit save button.
  output.addEventListener("focusout", (e) => {
    const textarea = e.target.closest('[data-role="commentaire"]');
    if (!textarea) return;
    const it = rowFor(textarea);
    if (!it || !it.entryUrl || textarea.value === it.commentaire) return;
    fetch(it.entryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
      body: JSON.stringify({ commentaire: textarea.value }),
    })
      .then(jsonOrThrow)
      .then((data) => { it.commentaire = data.commentaire; })
      .catch((err) => console.warn("[expressions] échec sauvegarde commentaire:", err.message));
  });

  output.addEventListener("click", (e) => {
    const saveBtn = e.target.closest('[data-role="split-save"]');
    const resetBtn = e.target.closest('[data-role="split-reset"]');
    if (!saveBtn && !resetBtn) return;

    const card = e.target.closest(".compare-card");
    const it = rowFor(e.target);
    if (!it || !it.entryUrl) return;
    const textarea = card.querySelector('[data-role="split"]');
    const analysisEl = card.querySelector('[data-role="split-analysis"]');

    if (saveBtn) {
      setSplitStatus(card, "Enregistrement…", false);
      fetch(it.entryUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ excel_format: textarea.value }),
      })
        .then(jsonOrThrow)
        .then((data) => {
          it.excelFormat = data.excel_format;
          setSplitStatus(card, "Enregistré.", false);
        })
        .catch((err) => setSplitStatus(card, `Échec : ${err.message}`, true));
      return;
    }

    if (resetBtn) {
      if (!it.resetUrl) return;
      setSplitStatus(card, "Réinitialisation…", false);
      fetch(it.resetUrl, { method: "POST", headers: { "X-CSRFToken": getCsrfToken() } })
        .then(jsonOrThrow)
        .then((data) => {
          it.excelFormat = data.excel_format;
          textarea.value = data.excel_format;
          if (analysisEl) analysisEl.innerHTML = renderSplitAnalysis(data.excel_format, it.french);
          setSplitStatus(card, "Revenu à l'état plateforme.", false);
        })
        .catch((err) => setSplitStatus(card, `Échec : ${err.message}`, true));
    }
  });

  output.addEventListener("change", (e) => {
    const checkbox = e.target.closest('[data-role="use-in-export"]');
    if (!checkbox) return;
    const it = rowFor(checkbox);
    if (!it || !it.entryUrl) return;
    const label = checkbox.closest('[data-role="use-export-label"]');
    // The checkbox is `disabled` while off and not exportOk, so this only
    // matters for the "needs-review" case: already on despite no longer
    // meeting the conditions (Split edited since), unchecked then re-checked
    // by hand. Caught client-side to skip the round trip, and again
    // server-side in expression_mesh_entry regardless (never trust the UI
    // state alone for what ends up in expressionCorpus.json).
    if (checkbox.checked && !it.exportOk) {
      checkbox.checked = false;
      console.warn("[expressions] export bloqué :", it.exportBlockReason);
      return;
    }
    fetch(it.entryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
      body: JSON.stringify({ use_in_export: checkbox.checked }),
    })
      .then(jsonOrThrow)
      .then((data) => {
        it.useInExport = data.use_in_export;
        label?.classList.toggle("is-on", data.use_in_export);
      })
      .catch((err) => {
        checkbox.checked = !checkbox.checked; // revert on failure
        console.warn("[expressions] échec sauvegarde use_in_export:", err.message);
      });
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

  // Initial render
  rerender();
});

/* ---------------- helpers ---------------- */

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

// A token/segment made up entirely of punctuation/space -- never a real
// word, so it's excluded from the Vercel/platform decomposition
// comparison rather than flagged as a "missing" component. Covers Latin
// and CJK punctuation plus ellipses (single-char "…" and multi-dot "...").
const PUNCTUATION_ONLY_RE = /^[，。？！、,.!?…\s]+$/;
function isPunctuationToken(hanzi) {
  return PUNCTUATION_ONLY_RE.test(hanzi);
}

// Same character class as PUNCTUATION_ONLY_RE, minus \s -- used to tell a
// pure punctuation mismatch (e.g. a missing "。") apart from a real
// spelling/segmentation difference between the Vercel/base and platform
// hakka strings (see punctuationMismatch/spellingMismatch above). Deliberately
// leaves whitespace alone: pinyin syllables are always single-space-joined
// on both sides, so a real spacing difference would mean a real word-
// boundary difference, not a formatting nit.
const PUNCT_MARKS_RE = /[，。？！、,.!?…]/g;
function stripPunctuationMarks(s) {
  return (s || "").replace(PUNCT_MARKS_RE, "").trim();
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
