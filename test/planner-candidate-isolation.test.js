"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const planner = require("../plugin/lib/planner.js");

function segment(start, end, text, speaker = "") {
  return Object.freeze({ start, end, text, speaker });
}

test("a high-confidence retake cannot promote an adjacent near-repeat into automatic deletion", () => {
  const plan = planner.createEditPlan([
    segment(0, 1, "지원 자격을 설명하겠습니다.", "host"),
    segment(1, 2, "오늘 지원 자격을 설명하겠습니다", "host"),
    segment(2, 2.6, "아 잠깐만 다시 할게요", "host"),
    segment(3, 10, "이제 본론을 이어가겠습니다.", "host"),
  ], { duration: 10, preset: "balanced" });

  const duplicate = plan.candidates.find((item) => item.type === "duplicate");
  const retake = plan.candidates.find((item) => item.type === "retake");
  assert.ok(duplicate);
  assert.ok(retake);
  assert.deepEqual([duplicate.start, duplicate.end], [0, 1]);
  assert.deepEqual([retake.start, retake.end], [1, 2.6]);
  assert.ok(duplicate.confidence < 0.9);
  assert.equal(retake.confidence, 0.99);
  assert.equal(plan.selectedIds.includes(duplicate.id), false);
  assert.equal(plan.selectedIds.includes(retake.id), true);
  assert.deepEqual(plan.keepRanges, [{ start: 0, end: 1 }, { start: 2.6, end: 10 }]);
});
