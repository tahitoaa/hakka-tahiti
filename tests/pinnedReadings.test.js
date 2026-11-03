// Tests for pinned readings: picking a polyphone (生 = sen1 or sang1) in the
// converter/transcriber writes 生(sen1) into the text, and Sentence then
// keeps that reading instead of guessing between homophones.
//
// Run with: npm test   (see tests/README.md)
const test = require("node:test");
const assert = require("node:assert/strict");
const { createContext, loadScripts, makeDocumentStub } = require("./helpers/load");

function load() {
  const context = createContext({ document: makeDocumentStub() });
  loadScripts(context, [
    { file: "Pronunciation.js", exports: ["Pronunciation"] },
    { file: "CharacterInput.js", exports: ["SyllableInputModel"] },
    { file: "Sentence.js", exports: ["Sentence"] },
  ]);
  return context;
}

// 生 has two readings, 人 one.
function makeDico(context, words = []) {
  const P = context.Pronunciation;
  const prons = [
    new P({ simp: "生", trad: "生", initial: "s", final: "en", tone: "1" }),
    new P({ simp: "生", trad: "生", initial: "s", final: "ang", tone: "1" }),
    new P({ simp: "人", trad: "人", initial: "ng", final: "in", tone: "2" }),
    new P({ simp: "先", trad: "先", initial: "x", final: "ien", tone: "1" }),
  ];
  return {
    words: words.map((dataset) => ({ dataset })),
    getMatchesForSyllable: (syl) => prons.filter((p) => syl === p.initial + p.final || syl === p.initial + p.final + p.tone),
    getMatchesForHanzi: (char) => prons.filter((p) => p.simp === char),
  };
}

const plain = (s) => JSON.parse(JSON.stringify(s));

test("picking a polyphone pins the chosen reading; a single-reading character stays bare", () => {
  const context = load();
  const model = new context.SyllableInputModel(makeDico(context));

  model.parse("sen ngin2");
  const sen = model.suggestions.findIndex((s) => s.pron.final === "en");
  model.select(sen);
  assert.equal(model.text, "生(sen1) ngin2");

  model.select(0); // 人, the only suggestion left
  assert.equal(model.text, "生(sen1) 人");
});

test("with a lexicon, the pin depends on the lexicon only (not the dictionaries in use)", () => {
  const context = load();
  const P = context.Pronunciation;
  const dico = makeDico(context);
  // 人 is known to the dictionaries in use but not to the lexicon: pinned.
  dico.lexiconPronunciations = [new P({ simp: "生", trad: "生", initial: "s", final: "en", tone: "1" })];
  const model = new context.SyllableInputModel(dico);
  model.parse("ngin2 sen1");
  model.select(model.suggestions.findIndex((s) => s.pron.simp === "人"));
  assert.equal(model.text, "人(ngin2) sen1");
  // 生 has one lexicon reading, the one chosen: bare.
  model.select(model.suggestions.findIndex((s) => s.pron.simp === "生" && s.pron.final === "en"));
  assert.equal(model.text, "人(ngin2) 生");
});

test("parse() ignores pinned readings, :constraints and *comments*", () => {
  const context = load();
  const model = new context.SyllableInputModel(makeDico(context));
  model.parse("生(sen1) 好:bon *note* ngin2");
  assert.deepEqual([...model.syllables], ["ngin2"]);
});

test("replace() edits the syllable it was asked to, not the first identical one", () => {
  const context = load();
  const model = new context.SyllableInputModel(makeDico(context));
  model.parse("ngin2 ngin2");
  model.replace(1, "人");
  assert.equal(model.text, "ngin2 人");
});

test("pinnedReadings(): an annotation covers the run before it, right-aligned when shorter", () => {
  const { Sentence } = load();
  assert.deepEqual(plain(Sentence.pinnedReadings("生(sen1)")), ["sen1"]);
  assert.deepEqual(plain(Sentence.pinnedReadings("先生(sen1)")), [null, "sen1"]);
  assert.deepEqual(plain(Sentence.pinnedReadings("先(xien1)生(sen1)")), ["xien1", "sen1"]);
  assert.deepEqual(plain(Sentence.pinnedReadings("掃墳墓(sao4fun2mu4)")), ["sao4", "fun2", "mu4"]);
  assert.deepEqual(plain(Sentence.pinnedReadings("--(but5xin1)")), ["but5", "xin1"]);
  assert.deepEqual(plain(Sentence.pinnedReadings("好")), [null]);
});

test("a pinned reading picks the matching homophone entry and rules out the others", () => {
  const context = load();
  const dico = makeDico(context, [
    { simp: "生", trad: "生", pinyin: "sang1", initials: "s ", finals: "ang ", tones: "1 ", french: "naître" },
    { simp: "生", trad: "生", pinyin: "sen1", initials: "s ", finals: "en ", tones: "1 ", french: "cru" },
  ]);
  const s = new context.Sentence(dico, "生(sen1) 生");
  assert.equal(s.matches[0].length, 1);
  assert.equal(s.matches[0][0].dataset.french, "cru");
  assert.equal(s.matches[1].length, 2, "an unpinned 生 is still ambiguous");
  assert.equal(s.renderHanziLine(), "生生", "the annotation never shows in the hanzi line");
  // The unpinned one falls back to the usual best guess (shortest gloss).
  assert.equal(s.renderPinyinLine(), "sen¹ sen¹");
});

test("with no entry read that way, the token is unknown but keeps the pinned reading", () => {
  const context = load();
  const dico = makeDico(context, [
    { simp: "先生", trad: "先生", pinyin: "xien1sang1", initials: "x s ", finals: "ien ang ", tones: "1 1 ", french: "monsieur" },
  ]);
  const s = new context.Sentence(dico, "先生(sen1)");
  assert.ok(s.matches[0][0].isUnknown);
  assert.equal(s.renderPinyinLine(), "xien¹sen¹", "先 from the dictionary, 生 as pinned");
});
