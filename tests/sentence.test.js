// Tests for Sentence.js -- the class that turns a line of space-separated
// hanzi tokens (optionally with `:constraint` or `(inline pinyin)` syntax)
// into dictionary matches, and renders pinyin/hanzi/french lines from them.
// Shared by the Converter, Transcripter and Expressions pages.
//
// Run with: npm test   (see tests/README.md)
const test = require("node:test");
const assert = require("node:assert/strict");
const { createContext, loadScripts } = require("./helpers/load");

// A tiny fake dictionary: same shape Dictionary.js produces (`.words` is an
// array of objects with a `.dataset` holding simp/trad/pinyin/french), but
// built by hand so each test controls exactly what's in it.
function makeDico(words) {
  return {
    words: words.map((dataset) => ({ dataset })),
    // Only used by Sentence's "unknown hanzi" fallback path (it asks the
    // dictionary for every possible reading of a character it can't match
    // as a whole word); an empty dictionary just means "no reading known".
    getMatchesForHanzi: () => [],
  };
}

function loadSentence() {
  const context = createContext();
  loadScripts(context, [{ file: "Sentence.js", exports: ["Sentence"] }]);
  return context.Sentence;
}

test("parseToken splits hanzi, :constraints and (inline pinyin)", () => {
  const Sentence = loadSentence();
  const s = new Sentence(makeDico([]), "");

  // `{...s.parseToken(...)}` copies the fields into a plain object built in
  // this file's own realm -- s.parseToken's own return value was built
  // inside the sandboxed vm context, whose `Object` is a *different* Object
  // than this file's, so a direct assert.deepEqual would fail on that alone
  // even though every field matches.
  const plain = s.parseToken("好");
  assert.deepEqual({ ...plain }, { hanzi: "好", constraints: null, inline: null, raw: "好" });

  const withConstraints = s.parseToken("好:bon,ok");
  assert.equal(withConstraints.hanzi, "好");
  assert.deepEqual([...withConstraints.constraints], ["bon", "ok"]);

  const withInline = s.parseToken("好(hao3)");
  assert.equal(withInline.hanzi, "好");
  assert.equal(withInline.inline, "hao3");
});

test("findMatches returns the dictionary entry for a hanzi", () => {
  const Sentence = loadSentence();
  const dico = makeDico([
    { simp: "若", trad: "若", pinyin: "ngi2", french: "tu" },
    { simp: "好", trad: "好", pinyin: "ho3", french: "bien" },
  ]);
  const s = new Sentence(dico, "");

  const matches = s.findMatches("好", null);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].dataset.pinyin, "ho3");
});

test("findMatches filters ambiguous hanzi by :constraint against french/pinyin", () => {
  const Sentence = loadSentence();
  const dico = makeDico([
    { simp: "好", trad: "好", pinyin: "ho3", french: "bien" },
    { simp: "好", trad: "好", pinyin: "ho2", french: "bonjour" },
  ]);
  const s = new Sentence(dico, "");

  const matches = s.findMatches("好", ["bonjour"]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].dataset.french, "bonjour");
});

test("findMatches sorts shortest french gloss first (best guess when several readings exist)", () => {
  const Sentence = loadSentence();
  const dico = makeDico([
    { simp: "好", trad: "好", pinyin: "ho2", french: "bonjour (long gloss)" },
    { simp: "好", trad: "好", pinyin: "ho3", french: "bien" }, // shorter french -> sorts first
  ]);
  const s = new Sentence(dico, "");

  const matches = s.findMatches("好", null);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].dataset.pinyin, "ho3", "the shorter french gloss should be the best guess");
});

test("a hanzi with two dictionary entries is a genuine ambiguity: both show up in the same match group", () => {
  const Sentence = loadSentence();
  const dico = makeDico([
    { simp: "若", trad: "若", pinyin: "ngi2", french: "tu" },
    { simp: "好", trad: "好", pinyin: "ho3", french: "a" },
    { simp: "好", trad: "好", pinyin: "ho2", french: "bb" },
  ]);
  const s = new Sentence(dico, "若 好", "tu vas bien");

  assert.equal(s.matches.length, 2, "one match group per token");
  assert.equal(s.matches[0].length, 1, "若 has only one dictionary entry");
  assert.equal(s.matches[1].length, 2, "好 is ambiguous: two dictionary entries");
});

test("renderPinyinLine / renderHanziLine / renderFrenchLine build the three plain-text lines", () => {
  const Sentence = loadSentence();
  const dico = makeDico([
    { simp: "若", trad: "若", pinyin: "ngi2", french: "tu" },
    { simp: "好", trad: "好", pinyin: "ho3", french: "bien" },
  ]);
  const s = new Sentence(dico, "若 好", "tu vas bien");

  assert.equal(s.renderPinyinLine(), "ngi² ho³", "digits become superscript tone marks");
  assert.equal(s.renderHanziLine(), "若好", "hanzi are concatenated with no spaces");
  assert.equal(s.renderFrenchLine(), "tu bien");
});

test("an unknown hanzi (no dictionary entry) still produces a token instead of crashing", () => {
  const Sentence = loadSentence();
  const s = new Sentence(makeDico([]), "谜", "mystère");

  assert.equal(s.matches.length, 1);
  assert.equal(s.matches[0][0].isUnknown, true);
  assert.equal(s.renderHanziLine(), "谜", "falls back to the raw hanzi from the input text");
});

test("render() includes a copy button per field, with the pinyin+hanzi and french text in data-copy-text", () => {
  const Sentence = loadSentence();
  const dico = makeDico([
    { simp: "若", trad: "若", pinyin: "ngi2", french: "tu" },
    { simp: "好", trad: "好", pinyin: "ho3", french: "bien" },
  ]);
  const s = new Sentence(dico, "若 好", 'tu vas "bien"');

  const html = s.render();
  assert.match(html, /class="copy-btn/, "each field has a copy button");
  assert.match(html, /data-copy-text="ngi² ho³ 若好"/, "pinyin+hanzi copy button carries the combined text");
  // The french text contains a double quote, which must be HTML-escaped in
  // the attribute rather than breaking the markup.
  assert.match(html, /data-copy-text="tu vas &quot;bien&quot;"/);
});
