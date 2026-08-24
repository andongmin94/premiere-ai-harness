"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const transcript = require("../plugin/lib/transcript.js");

test("parses SRT and normalizes caption markup", () => {
  const segments = transcript.parseTranscript(`1\n00:00:00,000 --> 00:00:01,250\n<b>안녕하세요</b> &amp; 반갑습니다\n\n2\n00:00:02,000 --> 00:00:03,500\n두 번째 문장`);
  assert.deepEqual(segments.map(({ start, end, text }) => ({ start, end, text })), [
    { start: 0, end: 1.25, text: "안녕하세요 & 반갑습니다" },
    { start: 2, end: 3.5, text: "두 번째 문장" },
  ]);
  assert.equal(Object.isFrozen(segments), true);
});

test("parses WebVTT cue identifiers, settings, and NOTE blocks", () => {
  const segments = transcript.parseTranscript(`WEBVTT\n\nNOTE ignored\nmetadata\n\nintro\n00:00.000 --> 00:01.500 align:start\nHello world\n\n00:02.000 --> 00:03.250\nSecond cue`, "vtt");
  assert.deepEqual(segments.map(({ start, end, text }) => ({ start, end, text })), [
    { start: 0, end: 1.5, text: "Hello world" },
    { start: 2, end: 3.25, text: "Second cue" },
  ]);
});


test("accepts WebVTT header metadata before the first blank line", () => {
  const segments = transcript.parseWebVtt(`WEBVTT - export\nKind: captions\nLanguage: ko\n\n00:00.000 --> 00:01.000\n안녕하세요`);
  assert.equal(segments[0].text, "안녕하세요");
});

test("rejects malformed SRT and WebVTT blocks instead of silently skipping them", () => {
  assert.throws(() => transcript.parseSrt("1\nmissing timing\ntext"), /타임코드/);
  assert.throws(() => transcript.parseSrt("1\n00:00:00,000 --> 00:00:01,000"), /텍스트/);
  assert.throws(() => transcript.parseWebVtt("WEBVTT\n\nbad cue\ntext"), /타임코드/);
  assert.throws(() => transcript.parseWebVtt("NOPE\n\n00:00.000 --> 00:01.000\ntext"), /헤더/);
});

test("prefers transcript arrays over longer metadata arrays", () => {
  const metadata = Array.from({ length: 20 }, (_, index) => ({ start: index, end: index + 0.5, value: `meta-${index}` }));
  const segments = transcript.parseTranscriptJson({
    metadata,
    transcript: {
      segments: [
        { startTime: { seconds: 0.2 }, endTime: { seconds: 1.3 }, text: "첫 문장", speakerName: "A" },
        { startTime: "00:01.500", endTime: "00:02.700", words: [{ word: "둘째" }, { word: "문장" }] },
      ],
    },
  });
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, "첫 문장");
  assert.equal(segments[0].speaker, "A");
  assert.equal(segments[1].text, "둘째 문장");
});

test("supports start plus duration JSON segments", () => {
  const segments = transcript.parseTranscriptJson({ segments: [
    { start: 1.25, duration: 0.75, text: "duration based" },
  ] });
  assert.deepEqual({ start: segments[0].start, end: segments[0].end }, { start: 1.25, end: 2 });
});

test("rejects empty, malformed, invalid timing, and value-only untrusted JSON", () => {
  assert.throws(() => transcript.parseTranscript(""), /비어/);
  assert.throws(() => transcript.parseTranscript("not a transcript"), /형식/);
  assert.throws(() => transcript.parseSrt("1\n00:00:02,000 --> 00:00:01,000\nwrong"), /종료 시간/);
  assert.throws(() => transcript.normalizeSegments([{ start: -1, end: 1, text: "bad" }]), /시간/);
  assert.throws(() => transcript.normalizeSegments([{ start: 0, end: 1, text: "" }]), /텍스트/);
  assert.throws(() => transcript.parseTranscriptJson({ metadata: [{ start: 0, end: 1, value: "not transcript" }] }), /찾지 못했습니다/);
});

test("accepts numeric seconds and clock strings in generic JSON", () => {
  const segments = transcript.parseTranscript(JSON.stringify({ segments: [
    { in: "0.125", out: "1.500", caption: "one" },
    { begin: "00:01.750", finish: "00:02.250", transcript: "two" },
  ] }));
  assert.deepEqual(segments.map(({ start, end }) => ({ start, end })), [
    { start: 0.125, end: 1.5 },
    { start: 1.75, end: 2.25 },
  ]);
});
