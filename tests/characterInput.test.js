// Tests for CharacterInput.js -- the shared romanization -> hanzi
// suggestion engine (`SyllableInputModel`) and the tappable suggestion
// picker (`SuggestionBar`) used by both the Converter and Transcripter
// pages.
//
// Run with: npm test   (see tests/README.md)
const test = require("node:test");
const assert = require("node:assert/strict");
const { createContext, loadScripts, makeEl, makeDocumentStub } = require("./helpers/load");

function loadCharacterInput() {
  const context = createContext({ document: makeDocumentStub() });
  loadScripts(context, [
    { file: "CharacterInput.js", exports: ["SyllableInputModel", "SuggestionBar", "suggestionKeyHint"] },
  ]);
  return context;
}

test("suggestionKeyHint labels the first 9 suggestions 1-9, then A, B, C...", () => {
  const { suggestionKeyHint } = loadCharacterInput();

  assert.equal(suggestionKeyHint(0), "1");
  assert.equal(suggestionKeyHint(8), "9");
  assert.equal(suggestionKeyHint(9), "A");
  assert.equal(suggestionKeyHint(10), "B");
});

test("SyllableInputModel.parse extracts romanized syllables and looks each one up in the dictionary", () => {
  const { SyllableInputModel } = loadCharacterInput();

  // A fake dico: "hao3" has one candidate character, everything else none.
  const dico = {
    getMatchesForSyllable(syl) {
      return syl === "hao3" ? [{ simp: "好", trad: "好" }] : [];
    },
  };
  const model = new SyllableInputModel(dico);
  model.parse("ni3 hao3");

  assert.deepEqual([...model.syllables], ["ni3", "hao3"]);
  assert.equal(model.suggestions.length, 1, "only hao3 matched a character");
  assert.equal(model.suggestions[0].for, 1, "the suggestion points back at the 2nd syllable (index 1)");
  assert.equal(model.suggestions[0].pron.simp, "好");
});

test("SyllableInputModel.parse ignores text wrapped in *stars* (notes, not syllables to convert)", () => {
  const { SyllableInputModel } = loadCharacterInput();
  const dico = { getMatchesForSyllable: () => [] };
  const model = new SyllableInputModel(dico);

  model.parse("hao3 *note: informal* ni3");

  assert.deepEqual([...model.syllables], ["hao3", "ni3"], "the starred note is stripped before syllables are extracted");
});

test("SyllableInputModel.replace substitutes one syllable's text in place", () => {
  const { SyllableInputModel } = loadCharacterInput();
  const dico = { getMatchesForSyllable: () => [] };
  const model = new SyllableInputModel(dico);
  model.parse("ni3 hao3");

  model.replace(1, "好");

  assert.equal(model.text, "ni3 好");
});

test("SyllableInputModel.select replaces the chosen syllable then re-parses the whole text", () => {
  const { SyllableInputModel } = loadCharacterInput();
  const dico = {
    getMatchesForSyllable(syl) {
      return syl === "hao3" ? [{ simp: "好", trad: "好" }] : [];
    },
  };
  const model = new SyllableInputModel(dico);
  model.parse("ni3 hao3");

  model.select(0); // the only suggestion: "好" for syllable index 1 (hao3)

  assert.equal(model.text, "ni3 好", "hao3 was replaced by the picked hanzi");
  assert.deepEqual([...model.syllables], ["ni3"], "re-parsing only finds the remaining romanized syllable");
});

test("SuggestionBar.render fills the container with one tappable button per suggestion", () => {
  const { SuggestionBar } = loadCharacterInput();
  const container = makeEl();
  const bar = new SuggestionBar(container);

  bar.render([
    { for: 0, pron: { simp: "好", trad: "好", abstractPinyin: () => "ho³" } },
  ]);

  assert.match(container.innerHTML, /data-suggestion-index="0"/);
  assert.match(container.innerHTML, />好</);
});

test("SuggestionBar.render clears the container when there are no suggestions", () => {
  const { SuggestionBar } = loadCharacterInput();
  const container = makeEl({ innerHTML: "<button>stale</button>" });
  const bar = new SuggestionBar(container);

  bar.render([]);

  assert.equal(container.innerHTML, "");
});

test("clicking a suggestion button calls onSelect with that button's index", () => {
  const { SuggestionBar } = loadCharacterInput();
  const container = makeEl();
  let selectedIndex = null;
  new SuggestionBar(container, { onSelect: (i) => { selectedIndex = i; } });

  // Simulate a click landing on the suggestion button (event.target.closest
  // finds the [data-suggestion-index] element, same as in a real browser).
  const button = { dataset: { suggestionIndex: "1" } };
  button.closest = (selector) => (selector === "[data-suggestion-index]" ? button : null);
  container._trigger("click", { target: button });

  assert.equal(selectedIndex, 1);
});
