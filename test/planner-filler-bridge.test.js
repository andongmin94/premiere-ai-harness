"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const planner = require("../plugin/lib/planner.js");

function segment(start, end, text, speaker = "") {
  return Object.freeze({ start, end, text, speaker });
}

function bridgedCandidate(plan) {
  return plan.candidates.find((item) => /필러 뒤 유사 반복/.test(item.reason));
}

test("suggests the earlier attempt plus one short filler when the same speech repeats", () => {
  const plan = planner.createEditPlan([
    segment(0, 1.1, "지원 자격을 확인하겠습니다", "host"),
    segment(1.2, 1.4, "어", "host"),
    segment(1.5, 2.6, "지원 자격을 확인하겠습니다", "host"),
    segment(2.8, 4, "다음 내용을 설명하겠습니다.", "host"),
  ], { duration: 4, preset: "balanced" });

  const duplicate = bridgedCandidate(plan);
  assert.ok(duplicate);
  assert.deepEqual([duplicate.start, duplicate.end], [0, 1.4]);
  assert.equal(duplicate.confidence, 0.89);
  assert.equal(plan.selectedIds.includes(duplicate.id), false);
  assert.deepEqual(plan.keepRanges, [{ start: 0, end: 4 }]);
  assert.deepEqual(planner.approveCandidates(plan, [duplicate.id]).keepRanges, [{ start: 1.4, end: 4 }]);
});

test("does not bridge a filler across a known speaker change", () => {
  const plan = planner.createEditPlan([
    segment(0, 1.1, "지원 자격을 확인하겠습니다", "host"),
    segment(1.2, 1.4, "어", "guest"),
    segment(1.5, 2.6, "지원 자격을 확인하겠습니다", "host"),
  ], { duration: 2.6, preset: "tight" });
  assert.equal(Boolean(bridgedCandidate(plan)), false);
});

test("does not bridge low-similarity speech even under the tight preset", () => {
  const plan = planner.createEditPlan([
    segment(0, 1.1, "지원 자격을 확인하겠습니다", "host"),
    segment(1.2, 1.4, "음", "host"),
    segment(1.5, 2.6, "지원 자격을 변경하겠습니다", "host"),
  ], { duration: 2.6, preset: "tight" });
  assert.equal(Boolean(bridgedCandidate(plan)), false);
});

test("does not bridge an unusually long filler segment", () => {
  const plan = planner.createEditPlan([
    segment(0, 1.1, "지원 자격을 확인하겠습니다", "host"),
    segment(1.2, 2.5, "어", "host"),
    segment(2.6, 3.7, "지원 자격을 확인하겠습니다", "host"),
  ], { duration: 3.7, preset: "tight" });
  assert.equal(Boolean(bridgedCandidate(plan)), false);
});
