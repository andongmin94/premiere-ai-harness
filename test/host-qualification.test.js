"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const qualification = require("../plugin/lib/host-qualification.js");

const environment = {
  hostName: "premierepro",
  hostVersion: "26.3.1",
  uxpVersion: "8.2.0",
  pluginVersion: "0.4.0",
  platform: "win32",
  arch: "x64",
};
const selection = {
  projectId: "project-1",
  projectName: "Project",
  clipId: "clip-1",
  clipName: "camera.mp4",
  duration: 10,
  frameRate: 25,
};

function makeStorage() {
  const values = new Map([["unrelated", "keep"]]);
  return {
    values,
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

test("qualification record advances only through verified steps and stores no transcript content", () => {
  const storage = makeStorage();
  let record = qualification.beginQualification(storage, environment, selection, "session-one", "2026-08-22T00:00:00.000Z");
  assert.equal(record.status, "PENDING");
  assert.equal(qualification.qualificationMatchesSelection(record, selection), true);
  assert.equal(qualification.canConfirmPersistence(record, "session-two"), false);

  assert.throws(() => qualification.recordHostSelfTest(storage, environment, selection, {
    status: "PASS",
    cleaned: true,
    checks: { subclip: true, sequence: true, activation: false, cleanup: true },
  }), /필요/);

  record = qualification.recordHostSelfTest(storage, environment, selection, {
    status: "PASS",
    cleaned: true,
    operationId: "self-test",
    checks: { subclip: true, sequence: true, activation: true, cleanup: true },
  }, "2026-08-22T00:01:00.000Z");
  record = qualification.recordRollbackSelfTest(storage, environment, selection, {
    status: "PASS",
    cleaned: true,
    operationId: "rollback-test",
    checks: { failureObserved: true, subclip: true, cleanup: true },
  }, "2026-08-22T00:02:00.000Z");
  record = qualification.recordPremiereTranscript(storage, environment, selection, {
    source: "premiere",
    segmentCount: 12,
    raw: "must not be persisted",
  }, "2026-08-22T00:03:00.000Z");
  record = qualification.recordRoughCut(storage, environment, selection, {
    projectId: "project-1",
    sequenceId: "sequence-1",
    sequenceName: "camera_AI_ROUGH_CUT",
    operationId: "PAI_OUTPUT_test",
    segmentCount: 3,
  }, "session-one", "2026-08-22T00:04:00.000Z");
  record = qualification.recordPlaybackConfirmation(storage, environment, selection, true, "2026-08-22T00:05:00.000Z");

  assert.equal(record.status, "PENDING");
  assert.equal(qualification.canConfirmPersistence(record, "session-one"), false);
  assert.equal(qualification.canConfirmPersistence(record, "session-two"), true);
  assert.equal(storage.values.get(qualification.QUALIFICATION_STORAGE_KEY).includes("must not be persisted"), false);

  record = qualification.recordPersistenceConfirmation(storage, environment, "session-two", {
    status: "PASS",
    projectId: "project-1",
    sequenceId: "sequence-1",
    sequenceName: "camera_AI_ROUGH_CUT",
  }, "2026-08-22T00:06:00.000Z");
  assert.equal(record.status, "PASS");
  assert.equal(qualification.isQualificationComplete(record), true);
  assert.match(qualification.qualificationSummary(record), /완료/);
  assert.match(qualification.qualificationReport(record), /"segmentCount": 12/);
});

test("qualification is bound to the exact host and source selection", () => {
  const storage = makeStorage();
  const record = qualification.beginQualification(storage, environment, selection, "session-one");
  assert.ok(qualification.readQualification(storage, environment));
  assert.equal(qualification.readQualification(storage, { ...environment, pluginVersion: "0.4.1" }), null);
  assert.equal(qualification.qualificationMatchesSelection(record, { ...selection, clipId: "clip-2" }), false);
  assert.throws(() => qualification.recordPremiereTranscript(storage, environment, { ...selection, projectId: "other" }, {
    source: "premiere",
    segmentCount: 2,
  }), /바뀌었습니다/);
});

test("persistence confirmation rejects the same session and mismatched sequence", () => {
  const storage = makeStorage();
  qualification.beginQualification(storage, environment, selection, "session-one");
  qualification.recordRoughCut(storage, environment, selection, {
    projectId: "project-1",
    sequenceId: "sequence-1",
    sequenceName: "rough-cut",
    operationId: "operation-1",
    segmentCount: 1,
  }, "session-one");
  assert.throws(() => qualification.recordPersistenceConfirmation(storage, environment, "session-one", {
    status: "PASS",
    projectId: "project-1",
    sequenceId: "sequence-1",
    sequenceName: "rough-cut",
  }), /새 패널 세션/);
  assert.throws(() => qualification.recordPersistenceConfirmation(storage, environment, "session-two", {
    status: "PASS",
    projectId: "project-1",
    sequenceId: "other",
    sequenceName: "rough-cut",
  }), /바뀌었습니다/);
});

test("clearing qualification removes only the plugin-owned record", () => {
  const storage = makeStorage();
  qualification.beginQualification(storage, environment, selection, "session-one");
  qualification.clearQualification(storage);
  assert.equal(storage.values.get("unrelated"), "keep");
  assert.equal(storage.values.has(qualification.QUALIFICATION_STORAGE_KEY), false);
  storage.values.set(qualification.QUALIFICATION_STORAGE_KEY, "not json");
  assert.equal(qualification.readQualification(storage, environment), null);
});
