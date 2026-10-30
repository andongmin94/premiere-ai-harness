"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const controllerApi = require("../plugin/index.js");
const certification = require("../plugin/lib/host-certification.js");
const qualificationApi = require("../plugin/lib/host-qualification.js");
const { makeFixture } = require("./premiere-fixture.js");

const IDS = [
  "inspect", "host-self-test", "cleanup-self-test", "load-premiere", "analyze-pasted", "apply", "reset-data",
  "preset", "transcript-input", "candidate-list", "plan-stats", "plan-report", "selection-info", "host-badge", "host-status", "status",
  "custom-retakes", "retake-signals", "custom-fillers", "filler-words",
  "qualification-start", "rollback-self-test", "qualification-confirm-playback", "qualification-prepare-persistence", "qualification-confirm-persistence",
  "qualification-reset", "qualification-status", "qualification-report",
];

class FakeElement {
  constructor(tagName, id) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.id = id || "";
    this.dataset = {};
    this.disabled = false;
    this.textContent = "";
    this.value = this.id === "preset" ? "balanced" : "";
    this.checked = false;
    this.type = "";
    this.className = "";
    this.children = [];
    this.listeners = new Map();
  }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; this.textContent = ""; }
  async dispatch(name) { return this.listeners.get(name)?.({ target: this }); }
}

function makeDocument() {
  const elements = new Map(IDS.map((id) => [id, new FakeElement("div", id)]));
  const listeners = new Map();
  return {
    elements,
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) { return new FakeElement(tag); },
    addEventListener(name, handler) { listeners.set(name, handler); },
    querySelectorAll(selector) {
      if (selector !== ".candidate input:checked") return [];
      const found = [];
      visit(elements.get("candidate-list"));
      return found;
      function visit(node) {
        if (!node) return;
        if (node.tagName === "INPUT" && node.checked) found.push(node);
        for (const child of node.children || []) visit(child);
      }
    },
    async dispatch(name) { return listeners.get(name)?.(); },
  };
}

