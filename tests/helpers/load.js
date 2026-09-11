// Shared plumbing for loading the app's plain <script>-tag JS files (no
// bundler, no `export`/`import`) into a sandboxed environment where they can
// be unit tested with Node's built-in test runner.
//
// Why this is needed: the files under hakkadbapp/static/hakkadbapp/js/ are
// written as `class Foo { ... }` at the top level, meant to run directly in
// a browser <script> tag. A top-level `class` declaration does NOT attach
// itself to the global object (this is true in real browsers too, not just
// here) -- so after running the file's source, `context.Foo` is undefined
// even though `Foo` exists inside that context's scope. To get a handle on
// it from the Node side, we run one more tiny snippet in the SAME context
// right after loading the file, assigning `this.Foo = Foo` -- `this` at
// top-level non-strict code is the context's global object, so this makes
// the class visible as a normal property Node can read back out.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const JS_DIR = path.join(__dirname, "..", "..", "hakkadbapp", "static", "hakkadbapp", "js");

/** Creates a fresh vm context pre-seeded with `console` plus whatever else
 *  a given file needs (most of them touch `document` one way or another). */
function createContext(extra = {}) {
  const context = { console, ...extra };
  vm.createContext(context);
  return context;
}

/** Loads one or more source files (by filename, relative to the js/ folder)
 *  into `context`, in order -- order matters when one file's classes
 *  reference another's (e.g. Dictionary.js uses `Word` and `Pronunciation`).
 *  `entries` is an array of either a plain filename string (nothing needs
 *  to be read back out of it) or `{ file, exports }` where `exports` lists
 *  the top-level class/function names the test needs access to afterwards. */
function loadScripts(context, entries) {
  entries.forEach((entry) => {
    const { file, exports: names } = typeof entry === "string" ? { file: entry, exports: [] } : entry;
    const code = fs.readFileSync(path.join(JS_DIR, file), "utf8");
    vm.runInContext(code, context, { filename: file });
    if (names && names.length) {
      vm.runInContext(names.map((n) => `this.${n} = ${n};`).join("\n"), context, { filename: `${file} (export bridge)` });
    }
  });
  return context;
}

/** A minimal fake DOM element: enough `dataset`/`classList`/`innerHTML`/
 *  `addEventListener` surface for the bits of the app's JS that touch
 *  elements directly, without pulling in a real DOM library. Extend with
 *  `overrides` for anything a specific test needs beyond this. */
function makeEl(overrides = {}) {
  const listeners = {};
  return Object.assign(
    {
      innerHTML: "",
      textContent: "",
      value: "",
      dataset: {},
      style: {},
      classList: {
        _classes: new Set(),
        add(...cls) { cls.forEach((c) => this._classes.add(c)); },
        remove(...cls) { cls.forEach((c) => this._classes.delete(c)); },
        contains(c) { return this._classes.has(c); },
      },
      addEventListener(evt, cb) {
        (listeners[evt] = listeners[evt] || []).push(cb);
      },
      // Not a real DOM method -- lets a test fire a registered handler
      // directly instead of needing a real event loop.
      _trigger(evt, event) {
        (listeners[evt] || []).forEach((cb) => cb(event));
      },
    },
    overrides,
  );
}

/** A fake `document` whose `querySelectorAll` returns a fixed array per
 *  selector string, and whose `getElementById` returns a fixed element per
 *  id -- both driven by plain lookup tables the test controls. */
function makeDocumentStub({ bySelector = {}, byId = {}, ...rest } = {}) {
  return {
    querySelectorAll: (selector) => bySelector[selector] || [],
    getElementById: (id) => byId[id] || null,
    createElement: () => makeEl(),
    activeElement: null,
    // A no-op by default: most files end with
    // `document.addEventListener("DOMContentLoaded", () => {...})`, and
    // merely loading the file's source (to reach a class it defines) does
    // not need that callback to actually run.
    addEventListener() {},
    ...rest,
  };
}

module.exports = { JS_DIR, createContext, loadScripts, makeEl, makeDocumentStub };
