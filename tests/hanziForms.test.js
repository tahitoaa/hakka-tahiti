// Tests for HanziForms.js: a character written in another form than the
// lexicon's (髮 for 发, 愛 for 爱, or the other way round) is still known --
// its readings, its words, the derived lines -- without mixing up two
// characters the lexicon has both (乾 is not 干).
// Run with: npm test   (see tests/README.md)
const test = require("node:test");
const assert = require("node:assert/strict");
const { createContext, loadScripts } = require("./helpers/load");

// What templatetags.hanzi_forms_json gives for 发, 爱, 干, 乾 (OpenCC).
const TABLE = { "發": "发", "髮": "发", "愛": "爱", "幹": "干", "乾": "干" };

function load() {
  const context = createContext();
  loadScripts(context, [
    { file: "HanziForms.js", exports: ["HanziForms"] },
    { file: "Sentence.js", exports: ["Sentence"] },
    { file: "TranscriptLines.js", exports: ["TranscriptLines"] },
  ]);
  context.HanziForms.use(TABLE);
  return context;
}

const reading = (simp, trad, pinyin) => ({ simp, trad, storedPinyin: () => pinyin });

test("canon, sameText, isOtherForm", () => {
  const { HanziForms: F } = load();
  assert.equal(F.canon("頭髮 愛"), "頭发 爱");
  assert.equal(F.sameText("头髮", "头发"), true);
  assert.equal(F.sameText("头发", "头發"), true);
  assert.equal(F.sameText("发", "爱"), false);
  assert.equal(F.isOtherForm("髮"), true);
  assert.equal(F.isOtherForm("发"), false);
});

test("pick: written so first, else another form of it", () => {
  const { HanziForms: F } = load();
  const lexicon = [reading("发", "發", "fat5"), reading("爱", "愛", "oi4"), reading("干", "干", "gon1"), reading("干", "乾", "kon1")];
  // 髮: the lexicon's 发 (whose trad is 發) -- before, unknown.
  assert.deepEqual(F.pick(lexicon, "髮").map((p) => p.storedPinyin()), ["fat5"]);
  // Both ways: 爱 and 愛 find the same reading.
  assert.deepEqual(F.pick(lexicon, "爱").map((p) => p.storedPinyin()), ["oi4"]);
  assert.deepEqual(F.pick(lexicon, "愛").map((p) => p.storedPinyin()), ["oi4"]);
  // 乾 is in the lexicon itself: only its own reading, never 干's.
  assert.deepEqual(F.pick(lexicon, "乾").map((p) => p.storedPinyin()), ["kon1"]);
  // 幹 is not: the readings of 干 (its simplified form).
  assert.deepEqual(F.pick(lexicon, "幹").map((p) => p.storedPinyin()).sort(), ["gon1", "kon1"]);
});

test("a word written in another form is found; the traditional line keeps what was typed", () => {
  const { Sentence, TranscriptLines } = load();
  const READINGS = [reading("头", "頭", "teu2"), reading("发", "發", "fat5")];
  const dico = {
    pronunciations: READINGS,
    words: [{ dataset: { simp: "头发", trad: "頭發", pinyin: "teu2fat5", french: "cheveux" } }],
    getMatchesForHanzi: (c) => READINGS.filter((p) => p.simp === c || p.trad === c),
  };
  const s = new Sentence(dico, "頭髮");
  assert.equal(s.matches[0][0].isUnknown, undefined, "頭髮 is the lexicon's 头发");
  assert.equal(s.matches[0][0].dataset.french, "cheveux");
  const d = TranscriptLines.derive(dico, "頭髮");
  assert.equal(d.hanzi, "头发");
  assert.equal(d.trad, "頭髮", "the 髮 typed, not the lexicon's 發");
  // Written as the lexicon has it: unchanged.
  assert.equal(TranscriptLines.derive(dico, "头发").trad, "頭發");
});
