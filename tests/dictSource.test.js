// Tests for the converter's alternative pronunciation source (the Bao'an
// dictionary index, hakka_dict_prons.json): Dictionary.useSource(),
// SourcePronunciation, and how CharacterInput/Sentence handle its notation
// (apostrophe aspiration, tones 7/8, no Wenfa conversion).
//
// Run with: npm test   (see tests/README.md)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createContext, loadScripts, makeEl, makeDocumentStub } = require("./helpers/load");

const DICT_FILE = path.join(__dirname, "..", "hakkadbapp", "static", "hakkadbapp", "data", "hakka_dict_prons.json");

function setup() {
  const context = createContext({
    document: makeDocumentStub({
      bySelector: {
        "#pron-list > li": [makeEl({ dataset: { search: "屋,屋,w,uk,5" } })],
        "#word-list > li": [makeEl({ dataset: { simp: "屋家", trad: "屋家", pinyin: "wuk5ga1", french: "maison" } })],
      },
    }),
  });
  loadScripts(context, [
    { file: "Pronunciation.js", exports: ["Pronunciation", "SourcePronunciation"] },
    { file: "Word.js", exports: ["Word"] },
    { file: "Dictionary.js", exports: ["Dictionary"] },
    { file: "CharacterInput.js", exports: ["SyllableInputModel"] },
    { file: "Sentence.js", exports: ["Sentence"] },
  ]);
  const dico = new context.Dictionary({ containerId: "#pron-list", itemSelector: "li" });
  const src = (trad, syllable, tone, simp) => new context.SourcePronunciation({ trad, simp: simp || trad, syllable, tone });
  return { context, dico, src };
}

test("useSource() swaps pronunciations and drops words; useSource(null) restores the lexicon", () => {
  const { dico, src } = setup();
  dico.useSource([src("屋", "wuk", 7), src("家", "ka", 1)]);
  assert.equal(dico.useLexicon, false);
  assert.equal(dico.pronunciations.length, 2);
  assert.equal(dico.words.length, 0);
  assert.equal(dico.getMatchesForSyllable("wuk5").length, 0, "Wenfa readings are gone");

  dico.useSource(null);
  assert.equal(dico.useLexicon, true);
  assert.equal(dico.getMatchesForSyllable("wuk5").length, 1);
  assert.equal(dico.words.length, 1);
});

test("useSources(): lexicon and dictionaries together, words kept, one suggestion per character and reading", () => {
  const { dico, src } = setup();
  dico.useSources({ lexicon: true, sources: [{ id: "baoan", short: "B", system: null, prons: [src("屋", "wuk", 7), src("家", "ka", 1)] }] });
  assert.equal(dico.pronunciations.length, 3, "lexicon 屋 + the dictionary's two readings");
  assert.equal(dico.words.length, 1, "the lexicon's words stay available");
  const found = dico.suggestionsFor("wuk5", null);
  assert.deepEqual([...found.map((e) => JSON.stringify([e.pron.trad, [...e.sources]]))], [JSON.stringify(["屋", ["L"]])]);
});

test("SourcePronunciation keeps the syllable whole and superscripts tones 7/8", () => {
  const { src } = setup();
  const p = src("客", "k'ak", 7);
  assert.equal(p.abstractPinyin(), "k'ak⁷");
  assert.equal(p.displayPinyin(), "k'ak⁷");
});

test("typed input with apostrophes and tones 7/8 finds the source readings", () => {
  const { context, dico, src } = setup();
  dico.useSource([src("客", "k'ak", 7), src("食", "sit", 8), src("家", "ka", 1)]);
  const model = new context.SyllableInputModel(dico);
  model.parse("k'ak7 sit8 ka_");
  assert.deepEqual([...model.syllables], ["k'ak7", "sit8", "ka_"]);
  assert.deepEqual([...model.suggestions.map((s) => s.pron.simp)], ["客", "食", "家"]);
});

test("Sentence shows source readings as-is, character by character", () => {
  const { context, dico, src } = setup();
  dico.useSource([src("屋", "wuk", 7), src("家", "ka", 1)]);
  const s = new context.Sentence(dico, "屋家");
  assert.equal(s.renderDisplayPinyinLine(), "wuk⁷ka¹");
});

