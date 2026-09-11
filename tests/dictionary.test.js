// Tests for Dictionary.js -- builds the in-memory pronunciation/word lookup
// tables the rest of the app's JS (Sentence, CharacterInput...) searches
// against. It reads its data from the DOM (two lists of `data-*` elements
// rendered server-side), so these tests fake that DOM instead of a real
// browser.
//
// Run with: npm test   (see tests/README.md)
const test = require("node:test");
const assert = require("node:assert/strict");
const { createContext, loadScripts, makeEl, makeDocumentStub } = require("./helpers/load");

/** Builds a real Dictionary instance against a fake DOM: `pronRows` are
 *  "simp,trad,initial,final,tone" strings (the raw `data-search` format),
 *  `wordRows` are plain dataset objects for the #word-list side. Returns
 *  both the dictionary and the vm context, so a test can also reach classes
 *  like `context.Punctuation` for `instanceof` checks. */
function buildDictionary({ pronRows = [], wordRows = [] } = {}) {
  const pronItems = pronRows.map((search) => makeEl({ dataset: { search } }));
  const wordItems = wordRows.map((dataset) => makeEl({ dataset }));

  const context = createContext({
    document: makeDocumentStub({
      bySelector: {
        "#pron-list > li": pronItems,
        "#word-list > li": wordItems,
      },
    }),
  });
  loadScripts(context, [
    { file: "Pronunciation.js", exports: ["Pronunciation", "NoHanziToken", "Punctuation"] },
    { file: "Word.js", exports: ["Word"] },
    { file: "Dictionary.js", exports: ["Dictionary"] },
  ]);

  const dico = new context.Dictionary({ containerId: "#pron-list", itemSelector: "li" });
  return { dico, context };
}

test("constructor parses each pron-list row's data-search into a Pronunciation", () => {
  const { dico } = buildDictionary({ pronRows: ["好,好,H,AO,3"] });

  assert.equal(dico.pronunciations.length, 1);
  const p = dico.pronunciations[0];
  // data-search is lower-cased on read, so the hanzi is untouched but the
  // initial/final come through lowercase regardless of how they were typed.
  assert.equal(p.simp, "好");
  assert.equal(p.initial, "h");
  assert.equal(p.final, "ao");
  assert.equal(p.tone, "3");
});

test("constructor wraps each word-list row's dataset in a Word", () => {
  const { dico } = buildDictionary({ wordRows: [{ simp: "若", pinyin: "ngi2", french: "tu" }] });

  assert.equal(dico.words.length, 1);
  assert.equal(dico.words[0].dataset.french, "tu");
});

test("getMatchesForSyllable finds a pronunciation by its digit-tone pinyin", () => {
  const { dico } = buildDictionary({ pronRows: ["好,好,h,ao,3"] });

  const matches = dico.getMatchesForSyllable("hao3");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].simp, "好");
});

test("getMatchesForHanzi returns every pronunciation recorded for that character", () => {
  const { dico } = buildDictionary({ pronRows: ["好,好,h,ao,3", "好,好,h,ao,2"] });

  const matches = dico.getMatchesForHanzi("好");
  assert.equal(matches.length, 2, "两个 both readings of 好 come back");
});

test("getMatchesForHanzi records an unrecognised character in .unknowns", () => {
  const { dico } = buildDictionary({ pronRows: ["好,好,h,ao,3"] });

  const matches = dico.getMatchesForHanzi("谜");
  assert.equal(matches.length, 0);
  assert.ok(dico.unknowns.has("谜"), "the unmatched character is tracked for the 'unknown chars' report");
});

test("getMatchesForHanzi returns a placeholder token for non-hanzi input, without touching the dictionary", () => {
  const { dico, context } = buildDictionary({ pronRows: ["好,好,h,ao,3"] });

  const [letter] = dico.getMatchesForHanzi("a");
  assert.ok(letter instanceof context.NoHanziToken);

  // Note: getMatchesForHanzi checks `!isHanzi(char)` before it ever checks
  // `isPunctuation(char)` -- and punctuation is also non-hanzi, so it always
  // takes the first branch. Punctuation ends up as a NoHanziToken too, not
  // the dedicated `Punctuation` class (which currently has no way to be
  // reached from here).
  const [punct] = dico.getMatchesForHanzi(",");
  assert.ok(punct instanceof context.NoHanziToken);

  // Neither should have been recorded as an "unknown hanzi" -- they were
  // never hanzi to begin with.
  assert.equal(dico.unknowns.size, 0);
});

test("addPronunciations skips an entry that's already present (same simp/trad/initial/final/tone)", () => {
  const { dico, context } = buildDictionary({ pronRows: ["好,好,h,ao,3"] });

  const duplicate = new context.Pronunciation({ simp: "好", trad: "好", initial: "h", final: "ao", tone: "3" });
  const brandNew = new context.Pronunciation({ simp: "新", trad: "新", initial: "x", final: "in", tone: "1" });

  dico.addPronunciations([duplicate, brandNew]);

  assert.equal(dico.pronunciations.length, 2, "the duplicate was skipped, the new one was added");
});
