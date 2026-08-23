"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const controllerApi = require("../plugin/index.js");
const certification = require("../plugin/lib/host-certification.js");
const qualificationApi = require("../plugin/lib/host-qualification.js");
const { makeFixture } = require("./premiere-fixture.js");

const IDS = [
  "inspect", "host-self-test", "cleanup-self-test", "load-premiere", "analyze-pasted", "apply", "reset-data",
  "preset", "transcript-input", "candidate-list", "plan-stats", "selection-info", "host-badge", "host-status", "status",
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

test("guided qualification requires a later panel session before persistence can pass", async () => {
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
  await first.runHostSelfTest();
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
  document.elements.get("transcript-input").value = "old pasted text";
  await controller.inspectSelection();
  assert.equal(controller.getSession().plan, null);
  assert.equal(controller.getSession().transcript, null);
  assert.equal(document.elements.get("transcript-input").value, "");
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
  await controller.analyzePastedTranscript();
  assert.equal(controller.getSession().plan, originalPlan);
  assert.equal(controller.getSession().transcript, originalTranscript);
  assert.match(document.elements.get("status").textContent, /형식/);
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
