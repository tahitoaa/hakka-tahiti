// Tests for SearchMatch.js: what every search box of the site understands.
// Run with: npm test   (see tests/README.md)
const test = require("node:test");
const assert = require("node:assert/strict");
const { createContext, loadScripts } = require("./helpers/load");

function load() {
  const context = createContext();
  loadScripts(context, [{ file: "SearchMatch.js", exports: ["SearchMatch"] }]);
  return context.SearchMatch;
}

test("syllables typed apart, with or without tone, find a word written in one block", () => {
  const S = load();
  for (const q of ["zen lao", "Zen Lao", "zen1 lao", "zen1 lao1", "zenlao", "zen lao1"]) {
    assert.equal(S.match("py:zen1lao1 fr:vieux", q), true, q);
  }
  assert.equal(S.match("zen¹lao¹", "zen lao"), true, "superscript tones");
  assert.equal(S.match("zen1 lao1", "zen lao"), true, "already apart");
  assert.equal(S.match("zen1lao1", "zen2 lao"), false, "another tone typed");
  assert.equal(S.match("zen1lao1", "lao zen"), true, "each word found, any order (as before)");
  assert.equal(S.match("zen1gai1lao1", "zen lao"), true, "each word found");
  assert.equal(S.match("zen1gai1", "zen lao"), false);
});

test("words, accents and case as before", () => {
  const S = load();
  assert.equal(S.match("fr:la Maison", "maison"), true);
  assert.equal(S.match("jiā", "jia"), true);
  assert.equal(S.match("屋家 wuk5ka1 maison", "屋家 maison"), true);
  assert.equal(S.match("anything", ""), true);
  assert.equal(S.match("maison", "voiture"), false);
});
