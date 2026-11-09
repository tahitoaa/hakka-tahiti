// Tests for Romanization.js -- the client-side twin of hakkadbapp/romanization.py
// that converts stored (Wenfa) syllables into the transcription system picked
// in the header menu, driven by hakkadbapp/romanization.json.
//
// Run with: npm test   (see tests/README.md)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createContext, loadScripts } = require("./helpers/load");

const CONFIG_PATH = path.join(__dirname, "..", "hakkadbapp", "romanization.json");
const FIXTURE_PATH = path.join(__dirname, "fixtures", "romanization_expected.json");

function realConfig() {
  // Python reads the file in text mode (CRLF -> LF) before hashing it.
  const raw = fs.readFileSync(CONFIG_PATH, "utf8").replace(/\r\n/g, "\n");
  const config = JSON.parse(raw);
  // Same short hash romanization.load_config() adds.
  config._version = crypto.createHash("sha1").update(raw, "utf8").digest("hex").slice(0, 10);
  return config;
}

function loadRomanization(config) {
  const context = createContext();
  loadScripts(context, ["Romanization.js"]);
  return context.Romanization.load(config);
}

// A tiny hand-made config exercising every feature of the file format, so
// these tests don't break whenever the real mappings are edited.
const MINI = {
  default_system: "a",
  tones: { "1": "¹", "2": "²", "": "" },
  systems: [
    { id: "a", label: "A", initials: { b: "b", ng: "ng", "": "" }, finals: { a: "a", i: "i", ia: "ia" } },
    {
      id: "b",
      label: "B",
      tones: { "1": "˥" },
      initials: { b: "p", ng: "ŋ", "": "" },
      finals: { a: "ɑ", i: "i", ia: "ja", _comment: "ignored" },
      rules: [
        { when: { initial: "ng", final_startswith: "i", final_not: ["i"] }, then: { initial: "ŋj" } },
        { when: { initial: ["b"], final: "i" }, then: { final: "ɿ" } },
      ],
      syllables: { "+a": "ʔa" },
    },
  ],
};

test("maps initials, finals and tones; per-system tones override the shared ones", () => {
  const R = loadRomanization(MINI);
  assert.equal(R.convert("b", "a", "1", "a"), "ba¹");
  assert.equal(R.convert("b", "a", "1", "b"), "pɑ˥");
  assert.equal(R.convert("b", "a", "2", "b"), "pɑ²");
  assert.equal(R.convert("b", "a", "", "b"), "pɑ");
});

test("rules match on the stored notation and replace only what they name", () => {
  const R = loadRomanization(MINI);
  assert.equal(R.convert("ng", "ia", "1", "b"), "ŋjja˥");
  assert.equal(R.convert("ng", "i", "1", "b"), "ŋi˥"); // final_not excludes bare -i
  assert.equal(R.convert("b", "i", "", "b"), "pɿ");
});

test("whole-syllable overrides win, and the empty initial is written '+final'", () => {
  const R = loadRomanization(MINI);
  assert.equal(R.convert("", "a", "1", "b"), "ʔa˥");
});

test("unmapped parts are copied verbatim, unknown tones too", () => {
  const R = loadRomanization(MINI);
  assert.equal(R.convert("zz", "ou", "7", "b"), "zzou7");
});

test("convert() defaults to the current system, which set() changes", () => {
  const R = loadRomanization(MINI);
  assert.equal(R.current(), "a");
  assert.equal(R.convert("b", "a", "1"), "ba¹");
});

test("fromPinyin() re-splits stored strings, leaving what it can't parse", () => {
  const R = loadRomanization(MINI);
  assert.equal(R.fromPinyin("ba1nga2", "b"), "pɑ˥ŋɑ²");
  assert.equal(R.fromPinyin("ba1/ngia2 ?", "b"), "pɑ˥/ŋjja² ?");
  assert.equal(R.fromPinyin("xyz1", "b"), "xyz1");
});

test("fromPinyin() keeps words without tone that aren't a syllable (ma'a, tinito)", () => {
  const R = loadRomanization(MINI);
  assert.equal(R.fromPinyin("ba1 ma'a tinito", "b"), "pɑ˥ ma'a tinito");
  assert.equal(R.fromPinyin("ba", "b"), "pɑ", "a lone toneless syllable still converts");
});

test("fromDataset() uses the per-syllable data-initials/finals/tones, empty initial included", () => {
  const R = loadRomanization(MINI);
  // data-initials="b  " for [b, ""]: every syllable is followed by a space.
  assert.equal(R.fromDataset({ initials: "b  ", finals: "a a ", tones: "1 2 ", pinyin: "ba1a2" }, "b"), "pɑ˥ʔa²");
  // No per-syllable data: falls back to parsing `pinyin`.
  assert.equal(R.fromDataset({ pinyin: "ba1" }, "b"), "pɑ˥");
});

