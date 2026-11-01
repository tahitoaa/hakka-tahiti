// Tests for typing in another transcription system ("Saisie en…" menu of
// the converter/transcriber): Romanization.toStored() converts a typed
// syllable back into the stored (Wenfa) readings it can stand for, and the
// input model looks those up in the lexicon.
//
// Run with: npm test   (see tests/README.md)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createContext, loadScripts, makeDocumentStub } = require("./helpers/load");

const CONFIG_PATH = path.join(__dirname, "..", "hakkadbapp", "romanization.json");
const FIXTURE_PATH = path.join(__dirname, "fixtures", "romanization_expected.json");

function realConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8").replace(/\r\n/g, "\n");
  const config = JSON.parse(raw);
  config._version = crypto.createHash("sha1").update(raw, "utf8").digest("hex").slice(0, 10);
  return config;
}

function load() {
  const document = makeDocumentStub();
  document.dispatchEvent = document.dispatchEvent || (() => true);
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
  ]);
  context.Romanization.load(realConfig());
  return context;
}

// What someone types for a displayed form: tone digits instead of superscripts.
const typedForm = (shown) => shown.replace(/[¹²³⁴⁵⁶⁷⁸]/g, (c) => String("¹²³⁴⁵⁶⁷⁸".indexOf(c) + 1));
const has = (candidates, i, f, t) =>
  candidates.some((c) => c.initial === i && c.final === f && (c.tones === null || c.tones.includes(t)));

test("round trip: every stored syllable, typed as shown in each system, is found again", () => {
  const { Romanization } = load();
  const { cases } = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const misses = cases
    .filter(([, , tone]) => tone !== "")
    .filter(([i, f, tone, sid, shown]) => !has(Romanization.toStored(typedForm(shown), sid), i, f, tone))
    .slice(0, 10);
  assert.deepEqual(misses, []);
});

test("one spelling can stand for several stored syllables (ts'am <- cam / cham)", () => {
  const { Romanization } = load();
  const found = Romanization.toStored("ts'am1", "hakka_dict");
  assert.ok(has(found, "c", "am", "1") && has(found, "ch", "am", "1"));
  assert.deepEqual([...found[0].tones], ["1"]);
});

test("no tone typed, or '_': any tone", () => {
  const { Romanization } = load();
  assert.equal(Romanization.toStored("ts'am", "hakka_dict")[0].tones, null);
  assert.equal(Romanization.toStored("ts'am_", "hakka_dict")[0].tones, null);
});

test("plain-keyboard spellings are accepted for ε, ɔ, ŋ (Sagart)", () => {
  const { Romanization } = load();
  // Wenfa "ngong" is shown "ŋɔŋ" in Sagart.
  assert.ok(has(Romanization.toStored("ngong2", "sagart"), "ng", "ong", "2"));
  assert.ok(has(Romanization.toStored("ŋɔŋ2", "sagart"), "ng", "ong", "2"));
});

test("Bao'an tone digits use the derived input_tones (3 also finds Wenfa 4)", () => {
  const { Romanization } = load();
  const tones = [...Romanization.toStored("fan3", "baoan")[0].tones].sort();
  assert.deepEqual(tones, ["3", "4"]);
});

test("the input model suggests lexicon hanzi for a syllable typed in another system", () => {
  const context = load();
  const P = context.Pronunciation;
  const dico = Object.create(context.Dictionary.prototype);
  Object.assign(dico, {
    unknowns: new Set(),
    useLexicon: true,
    sources: [],
    lexiconWords: [],
    lexiconPronunciations: [
      new P({ simp: "参", trad: "參", initial: "c", final: "am", tone: "1" }),
      new P({ simp: "搀", trad: "攙", initial: "ch", final: "am", tone: "1" }),
      new P({ simp: "三", trad: "三", initial: "s", final: "am", tone: "1" }),
    ],
  });
  dico.rebuild();
  const model = new context.SyllableInputModel(dico);

  context.Romanization.setInput("hakka_dict");
  model.parse("ts'am1");
  assert.deepEqual([...model.syllables], ["ts'am1"]);
  assert.deepEqual([...model.suggestions.map((s) => s.pron.simp)].sort(), ["参", "搀"]);

  context.Romanization.setInput("wenfa");
  model.parse("cam1");
  assert.deepEqual([...model.suggestions.map((s) => s.pron.simp)], ["参"]);
});

test("McIver: ng before non-i finals stays ng (ngai2 = 我), ny before i, both typed and shown", () => {
  const { Romanization } = load();
  assert.ok(has(Romanization.toStored("ngai2", "mciver"), "ng", "ai", "2"));
  assert.ok(has(Romanization.toStored("nyin2", "mciver"), "ng", "in", "2"));
  assert.equal(Romanization.convert("ng", "ai", "2", "mciver"), "ngai²");
  assert.equal(Romanization.convert("ng", "in", "2", "mciver"), "nyin²");
});

test("McIver: attested spellings outside the mapping are typable (chi1 finds Wenfa ji1 and zhi1)", () => {
  const { Romanization } = load();
  const found = Romanization.toStored("chi1", "mciver");
  assert.ok(has(found, "j", "i", "1") && has(found, "zh", "i", "1"));
});
