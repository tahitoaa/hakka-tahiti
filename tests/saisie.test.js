// Tests for the "Saisie" form model (SaisieEntry in Saisie.js): the same
// algorithm as the "Écrire" page -- a picked suggestion replaces its
// syllable in the text (SyllableInputModel), Sentence then gives the stored
// pinyin, the mixed line and the lexicon words matched.
//
// Run with: npm test   (see tests/README.md)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createContext, loadScripts, makeDocumentStub } = require("./helpers/load");

const CONFIG_PATH = path.join(__dirname, "..", "hakkadbapp", "romanization.json");

function load() {
  const document = makeDocumentStub();
  document.dispatchEvent = () => true;
  const context = createContext({
    document,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    localStorage: { getItem: () => null, setItem: () => {} },
  });
  loadScripts(context, [
    "Romanization.js",
    { file: "Pronunciation.js", exports: ["Pronunciation"] },
    { file: "Word.js", exports: ["Word"] },
    { file: "Dictionary.js", exports: ["Dictionary"] },
    { file: "CharacterInput.js", exports: ["SyllableInputModel"] },
    { file: "Sentence.js", exports: ["Sentence"] },
    { file: "Saisie.js", exports: ["SaisieEntry"] },
  ]);
  context.Romanization.load(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
  context.Romanization.setInput("wenfa");

  const P = context.Pronunciation;
  const dico = Object.create(context.Dictionary.prototype);
  Object.assign(dico, {
    unknowns: new Set(),
    useLexicon: true,
    sources: [],
    lexiconPronunciations: [
      new P({ simp: "屋", trad: "屋", initial: "w", final: "uk", tone: "5" }),
      new P({ simp: "家", trad: "家", initial: "k", final: "a", tone: "1" }),
      new P({ simp: "参", trad: "參", initial: "c", final: "am", tone: "1" }),
      new P({ simp: "搀", trad: "攙", initial: "ch", final: "am", tone: "1" }),
      new P({ simp: "我", trad: "我", initial: "ng", final: "ai", tone: "1" }),
      new P({ simp: "爱", trad: "愛", initial: "", final: "oi", tone: "4" }),
      new P({ simp: "生", trad: "生", initial: "s", final: "en", tone: "1" }),
      new P({ simp: "生", trad: "生", initial: "s", final: "ang", tone: "1" }),
    ],
    lexiconWords: [
      { dataset: { simp: "屋家", trad: "屋家", pinyin: "wuk5ka1", initials: "w k ", finals: "uk a ", tones: "5 1 ", french: "maison" } },
    ],
  });
  dico.rebuild();
  return { context, dico, entry: new context.SaisieEntry(dico) };
}

/** Picks `char` among the suggestions of the first pending syllable. */
function pickChar(entry, char) {
  const s = entry.suggestions(0).find((x) => x.pron.simp === char);
  assert.ok(s, `no suggestion ${char} for ${entry.syllables[0]}`);
  entry.pick(s.index);
}

test("ngai_ then 我 picked: rendered ngai1 + 我, as on the Écrire page", () => {
  const { entry } = load();
  entry.setText("ngai_", "word");
  pickChar(entry, "我");
  assert.equal(entry.text, "我");
  assert.deepEqual({ ...entry.values() }, { kind: "word", hanzi: "我", pinyin: "ngai1" });
  const mixed = entry.mixed();
  assert.equal(mixed.hanzi, "我");
  assert.match(mixed.pinyin, /^ngai(1|¹)$/);
  assert.equal(entry.problem(), "");
});

test("a polyphone picked is pinned in the text (生(sen1)), like the converter does", () => {
  const { entry } = load();
  entry.setText("sen1", "word");
  pickChar(entry, "生");
  assert.equal(entry.text, "生(sen1)");
  assert.equal(entry.values().pinyin, "sen1");
  assert.equal(entry.values().hanzi, "生");
});

test("typed in another system: suggestions from 'Je tape en', stored in Wenfa", () => {
  const { context, entry } = load();
  context.Romanization.setInput("hakka_dict");
  entry.setText("ts'am1", "word");
  assert.deepEqual([...entry.suggestions(0).map((s) => s.pron.simp)].sort(), ["参", "搀"]);
  pickChar(entry, "搀");
  assert.equal(entry.values().pinyin, "cham1");
});

test("a character typed for a syllable: pinned with its reading, unless ambiguous", () => {
  const { context, entry } = load();
  entry.setText("sam1", "word");
  assert.equal(entry.type(0, "三"), true);
  assert.equal(entry.text, "三(sam1)");
  assert.equal(entry.values().pinyin, "sam1");

  context.Romanization.setInput("hakka_dict");
  entry.setText("ts'am1", "word");
  assert.equal(entry.type(0, "三"), false); // cam1 or cham1?
  assert.equal(entry.text, "ts'am1");
});

test("saving is blocked while syllables remain", () => {
  const { entry } = load();
  entry.setText("ngai_ oi4", "expression");
  pickChar(entry, "我");
  assert.match(entry.problem(), /Il reste à convertir : oi4/);
});

test("expression: each word checked against the lexicon by Sentence", () => {
  const { entry } = load();
  entry.setText("ngai_ oi4 wuk5ka1 wuk5ka2", "expression");
  ["我", "爱", "屋", "家", "屋"].forEach((c) => pickChar(entry, c));
  assert.equal(entry.type(0, "家"), true); // ka2: not a reading the lexicon has
  assert.equal(entry.text, "我 爱 屋家 屋家(ka2)");
  const additions = [{ kind: "word", status: "review", hanzi: "爱", pinyin: "oi4", french: "aimer" }];
  assert.deepEqual([...entry.check(additions).map((c) => `${c.hanzi} ${c.pinyin} ${c.status}`)], [
    "我 ngai1 unknown",
    "爱 oi4 proposed",
    "屋家 wuk5ka1 known",
    "屋家 wuk5ka2 reading",   // same characters, another reading than the lexicon's
  ]);
  assert.deepEqual({ ...entry.values() }, { kind: "expression", hanzi: "我 爱 屋家 屋家", pinyin: "ngai1 oi4 wuk5ka1 wuk5ka2" });
});

test("boxes: characters with their reading, pending syllables, grouped by word", () => {
  const { entry } = load();
  entry.setText("ngai_ 屋家", "expression");
  const groups = entry.units().map((g) => [...g.map((u) => (u.type === "syl" ? `[${u.syl}]` : `${u.char}:${u.reading}`))]);
  assert.deepEqual([...groups], [["[ngai_]"], ["屋:wuk5", "家:ka1"]]);
});

function loadAdditionList() {
  const context = createContext({ document: makeDocumentStub() });
  loadScripts(context, [{ file: "AdditionList.js", exports: ["AdditionList"] }]);
  return context;
}

test("platform rendering: no spaces, no :sense hint, Chinese punctuation in the characters, Latin in the pinyin", () => {
  const ctx = loadAdditionList();
  assert.equal(ctx.AdditionList.platformHanzi("活到老 , 读到老 ?"), "活到老，读到老？");
  assert.equal(ctx.AdditionList.platformHanzi("我 把:prendre 书"), "我把书");
  assert.equal(ctx.AdditionList.platformPinyin("fat6 dao4 lao3 ， tuk6"), "fat⁶ dao⁴ lao³ , tuk⁶");
});

test("an addition reopened with the lexicon: a reading is written only where needed", () => {
  const { context } = load();
  const P = context.Pronunciation;
  const dico = { lexiconPronunciations: [
    new P({ simp: "屋", trad: "屋", initial: "w", final: "uk", tone: "5" }),
    new P({ simp: "家", trad: "家", initial: "k", final: "a", tone: "1" }),
    new P({ simp: "生", trad: "生", initial: "s", final: "en", tone: "1" }),
    new P({ simp: "生", trad: "生", initial: "s", final: "ang", tone: "1" }),
  ] };
  const SaisieEntry = context.SaisieEntry;
  assert.equal(SaisieEntry.textFromStored("屋家", "wuk5ka1", "word", dico), "屋家");
  assert.equal(SaisieEntry.textFromStored("屋家 生", "wuk5ka1 sang1", "expression", dico), "屋家 生(sang1)");
  assert.equal(SaisieEntry.textFromStored("人", "ngin2", "word", dico), "人(ngin2)");      // unknown to the lexicon
  assert.equal(SaisieEntry.textFromStored("屋", "wuk6", "word", dico), "屋(wuk6)");       // another reading than the lexicon's
});

test("an addition edited: read back with its stored readings pinned", () => {
  const { context, entry } = load();
  context.Romanization.setInput("hakka_dict");
  const SaisieEntry = context.SaisieEntry;
  assert.equal(SaisieEntry.textFromStored("屋家", "wuk5ka1", "word"), "屋家(wuk5ka1)");
  assert.equal(SaisieEntry.textFromStored("我 屋家", "ngai1 wuk5ka1", "expression"), "我(ngai1) 屋家(wuk5ka1)");
  entry.setText(SaisieEntry.textFromStored("屋家", "wuk5ka1", "word"), "word");
  assert.equal(entry.values().pinyin, "wuk5ka1");
  assert.equal(entry.check()[0].status, "known");
});
