// Tests for GrammarAnalysis.js on top of the shared grammar module tumu-kin
// (vendor/tumu-kin, also used by tumuparau): the page's TagSet keeps its own
// <select> options and hints, the tree is drawn by tumu-kin with the words
// marked as Chinese (lang="zh"), as before the move.
// Run with: npm test   (see tests/README.md)
const test = require("node:test");
const assert = require("node:assert/strict");
const { createContext, loadScripts } = require("./helpers/load");

function load() {
  const context = createContext();
  loadScripts(context, ["../vendor/tumu-kin/tumu-kin.js", "GrammarAnalysis.js"]);
  return context;
}

const LIST = [
  { id: 1, kind: "category", code: "PRO", name: "pronom", parent: null, equivalent: "PRON" },
  { id: 2, kind: "category", code: "NÉG", name: "négation", parent: null, status: "proposed" },
  { id: 3, kind: "category", code: "V", name: "verbe", parent: null },
  { id: 4, kind: "category", code: "Vmvt", name: "verbe de mouvement", parent: 3 },
  { id: 5, kind: "phrase", code: "GN", name: "groupe nominal", parent: null },
  { id: 6, kind: "phrase", code: "GV", name: "groupe verbal", parent: null },
  { id: 7, kind: "function", code: "sujet", name: "sujet", parent: null },
  { id: 8, kind: "phrase", code: "P", name: "phrase", parent: null },
];
// 佢 唔 來 : [P [GN:sujet 佢/PRO] [GV 唔/NÉG 來/Vmvt]]
const TOKENS = [{ t: "佢", p: "ki2", c: 1, f: null }, { t: "唔", p: "m2", c: 2, f: null }, { t: "來", p: "loi2", c: 4, f: null }];
const GROUPS = [{ s: 0, e: 3, c: 8, f: null }, { s: 0, e: 1, c: 5, f: 7 }, { s: 1, e: 3, c: 6, f: null }];

test("GrammarAnalysis uses tumu-kin", () => {
  const { GrammarAnalysis: GA, TumuKin } = load();
  const tags = new GA.TagSet(LIST);
  assert.ok(tags instanceof TumuKin.TagSet);
  assert.equal(GA.bracketed(TOKENS, GROUPS, tags), "[P [GN:sujet 佢/PRO] [GV 唔/NÉG 來/Vmvt]]");
  assert.equal(GA.structure(TOKENS, GROUPS).top, 2);
});

test("the tree and the linear form mark the words as Chinese", () => {
  const { GrammarAnalysis: GA } = load();
  const tags = new GA.TagSet(LIST);
  const svg = GA.drawTree(TOKENS, GROUPS, tags, { selectedGroup: 2 });
  assert.match(svg, /class="ga-han" lang="zh">佢</);
  assert.match(svg, /ga-node is-sel" data-group="2"/);
  assert.match(GA.linear(TOKENS, tags, [1, 3]), /<span class="ga-lin is-mark"><span lang="zh">唔<\/span><sub>NÉG<\/sub>/);
});

test("the page's TagSet: options under their broader tag, AI-proposed, hints", () => {
  const { GrammarAnalysis: GA } = load();
  const tags = new GA.TagSet(LIST);
  const options = tags.options("category", 4, "catégorie ?");
  assert.match(options, /<option value="4" selected title="">  Vmvt — verbe de mouvement<\/option>/);
  assert.match(options, /NÉG — négation \(IA\)/);
  assert.match(options, /＋ nouvelle catégorie…<\/option>$/);
  assert.match(tags.hint(1), /<b>PRO<\/b> \(pronom\).*UD PRON/);
  assert.equal(tags.hint(42), "");
});
