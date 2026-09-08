"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const planner = require("../plugin/lib/planner.js");

function segment(start, end, text, speaker = "") {
  return Object.freeze({ start, end, text, speaker });
}

test("detects leading and trailing silence while preserving speech-side breathing room", () => {
  const plan = planner.createEditPlan([
    segment(2, 8, "중간 대사입니다.", "host"),
  ], { duration: 10, preset: "balanced" });

  const silences = plan.candidates.filter((item) => item.type === "silence");
  assert.equal(silences.length, 2);
  assert.deepEqual(silences.map(({ start, end }) => [start, end]), [[0, 1.8], [8.2, 10]]);
  assert.match(silences[0].reason, /시작 무음/);
  assert.match(silences[1].reason, /끝 무음/);
  assert.equal(plan.selectedIds.includes(silences[0].id), true);
  assert.equal(plan.selectedIds.includes(silences[1].id), true);
  assert.deepEqual(plan.keepRanges, [{ start: 1.8, end: 8.2 }]);
});

test("does not suggest edge silence below the active preset threshold", () => {
  const plan = planner.createEditPlan([
    segment(0.7, 9.3, "가장자리 여백은 짧습니다.", "host"),
  ], { duration: 10, preset: "balanced" });

  assert.equal(plan.candidates.some((item) => /시작 무음|끝 무음/.test(item.reason)), false);
});

test("keeps the existing two-sided breathing room for internal silence", () => {
  const plan = planner.createEditPlan([
    segment(0, 1, "첫 문장입니다.", "host"),
    segment(3, 4, "다음 문장입니다.", "host"),
  ], { duration: 4, preset: "balanced" });

  const silence = plan.candidates.find((item) => item.type === "silence");
  assert.ok(silence);
  assert.deepEqual([silence.start, silence.end], [1.2, 2.8]);
});
