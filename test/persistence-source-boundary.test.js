"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const adapter = require("../plugin/lib/premiere-adapter.js");
const snapshots = require("../plugin/lib/sequence-snapshot.js");
const { makeFixture } = require("./premiere-fixture.js");

const fast = { delay: async () => {}, timeoutMs: 300 };

function roughCutRecord(created) {
  return {
    status: "PASS",
    projectId: created.projectId,
    sequenceId: created.sequenceId,
    sequenceName: created.sequenceName,
    segmentCount: created.segmentCount,
    createdSnapshot: created.sequenceSnapshot,
  };
}

function shiftTrackSource(sequence, field, delta) {
  sequence.videoItems[0][field] += delta;
  sequence.audioItems[0][field] += delta;
}

test("sequence snapshot v3 records project-item and track-item source ranges", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [{ start: 1, end: 2 }], "SOURCE_SNAPSHOT", fast);
  assert.equal(created.sequenceSnapshot.formatVersion, 3);
  const video = created.sequenceSnapshot.videoTracks[0].items[0];
  const audio = created.sequenceSnapshot.audioTracks[0].items[0];
  const expected = { projectSourceIn: 1, projectSourceOut: 2, trackSourceIn: 0, trackSourceOut: 1 };
  assert.deepEqual({
    projectSourceIn: video.projectSourceIn,
    projectSourceOut: video.projectSourceOut,
    trackSourceIn: video.trackSourceIn,
    trackSourceOut: video.trackSourceOut,
  }, expected);
  assert.deepEqual({
    projectSourceIn: audio.projectSourceIn,
    projectSourceOut: audio.projectSourceOut,
    trackSourceIn: audio.trackSourceIn,
    trackSourceOut: audio.trackSourceOut,
  }, expected);
});

test("save preparation rejects project-item source-boundary drift with unchanged timeline placement", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [{ start: 1, end: 2 }], "PROJECT_SOURCE_DRIFT", fast);
  fixture.project.activeSequence.clips[0].startFrame += 1;
  await assert.rejects(
    () => adapter.preparePersistedRoughCut(fixture.ppro, roughCutRecord(created)),
    /시퀀스 구조가 바뀌었습니다/
  );
  assert.equal(fixture.project.saveCount, 0);
});

test("save preparation rejects linked A/V track-item slip with unchanged project item and timeline", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [{ start: 1, end: 2 }], "TRACK_SLIP_BEFORE_SAVE", fast);
  shiftTrackSource(fixture.project.activeSequence, "trackSourceIn", 1 / 25);
  await assert.rejects(
    () => adapter.preparePersistedRoughCut(fixture.ppro, roughCutRecord(created)),
    /시퀀스 구조가 바뀌었습니다/
  );
  assert.equal(fixture.project.saveCount, 0);
});

test("later-session verification rejects track-item source drift after save preparation", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [{ start: 1, end: 2 }], "TRACK_SLIP_AFTER_SAVE", fast);
  const roughCut = roughCutRecord(created);
  const prepared = await adapter.preparePersistedRoughCut(fixture.ppro, roughCut);
  shiftTrackSource(fixture.project.activeSequence, "trackSourceOut", -1 / 25);
  await assert.rejects(
    () => adapter.verifyPersistedRoughCut(fixture.ppro, { ...roughCut, persistenceSnapshot: prepared.sequenceSnapshot }),
    /시퀀스 구조가 달라졌습니다/
  );
});

test("snapshot v2 is rejected instead of being accepted through a compatibility path", () => {
  const old = {
    formatVersion: 2,
    end: 1,
    videoTracks: [{ index: 0, items: [{
      projectItemId: "subclip-1", projectItemName: "clip", start: 0, end: 1, sourceIn: 1, sourceOut: 2,
    }] }],
    audioTracks: [],
  };
  assert.throws(() => snapshots.normalizeSequenceSnapshot(old), /형식이 올바르지 않습니다/);
});