test("the built hakka_dict_prons.json has the expected shape", () => {
  const data = JSON.parse(fs.readFileSync(DICT_FILE, "utf8"));
  assert.ok(data.prons.length > 10000);
  for (const row of data.prons.slice(0, 200)) {
    assert.ok(row.length === 3 || row.length === 4);
    assert.match(row[1], /^[a-z']+$/);
    assert.ok([1, 2, 3, 5, 7, 8].includes(row[2]));
  }
});

// --- Typing Wenfa in dictionary mode (readings found via their Wenfa
// equivalents, through the "baoan" system of romanization.json) -----------

function setupWithRomanization(dictFile = DICT_FILE, system = "baoan") {
  const crypto = require("node:crypto");
  const raw = fs.readFileSync(path.join(__dirname, "..", "hakkadbapp", "romanization.json"), "utf8").replace(/\r\n/g, "\n");
  const config = JSON.parse(raw);
  config._version = crypto.createHash("sha1").update(raw, "utf8").digest("hex").slice(0, 10);
  const document = makeDocumentStub({ bySelector: { "#pron-list > li": [], "#word-list > li": [] } });
  document.dispatchEvent = () => true;
  document.documentElement = { setAttribute: () => {} };
  const context = createContext({
    document,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    localStorage: { getItem: () => null, setItem: () => {} },
  });
  loadScripts(context, [
    "Romanization.js",
    { file: "Pronunciation.js", exports: ["Pronunciation", "SourcePronunciation"] },
    { file: "Word.js", exports: ["Word"] },
    { file: "Dictionary.js", exports: ["Dictionary"] },
    { file: "CharacterInput.js", exports: ["SyllableInputModel"] },
    { file: "Sentence.js", exports: ["Sentence"] },
  ]);
  context.Romanization.load(config);
  const dico = new context.Dictionary({ containerId: "#pron-list", itemSelector: "li" });
  const data = JSON.parse(fs.readFileSync(dictFile, "utf8"));
  const prons = data.prons.map(([trad, syllable, tone, simp]) =>
    new context.SourcePronunciation({ trad, simp: simp || trad, syllable, tone }));
  dico.useSource(prons, { system });
  return { context, dico, model: new context.SyllableInputModel(dico) };
}

const chars = (model) => [...new Set(model.suggestions.map((s) => s.pron.trad))];

test("dictionary mode, Saisie en Wenfa: Wenfa spelling finds the Bao'an readings", () => {
  const { context, model } = setupWithRomanization();
  context.Romanization.setInput("wenfa");
  model.parse("ga1");            // Wenfa ga1 = Bao'an ka¹ (家)
  assert.ok(chars(model).includes("家"));
  model.parse("wuk5");           // Wenfa wuk5 = Bao'an wuk⁷ (屋)
  assert.ok(chars(model).includes("屋"));
  model.parse("hak5");           // Wenfa hak5 = Bao'an hak⁷ (客)
  assert.ok(chars(model).includes("客"));
});

test("dictionary mode, Saisie en Wenfa: tone 4 finds Bao'an ⁵ and ³ readings, no tone finds all", () => {
  const { context, model } = setupWithRomanization();
  context.Romanization.setInput("wenfa");
  model.parse("fan4");           // 飯 is fan³ in the Bao'an dictionary
  assert.ok(chars(model).includes("飯"));
  model.parse("ngai_");
  assert.ok(chars(model).includes("我"));
});

test("dictionary mode, Saisie en Bao'an: the dictionary's own spelling still works", () => {
  const { context, model } = setupWithRomanization();
  context.Romanization.setInput("baoan");
  model.parse("k'ak7");
  assert.ok(chars(model).includes("客"));
  model.parse("ga1");            // Wenfa spelling isn't Bao'an: nothing
  assert.equal(model.suggestions.length, 0);
});

// --- Pinned readings are always written in Wenfa ---------------------------

function pick(model, typed, trad, syllable, tone) {
  model.parse(typed);
  const i = model.suggestions.findIndex((s) => s.pron.trad === trad && s.pron.initial === syllable && String(s.pron.tone) === String(tone));
  assert.ok(i >= 0, `suggestion ${trad} ${syllable}${tone} pour « ${typed} »`);
  model.select(i);
  return model.text;
}

test("dictionary mode: picking a polyphone pins its reading in Wenfa, not Bao'an", () => {
  const { context, model } = setupWithRomanization();
  context.Romanization.setInput("wenfa");
  assert.equal(pick(model, "ga1", "家", "ka", 1), "家(ga1)");   // Bao'an ka¹ -> Wenfa ga1
  context.Romanization.setInput("baoan");
  assert.equal(pick(model, "ka1", "家", "ka", 1), "家(ga1)");   // typed in Bao'an, pinned in Wenfa
});

test("dictionary mode: the Wenfa reading comes from the lexicon first, then what was typed, then the likeliest tone", () => {
  const { context, dico, model } = setupWithRomanization();
  const S = context.SourcePronunciation;
  // 飯 read fan³ or fan⁵ in the dictionary; Bao'an ³ can be Wenfa 3 or 4.
  dico.useSource([new S({ trad: "飯", simp: "饭", syllable: "fan", tone: 3 }), new S({ trad: "飯", simp: "饭", syllable: "fan", tone: 5 })], { system: "baoan" });
  context.Romanization.setInput("wenfa");

  assert.equal(pick(model, "fan_", "飯", "fan", 3), "饭(fan3)", "no lexicon, no typed tone: exact reverse of ³ is Wenfa 3");
  assert.equal(pick(model, "fan4", "飯", "fan", 3), "饭(fan4)", "typed fan4 fits ³: kept");

  dico.lexiconPronunciations = [new context.Pronunciation({ simp: "饭", trad: "飯", initial: "f", final: "an", tone: "4" })];
  assert.equal(pick(model, "fan_", "飯", "fan", 3), "饭", "the lexicon knows 飯 only as fan4, the reading chosen: nothing to write");
  dico.lexiconPronunciations.push(new context.Pronunciation({ simp: "饭", trad: "飯", initial: "f", final: "an", tone: "3" }));
  assert.equal(pick(model, "fan4", "飯", "fan", 3), "饭(fan4)", "two lexicon readings: the one chosen is written");
});

test("dictionary mode: a Wenfa pin follows the display system like everything else", () => {
  const { context, dico } = setupWithRomanization();
  const s = new context.Sentence(dico, "家(ga1)");
  assert.equal(s.renderPinyinLine(), "ga¹", "stored notation");
  assert.equal(s.renderDisplayPinyinLine(), "ga¹", "displayed in Wenfa");
  context.Romanization.set("baoan");
  assert.equal(s.renderDisplayPinyinLine(), "ka¹", "displayed in Bao'an");
});

test("a dictionary reading is shown in its own spelling when that's the display system, else converted", () => {
  const { context, dico } = setupWithRomanization();
  const ka = dico.sources[0].prons.find((p) => p.trad === "家" && p.initial === "ka");
  assert.equal(ka.storedPinyin(), "ga¹", "its Wenfa equivalent");
  assert.equal(ka.displayPinyin(), "ga¹", "display system Wenfa: converted");
  context.Romanization.set("baoan");
  assert.equal(ka.displayPinyin(), "ka¹", "display system Bao'an: the dictionary's own spelling");
  context.Romanization.set("mciver");
  assert.equal(ka.displayPinyin(), "ka¹", "display system McIver: Wenfa ga1 converted (McIver also writes ka)");
});

// --- McIver index: same dictionary mode, another source ---------------------

const MCIVER_FILE = path.join(__dirname, "..", "hakkadbapp", "static", "hakkadbapp", "data", "mciver_prons.json");

test("the built mciver_prons.json has the expected shape (tones on the Bao'an scale)", () => {
  const data = JSON.parse(fs.readFileSync(MCIVER_FILE, "utf8"));
  assert.equal(data.meta.source, "mciver");
  assert.ok(data.prons.length > 10000);
  for (const row of data.prons) {
    assert.match(row[1], /^[a-zṳ]+$/);
    assert.ok([1, 2, 3, 5, 7, 8].includes(row[2]), `${row[0]} ${row[1]} ${row[2]}`);
    // Entering tones only on -p/-t/-k, and only there.
    assert.equal([7, 8].includes(row[2]), /[ptk]$/.test(row[1]), `${row[0]} ${row[1]}${row[2]}`);
  }
});

test("McIver mode: Wenfa spelling finds McIver readings, McIver spelling works too", () => {
  const { context, model } = setupWithRomanization(MCIVER_FILE, "mciver");
  context.Romanization.setInput("wenfa");
  model.parse("wuk5");           // Wenfa wuk5 = McIver vuk (yinru)
  assert.ok(chars(model).includes("屋"));
  model.parse("ga1");
  assert.ok(chars(model).includes("家"));
  context.Romanization.setInput("mciver");
  model.parse("khak7");          // McIver's own spelling: aspiration as h
  assert.ok(chars(model).includes("客"));
});

test("McIver mode: a picked polyphone is pinned in Wenfa and shown as the McIver reading", () => {
  const { context, dico, model } = setupWithRomanization(MCIVER_FILE, "mciver");
  context.Romanization.setInput("wenfa");
  assert.equal(pick(model, "ga1", "家", "ka", 1), "家(ga1)");
  const s = new context.Sentence(dico, "家(ga1)");
  assert.equal(s.renderPinyinLine(), "ga¹", "stored notation, displayed in the display system");
});
