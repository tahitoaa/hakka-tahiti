// Expression mesh: a per-expression {excel_format, commentaire} row
// (models.ExpressionNote, see hakkadbapp/expression_mesh.py). The
// excel_format text itself carries any disambiguation needed (a
// ":gloss" hint after a token, same syntax import_expressions.py already
// understands) -- there's no separate word-picker UI, just the text and a
// live preview of what it resolves to. Two independent pieces wired by
// event delegation so this file can be included once and dropped onto
// duplicates.html / expressions.html / the hanzi rosace without each page
// having to call an init function:
//
//   1. A page-level toolbar (ExportCorpus, plus an optional CSV
//      download/upload/sync for bulk review), marked up anywhere via
//      .expr-mesh-toolbar (see components/expression_mesh_toolbar.html).
//   2. Per-expression "Editer le maillage" buttons, marked up via
//      [data-mesh-toggle="<expression db id>"] with a matching
//      [data-mesh-panel="<id>"] container right after it to render into.

(function () {
  "use strict";

  function jsonOrThrow(response) {
    return response.json().then((data) => {
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return data;
    });
  }

  function setStatus(el, text, isError) {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("expr-mesh-status--error", !!isError);
  }

  function getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  // ---- toolbar --------------------------------------------------------

  function wireToolbar(toolbar) {
    if (toolbar.dataset.wired) return;
    toolbar.dataset.wired = "1";

    const status = toolbar.querySelector(".expr-mesh-status");
    const downloadBtn = toolbar.querySelector('[data-action="download-mesh"]');
    const uploadInput = toolbar.querySelector('[data-action="upload-mesh"]');
    const syncBtn = toolbar.querySelector('[data-action="sync-mesh"]');
    const exportBtn = toolbar.querySelector('[data-action="export-corpus"]');

    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => {
        window.location.href = downloadBtn.dataset.url;
      });
    }

    if (uploadInput) {
      uploadInput.addEventListener("change", () => {
        const file = uploadInput.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append("file", file);
        setStatus(status, "Envoi en cours…", false);
        fetch(uploadInput.dataset.url, {
          method: "POST",
          headers: { "X-CSRFToken": getCsrfToken() },
          body: formData,
        })
          .then(jsonOrThrow)
          .then((data) => {
            setStatus(status, `Table importée (${data.count} expressions).`, false);
          })
          .catch((err) => setStatus(status, `Échec de l'import : ${err.message}`, true))
          .finally(() => { uploadInput.value = ""; });
      });
    }

    if (syncBtn) {
      syncBtn.addEventListener("click", () => {
        setStatus(status, "Vérification en cours…", false);
        fetch(syncBtn.dataset.url, {
          method: "POST",
          headers: { "X-CSRFToken": getCsrfToken() },
        })
          .then(jsonOrThrow)
          .then((data) => {
            setStatus(status, `${data.added} expression(s) ajoutée(s) (${data.total} au total).`, false);
          })
          .catch((err) => setStatus(status, `Échec : ${err.message}`, true));
      });
    }

    // Fetches one export endpoint and saves its zip, resolving with the
    // counts/warnings it reported via response headers -- shared by both
    // downloads below so a header goes missing/renamed in only one place.
    function fetchAndSaveZip(url, filename) {
      return fetch(url).then((response) => {
        if (!response.ok) {
          // Error responses are still JSON ({error: ...}), unlike the zip
          // a successful export returns.
          return response.json().then((data) => {
            throw new Error(data.error || `HTTP ${response.status}`);
          });
        }
        const headers = response.headers;
        return response.blob().then((blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          return {
            nWords: headers.get("X-Export-Word-Count"),
            nExpr: headers.get("X-Export-Expression-Count"),
            nThemes: headers.get("X-Export-Theme-Count"),
            nAudio: headers.get("X-Export-Audio-Count"),
            nWarnings: parseInt(headers.get("X-Export-Warning-Count") || "0", 10),
          };
        });
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        setStatus(status, "Export en cours…", false);
        // Two separate files, requested and saved one after the other from
        // this single click: corpus.zip (word/expression/theme corpora +
        // any matching local audio) and expressions_export.zip (the
        // français/anglais/hanzi/audio review spreadsheet). Two requests
        // rather than one archive nested inside another, so each can be
        // opened directly without an extra unzip step.
        fetchAndSaveZip(exportBtn.dataset.url, "corpus_export.zip")
          .then((corpusStats) =>
            fetchAndSaveZip(exportBtn.dataset.spreadsheetUrl, "expressions_export.zip")
              .then((sheetStats) => ({ corpusStats, sheetStats }))
          )
          .then(({ corpusStats, sheetStats }) => {
            const nWarnings = corpusStats.nWarnings + sheetStats.nWarnings;
            const summary = `${corpusStats.nWords ?? "?"} mots, ${corpusStats.nExpr ?? "?"} expressions, `
              + `${corpusStats.nThemes ?? "?"} thèmes, ${corpusStats.nAudio ?? "0"} audio(s) exportés`;
            if (nWarnings > 0) {
              setStatus(status, `${summary}, ${nWarnings} avertissement(s) -- voir warnings.txt dans les zips.`, true);
            } else {
              setStatus(status, `${summary}, aucun avertissement.`, false);
            }
          })
          .catch((err) => setStatus(status, `Échec de l'export : ${err.message}`, true));
      });
    }
  }

  // ---- per-expression editor -------------------------------------------

  function renderPreview(preview) {
    if (!preview.length) return "";
    return (
      '<div class="expr-mesh-preview">' +
      preview
        .map((item) => {
          if (!item.word) {
            return `<span class="expr-mesh-chip expr-mesh-chip--unresolved" title="Non résolu">${escapeHtml(item.token)}</span>`;
          }
          const label = `${item.word.char} ${item.word.pinyin} — ${item.word.french}`;
          if (item.ambiguous) {
            const alts = item.candidates
              .map((c) => `${c.char} ${c.pinyin} — ${c.french}`)
              .join(" / ");
            return `<span class="expr-mesh-chip expr-mesh-chip--ambiguous" title="Ambigu (${escapeHtml(alts)}) -- ajoutez &quot;:précision&quot; pour choisir">${escapeHtml(label)} ⚠</span>`;
          }
          return `<span class="expr-mesh-chip" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`;
        })
        .join("") +
      "</div>"
    );
  }

  function renderEditor(panel, data) {
    panel.innerHTML = `
      <div class="expr-mesh-editor">
        <label class="expr-mesh-field-label">Maillage (hanzi espacés)</label>
        <textarea class="expr-mesh-textarea" rows="2">${escapeHtml(data.excel_format)}</textarea>
        <label class="expr-mesh-field-label">Commentaire</label>
        <textarea class="expr-mesh-textarea expr-mesh-comment" rows="2" placeholder="Commentaire libre…">${escapeHtml(data.commentaire || "")}</textarea>
        <div class="expr-mesh-editor-actions">
          <button type="button" class="expr-mesh-save">Enregistrer</button>
          <span class="expr-mesh-status"></span>
        </div>
        <div class="expr-mesh-preview-wrap">${renderPreview(data.preview)}</div>
      </div>`;

    const textarea = panel.querySelector(".expr-mesh-textarea");
    const commentTextarea = panel.querySelector(".expr-mesh-comment");
    const status = panel.querySelector(".expr-mesh-status");
    const previewWrap = panel.querySelector(".expr-mesh-preview-wrap");

    panel.querySelector(".expr-mesh-save").addEventListener("click", () => {
      setStatus(status, "Enregistrement…", false);
      fetch(panel.dataset.entryUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ excel_format: textarea.value, commentaire: commentTextarea.value }),
      })
        .then(jsonOrThrow)
        .then((updated) => {
          setStatus(status, "Enregistré.", false);
          previewWrap.innerHTML = renderPreview(updated.preview);
        })
        .catch((err) => setStatus(status, `Échec : ${err.message}`, true));
    });
  }

  function toggleEditor(button) {
    const panelId = button.dataset.meshToggle;
    const panel = document.querySelector(`[data-mesh-panel="${panelId}"]`);
    if (!panel) return;

    if (!panel.hidden) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    if (panel.dataset.loaded) return;
    panel.dataset.loaded = "1";
    panel.innerHTML = '<div class="expr-mesh-loading">Chargement…</div>';

    fetch(panel.dataset.entryUrl)
      .then(jsonOrThrow)
      .then((data) => renderEditor(panel, data))
      .catch((err) => {
        panel.innerHTML = `<div class="expr-mesh-status expr-mesh-status--error">Échec du chargement : ${escapeHtml(err.message)}</div>`;
        panel.dataset.loaded = "";
      });
  }

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-mesh-toggle]");
    if (toggle) {
      toggleEditor(toggle);
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".expr-mesh-toolbar").forEach(wireToolbar);
  });
})();
