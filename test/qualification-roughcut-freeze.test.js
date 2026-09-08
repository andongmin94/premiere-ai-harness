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
const segments = [{ start: 0, end: 1, text: "검증 문장입니다.", speaker: "host" }];

function makeStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function snapshot(projectItemId = "subclip-1") {
  const item = {
    projectItemId,
    projectItemName: "clip-1",
    start: 0,
    end: 1,
    projectSourceIn: 0,
    projectSourceOut: 1,
    trackSourceIn: 0,
    trackSourceOut: 1,
  };
  return {
    formatVersion: 3,
    end: 1,
    videoTracks: [{ index: 0, items: [item] }],
    audioTracks: [{ index: 0, items: [item] }],
  };
}

function roughCut(sequenceId) {
  return {
    projectId: selection.projectId,
    sequenceId,
    sequenceName: `rough-${sequenceId}`,
    operationId: `op-${sequenceId}`,
    segmentCount: 1,
    sequenceSnapshot: snapshot(`subclip-${sequenceId}`),
  };
}

test("the first qualified rough cut cannot be overwritten by a later sequence", () => {
  const storage = makeStorage();
  qualification.beginQualification(storage, environment, selection, "session-one", "2026-09-08T00:00:00.000Z");
  const fingerprint = qualification.transcriptFingerprint(segments);
  qualification.recordPremiereTranscript(storage, environment, selection, {
    source: "premiere",
    segmentCount: segments.length,
    fingerprint,
  }, "2026-09-08T00:01:00.000Z");

  const first = qualification.recordRoughCut(
    storage,
    environment,
    selection,
    roughCut("sequence-1"),
    "session-one",
    fingerprint,
    "2026-09-08T00:02:00.000Z"
  );
  assert.equal(first.steps.roughCut.sequenceId, "sequence-1");

  assert.throws(() => qualification.recordRoughCut(
    storage,
    environment,
    selection,
    roughCut("sequence-2"),
    "session-one",
    fingerprint,
    "2026-09-08T00:03:00.000Z"
  ), /이미 기록/);

  const stored = qualification.readQualification(storage, environment);
  assert.equal(stored.steps.roughCut.sequenceId, "sequence-1");
  assert.equal(stored.steps.playback.status, "PENDING");
});
