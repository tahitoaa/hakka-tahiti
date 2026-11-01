// Tests for sharing transcriptions: the segment list read by the group
// (TranscriptDocument.js, listening page + PDF) and the empty .eaf made
// from the participants' names (EafDocument.create).
//
// Run with: npm test   (see tests/README.md)
const test = require("node:test");
const assert = require("node:assert/strict");
const { createContext, loadScripts } = require("./helpers/load");

function load() {
  const context = createContext({ crypto: { randomUUID: () => "11111111-2222-3333-4444-555555555555" } });
  loadScripts(context, [
    { file: "TranscriptDocument.js", exports: ["TranscriptDocument"] },
    { file: "EafDocument.js", exports: ["EafDocument"] },
  ]);
  return context;
}

const transcript = {
  title: "Annette <1>",
  participants: [{ name: "Annette Levin", tier: "Annette" }, { name: "Aurélie", tier: "Aurélie" }],
  segments: [
    { start: 1200, end: 2500, speaker: 0, hanzi: "吾爸爸", pinyin: "nga ba ba", translation: "mon père", transcript: "吾(nga1) 爸(ba1)爸(ba1)" },
    { start: 3000, end: 4000, speaker: 1, hanzi: "", pinyin: "", translation: "", transcript: "十(ship6) 六 so_" },
    { start: 65000, end: 66000, speaker: 0, hanzi: "", pinyin: "", translation: "oui", transcript: "nga_ba_" },
  ],
};

test("hanzi: the Hanzi tier, else the transcript's characters, else nothing", () => {
  const { TranscriptDocument: T } = load();
  assert.equal(T.hanzi(transcript.segments[0]), "吾爸爸");
  assert.equal(T.hanzi(transcript.segments[1]), "十 六");
  assert.equal(T.hanzi(transcript.segments[2]), "");
});

test("time: m:ss, h:mm:ss past an hour", () => {
  const { TranscriptDocument: T } = load();
  assert.equal(T.time(65000), "1:05");
  assert.equal(T.time(3725000), "1:02:05");
});

test("renderSegments: one entry per segment, speaker, time, lines; text escaped", () => {
  const { TranscriptDocument: T } = load();
  const html = T.renderSegments(transcript);
  assert.equal((html.match(/class="tr-seg"/g) || []).length, 3);
  assert.match(html, /Annette Levin<\/span>\s*<span class="tr-when">0:01/);
  assert.match(html, /tr-hanzi" lang="zh">吾爸爸/);
  assert.match(html, /tr-pinyin">nga ba ba/);
  assert.match(html, /tr-fr" lang="fr">mon père/);
  // Not converted yet: the romanization, marked as such.
  assert.match(html, /tr-raw">nga_ba_/);
  assert.match(T.renderHeader(transcript), /Annette &lt;1&gt;/);
});

test("EafDocument.create: per participant a transcription tier and its four child tiers", () => {
  const { EafDocument } = load();
  const xml = EafDocument.create({
    participants: [{ name: "Annette Levin", tierId: "Annette" }],
    annotator: "Tahitoa",
    media: { name: "audio.wav", mime: "audio/x-wav" },
  });
  assert.match(xml, /<TIER ANNOTATOR="Tahitoa" LINGUISTIC_TYPE_REF="transcription" PARTICIPANT="Annette Levin" TIER_ID="Annette"\/>/);
  for (const [type, suffix] of [["traduction", "Traduction"], ["pinyin", "Pinyin"], ["mixed", "Mixed"], ["hanzi", "Hanzi"]]) {
    assert.match(xml, new RegExp(`LINGUISTIC_TYPE_REF="${type}" PARENT_REF="Annette" PARTICIPANT="Annette Levin" TIER_ID="Annette ${suffix}"`));
    assert.match(xml, new RegExp(`CONSTRAINTS="Symbolic_Association" GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="${type}"`));
  }
  assert.match(xml, /RELATIVE_MEDIA_URL="\.\/audio\.wav"/);
  assert.match(xml, /urn:nl-mpi-tools-elan-eaf:11111111-2222-3333-4444-555555555555/);
});
