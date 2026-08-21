"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const planner = require("../plugin/lib/planner.js");

function segment(start, end, text) { return Object.freeze({ start, end, text }); }

test("finds Korean retake signals and includes an incomplete previous phrase", () => {
  const plan = planner.createEditPlan([
    segment(0, 1.2, "이 전형은 지역에서 고등학교를"),
    segment(1.3, 2.0, "아 잠깐만 다시 할게요"),
    segment(2.4, 4.5, "지역인재전형은 해당 권역 학생을 대상으로 합니다."),
  ], { duration: 4.5, preset: "balanced" });
  const retake = plan.candidates.find((item) => item.type === "retake");
  assert.ok(retake);
  assert.equal(retake.start, 0);
  assert.equal(retake.end, 2);
  assert.equal(plan.selectedIds.includes(retake.id), false, "large high-confidence cuts must still require review when they exceed the preset safety budget");
});

test("finds long silence while preserving sentence-side breathing room", () => {
  const plan = planner.createEditPlan([
    segment(0, 1, "첫 문장입니다."),
    segment(3, 4, "다음 문장입니다."),
  ], { duration: 4, preset: "balanced" });
  const silence = plan.candidates.find((item) => item.type === "silence");
  assert.ok(silence);
  assert.equal(silence.start, 1.2);
  assert.equal(silence.end, 2.8);
});

test("detects consecutive filler segments and adjacent duplicates", () => {
  const plan = planner.createEditPlan([
    segment(0, 0.3, "어"),
    segment(0.35, 0.7, "음"),
    segment(1, 2, "지원 자격을 확인하겠습니다"),
    segment(2.1, 3.2, "지원 자격을 확인하겠습니다"),
  ], { duration: 3.2, preset: "tight" });
  assert.ok(plan.candidates.some((item) => item.reason.includes("필러")));
  assert.ok(plan.candidates.some((item) => item.reason.includes("반복")));
});

test("manual approval produces deterministic keep ranges", () => {
  const plan = {
    duration: 10,
    rules: planner.PRESETS.balanced,
    candidates: [
      { id: "a", start: 1, end: 2 },
      { id: "b", start: 2, end: 3 },
      { id: "c", start: 7, end: 8 },
    ],
  };
  const approved = planner.approveCandidates(plan, ["a", "b", "c"]);
  assert.deepEqual(approved.keepRanges, [{ start: 0, end: 1 }, { start: 3, end: 7 }, { start: 8, end: 10 }]);
  assert.equal(approved.stats.deletedSeconds, 3);
});

test("rejects excessive deletion and empty input", () => {
  assert.throws(() => planner.createEditPlan([], {}), /전사 구간/);
  const plan = {
    duration: 10,
    rules: planner.PRESETS.conservative,
    candidates: [{ id: "all", start: 0, end: 5 }],
  };
  assert.throws(() => planner.approveCandidates(plan, ["all"]), /안전 상한/);
});

test("similarity is token based and language agnostic", () => {
  assert.equal(planner.textSimilarity("서울대학교 학생부 전형", "서울대학교 학생부 전형"), 1);
  assert.ok(planner.textSimilarity("let us start again", "let us start over") > 0.5);
  assert.equal(planner.textSimilarity("", "anything"), 0);
});
