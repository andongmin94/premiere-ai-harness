"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const planner = require("../plugin/lib/planner.js");

function segment(start, end, text, speaker = "") {
  return Object.freeze({ start, end, text, speaker });
}

test("suggests leading and trailing no-speech ranges without auto-selecting them", () => {
  const plan = planner.createEditPlan([
    segment(2, 8, "중간 대사입니다.", "host"),
  ], { duration: 10, preset: "balanced" });

  const edges = plan.candidates.filter((item) => /시작 무발화|끝 무발화/.test(item.reason));
  assert.equal(edges.length, 2);
  assert.deepEqual(edges.map(({ start, end }) => [start, end]), [[0, 1.8], [8.2, 10]]);
  assert.ok(edges.every((item) => item.confidence < 0.9));
  assert.ok(edges.every((item) => !plan.selectedIds.includes(item.id)));
  assert.deepEqual(plan.keepRanges, [{ start: 0, end: 10 }]);

  const approved = planner.approveCandidates(plan, edges.map((item) => item.id));
  assert.deepEqual(approved.keepRanges, [{ start: 1.8, end: 8.2 }]);
});

test("does not suggest edge no-speech ranges below the active preset threshold", () => {
  const plan = planner.createEditPlan([
    segment(0.7, 9.3, "가장자리 여백은 짧습니다.", "host"),
  ], { duration: 10, preset: "balanced" });

  assert.equal(plan.candidates.some((item) => /시작 무발화|끝 무발화/.test(item.reason)), false);
});

test("keeps the existing two-sided breathing room and auto-selection for internal silence", () => {
  const plan = planner.createEditPlan([
    segment(0, 1, "첫 문장입니다.", "host"),
    segment(3, 4, "다음 문장입니다.", "host"),
  ], { duration: 4, preset: "balanced" });

  const silence = plan.candidates.find((item) => item.type === "silence");
  assert.ok(silence);
  assert.deepEqual([silence.start, silence.end], [1.2, 2.8]);
  assert.equal(plan.selectedIds.includes(silence.id), true);
});

test("uses the full speech extent for overlapping cues and inferred duration", () => {
  const segments = [
    segment(0, 10, "긴 설명을 끝까지 이어갑니다."),
    segment(2, 3, "잠시 겹치는 질문입니다."),
    segment(5, 6, "별도의 짧은 대답입니다."),
  ];
  const plan = planner.createEditPlan(segments, { duration: 12, preset: "balanced" });
  assert.equal(plan.candidates.length, 1);
  const tail = plan.candidates[0];
  assert.equal(tail.type, "silence");
  assert.match(tail.reason, /^끝 무발화/);
  assert.deepEqual([tail.start, tail.end], [10.2, 12]);
  assert.equal(tail.confidence, 0.89);
  assert.deepEqual(plan.selectedIds, []);
  assert.deepEqual(plan.keepRanges, [{ start: 0, end: 12 }]);

  const inferred = planner.createEditPlan(segments);
  assert.equal(inferred.duration, 10);
  assert.deepEqual(inferred.candidates, []);
  assert.deepEqual(inferred.keepRanges, [{ start: 0, end: 10 }]);
});

test("preserves real internal and trailing gaps after overlapping cues", () => {
  const plan = planner.createEditPlan([
    segment(0, 6, "긴 설명을 끝까지 이어갑니다."),
    segment(1, 2, "잠시 겹치는 질문입니다."),
    segment(8, 10, "별도의 짧은 대답입니다."),
  ], { duration: 12, preset: "balanced" });

  assert.equal(plan.candidates.length, 2);
  const [internal, tail] = plan.candidates;
  assert.deepEqual(plan.candidates.map(({ start, end }) => [start, end]), [[6.2, 7.8], [10.2, 12]]);
  assert.match(internal.reason, /^긴 무음/);
  assert.equal(internal.confidence, 0.98);
  assert.match(tail.reason, /^끝 무발화/);
  assert.equal(tail.confidence, 0.89);
  assert.deepEqual(plan.selectedIds, [internal.id]);
  assert.deepEqual(plan.keepRanges, [{ start: 0, end: 6.2 }, { start: 7.8, end: 12 }]);
});
