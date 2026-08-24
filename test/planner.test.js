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
  assert.equal(plan.selectedIds.includes(retake.id), false);
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
    segment(0, 0.3, "어"), segment(0.35, 0.7, "음"),
    segment(1, 2, "지원 자격을 확인하겠습니다"),
    segment(2.1, 3.2, "지원 자격을 확인하겠습니다"),
  ], { duration: 3.2, preset: "tight" });
  assert.ok(plan.candidates.some((item) => item.reason.includes("필러")));
  assert.ok(plan.candidates.some((item) => item.reason.includes("반복")));
});

test("manual approval preserves the entire source duration", () => {
  const plan = {
    duration: 10,
    rules: planner.PRESETS.balanced,
    candidates: [
      { id: "a", start: 1, end: 2 }, { id: "b", start: 2, end: 3 }, { id: "c", start: 7, end: 8 },
    ],
  };
  const approved = planner.approveCandidates(plan, ["a", "b", "c"]);
  assert.deepEqual(approved.keepRanges, [{ start: 0, end: 1 }, { start: 3, end: 7 }, { start: 8, end: 10 }]);
  assert.equal(approved.stats.deletedSeconds + approved.stats.keptSeconds, approved.stats.duration);
});

test("rejects excessive deletion, unknown ids, duplicate ids, and empty input", () => {
  assert.throws(() => planner.createEditPlan([], {}), /전사 구간/);
  const plan = { duration: 10, rules: planner.PRESETS.conservative, candidates: [{ id: "all", start: 0, end: 5 }] };
  assert.throws(() => planner.approveCandidates(plan, ["all"]), /안전 상한/);
  assert.throws(() => planner.approveCandidates(plan, ["missing"]), /없는 삭제 후보/);
  assert.throws(() => planner.approveCandidates({ ...plan, candidates: [{ id: "x", start: 1, end: 2 }, { id: "x", start: 3, end: 4 }] }, []), /ID/);
});

test("never silently drops a short unapproved keep range", () => {
  const plan = {
    duration: 100,
    rules: planner.PRESETS.balanced,
    candidates: [{ id: "a", start: 10, end: 20 }, { id: "b", start: 20.1, end: 30 }],
  };
  assert.throws(() => planner.approveCandidates(plan, ["a", "b"]), /짧은 유지 구간/);
});

test("automatic selection skips candidates that violate a safety invariant", () => {
  const plan = {
    duration: 10,
    rules: planner.PRESETS.balanced,
    candidates: [
      { id: "a", start: 0, end: 3.9, confidence: 0.99 },
      { id: "b", start: 4, end: 4.1, confidence: 0.98 },
    ],
  };
  assert.deepEqual(planner.selectSafeCandidates(plan), ["a"]);
});

test("rejects transcript times beyond the selected source", () => {
  assert.throws(() => planner.createEditPlan([segment(0, 5, "too long")], { duration: 4 }), /원본보다 깁니다/);
});

test("similarity is token based and language agnostic", () => {
  assert.equal(planner.textSimilarity("서울대학교 학생부 전형", "서울대학교 학생부 전형"), 1);
  assert.ok(planner.textSimilarity("let us start again", "let us start over") > 0.5);
  assert.equal(planner.textSimilarity("", "anything"), 0);
});

test("randomized approvals conserve source duration whenever accepted", () => {
  let seed = 0x12345678;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let trial = 0; trial < 3000; trial += 1) {
    const duration = 30;
    const candidates = Array.from({ length: 8 }, (_, index) => {
      const start = random() * 28;
      return { id: `c${index}`, start, end: Math.min(duration, start + 0.1 + random() * 2) };
    });
    try {
      const chosen = candidates.filter(() => random() > 0.5).map((item) => item.id);
      const approved = planner.approveCandidates({ duration, rules: planner.PRESETS.tight, candidates }, chosen);
      assert.ok(Math.abs(approved.stats.deletedSeconds + approved.stats.keptSeconds - duration) <= 0.001);
    } catch (error) {
      assert.match(String(error.message), /안전 상한|짧은 유지 구간/);
    }
  }
});
