// Per-word persistent comment editor (see hakkadbapp/word_notes.py):
// a single free-text field, keyed server-side by Word.platform_id so it
// survives a platform_to_vercel reset+rebuild. Same event-delegation
// pattern as ExpressionMesh.js's per-expression editor, so this file can
// be dropped onto any page once -- toggle buttons are marked up via
// [data-note-toggle="<word db id>"] with a matching
// [data-note-panel="<id>"] container right after it to render into.

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
    el.classList.toggle("word-note-status--error", !!isError);
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

  function renderEditor(panel, data) {
    panel.innerHTML = `
      <div class="word-note-editor">
        <textarea class="word-note-textarea" rows="2" placeholder="Commentaire libre…">${escapeHtml(data.commentaire || "")}</textarea>
        <label class="word-note-export-toggle${data.use_in_export ? " is-on" : ""}">
          <input type="checkbox" class="word-note-export-checkbox" ${data.use_in_export ? "checked" : ""}>
          Utiliser dans l'export
        </label>
        <div class="word-note-editor-actions">
          <button type="button" class="word-note-save">Enregistrer</button>
          <span class="word-note-status"></span>
        </div>
      </div>`;

    const textarea = panel.querySelector(".word-note-textarea");
    const checkbox = panel.querySelector(".word-note-export-checkbox");
    const label = panel.querySelector(".word-note-export-toggle");
    const status = panel.querySelector(".word-note-status");

    checkbox.addEventListener("change", () => {
      fetch(panel.dataset.entryUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ use_in_export: checkbox.checked }),
      })
        .then(jsonOrThrow)
        .then((updated) => label.classList.toggle("is-on", updated.use_in_export))
        .catch((err) => {
          checkbox.checked = !checkbox.checked; // revert on failure
          setStatus(status, `Échec : ${err.message}`, true);
        });
    });

    panel.querySelector(".word-note-save").addEventListener("click", () => {
      setStatus(status, "Enregistrement…", false);
      fetch(panel.dataset.entryUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: JSON.stringify({ commentaire: textarea.value }),
      })
        .then(jsonOrThrow)
        .then(() => setStatus(status, "Enregistré.", false))
        .catch((err) => setStatus(status, `Échec : ${err.message}`, true));
    });
  }

  function toggleEditor(button) {
    const panelId = button.dataset.noteToggle;
    const panel = document.querySelector(`[data-note-panel="${panelId}"]`);
    if (!panel) return;

    if (!panel.hidden) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    if (panel.dataset.loaded) return;
    panel.dataset.loaded = "1";
    panel.innerHTML = '<div class="word-note-loading">Chargement…</div>';

    fetch(panel.dataset.entryUrl)
      .then(jsonOrThrow)
      .then((data) => renderEditor(panel, data))
      .catch((err) => {
        panel.innerHTML = `<div class="word-note-status word-note-status--error">Échec du chargement : ${escapeHtml(err.message)}</div>`;
        panel.dataset.loaded = "";
      });
  }

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-note-toggle]");
    if (toggle) {
      toggleEditor(toggle);
    }
  });
})();
