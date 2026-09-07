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

test("sequence snapshot v2 records source in-out for every generated track item", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [{ start: 1, end: 2 }], "SOURCE_SNAPSHOT", fast);
  assert.equal(created.sequenceSnapshot.formatVersion, 2);
  const video = created.sequenceSnapshot.videoTracks[0].items[0];
  const audio = created.sequenceSnapshot.audioTracks[0].items[0];
  assert.deepEqual({ sourceIn: video.sourceIn, sourceOut: video.sourceOut }, { sourceIn: 1, sourceOut: 2 });
  assert.deepEqual({ sourceIn: audio.sourceIn, sourceOut: audio.sourceOut }, { sourceIn: 1, sourceOut: 2 });
});

test("save preparation rejects source-boundary drift even when timeline placement is unchanged", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [{ start: 1, end: 2 }], "SOURCE_DRIFT_BEFORE_SAVE", fast);
  fixture.project.activeSequence.clips[0].startFrame += 1;
  await assert.rejects(
    () => adapter.preparePersistedRoughCut(fixture.ppro, roughCutRecord(created)),
    /시퀀스 구조가 바뀌었습니다/
  );
  assert.equal(fixture.project.saveCount, 0);
});

test("later-session verification rejects source-boundary drift after save preparation", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [{ start: 1, end: 2 }], "SOURCE_DRIFT_AFTER_SAVE", fast);
  const roughCut = roughCutRecord(created);
  const prepared = await adapter.preparePersistedRoughCut(fixture.ppro, roughCut);
  fixture.project.activeSequence.clips[0].endFrame -= 1;
  await assert.rejects(
    () => adapter.verifyPersistedRoughCut(fixture.ppro, { ...roughCut, persistenceSnapshot: prepared.sequenceSnapshot }),
    /시퀀스 구조가 달라졌습니다/
  );
});

test("snapshot v1 is rejected instead of being accepted through a compatibility path", () => {
  const old = {
    formatVersion: 1,
    end: 1,
    videoTracks: [{ index: 0, items: [{ projectItemId: "subclip-1", projectItemName: "clip", start: 0, end: 1 }] }],
    audioTracks: [],
  };
  assert.throws(() => snapshots.normalizeSequenceSnapshot(old), /형식이 올바르지 않습니다/);
});