function makeStorage() {
  const values = new Map([["unrelated", "keep"]]);
  return {
    values,
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function makeRequire(ppro, entrypointSpy) {
  return function requireFn(name) {
    if (name === "premierepro") return ppro;
    if (name === "os") return { platform: () => "win32", arch: () => "x64" };
    if (name === "uxp") return {
      host: { name: "premierepro", version: "26.3.1" },
      versions: { uxp: "8.2.0", plugin: "0.5.1" },
      entrypoints: { setup: entrypointSpy || function () {} },
    };
    throw new Error(`unexpected module: ${name}`);
  };
}

test("controller boots with the actual DOM contract and completes the core flow", async () => {
  const document = makeDocument();
  const storage = makeStorage();
  const fixture = makeFixture();
  const controller = controllerApi.createController({ document, storage, requireFn: makeRequire(fixture.ppro), sessionId: "core-session" });
  controller.initialize();

  assert.equal(document.elements.get("inspect").listeners.has("click"), true);
  assert.equal(document.elements.get("host-self-test").disabled, true);

  await controller.inspectSelection();
  assert.equal(controller.getSession().selection.clipName, "camera.mp4");
  assert.equal(document.elements.get("host-self-test").disabled, false);

  await controller.loadPremiereTranscript();
  assert.ok(controller.getSession().plan);
  assert.equal(document.elements.get("apply").disabled, true);

  await controller.runHostSelfTest();
  assert.ok(storage.values.has(certification.CERTIFICATION_STORAGE_KEY));
  assert.equal(document.elements.get("apply").disabled, false);

  await controller.applyRoughCut();
  assert.equal(fixture.project.sequences.length, 1);
  assert.match(document.elements.get("status").textContent, /새 시퀀스/);

  controller.resetPluginData();
  assert.equal(storage.values.get("unrelated"), "keep");
  assert.equal(storage.values.has(certification.CERTIFICATION_STORAGE_KEY), false);
  assert.equal(storage.values.has(qualificationApi.QUALIFICATION_STORAGE_KEY), false);
  assert.equal(controller.getSession().selection, null);
});

test("host self-test rejects a Premiere selection that changed after inspection", async () => {
  const document = makeDocument();
  const storage = makeStorage();
  const fixture = makeFixture();
  const controller = controllerApi.createController({ document, storage, requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  await controller.inspectSelection();
  fixture.source.id = "clip-2";

  await controller.runHostSelfTest();
  assert.equal(storage.values.has(certification.CERTIFICATION_STORAGE_KEY), false);
  assert.equal(fixture.project.transactions.length, 0);
  assert.match(document.elements.get("status").textContent, /원본 클립이 바뀌었습니다/);
});

test("failed host self-test rerun revokes certification until a new successful run", async () => {
  const document = makeDocument();
  const storage = makeStorage();
  const fixture = makeFixture();
  const controller = controllerApi.createController({ document, storage, requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  await controller.inspectSelection();
  await controller.loadPremiereTranscript();
  await controller.runHostSelfTest();

  assert.ok(storage.values.has(certification.CERTIFICATION_STORAGE_KEY));
  assert.equal(document.elements.get("host-badge").textContent, "인증됨");
  assert.equal(document.elements.get("apply").disabled, false);

  fixture.options.failActivate = true;
  await controller.runHostSelfTest();

  assert.match(document.elements.get("status").textContent, /활성화/);
  assert.equal(storage.values.has(certification.CERTIFICATION_STORAGE_KEY), false);
  assert.equal(document.elements.get("host-badge").textContent, "미인증");
  assert.equal(document.elements.get("apply").disabled, true);

  const transactionsBeforeBlockedApply = fixture.project.transactions.length;
  await controller.applyRoughCut();
  assert.equal(fixture.project.transactions.length, transactionsBeforeBlockedApply);
  assert.match(document.elements.get("status").textContent, /호스트 자체시험을 먼저 통과/);

  fixture.options.failActivate = false;
  await controller.runHostSelfTest();

  assert.ok(storage.values.has(certification.CERTIFICATION_STORAGE_KEY));
  assert.equal(document.elements.get("host-badge").textContent, "인증됨");
  assert.equal(document.elements.get("apply").disabled, false);
  assert.match(document.elements.get("status").textContent, /자체시험과 자동 정리를 모두 통과/);
});

test("active qualification binds rough cut creation to the recorded Premiere transcript", async () => {
  const document = makeDocument();
  const storage = makeStorage();
  const fixture = makeFixture();
  const controller = controllerApi.createController({
    document,
    storage,
    requireFn: makeRequire(fixture.ppro),
    sessionId: "transcript-session",
  });
  controller.initialize();
  await controller.inspectSelection();
  await controller.startQualification();
  await controller.runHostSelfTest();
  assert.equal(document.elements.get("qualification-start").disabled, true);

  document.elements.get("transcript-input").value = "1\n00:00:00,000 --> 00:00:01,000\n붙여넣은 전사문입니다.";
  await controller.analyzePastedTranscript();
  assert.equal(document.elements.get("apply").disabled, true);
  const transactionsBeforeBlockedApply = fixture.project.transactions.length;
  await controller.applyRoughCut();
  assert.equal(fixture.project.transactions.length, transactionsBeforeBlockedApply);
  assert.equal(fixture.project.sequences.length, 0);
  assert.equal(controller.getQualification().steps.roughCut.status, "PENDING");
  assert.match(document.elements.get("status").textContent, /Premiere 전사문/);

  await controller.loadPremiereTranscript();
  assert.equal(document.elements.get("apply").disabled, false);
  await controller.applyRoughCut();
  const qualified = controller.getQualification();
  assert.equal(fixture.project.sequences.length, 1);
  assert.equal(qualified.steps.roughCut.status, "PASS");
  assert.equal(qualified.steps.roughCut.transcriptFingerprint, qualified.steps.premiereTranscript.fingerprint);
  assert.equal(document.elements.get("apply").disabled, true);
  const transactionsBeforeSecondApply = fixture.project.transactions.length;
  await controller.applyRoughCut();
  assert.equal(fixture.project.transactions.length, transactionsBeforeSecondApply);
  assert.equal(fixture.project.sequences.length, 1);
  assert.match(document.elements.get("status").textContent, /이미 기록/);

  fixture.options.transcriptJson = JSON.stringify({ segments: [{ start: 0, end: 1, text: "changed transcript" }] });
  await controller.loadPremiereTranscript();
  assert.match(document.elements.get("status").textContent, /다른 Premiere 전사문/);
  assert.equal(document.elements.get("apply").disabled, true);
  const transactionsBeforeMismatchedApply = fixture.project.transactions.length;
  await controller.applyRoughCut();
  assert.equal(fixture.project.transactions.length, transactionsBeforeMismatchedApply);
  assert.equal(fixture.project.sequences.length, 1);
  assert.match(document.elements.get("status").textContent, /현재 편집안의 전사문이 다릅니다|이미 기록/);
});

test("guided qualification requires host self-test before rollback and a later panel session before persistence", async () => {
  const storage = makeStorage();
  const fixture = makeFixture();
  const firstDocument = makeDocument();
  const first = controllerApi.createController({
    document: firstDocument,
    storage,
    requireFn: makeRequire(fixture.ppro),
    sessionId: "session-one",
  });
  first.initialize();
  await first.inspectSelection();
  await first.startQualification();
  const qualificationBeforeRestart = first.getQualification();
  assert.equal(firstDocument.elements.get("qualification-start").disabled, true);
  await first.startQualification();
  assert.equal(first.getQualification(), qualificationBeforeRestart);
  assert.match(firstDocument.elements.get("status").textContent, /초기화한 뒤 다시 시작/);
  assert.equal(firstDocument.elements.get("rollback-self-test").disabled, true);
  await first.runRollbackSelfTest();
  assert.equal(fixture.project.transactions.length, 0);
  assert.match(firstDocument.elements.get("status").textContent, /호스트 자체시험/);
  await first.runHostSelfTest();
  assert.equal(firstDocument.elements.get("rollback-self-test").disabled, false);
  await first.runRollbackSelfTest();
  await first.loadPremiereTranscript();
  await first.applyRoughCut();
  await first.confirmQualificationPlayback();

  assert.equal(first.getQualification().status, "PENDING");
  assert.equal(firstDocument.elements.get("qualification-prepare-persistence").disabled, false);
  assert.equal(firstDocument.elements.get("qualification-confirm-persistence").disabled, true);
  await first.prepareQualificationPersistence();
  assert.equal(fixture.project.saveCount, 1);
  assert.equal(firstDocument.elements.get("qualification-confirm-persistence").disabled, true);
  assert.equal(fixture.project.sequences.length, 1);

  const secondDocument = makeDocument();
  const second = controllerApi.createController({
    document: secondDocument,
    storage,
    requireFn: makeRequire(fixture.ppro),
    sessionId: "session-two",
  });
  second.initialize();
  assert.equal(secondDocument.elements.get("qualification-confirm-persistence").disabled, false);
  await second.confirmQualificationPersistence();

  assert.equal(second.getQualification().status, "PASS");
  assert.match(secondDocument.elements.get("qualification-report").value, /"status": "PASS"/);
  second.resetQualification();
  assert.equal(storage.values.get("unrelated"), "keep");
  assert.equal(storage.values.has(qualificationApi.QUALIFICATION_STORAGE_KEY), false);
});

test("re-inspecting a clip deliberately clears the prior transcript and plan", async () => {
  const document = makeDocument();
  const fixture = makeFixture();
  const controller = controllerApi.createController({ document, storage: makeStorage(), requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  await controller.inspectSelection();
  await controller.loadPremiereTranscript();
  assert.ok(controller.getSession().plan);
  assert.notEqual(document.elements.get("plan-report").value, "");
  document.elements.get("transcript-input").value = "old pasted text";
  await controller.inspectSelection();
  assert.equal(controller.getSession().plan, null);
  assert.equal(controller.getSession().transcript, null);
  assert.equal(document.elements.get("transcript-input").value, "");
  assert.equal(document.elements.get("plan-report").value, "");
});

test("reviewed plan JSON follows the current checkbox selection before host certification", async () => {
  const document = makeDocument();
  const storage = makeStorage();
  const fixture = makeFixture({ transcriptJson: JSON.stringify({ segments: [
    { start: 0, end: 1, text: "start over" },
    { start: 1, end: 10, text: "본문 설명을 계속하겠습니다." },
  ] }) });
  const controller = controllerApi.createController({ document, storage, requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  await controller.inspectSelection();
  await controller.loadPremiereTranscript();
  const report = document.elements.get("plan-report");
  assert.deepEqual(JSON.parse(report.value), {
    keepRanges: [{ start: 1, end: 10 }],
    stats: { duration: 10, deletedSeconds: 1, keptSeconds: 9, selectedCount: 1 },
  });
  assert.equal(document.elements.get("host-badge").textContent, "미인증");
  assert.equal(document.elements.get("apply").disabled, true);
  assert.equal(storage.values.has(certification.CERTIFICATION_STORAGE_KEY), false);

  const checkbox = document.elements.get("candidate-list").children[0].children[0];
  assert.equal(checkbox.checked, true);
  checkbox.checked = false;
  await checkbox.dispatch("change");
  assert.deepEqual(JSON.parse(report.value), {
    keepRanges: [{ start: 0, end: 10 }],
    stats: { duration: 10, deletedSeconds: 0, keptSeconds: 10, selectedCount: 0 },
  });
  assert.equal(fixture.project.transactions.length, 0);
});

test("overlapping WebVTT speech stays intact through panel approval JSON", async () => {
  const document = makeDocument();
  const fixture = makeFixture();
  const controller = controllerApi.createController({ document, storage: makeStorage(), requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  await controller.inspectSelection();
  document.elements.get("transcript-input").value = [
    "WEBVTT", "",
    "00:00:00.000 --> 00:00:06.000", "긴 설명을 계속하는 화자의 문장입니다.", "",
    "00:00:01.000 --> 00:00:02.000", "중간에 짧게 겹치는 응답입니다.", "",
    "00:00:04.000 --> 00:00:10.000", "이어서 들리는 다른 설명입니다.",
  ].join("\n");
  await controller.analyzePastedTranscript();

  assert.equal(controller.getSession().transcript.source, "pasted");
  assert.equal(controller.getSession().segments.length, 3);
  assert.deepEqual(controller.getSession().plan.candidates, []);
  assert.deepEqual(JSON.parse(document.elements.get("plan-report").value), {
    keepRanges: [{ start: 0, end: 10 }],
    stats: { duration: 10, deletedSeconds: 0, keptSeconds: 10, selectedCount: 0 },
  });
  assert.equal(fixture.project.transactions.length, 0);
});

test("reviewed plan JSON clears for unsafe selections and returns after correction", async () => {
  const document = makeDocument();
  const fixture = makeFixture({ transcriptJson: JSON.stringify({ segments: [
    { start: 0, end: 5, text: "start over" },
    { start: 5, end: 10, text: "본문 설명을 계속하겠습니다." },
  ] }) });
  const controller = controllerApi.createController({ document, storage: makeStorage(), requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  await controller.inspectSelection();
  await controller.loadPremiereTranscript();
  const report = document.elements.get("plan-report");
  const unchanged = {
    keepRanges: [{ start: 0, end: 10 }],
    stats: { duration: 10, deletedSeconds: 0, keptSeconds: 10, selectedCount: 0 },
  };
  assert.deepEqual(JSON.parse(report.value), unchanged);

  const checkbox = document.elements.get("candidate-list").children[0].children[0];
  assert.equal(checkbox.checked, false);
  checkbox.checked = true;
  await checkbox.dispatch("change");
  assert.equal(report.value, "");
  assert.match(document.elements.get("plan-stats").textContent, /안전 상한 40%/);

  checkbox.checked = false;
  await checkbox.dispatch("change");
  assert.deepEqual(JSON.parse(report.value), unchanged);
  assert.equal(fixture.project.transactions.length, 0);
});

test("failed pasted-transcript analysis does not replace the existing protected plan", async () => {
  const document = makeDocument();
  const fixture = makeFixture();
  const controller = controllerApi.createController({ document, storage: makeStorage(), requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  await controller.inspectSelection();
  await controller.loadPremiereTranscript();
  const originalPlan = controller.getSession().plan;
  const originalTranscript = controller.getSession().transcript;

  document.elements.get("transcript-input").value = "not a transcript";
  await document.elements.get("transcript-input").dispatch("input");
  assert.equal(controller.getSession().plan, originalPlan);
  assert.equal(controller.getSession().transcript, originalTranscript);
  await controller.analyzePastedTranscript();
  assert.equal(controller.getSession().plan, originalPlan);
  assert.equal(controller.getSession().transcript, originalTranscript);
  assert.match(document.elements.get("status").textContent, /형식/);
});

test("editing an analyzed pasted transcript invalidates its plan until reanalysis", async () => {
  const document = makeDocument();
  const fixture = makeFixture();
  const controller = controllerApi.createController({ document, storage: makeStorage(), requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  await controller.inspectSelection();
  await controller.runHostSelfTest();
  const input = document.elements.get("transcript-input");
  input.value = JSON.stringify({ segments: [
    { start: 0, end: 0.5, text: "start over" },
    { start: 0.7, end: 10, text: "첫 번째 설명입니다." },
  ] });
  await controller.analyzePastedTranscript();
  const selection = controller.getSession().selection;
  const originalPlan = controller.getSession().plan;
  assert.ok(originalPlan);
  assert.ok(document.elements.get("candidate-list").children.length > 0);
  assert.equal(document.elements.get("apply").disabled, false);

  const replacement = JSON.stringify({ segments: [{ start: 0, end: 10, text: "수정한 설명입니다." }] });
  input.value = replacement;
  await input.dispatch("input");
  assert.equal(controller.getSession().plan, null);
  assert.equal(controller.getSession().transcript, null);
  assert.deepEqual(controller.getSession().segments, []);
  assert.equal(controller.getSession().selection, selection);
  assert.equal(input.value, replacement);
  assert.equal(document.elements.get("apply").disabled, true);
  assert.equal(document.elements.get("candidate-list").children.length, 0);
  assert.match(document.elements.get("status").textContent, /다시.*분석/);

  document.elements.get("custom-retakes").checked = true;
  await document.elements.get("custom-retakes").dispatch("change");
  assert.equal(controller.getSession().plan, null);
  const transactions = fixture.project.transactions.length;
  await controller.applyRoughCut();
  assert.equal(fixture.project.transactions.length, transactions);
  assert.equal(fixture.project.sequences.length, 0);

  await controller.analyzePastedTranscript();
  assert.equal(controller.getSession().transcript.source, "pasted");
  assert.equal(controller.getSession().segments[0].text, "수정한 설명입니다.");
  assert.ok(controller.getSession().plan);
  assert.notEqual(controller.getSession().plan, originalPlan);
  assert.equal(document.elements.get("apply").disabled, false);
});

test("value-backed JSON reaches custom retake and filler approval", async () => {
  const document = makeDocument();
  const fixture = makeFixture();
  const controller = controllerApi.createController({ document, storage: makeStorage(), requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  await controller.inspectSelection();
  for (const [toggle, input, value] of [["custom-retakes", "retake-signals", "[cut?]"], ["custom-fillers", "filler-words", "EH!"]]) {
    document.elements.get(toggle).checked = true;
    await document.elements.get(toggle).dispatch("change");
    document.elements.get(input).value = value;
    await document.elements.get(input).dispatch("input");
  }
  document.elements.get("transcript-input").value = JSON.stringify({ transcript: { segments: [
    { start: 0, end: 0.5, value: "  [CUT?]  ", speaker: "host" },
    { start: 0.5, end: 0.8, value: "EH!", speaker: "host" },
    { start: 0.9, end: 1.2, value: "eh.", speaker: "host" },
    { start: 1.4, end: 10, value: "본문 설명을 계속하겠습니다.", speaker: "host" },
  ] } });
  await controller.analyzePastedTranscript();

  const plan = controller.getSession().plan;
  assert.ok(plan);
  assert.deepEqual(plan.candidates.map(({ type, start, end }) => ({ type, start, end })), [
    { type: "retake", start: 0, end: 0.5 },
    { type: "filler", start: 0.5, end: 1.2 },
  ]);
  const report = document.elements.get("plan-report");
  assert.deepEqual(JSON.parse(report.value), {
    keepRanges: [{ start: 1.2, end: 10 }],
    stats: { duration: 10, deletedSeconds: 1.2, keptSeconds: 8.8, selectedCount: 2 },
  });

  const retakeCheckbox = document.elements.get("candidate-list").children[0].children[0];
  retakeCheckbox.checked = false;
  await retakeCheckbox.dispatch("change");
  assert.deepEqual(JSON.parse(report.value), {
    keepRanges: [{ start: 0, end: 0.5 }, { start: 1.2, end: 10 }],
    stats: { duration: 10, deletedSeconds: 0.7, keptSeconds: 9.3, selectedCount: 1 },
  });
  assert.equal(fixture.project.transactions.length, 0);
});

test("custom lists reach Premiere transcript analysis and remain active after a preset change", async () => {
  const document = makeDocument();
  const fixture = makeFixture({ transcriptJson: JSON.stringify({ segments: [
    { start: 0, end: 0.8, text: "앞 문장입니다." },
    { start: 1, end: 1.4, text: "please [cut?]" },
    { start: 1.6, end: 1.8, text: "에헴" },
    { start: 1.9, end: 2.1, text: "EH!" },
    { start: 2.4, end: 10, text: "본문 설명을 계속하겠습니다." },
  ] }) });
  const controller = controllerApi.createController({ document, storage: makeStorage(), requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  await controller.inspectSelection();
  document.elements.get("custom-retakes").checked = true;
  await document.elements.get("custom-retakes").dispatch("change");
  document.elements.get("retake-signals").value = " [CUT?] \n\n";
  document.elements.get("custom-fillers").checked = true;
  await document.elements.get("custom-fillers").dispatch("change");
  document.elements.get("filler-words").value = " 에헴 \n \n EH! ";

  await controller.loadPremiereTranscript();
  const plan = controller.getSession().plan;
  assert.equal(controller.getSession().transcript.source, "premiere");
  assert.ok(plan.candidates.some((candidate) => candidate.type === "retake"));
  assert.ok(plan.candidates.some((candidate) => candidate.type === "filler"));

  document.elements.get("preset").value = "tight";
  await document.elements.get("preset").dispatch("change");
  const rebuilt = controller.getSession().plan;
  assert.equal(rebuilt.preset, "tight");
  assert.deepEqual(rebuilt.candidates, plan.candidates);
});

test("empty custom lists disable matching for pasted transcripts and unchecking restores defaults", async () => {
  const document = makeDocument();
  const fixture = makeFixture();
  const controller = controllerApi.createController({ document, storage: makeStorage(), requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  await controller.inspectSelection();
  document.elements.get("transcript-input").value = JSON.stringify({ segments: [
    { start: 0, end: 0.8, text: "앞 문장입니다." },
    { start: 1, end: 1.4, text: "start over" },
    { start: 1.6, end: 1.8, text: "어" },
    { start: 1.9, end: 2.1, text: "음" },
    { start: 2.4, end: 10, text: "본문 설명을 계속하겠습니다." },
  ] });
  await controller.analyzePastedTranscript();
  const original = controller.getSession().plan;
  assert.equal(controller.getSession().transcript.source, "pasted");
  assert.ok(original.candidates.some((candidate) => candidate.type === "retake"));
  assert.ok(original.candidates.some((candidate) => candidate.type === "filler"));

  for (const id of ["custom-retakes", "custom-fillers"]) {
    document.elements.get(id).checked = true;
    await document.elements.get(id).dispatch("change");
  }
  assert.deepEqual(controller.getSession().plan.candidates, []);
  for (const id of ["custom-retakes", "custom-fillers"]) {
    document.elements.get(id).checked = false;
    await document.elements.get(id).dispatch("change");
  }
  assert.deepEqual(controller.getSession().plan, original);
});

test("planner list settings restore after a panel restart without storing editing data", async () => {
  const document = makeDocument();
  const storage = makeStorage();
  const fixture = makeFixture({ transcriptJson: JSON.stringify({ segments: [
    { start: 0, end: 0.8, text: "앞 문장입니다." },
    { start: 1, end: 1.4, text: "please [cut?]" },
    { start: 1.6, end: 1.8, text: "어" },
    { start: 1.9, end: 2.1, text: "음" },
    { start: 2.4, end: 10, text: "본문 설명을 계속하겠습니다." },
  ] }) });
  const controller = controllerApi.createController({ document, storage, requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  assert.equal(storage.values.has(controllerApi.PLANNER_SETTINGS_STORAGE_KEY), false);
  await controller.inspectSelection();
  await controller.loadPremiereTranscript();
  document.elements.get("transcript-input").value = "저장하지 않을 원고 초안";
  for (const [toggle, input, value] of [["custom-retakes", "retake-signals", " [CUT?] \n\n"], ["custom-fillers", "filler-words", " 에헴 \n \n EH! "]]) {
    document.elements.get(toggle).checked = true;
    await document.elements.get(toggle).dispatch("change");
    document.elements.get(input).value = value;
    await document.elements.get(input).dispatch("input");
  }
  document.elements.get("custom-fillers").checked = false;
  await document.elements.get("custom-fillers").dispatch("change");
  assert.deepEqual(JSON.parse(storage.getItem(controllerApi.PLANNER_SETTINGS_STORAGE_KEY)), {
    retakeSignalsEnabled: true, retakeSignals: ["[CUT?]"], fillersEnabled: false, fillers: ["에헴", "EH!"],
  });
  assert.deepEqual([...storage.values.keys()].sort(), [controllerApi.PLANNER_SETTINGS_STORAGE_KEY, "unrelated"].sort());

  const restoredDocument = makeDocument();
  const restored = controllerApi.createController({ document: restoredDocument, storage, requireFn: makeRequire(fixture.ppro) });
  restored.initialize();
  assert.equal(restoredDocument.elements.get("custom-retakes").checked, true);
  assert.equal(restoredDocument.elements.get("retake-signals").value, "[CUT?]");
  assert.equal(restoredDocument.elements.get("custom-fillers").checked, false);
  assert.equal(restoredDocument.elements.get("filler-words").value, "에헴\nEH!");
  assert.equal(restoredDocument.elements.get("transcript-input").value, "");
  assert.equal(restored.getSession().selection, null);
  assert.equal(restored.getSession().transcript, null);
  assert.equal(restored.getSession().plan, null);
  await restored.inspectSelection();
  await restored.loadPremiereTranscript();
  const candidates = restored.getSession().plan.candidates;
  assert.ok(candidates.some((candidate) => candidate.type === "retake"));
  assert.ok(candidates.some((candidate) => candidate.type === "filler"));
  assert.deepEqual(candidates, controller.getSession().plan.candidates);
});

test("enabled empty planner lists remain disabled detectors after a panel restart", async () => {
  const document = makeDocument();
  const storage = makeStorage();
  const fixture = makeFixture({ transcriptJson: JSON.stringify({ segments: [
    { start: 0, end: 0.8, text: "앞 문장입니다." },
    { start: 1, end: 1.4, text: "start over" },
    { start: 1.6, end: 1.8, text: "어" },
    { start: 1.9, end: 2.1, text: "음" },
    { start: 2.4, end: 10, text: "본문 설명을 계속하겠습니다." },
  ] }) });
  const controller = controllerApi.createController({ document, storage, requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  await controller.inspectSelection();
  for (const id of ["custom-retakes", "custom-fillers"]) {
    document.elements.get(id).checked = true;
    await document.elements.get(id).dispatch("change");
  }
  assert.deepEqual(JSON.parse(storage.getItem(controllerApi.PLANNER_SETTINGS_STORAGE_KEY)), {
    retakeSignalsEnabled: true, retakeSignals: [], fillersEnabled: true, fillers: [],
  });

  const restoredDocument = makeDocument();
  const restored = controllerApi.createController({ document: restoredDocument, storage, requireFn: makeRequire(fixture.ppro) });
  restored.initialize();
  for (const id of ["custom-retakes", "custom-fillers"]) assert.equal(restoredDocument.elements.get(id).checked, true);
  for (const id of ["retake-signals", "filler-words"]) assert.equal(restoredDocument.elements.get(id).value, "");
  await restored.inspectSelection();
  await restored.loadPremiereTranscript();
  assert.deepEqual(restored.getSession().plan.candidates, []);

  for (const id of ["custom-retakes", "custom-fillers"]) {
    restoredDocument.elements.get(id).checked = false;
    await restoredDocument.elements.get(id).dispatch("change");
  }
  const candidates = restored.getSession().plan.candidates;
  assert.ok(candidates.some((candidate) => candidate.type === "retake"));
  assert.ok(candidates.some((candidate) => candidate.type === "filler"));
  assert.deepEqual(JSON.parse(storage.getItem(controllerApi.PLANNER_SETTINGS_STORAGE_KEY)), {
    retakeSignalsEnabled: false, retakeSignals: [], fillersEnabled: false, fillers: [],
  });
});

test("plugin data reset removes saved planner lists and keeps defaults after restart", async () => {
  const document = makeDocument();
  const storage = makeStorage();
  const fixture = makeFixture({ transcriptJson: JSON.stringify({ segments: [
    { start: 0, end: 0.8, text: "앞 문장입니다." },
    { start: 1, end: 1.4, text: "start over" },
    { start: 1.6, end: 1.8, text: "어" },
    { start: 1.9, end: 2.1, text: "음" },
    { start: 2.4, end: 10, text: "본문 설명을 계속하겠습니다." },
  ] }) });
  const controller = controllerApi.createController({ document, storage, requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  await controller.inspectSelection();
  for (const [toggle, input, value] of [["custom-retakes", "retake-signals", "컷"], ["custom-fillers", "filler-words", "에헴"]]) {
    document.elements.get(toggle).checked = true;
    await document.elements.get(toggle).dispatch("change");
    document.elements.get(input).value = value;
    await document.elements.get(input).dispatch("input");
  }
  assert.equal(storage.values.has(controllerApi.PLANNER_SETTINGS_STORAGE_KEY), true);
  await document.elements.get("reset-data").dispatch("click");
  assert.deepEqual([...storage.values.entries()], [["unrelated", "keep"]]);
  for (const id of ["custom-retakes", "custom-fillers"]) assert.equal(document.elements.get(id).checked, false);
  for (const id of ["retake-signals", "filler-words"]) assert.equal(document.elements.get(id).value, "");

  const restoredDocument = makeDocument();
  const restored = controllerApi.createController({ document: restoredDocument, storage, requireFn: makeRequire(fixture.ppro) });
  restored.initialize();
  for (const id of ["custom-retakes", "custom-fillers"]) assert.equal(restoredDocument.elements.get(id).checked, false);
  for (const id of ["retake-signals", "filler-words"]) assert.equal(restoredDocument.elements.get(id).value, "");
  await restored.inspectSelection();
  await restored.loadPremiereTranscript();
  const candidates = restored.getSession().plan.candidates;
  assert.ok(candidates.some((candidate) => candidate.type === "retake"));
  assert.ok(candidates.some((candidate) => candidate.type === "filler"));
  assert.equal(storage.values.has(controllerApi.PLANNER_SETTINGS_STORAGE_KEY), false);
});

test("list controls work before transcript analysis, disable while busy, and reset to defaults", async () => {
  const document = makeDocument();
  const fixture = makeFixture();
  const controller = controllerApi.createController({ document, storage: makeStorage(), requireFn: makeRequire(fixture.ppro) });
  const controlIds = ["custom-retakes", "retake-signals", "custom-fillers", "filler-words"];
  controller.initialize();
  for (const id of controlIds) assert.equal(document.elements.get(id).disabled, true);
  assert.equal(document.elements.get("transcript-input").disabled, false);
  await controller.inspectSelection();
  for (const [toggle, input, value] of [["custom-retakes", "retake-signals", "컷"], ["custom-fillers", "filler-words", "에헴"]]) {
    assert.equal(document.elements.get(toggle).disabled, false);
    assert.equal(document.elements.get(input).disabled, true);
    document.elements.get(toggle).checked = true;
    await document.elements.get(toggle).dispatch("change");
    assert.equal(document.elements.get(input).disabled, false);
    document.elements.get(input).value = value;
    await document.elements.get(input).dispatch("input");
  }
  assert.equal(controller.getSession().plan, null);
  const loading = controller.loadPremiereTranscript();
  for (const id of controlIds) assert.equal(document.elements.get(id).disabled, true);
  assert.equal(document.elements.get("transcript-input").disabled, true);
  await loading;
  for (const id of controlIds) assert.equal(document.elements.get(id).disabled, false);
  assert.equal(document.elements.get("transcript-input").disabled, false);

  controller.resetPluginData();
  for (const id of ["custom-retakes", "custom-fillers"]) assert.equal(document.elements.get(id).checked, false);
  for (const id of ["retake-signals", "filler-words"]) assert.equal(document.elements.get(id).value, "");
  for (const id of controlIds) assert.equal(document.elements.get(id).disabled, true);
  assert.equal(document.elements.get("transcript-input").disabled, false);
});

test("invalid filler input clears the plan and blocks Apply while remaining editable for correction", async () => {
  const document = makeDocument();
  const fixture = makeFixture();
  const controller = controllerApi.createController({ document, storage: makeStorage(), requireFn: makeRequire(fixture.ppro) });
  controller.initialize();
  await controller.inspectSelection();
  await controller.loadPremiereTranscript();
  await controller.runHostSelfTest();
  assert.equal(document.elements.get("apply").disabled, false);
  document.elements.get("custom-fillers").checked = true;
  await document.elements.get("custom-fillers").dispatch("change");
  document.elements.get("filler-words").value = "two words";
  await document.elements.get("filler-words").dispatch("input");
  assert.equal(controller.getSession().plan, null);
  assert.equal(document.elements.get("apply").disabled, true);
  assert.equal(document.elements.get("custom-fillers").disabled, false);
  assert.equal(document.elements.get("filler-words").disabled, false);
  assert.match(document.elements.get("status").textContent, /fillers/);
  const transactions = fixture.project.transactions.length;
  await controller.applyRoughCut();
  assert.equal(fixture.project.transactions.length, transactions);
  assert.equal(fixture.project.sequences.length, 0);

  document.elements.get("filler-words").value = "EH!";
  await document.elements.get("filler-words").dispatch("input");
  assert.ok(controller.getSession().plan);
  assert.equal(document.elements.get("apply").disabled, false);
  assert.equal(document.elements.get("status").dataset.kind, "success");
});

test("start registers the manifest panel id and defers controller boot to DOMContentLoaded", async () => {
  const document = makeDocument();
  const fixture = makeFixture();
  let setupValue = null;
  const root = {
    document,
    localStorage: makeStorage(),
    require: makeRequire(fixture.ppro, (value) => { setupValue = value; }),
  };
  controllerApi.start(root);
  assert.ok(setupValue.panels[controllerApi.PANEL_ID]);
  await document.dispatch("DOMContentLoaded");
  assert.equal(document.elements.get("inspect").listeners.has("click"), true);
});
