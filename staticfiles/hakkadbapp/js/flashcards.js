// Flashcards page: "next card" and category switching used to be a full
// page reload (a round trip to the DB, often slow on a remote/serverless
// connection) for every single click during a study session. This caches
// the whole word catalog client-side (localStorage) via /api/words-data/
// so every card after the first renders instantly, purely in JS.
(function () {
  "use strict";

  var CACHE_KEY = "hakka-flashcards-words-v1";
  // This dictionary only changes via admin import commands, never live user
  // edits, so a long TTL is safe and keeps repeat visits network-free.
  var CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  var API_URL = "/api/words-data/";

  var app = document.getElementById("flashcard-app");
  var words = null; // full cached catalog, once loaded/fetched
  var flipped = false;
  var currentCategory = (app && app.dataset.category) || "";
  var currentHanziFilter = (app && app.dataset.hanziFilter) || "";

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.words) || !parsed.fetchedAt) return null;
      if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
      return parsed.words;
    } catch (e) {
      return null;
    }
  }

  function writeCache(list) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), words: list }));
    } catch (e) {
      // localStorage full/unavailable (private browsing, quota) -- the page
      // still works, just falls back to a fetch on every load.
    }
  }

  function loadWords() {
    var cached = readCache();
    if (cached) {
      words = cached;
      prefetchCurrentChars();
      return;
    }
    fetch(API_URL)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        words = data.words || [];
        writeCache(words);
        prefetchCurrentChars();
      })
      .catch(function () {
        // Cache stays null -- nextCard()/category-change fall back to a
        // normal server round trip, same as before this feature existed.
      });
  }

  function matchesFilters(word) {
    if (currentCategory && word.category !== currentCategory) return false;
    if (currentHanziFilter && word.chars.indexOf(currentHanziFilter) === -1) return false;
    return true;
  }

  function pickRandom() {
    if (!words) return null;
    var pool = words.filter(matchesFilters);
    if (!pool.length) return null;
    for (var i = 0; i < 10; i++) {
      var candidate = pool[Math.floor(Math.random() * pool.length)];
      if (candidate.hanzi && candidate.hanzi.trim()) return candidate;
    }
    return pool[0];
  }

  // Warms the browser's HTTP cache for the character-rosace pages linked
  // from the card currently on screen, so clicking through to them feels
  // instant instead of waiting on a fresh server render.
  function prefetchCurrentChars() {
    var card = document.getElementById("flashcard");
    if (!card) return;
    card.querySelectorAll("a[href]").forEach(function (a) {
      fetch(a.href, { credentials: "same-origin" }).catch(function () {});
    });
  }

  function applyPinyinSystemSelection(container) {
    var menu = document.getElementById("pinyin-menu");
    if (!menu || !menu.value || !container) return;
    container.querySelectorAll(".wenfa_py, .hakka_dict_py, .chappell_py, .sagart_py").forEach(function (el) {
      el.style.display = el.classList.contains(menu.value) ? "" : "none";
    });
  }

  function renderCard(word) {
    document.querySelectorAll("#fc-hanzi-front, #fc-hanzi-back").forEach(function (el) {
      el.textContent = word.hanzi;
    });

    var pinyinRow = document.getElementById("fc-pinyin-row");
    if (pinyinRow) {
      pinyinRow.innerHTML = word.pinyin_html;
      applyPinyinSystemSelection(pinyinRow);
    }

    var heroMedia = document.getElementById("fc-hero-media");
    if (heroMedia) {
      if (word.illustration) {
        var img = document.createElement("img");
        img.src = word.illustration.url;
        img.alt = "";
        img.className = "h-40 w-40 object-contain";
        img.loading = "lazy";
        img.onerror = function () { img.style.display = "none"; };
        var credit = document.createElement("span");
        credit.className = "text-[10px] fc-text-muted";
        credit.textContent = word.illustration.credit;
        heroMedia.replaceChildren(img, credit);
      } else {
        heroMedia.replaceChildren();
      }
    }

    var charsRow = document.getElementById("fc-chars-row");
    if (charsRow) {
      charsRow.replaceChildren();
      if (word.chars && word.chars.length) {
        charsRow.hidden = false;
        word.chars.forEach(function (c) {
          var a = document.createElement("a");
          a.href = "/hanzi/" + encodeURIComponent(c) + "/";
          a.className = "hanzi px-2 py-0.5 rounded-full fc-chip transition-colors";
          a.textContent = c;
          charsRow.appendChild(a);
        });
      } else {
        charsRow.hidden = true;
      }
    }

    var frenchEl = document.getElementById("fc-french");
    if (frenchEl) frenchEl.textContent = word.french || "";

    var categoryEl = document.getElementById("fc-category");
    if (categoryEl) {
      categoryEl.hidden = !word.category;
      categoryEl.textContent = word.category || "";
    }

    flipped = false;
    var card = document.getElementById("flashcard");
    if (card) card.style.transform = "rotateY(0deg)";

    prefetchCurrentChars();
  }

  window.flipCard = function () {
    flipped = !flipped;
    var card = document.getElementById("flashcard");
    if (card) card.style.transform = flipped ? "rotateY(180deg)" : "rotateY(0deg)";
  };

  window.nextCard = function () {
    var next = pickRandom();
    if (next) {
      renderCard(next);
    } else {
      // Cache not ready yet (first-ever visit, or still fetching), or this
      // filter genuinely has no match in the cache -- same behavior as
      // before this feature existed.
      location.reload();
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    loadWords();

    var themeBtn = document.getElementById("fc-theme-toggle");
    var root = document.documentElement;
    if (themeBtn) {
      // Shares the "hakka-theme" preference/toggle mechanics with
      // expressions.html (see expressions.js) -- same localStorage key and
      // data-theme attribute on <html>, so the choice carries over between
      // pages instead of each page tracking its own.
      var stored = null;
      try { stored = localStorage.getItem("hakka-theme"); } catch (e) {}
      if (stored) root.setAttribute("data-theme", stored);
      themeBtn.addEventListener("click", function () {
        var nextTheme = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
        root.setAttribute("data-theme", nextTheme);
        try { localStorage.setItem("hakka-theme", nextTheme); } catch (e) {}
      });
    }

    var categorySelect = document.getElementById("category-select");
    if (categorySelect) {
      categorySelect.addEventListener("change", function () {
        currentCategory = this.value;
        // Switching category clears any inherited hanzi filter, same as
        // navigating to a fresh /flashcards/<category> URL always did.
        currentHanziFilter = "";
        var url = currentCategory ? "/flashcards/" + encodeURIComponent(currentCategory) : "/flashcards/";
        var next = pickRandom();
        if (next) {
          renderCard(next);
          history.replaceState(null, "", url);
        } else {
          window.location.href = url;
        }
      });
    }
  });
})();
