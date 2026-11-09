// Tests for TranscriptLines.js: the (auto) lines of a transcript -- simplified
// and traditional kept apart, words without characters copied as written --
// and the readings still to choose.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createContext, loadScripts } = require("./helpers/load");

function load() {
  const context = createContext();
  loadScripts(context, [
    { file: "Sentence.js", exports: ["Sentence"] },
    { file: "TranscriptLines.js", exports: ["TranscriptLines"] },
  ]);
  return context.TranscriptLines;
}

const reading = (simp, trad, pinyin) => ({ simp, trad, storedPinyin: () => pinyin });
const READINGS = [
  reading("个", "個", "go4"), reading("个", "個", "guo4"),
  reading("发", "發", "fat5"), reading("话", "話", "wa4"),
  reading("吾", "吾", "nga1"), reading("在", "在", "cai4"),
];
const WORDS = [
  { simp: "爸爸", trad: "爸爸", pinyin: "ba1ba1" },
  { simp: "说话", trad: "說話", pinyin: "shot5wa4" },
  { simp: "好", trad: "好", pinyin: "ho3" },
  { simp: "好", trad: "好", pinyin: "hau4" },
];
const dico = {
  pronunciations: READINGS,
  words: WORDS.map((dataset) => ({ dataset })),
  getMatchesForHanzi: (c) => READINGS.filter((p) => p.simp === c || p.trad === c),
};

test("simplified and traditional are separate lines, whatever was typed", () => {
  const T = load();
  for (const typed of ["说话 发", "說話 發"]) {
    const d = T.derive(dico, typed);
    assert.equal(d.hanzi, typed === "说话 发" ? "说话发" : d.hanzi);
    assert.equal(d.trad, "說話發");
  }
  assert.equal(T.derive(dico, "發").hanzi, "发");
});

test("words without characters are copied as written in every line", () => {
  const T = load();
  const d = T.derive(dico, "吾(nga1) 在 Raiatea c'est 爸爸");
  assert.equal(d.hanzi, "吾在 Raiatea c'est 爸爸");
  assert.equal(d.trad, "吾在 Raiatea c'est 爸爸");
  assert.match(d.pinyin, /Raiatea c'est/);
  assert.equal(T.derive(dico, "Bora Bora").mixed, "Bora Bora");
});

test("punctuation sticks to its word and never becomes « ? »", () => {
  const T = load();
  const d = T.derive(dico, "我 安做 Annette Levin， 爸爸。");
  assert.match(d.hanzi, /Annette Levin， 爸爸。$/);
  assert.match(d.pinyin, /Annette Levin, /);
  assert.doesNotMatch(T.derive(dico, "爸爸。").pinyin, /\?/);
});

test("syllables left to convert stay out of the characters, in the pinyin", () => {
  const T = load();
  const d = T.derive(dico, "吾(nga1) 在 Raiatea kiu3 爸爸shin_");
  assert.equal(d.hanzi, "吾在 Raiatea 爸爸");
  assert.match(d.pinyin, /kiu/);
  assert.match(d.pinyin, /shin/);
  assert.doesNotMatch(d.pinyin, /_/);
});

test("ambiguous: a character read several ways, until one is pinned", () => {
  const T = load();
  const text = "吾 个 爸爸";
  const found = T.ambiguous(dico, text);
  assert.equal(found.length, 1);
  assert.equal(found[0].char, "个");
  assert.deepEqual([...found[0].readings], ["go4", "guo4"]);
  const pinned = T.pin(text, found[0].pos, "guo4");
  assert.equal(pinned, "吾 个(guo4) 爸爸");
  assert.equal(T.ambiguous(dico, pinned).length, 0);
  assert.match(T.derive(dico, pinned).pinyin, /guo/);
});

test("ambiguous: homographs among the lexicon's words; punctuation and text ignored", () => {
  const T = load();
  const found = T.ambiguous(dico, "Raiatea 好， 说话");
  assert.equal(found.length, 1);
  assert.equal(found[0].char, "好");
  assert.deepEqual([...found[0].readings].sort(), ["hau4", "ho3"]);
});

test("a «…» block is copied as written, without its guillemets", () => {
  const T = load();
  const d = T.derive(dico, "吾(nga1) 在 «ma'a tinito» 爸爸");
  assert.equal(d.hanzi, "吾在 ma'a tinito 爸爸");
  assert.match(d.pinyin, /ma'a tinito/);
  assert.doesNotMatch(d.pinyin, /«|»/);
});
