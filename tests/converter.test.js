// Tests for converter.js.
//
// converter.js is mostly DOM wiring: `View` grabs ~15 elements by id and
// `Controller` wires a dozen event listeners -- that's glue code, not logic,
// and would need a much heavier fake DOM (or a real one, via jsdom /
// Playwright) to test meaningfully. `TextModel` is the one piece of actual
// logic the file owns: a thin wrapper that just forwards to
// `SyllableInputModel.parse` (see CharacterInput.js / characterInput.test.js
// for the shared engine this builds on). That's what's covered below.
//
// Run with: npm test   (see tests/README.md)
const test = require("node:test");
const assert = require("node:assert/strict");
const { createContext, loadScripts, makeDocumentStub } = require("./helpers/load");

function loadConverter() {
  const context = createContext({ document: makeDocumentStub() });
  loadScripts(context, [
    { file: "CharacterInput.js", exports: ["SyllableInputModel"] },
    { file: "converter.js", exports: ["TextModel"] },
  ]);
  return context;
}

test("TextModel.update parses the text into syllables and dictionary suggestions", () => {
  const { TextModel } = loadConverter();
  const dico = {
    getMatchesForSyllable(syl) {
      return syl === "hao3" ? [{ simp: "好", trad: "好" }] : [];
    },
  };
  const model = new TextModel(dico);

  model.update("ni3 hao3");

  assert.equal(model.text, "ni3 hao3");
  assert.deepEqual([...model.syllables], ["ni3", "hao3"]);
  assert.equal(model.suggestions.length, 1, "only hao3 matched a character");
});

test("TextModel keeps SyllableInputModel's select/replace behaviour (it adds no fields of its own)", () => {
  const { TextModel } = loadConverter();
  const dico = {
    getMatchesForSyllable(syl) {
      return syl === "hao3" ? [{ simp: "好", trad: "好" }] : [];
    },
  };
  const model = new TextModel(dico);
  model.update("ni3 hao3");

  model.select(0);

  assert.equal(model.text, "ni3 好");
});
