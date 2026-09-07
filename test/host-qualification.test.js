"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const qualification = require("../plugin/lib/host-qualification.js");

const environment = {
  hostName: "premierepro",
  hostVersion: "26.3.1",
  uxpVersion: "8.2.0",
  pluginVersion: "0.5.1",
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
const premiereSegments = Object.freeze([
  Object.freeze({ start: 0, end: 1, text: "첫 문장입니다.", speaker: "host" }),
  Object.freeze({ start: 1.2, end: 2.4, text: "두 번째 문장입니다.", speaker: "host" }),
]);

function makeStorage() {
  const values = new Map([["unrelated", "keep"]]);
  return {
    values,
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function sourceEvidence(overrides = {}) {
  return { projectId: "project-1", clipId: "clip-1", duration: 10, frameRate: 25, ...overrides };
}

function hostSelfTestResult(overrides = {}) {
  return {
    status: "PASS",
    cleaned: true,
    operationId: "self-test",
    ...sourceEvidence(),
    checks: { subclip: true, sequence: true, activation: true, cleanup: true },
    ...overrides,
  };
}

function rollbackSelfTestResult(overrides = {}) {
  return {
    status: "PASS",
    cleaned: true,
    operationId: "rollback-test",
    ...sourceEvidence(),
    checks: { failureObserved: true, subclip: true, cleanup: true },
    ...overrides,
  };
}

function transcriptDetails(segments = premiereSegments) {
  return {
    source: "premiere",
    segmentCount: segments.length,
    fingerprint: qualification.transcriptFingerprint(segments),
  };
}

function makeSnapshot(ids = ["subclip-1", "subclip-2", "subclip-3"]) {
  const items = ids.map((projectItemId, index) => ({
    projectItemId,
    projectItemName: `clip-${index + 1}`,
    start: index,
    end: index + 1,
    projectSourceIn: index,
    projectSourceOut: index + 1,
    trackSourceIn: 0,
    trackSourceOut: 1,
  }));
  return {
    formatVersion: 3,
    end: ids.length,
    videoTracks: [{ index: 0, items }],
    audioTracks: [{ index: 0, items }],
  };
}

function recordRoughCut(storage, snapshot = makeSnapshot(), fingerprint = transcriptDetails().fingerprint) {
  return qualification.recordRoughCut(storage, environment, selection, {
    projectId: "project-1",
    sequenceId: "sequence-1",
    sequenceName: "camera_AI_ROUGH_CUT",
    operationId: "PAI_OUTPUT_test",
    segmentCount: 3,
    sequenceSnapshot: snapshot,
  }, "session-one", fingerprint, "2026-08-22T00:04:00.000Z");
}

function recordPrePersistenceSteps(storage) {
  qualification.recordHostSelfTest(storage, environment, selection, hostSelfTestResult());
  qualification.recordRollbackSelfTest(storage, environment, selection, rollbackSelfTestResult());
  qualification.recordPremiereTranscript(storage, environment, selection, transcriptDetails());
}

test("qualification advances only through verified save and later-session structure checks", () => {
  const storage = makeStorage();
  let record = qualification.beginQualification(storage, environment, selection, "session-one", "2026-08-22T00:00:00.000Z");
  assert.equal(record.status, "PENDING");
  assert.equal(qualification.canPreparePersistence(record), false);
  assert.equal(qualification.canConfirmPersistence(record, "session-two"), false);

  assert.throws(() => qualification.recordHostSelfTest(storage, environment, selection, hostSelfTestResult({
    checks: { subclip: true, sequence: true, activation: false, cleanup: true },
  })), /필요/);

  record = qualification.recordHostSelfTest(storage, environment, selection, hostSelfTestResult(), "2026-08-22T00:01:00.000Z");
  record = qualification.recordRollbackSelfTest(storage, environment, selection, rollbackSelfTestResult(), "2026-08-22T00:02:00.000Z");
  record = qualification.recordPremiereTranscript(storage, environment, selection, {
    ...transcriptDetails(),
    raw: "must not be persisted",
  }, "2026-08-22T00:03:00.000Z");
  record = recordRoughCut(storage);
  record = qualification.recordPlaybackConfirmation(storage, environment, selection, true, "2026-08-22T00:05:00.000Z");

  assert.equal(qualification.canPreparePersistence(record), true);
  assert.equal(qualification.canConfirmPersistence(record, "session-two"), false);
  assert.equal(storage.values.get(qualification.QUALIFICATION_STORAGE_KEY).includes("must not be persisted"), false);
  assert.equal(record.steps.roughCut.transcriptFingerprint, record.steps.premiereTranscript.fingerprint);

  record = qualification.recordPersistencePreparation(storage, environment, "session-one", {
    status: "PASS",
    projectId: "project-1",
    sequenceId: "sequence-1",
    sequenceName: "camera_AI_ROUGH_CUT",
    sequenceSnapshot: makeSnapshot(),
  }, "2026-08-22T00:06:00.000Z");
  assert.equal(qualification.canPreparePersistence(record), false);
  assert.equal(qualification.canConfirmPersistence(record, "session-one"), false);
  assert.equal(qualification.canConfirmPersistence(record, "session-two"), true);

  record = qualification.recordPersistenceConfirmation(storage, environment, "session-two", {
    status: "PASS",
    projectId: "project-1",
    sequenceId: "sequence-1",
    sequenceName: "camera_AI_ROUGH_CUT",
    sequenceSnapshot: makeSnapshot(),
  }, "2026-08-22T00:07:00.000Z");
  assert.equal(record.status, "PASS");
  assert.equal(qualification.isQualificationComplete(record), true);
  assert.match(qualification.qualificationSummary(record), /완료/);
  assert.match(qualification.qualificationReport(record), /"fingerprint": "tx1-/);
});

test("transcript fingerprints are deterministic and sensitive to actual transcript changes", () => {
  const sameFormatting = [
    { start: 0, end: 1, text: "첫   문장입니다.", speaker: "host" },
    { start: 1.2, end: 2.4, text: "두 번째 문장입니다.", speaker: "host" },
  ];
  const changed = [
    premiereSegments[0],
    { ...premiereSegments[1], text: "완전히 다른 문장입니다." },
  ];
  assert.equal(qualification.transcriptFingerprint(premiereSegments), qualification.transcriptFingerprint(sameFormatting));
  assert.notEqual(qualification.transcriptFingerprint(premiereSegments), qualification.transcriptFingerprint(changed));
  assert.throws(() => qualification.transcriptFingerprint([]), /fingerprint/);
});

test("rough cut qualification requires the exact previously recorded Premiere transcript", () => {
  const storage = makeStorage();
  qualification.beginQualification(storage, environment, selection, "session-one");
  const fingerprint = transcriptDetails().fingerprint;
  assert.throws(() => recordRoughCut(storage), /검증한 Premiere 전사문/);
  qualification.recordPremiereTranscript(storage, environment, selection, transcriptDetails());
  assert.throws(() => recordRoughCut(storage, makeSnapshot(), "tx1-1-0000000000000000"), /일치/);
  const record = recordRoughCut(storage, makeSnapshot(), fingerprint);
  assert.equal(record.steps.roughCut.transcriptFingerprint, fingerprint);
});

test("a different Premiere transcript cannot replace provenance after the rough cut is recorded", () => {
  const storage = makeStorage();
  qualification.beginQualification(storage, environment, selection, "session-one");
  qualification.recordPremiereTranscript(storage, environment, selection, transcriptDetails());
  recordRoughCut(storage);
  const changed = [
    premiereSegments[0],
    { ...premiereSegments[1], text: "바뀐 문장입니다." },
  ];
  assert.throws(
    () => qualification.recordPremiereTranscript(storage, environment, selection, transcriptDetails(changed)),
    /다른 Premiere 전사문/
  );
  assert.equal(
    qualification.readQualification(storage, environment).steps.premiereTranscript.fingerprint,
    transcriptDetails().fingerprint
  );
});

test("self-test evidence must match the exact qualification source", () => {
  const storage = makeStorage();
  qualification.beginQualification(storage, environment, selection, "session-one");

  assert.throws(() => qualification.recordHostSelfTest(storage, environment, selection, hostSelfTestResult({ clipId: "clip-2" })), /원본 클립/);
  assert.throws(() => qualification.recordHostSelfTest(storage, environment, selection, hostSelfTestResult({ projectId: "project-2" })), /프로젝트/);
  assert.throws(() => qualification.recordHostSelfTest(storage, environment, selection, hostSelfTestResult({ frameRate: 30 })), /길이 또는 프레임레이트/);
  assert.throws(() => qualification.recordHostSelfTest(storage, environment, selection, hostSelfTestResult({ duration: undefined })), /길이 또는 프레임레이트/);

  qualification.recordHostSelfTest(storage, environment, selection, hostSelfTestResult());
  assert.throws(() => qualification.recordRollbackSelfTest(storage, environment, selection, rollbackSelfTestResult({ duration: 11 })), /길이 또는 프레임레이트/);
});

test("rollback qualification requires a host self-test pass first", () => {
  const storage = makeStorage();
  qualification.beginQualification(storage, environment, selection, "session-one");
  assert.throws(() => qualification.recordRollbackSelfTest(storage, environment, selection, rollbackSelfTestResult()), /호스트 자체시험/);
  qualification.recordHostSelfTest(storage, environment, selection, hostSelfTestResult());
  assert.equal(qualification.recordRollbackSelfTest(storage, environment, selection, rollbackSelfTestResult()).steps.rollbackSelfTest.status, "PASS");
});

test("persistence remains locked until every pre-save qualification step and transcript binding has passed", () => {
  const storage = makeStorage();
  let record = qualification.beginQualification(storage, environment, selection, "session-one");
  assert.throws(() => recordRoughCut(storage), /Premiere 전사문/);
  record = qualification.recordHostSelfTest(storage, environment, selection, hostSelfTestResult());
  assert.equal(qualification.canPreparePersistence(record), false);
  record = qualification.recordRollbackSelfTest(storage, environment, selection, rollbackSelfTestResult());
  assert.equal(qualification.canPreparePersistence(record), false);
  record = qualification.recordPremiereTranscript(storage, environment, selection, transcriptDetails());
  assert.equal(qualification.canPreparePersistence(record), false);
  record = recordRoughCut(storage);
  assert.equal(qualification.canPreparePersistence(record), false);
  record = qualification.recordPlaybackConfirmation(storage, environment, selection, true);
  assert.equal(qualification.canPreparePersistence(record), true);
});

test("qualification is bound to the exact host and source selection", () => {
  const storage = makeStorage();
  const record = qualification.beginQualification(storage, environment, selection, "session-one");
  assert.ok(qualification.readQualification(storage, environment));
  assert.equal(qualification.readQualification(storage, { ...environment, pluginVersion: "0.5.2" }), null);
  assert.equal(qualification.qualificationMatchesSelection(record, { ...selection, clipId: "clip-2" }), false);
  assert.throws(() => qualification.recordPremiereTranscript(storage, environment, { ...selection, projectId: "other" }, transcriptDetails()), /바뀌었습니다/);
});

test("persistence rejects same-session, mismatched sequence, and changed structure", () => {
  const storage = makeStorage();
  qualification.beginQualification(storage, environment, selection, "session-one");
  recordPrePersistenceSteps(storage);
  recordRoughCut(storage);
  qualification.recordPlaybackConfirmation(storage, environment, selection, true);
  qualification.recordPersistencePreparation(storage, environment, "session-one", {
    status: "PASS",
    projectId: "project-1",
    sequenceId: "sequence-1",
    sequenceName: "camera_AI_ROUGH_CUT",
    sequenceSnapshot: makeSnapshot(),
  });

  const valid = {
    status: "PASS",
    projectId: "project-1",
    sequenceId: "sequence-1",
    sequenceName: "camera_AI_ROUGH_CUT",
    sequenceSnapshot: makeSnapshot(),
  };
  assert.throws(() => qualification.recordPersistenceConfirmation(storage, environment, "session-one", valid), /새 패널 세션/);
  assert.throws(() => qualification.recordPersistenceConfirmation(storage, environment, "session-two", {
    ...valid,
    sequenceId: "other",
  }), /바뀌었습니다/);
  assert.throws(() => qualification.recordPersistenceConfirmation(storage, environment, "session-two", {
    ...valid,
    sequenceSnapshot: makeSnapshot(["subclip-1", "subclip-2", "changed"]),
  }), /구조가 달라졌습니다/);
});

test("malformed qualification records are discarded", () => {
  const storage = makeStorage();
  storage.values.set(qualification.QUALIFICATION_STORAGE_KEY, JSON.stringify({ formatVersion: 1 }));
  assert.equal(qualification.readQualification(storage, environment), null);
  storage.values.set(qualification.QUALIFICATION_STORAGE_KEY, "not json");
  assert.equal(qualification.readQualification(storage, environment), null);

  qualification.beginQualification(storage, environment, selection, "session-one", "2026-08-22T00:00:00.000Z");
  const malformed = JSON.parse(storage.values.get(qualification.QUALIFICATION_STORAGE_KEY));
  malformed.steps.premiereTranscript = { status: "PASS", completedAt: "2026-08-22T00:01:00.000Z", segmentCount: 2 };
  storage.values.set(qualification.QUALIFICATION_STORAGE_KEY, JSON.stringify(malformed));
  assert.equal(qualification.readQualification(storage, environment), null);
});

test("writing and clearing qualification preserve unrelated storage", () => {
  const storage = makeStorage();
  qualification.beginQualification(storage, environment, selection, "session-one");
  qualification.clearQualification(storage);
  assert.equal(storage.values.get("unrelated"), "keep");
  assert.equal(storage.values.has(qualification.QUALIFICATION_STORAGE_KEY), false);
});
