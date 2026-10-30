"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const planner = require("../plugin/lib/planner.js");

function segment(start, end, text, speaker = "host") {
  return Object.freeze({ start, end, text, speaker });
}
function textPlan(texts, options = {}) {
  return planner.createEditPlan(texts.map((text, index) => segment(index, index + 0.5, text)), {
    duration: texts.length, ...options,
  });
}
function candidatesOf(plan, type) { return plan.candidates.filter((item) => item.type === type); }
function bridgeSegments(text, speaker = "host") {
  return [
    segment(0, 1.1, "지원 자격을 확인하겠습니다"),
    segment(1.2, 1.4, text, speaker),
    segment(1.5, 2.6, "지원 자격을 확인하겠습니다"),
    segment(2.8, 4, "다음 내용을 설명하겠습니다."),
  ];
}
function bridgedCandidate(plan) {
  return plan.candidates.find((item) => item.reason.includes("필러 뒤 유사 반복"));
}

test("omitted and undefined lists retain Korean and English defaults for all presets", () => {
  const texts = ["아 잠깐만 다시 할게요", "I'll start again", "어", "음", "UH", "um"];
  for (const preset of ["conservative", "balanced", "tight"]) {
    const plan = textPlan(texts, { preset });
    assert.equal(plan.preset, preset);
    assert.deepEqual(plan.rules, planner.PRESETS[preset]);
    assert.equal(candidatesOf(plan, "retake").length, 2);
    assert.equal(candidatesOf(plan, "filler").length, 1);
    assert.deepEqual(textPlan(texts, { preset, retakeSignals: undefined, fillers: undefined }), plan);
  }
});

test("custom retake strings replace defaults and match trimmed literal substrings without case sensitivity", () => {
  const options = { retakeSignals: [" [GO?] "] };
  assert.equal(candidatesOf(textPlan(["prefix [go?] suffix"], options), "retake").length, 1);
  for (const text of ["go", "g", "start over", "아 잠깐만 다시 할게요"]) {
    assert.equal(candidatesOf(textPlan([text], options), "retake").length, 0);
  }
  assert.equal(candidatesOf(textPlan(["[GO?]", "[go?]"], options), "retake").length, 2);
});

test("custom retakes retain speaker boundaries and the lookback limit", () => {
  const plan = planner.createEditPlan([
    segment(0, 1, "진행자의 질문", "host"),
    segment(1.1, 1.6, "게스트의 미완성 답변", "guest"),
    segment(1.7, 2, "[GO?]", "guest"),
    segment(2.1, 4, "다음 답변입니다.", "guest"),
  ], { duration: 4, retakeSignals: ["[go?]"] });
  const retake = candidatesOf(plan, "retake")[0];
  assert.deepEqual([retake.start, retake.end], [1.1, 2]);

  const longPlan = planner.createEditPlan([
    segment(0, 7, "이 발화는 재촬영 lookback보다 오래 이어지는 미완성 설명"),
    segment(7.1, 7.5, "[GO?]"),
  ], { duration: 8, retakeSignals: ["[go?]"] });
  assert.equal(candidatesOf(longPlan, "retake")[0].start, 7.1);
});

test("custom fillers replace defaults and normalize case and punctuation for consecutive runs", () => {
  const plan = textPlan(["EH!", "eh."], { fillers: [" EH! "] });
  const filler = candidatesOf(plan, "filler")[0];
  assert.ok(filler);
  assert.deepEqual([filler.start, filler.end], [0, 1.5]);
  assert.equal(candidatesOf(textPlan(["uh", "um"], { fillers: ["eh"] }), "filler").length, 0);
  assert.equal(candidatesOf(textPlan(["EH!", "설명을 이어갑니다."], { fillers: ["eh"] }), "filler").length, 0);
});

test("custom fillers feed duplicate bridges while retaining manual review and speaker boundaries", () => {
  const options = { duration: 4, fillers: [" EH! "] };
  const plan = planner.createEditPlan(bridgeSegments("eh"), options);
  const duplicate = bridgedCandidate(plan);
  assert.ok(duplicate);
  assert.deepEqual([duplicate.start, duplicate.end], [0, 1.4]);
  assert.equal(duplicate.confidence, 0.89);
  assert.equal(plan.selectedIds.includes(duplicate.id), false);
  assert.deepEqual(planner.approveCandidates(plan, [duplicate.id]).keepRanges, [{ start: 1.4, end: 4 }]);
  assert.equal(bridgedCandidate(planner.createEditPlan(bridgeSegments("eh", "guest"), options)), undefined);
  assert.equal(bridgedCandidate(planner.createEditPlan(bridgeSegments("어"), options)), undefined);
});

test("empty lists disable their matching including duplicate filler bridges", () => {
  const plan = textPlan(["아 잠깐만", "start over", "어", "음"], { retakeSignals: [], fillers: [] });
  assert.deepEqual(plan.candidates, []);
  assert.deepEqual(plan.keepRanges, [{ start: 0, end: 4 }]);
  const segments = bridgeSegments("어");
  assert.ok(bridgedCandidate(planner.createEditPlan(segments, { duration: 4 })));
  assert.equal(bridgedCandidate(planner.createEditPlan(segments, { duration: 4, fillers: [] })), undefined);
});

test("configuring one list leaves the other list's defaults active", () => {
  assert.equal(candidatesOf(textPlan(["어", "음"], { retakeSignals: [] }), "filler").length, 1);
  assert.equal(candidatesOf(textPlan(["start over"], { fillers: [] }), "retake").length, 1);
});

test("configuration does not mutate inputs, defaults, presets, or the plan result shape", () => {
  const options = Object.freeze({
    preset: "tight",
    retakeSignals: Object.freeze([" [GO?] "]),
    fillers: Object.freeze([" EH! "]),
    rules: Object.freeze({ maxDeleteRatio: 0.3 }),
  });
  const defaults = textPlan(["start over", "어", "음"]);
  const presetSnapshot = JSON.stringify(planner.PRESETS);
  const custom = textPlan(["[go?]", "eh", "EH!"], options);
  assert.deepEqual(textPlan(["[go?]", "eh", "EH!"], options), custom);
  assert.deepEqual(options.retakeSignals, [" [GO?] "]);
  assert.deepEqual(options.fillers, [" EH! "]);
  assert.deepEqual(options.rules, { maxDeleteRatio: 0.3 });
  assert.deepEqual(custom.rules, { ...planner.PRESETS.tight, maxDeleteRatio: 0.3 });
  assert.deepEqual(Object.keys(custom), Object.keys(defaults));
  assert.equal(JSON.stringify(planner.PRESETS), presetSnapshot);
  assert.deepEqual(textPlan(["start over", "어", "음"]), defaults);
});

test("invalid list containers and entries are rejected with the option name", () => {
  for (const name of ["retakeSignals", "fillers"]) {
    for (const value of [null, "uh", {}, 42, [null], [42], [/uh/], [""], ["   "]]) {
      assert.throws(() => textPlan(["일반 설명입니다."], { [name]: value }), new RegExp(name));
    }
  }
  for (const fillers of [["two words"], ["uh-huh"], ["..."]]) {
    assert.throws(() => textPlan(["일반 설명입니다."], { fillers }), /fillers/);
  }
});
