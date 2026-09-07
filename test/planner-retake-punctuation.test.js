"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const planner = require("../plugin/lib/planner.js");

function segment(start, end, text, speaker = "") {
  return Object.freeze({ start, end, text, speaker });
}

test("includes an immediately preceding punctuated failed take after an explicit retake marker", () => {
  const plan = planner.createEditPlan([
    segment(0, 1.5, "지원 자격은 해당 권역 학생입니다.", "host"),
    segment(1.65, 2.2, "아 잠깐만 다시 할게요", "host"),
    segment(2.4, 4.2, "지원 자격은 해당 권역 학생을 대상으로 합니다.", "host"),
    segment(4.3, 8, "다음 내용을 설명하겠습니다.", "host"),
  ], { duration: 8, preset: "balanced" });

  const retake = plan.candidates.find((item) => item.type === "retake");
  assert.ok(retake);
  assert.deepEqual([retake.start, retake.end], [0, 2.2]);
  assert.equal(plan.selectedIds.includes(retake.id), true);
  assert.deepEqual(plan.keepRanges, [{ start: 2.2, end: 8 }]);
});

test("does not absorb a completed sentence when the pause before the retake marker is too long", () => {
  const plan = planner.createEditPlan([
    segment(0, 1.5, "앞 설명은 여기까지입니다.", "host"),
    segment(2.2, 2.7, "아 잠깐만 다시 할게요", "host"),
    segment(2.9, 5, "새로운 설명을 시작하겠습니다.", "host"),
  ], { duration: 5, preset: "balanced" });

  const retake = plan.candidates.find((item) => item.type === "retake");
  assert.ok(retake);
  assert.deepEqual([retake.start, retake.end], [2.2, 2.7]);
});

test("does not absorb a long completed sentence even when the retake marker follows immediately", () => {
  const plan = planner.createEditPlan([
    segment(0, 4.5, "이 문장은 정상적으로 끝난 비교적 긴 설명입니다.", "host"),
    segment(4.6, 5.1, "아 잠깐만 다시 할게요", "host"),
    segment(5.3, 8, "짧게 다시 설명하겠습니다.", "host"),
  ], { duration: 8, preset: "balanced" });

  const retake = plan.candidates.find((item) => item.type === "retake");
  assert.ok(retake);
  assert.deepEqual([retake.start, retake.end], [4.6, 5.1]);
});