test("the real romanization.json loads and the default system is the stored notation", () => {
  const config = realConfig();
  const R = loadRomanization(config);
  assert.equal(R.current(), config.default_system);
  assert.equal(R.convert("ng", "ai", "2"), "ngai²");
  assert.equal(R.fromPinyin("ngai2 oi4"), "ngai² oi⁴");
});

test("Romanization.js agrees with romanization.py on every stored syllable", (t) => {
  const config = realConfig();
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  if (fixture.version !== config._version) {
    t.skip("romanization.json changed since the fixture was made: run `python manage.py check_romanization --fixture`");
    return;
  }
  const R = loadRomanization(config);
  const mismatches = fixture.cases
    .filter(([i, f, tone, sid, expected]) => R.convert(i, f, tone, sid) !== expected)
    .slice(0, 10);
  assert.deepEqual(mismatches, []);
});

test("Sentence shows the selected system but keeps the stored notation for renderPinyinLine()", () => {
  const context = createContext();
  loadScripts(context, ["Romanization.js", { file: "Sentence.js", exports: ["Sentence"] }]);
  context.Romanization.load({ ...MINI, default_system: "b" });
  const dico = {
    words: [{ dataset: { simp: "爸", trad: "爸", pinyin: "ba1", initials: "b ", finals: "a ", tones: "1 ", french: "papa" } }],
    getMatchesForHanzi: () => [],
  };
  const s = new context.Sentence(dico, "爸");
  assert.equal(s.renderPinyinLine(), "ba¹");
  assert.equal(s.renderDisplayPinyinLine(), "pɑ˥");
  assert.match(s.renderFurigana(), /pɑ˥/);
  assert.match(s.renderTokens(), /pɑ˥/);
});

test("fromPinyin() also reads superscript tones (Python's Pronunciation.pinyin() output)", () => {
  const R = loadRomanization(MINI);
  assert.equal(R.fromPinyin("ba¹ ?", "b"), "pɑ˥ ?");
  assert.equal(R.fromPinyin("ba¹nga²", "b"), "pɑ˥ŋɑ²");
});

test("refresh() rewrites every [data-py] element in the current system", () => {
  const R = loadRomanization({ ...MINI, default_system: "b" });
  const els = [{ attrs: { "data-py": "ba1" }, textContent: "ba¹" }, { attrs: { "data-py": "nga2 ?" }, textContent: "" }]
    .map((e) => ({ ...e, getAttribute: (k) => e.attrs[k] }));
  R.refresh({ querySelectorAll: (sel) => (sel === "[data-py]" ? els : []) });
  assert.deepEqual(els.map((e) => e.textContent), ["pɑ˥", "ŋɑ² ?"]);
});

test("Pronunciation's static helpers are the shared display entry point", () => {
  const context = createContext();
  loadScripts(context, ["Romanization.js", { file: "Pronunciation.js", exports: ["Pronunciation", "SourcePronunciation"] }]);
  const P = context.Pronunciation;
  // No config loaded yet: stored notation, superscript tones.
  assert.equal(P.format("b", "a", "1"), "ba¹");
  assert.equal(P.formatStored("ba1ba1"), "ba¹ba¹");

  context.Romanization.load({ ...MINI, default_system: "b" });
  assert.equal(P.format("b", "a", "1"), "pɑ˥");
  assert.equal(P.formatStored("ba1 / nga2"), "pɑ˥ / ŋɑ²");
  assert.equal(P.span("ba1", "py"), '<span class="py" data-py="ba1">pɑ˥</span>');
  assert.equal(new P({ simp: "爸", trad: "爸", initial: "b", final: "a", tone: "1" }).pinyinSpan(), '<span data-py="ba1">pɑ˥</span>');
  // A reading without a known system can't be converted: shown as spelled,
  // with its origin as a tooltip, and not tagged for refresh().
  const src = new context.SourcePronunciation({ simp: "客", trad: "客", syllable: "k'ak", tone: 7 });
  assert.equal(src.pinyinSpan(), `<span title="Dictionnaire : k'ak⁷">k'ak⁷</span>`);
});

test("Sentence badges carry data-py so they follow later switches without a re-render", () => {
  const context = createContext();
  loadScripts(context, ["Romanization.js", { file: "Sentence.js", exports: ["Sentence"] }]);
  context.Romanization.load({ ...MINI, default_system: "b" });
  const dico = {
    words: [{ dataset: { simp: "爸", trad: "爸", pinyin: "ba1", initials: "b ", finals: "a ", tones: "1 ", french: "papa" } }],
    getMatchesForHanzi: () => [],
  };
  const s = new context.Sentence(dico, "爸");
  assert.match(s.renderTokens(), /<span data-py="ba1">pɑ˥<\/span>/);
  assert.equal(s.renderDisplayPinyinLine(), "pɑ˥", "lines meant for copying stay plain text");
});
