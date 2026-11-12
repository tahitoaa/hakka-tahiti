// Tests for CharReview (char_review.js): the characters of an addition
// paired with its syllables, and each pair compared with the lexicon --
// a character absent from it, or a reading it doesn't give that character.
//
// Run with: npm test   (see tests/README.md)
const test = require("node:test");
const assert = require("node:assert/strict");
const { createContext, loadScripts, makeDocumentStub } = require("./helpers/load");

async function load() {
  const context = createContext({
    document: makeDocumentStub(),
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => ({ ok: true, json: async () => ({ lexicon: { 屋: ["wuk5"], 家: ["ga1"], 個: ["go4"] }, chars: {} }) }),
  });
  loadScripts(context, [
    { file: "AdditionList.js", exports: ["AdditionList"] },
    { file: "char_review.js", exports: ["CharReview"] },
  ]);
  await context.CharReview.load();
  return context.CharReview;
}

const plain = (x) => JSON.parse(JSON.stringify(x));

test("characters paired with their syllables, «…» blocks and :sense hints left out", async () => {
  const CR = await load();
  assert.deepEqual(plain(CR.pairs("屋家", "wuk5ga1").map((p) => [p.char, p.reading])), [["屋", "wuk5"], ["家", "ga1"]]);
  assert.deepEqual(plain(CR.pairs("«ma'a» 屋:maison 家", "«ma'a» wuk5 ga1").map((p) => [p.char, p.reading])), [["屋", "wuk5"], ["家", "ga1"]]);
  // A character beyond the basic plane counts as one.
  assert.deepEqual(plain(CR.pairs("𠾒個", "nga1go4").map((p) => p.reading)), ["nga1", "go4"]);
  // Counts that differ: no reading paired.
  assert.deepEqual(plain(CR.pairs("玫瑰花", "moi2guifa1").map((p) => p.reading)), [null, null, null]);
});

test("new character, new reading, known reading", async () => {
  const CR = await load();
  assert.equal(CR.classify("屋", "wuk5"), "");
  assert.equal(CR.classify("家", "ka1"), "new-reading");
  assert.equal(CR.classify("花", "fa1"), "new-char");
  assert.equal(CR.classify("家", "ga_"), "", "a tone left open fits");
  assert.equal(CR.classify("□", null), "");
});

test("the tables' characters: the new ones coloured, with what the lexicon says", async () => {
  const CR = await load();
  const html = CR.markHanzi({ hanzi: "屋家花", pinyin: "wuk5ka1fa1" });
  assert.match(html, /^屋<span class="cr-new-reading" title="Lecture nouvelle : ka¹ — lexique : ga¹">家<\/span>/);
  assert.match(html, /<span class="cr-new-char" title="Caractère absent du lexique">花<\/span>$/);
});
