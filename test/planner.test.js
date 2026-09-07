"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const planner = require("../plugin/lib/planner.js");

function segment(start, end, text, speaker = "") { return Object.freeze({ start, end, text, speaker }); }

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

test("retake lookback includes a multi-segment unfinished phrase but stops at a completed sentence", () => {
  const plan = planner.createEditPlan([
    segment(0, 0.9, "앞 설명은 여기까지입니다.", "host"),
    segment(1.0, 1.8, "그리고 지역인재전형은", "host"),
    segment(1.9, 2.7, "해당 권역 학생을 대상으로", "host"),
    segment(2.8, 3.5, "아 잠깐만 다시 할게요", "host"),
    segment(3.7, 5.0, "지역인재전형을 다시 설명하겠습니다.", "host"),
  ], { duration: 5, preset: "balanced" });
  const retake = plan.candidates.find((item) => item.type === "retake");
  assert.ok(retake);
  assert.equal(retake.start, 1.0);
  assert.equal(retake.end, 3.5);
});

test("does not absorb a previous speaker into a retake", () => {
  const plan = planner.createEditPlan([
    segment(0, 1.2, "질문을 하나 드리겠습니다", "host"),
    segment(1.3, 2.0, "아 잠깐만 다시 할게요", "guest"),
    segment(2.2, 3.2, "답변을 시작하겠습니다.", "guest"),
  ], { duration: 3.2, preset: "balanced" });
  const retake = plan.candidates.find((item) => item.type === "retake");
  assert.ok(retake);
  assert.equal(retake.start, 1.3);
  assert.equal(retake.end, 2);
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

test("does not combine filler utterances across a long gap", () => {
  const plan = planner.createEditPlan([
    segment(0, 0.2, "어", "host"),
    segment(2.0, 2.2, "음", "host"),
    segment(2.4, 3.0, "계속하겠습니다.", "host"),
  ], { duration: 3, preset: "tight" });
  assert.equal(plan.candidates.some((item) => item.reason.includes("필러")), false);
});

test("does not combine fillers or duplicate speech across known speakers", () => {
  const plan = planner.createEditPlan([
    segment(0, 0.3, "어", "host"),
    segment(0.35, 0.7, "음", "guest"),
    segment(1, 2, "지원 자격을 확인하겠습니다", "host"),
    segment(2.1, 3.2, "지원 자격을 확인하겠습니다", "guest"),
  ], { duration: 3.2, preset: "tight" });
  assert.equal(plan.candidates.some((item) => item.reason.includes("필러")), false);
  assert.equal(plan.candidates.some((item) => item.reason.includes("반복")), false);
});

test("detects Korean repeats despite spacing differences", () => {
  const plan = planner.createEditPlan([
    segment(0, 1.2, "지원 자격을 확인하겠습니다", "host"),
    segment(1.3, 2.5, "지원자격을 확인하겠습니다", "host"),
    segment(2.7, 4.0, "다음 내용을 설명하겠습니다.", "host"),
  ], { duration: 4, preset: "balanced" });
  const duplicate = plan.candidates.find((item) => item.type === "duplicate");
  assert.ok(duplicate);
  assert.match(duplicate.reason, /100%/);
});

test("does not flag short acknowledgements or similar sentences with a changed action", () => {
  const shortPlan = planner.createEditPlan([
    segment(0, 0.3, "맞아요", "guest"),
    segment(0.4, 0.7, "맞아요", "guest"),
    segment(0.8, 1.5, "계속하겠습니다.", "guest"),
  ], { duration: 1.5, preset: "tight" });
  assert.equal(shortPlan.candidates.some((item) => item.type === "duplicate"), false);

  const changedPlan = planner.createEditPlan([
    segment(0, 1.0, "지원 자격을 확인하겠습니다", "host"),
    segment(1.1, 2.1, "지원 자격을 변경하겠습니다", "host"),
    segment(2.2, 3.0, "다음 내용입니다.", "host"),
  ], { duration: 3, preset: "tight" });
  assert.equal(changedPlan.candidates.some((item) => item.type === "duplicate"), false);
});

test("suggests a looser near-repeat without auto-selecting it", () => {
  const plan = planner.createEditPlan([
    segment(0, 1.2, "오늘 지원 자격을 설명하겠습니다", "host"),
    segment(1.3, 2.5, "지원 자격을 설명하겠습니다", "host"),
    segment(2.7, 5.0, "본론을 이어가겠습니다.", "host"),
  ], { duration: 5, preset: "balanced" });
  const duplicate = plan.candidates.find((item) => item.type === "duplicate");
  assert.ok(duplicate);
  assert.ok(duplicate.confidence < 0.9);
  assert.equal(plan.selectedIds.includes(duplicate.id), false);
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

test("similarity is spacing robust while preserving lexical differences", () => {
  assert.equal(planner.textSimilarity("서울대학교 학생부 전형", "서울대학교 학생부 전형"), 1);
  assert.equal(planner.textSimilarity("지원 자격을 확인하겠습니다", "지원자격을 확인하겠습니다"), 1);
  assert.ok(planner.textSimilarity("지원 자격을 확인하겠습니다", "지원 자격을 변경하겠습니다") < 0.82);
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
