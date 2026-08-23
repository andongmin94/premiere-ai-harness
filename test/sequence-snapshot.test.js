"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const snapshots = require("../plugin/lib/sequence-snapshot.js");
const adapter = require("../plugin/lib/premiere-adapter.js");
const { makeFixture } = require("./premiere-fixture.js");

const fast = { delay: async () => {}, timeoutMs: 300 };

test("reads deterministic video and audio sequence structure", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
  ], "SNAPSHOT", fast);
  const snapshot = created.sequenceSnapshot;
  assert.equal(snapshot.end, 2);
  assert.equal(snapshot.videoTracks[0].items.length, 2);
  assert.equal(snapshot.audioTracks[0].items.length, 2);
  assert.deepEqual(snapshots.validateSequenceSegmentCount(snapshot, 2), snapshot);
  assert.equal(snapshots.sameSequenceSnapshot(snapshot, JSON.parse(JSON.stringify(snapshot))), true);
});

test("accepts audio-only or video-only generated sequences", async () => {
  const audioOnly = makeFixture({ omitVideo: true });
  const audio = await adapter.createRoughCut(audioOnly.ppro, [{ start: 0, end: 1 }], "AUDIO", fast);
  assert.equal(audio.sequenceSnapshot.videoTracks.length, 0);
  assert.equal(audio.sequenceSnapshot.audioTracks[0].items.length, 1);

  const videoOnly = makeFixture({ omitAudio: true });
  const video = await adapter.createRoughCut(videoOnly.ppro, [{ start: 0, end: 1 }], "VIDEO", fast);
  assert.equal(video.sequenceSnapshot.audioTracks.length, 0);
  assert.equal(video.sequenceSnapshot.videoTracks[0].items.length, 1);
});

test("rejects empty or incomplete generated sequences and rolls them back", async () => {
  const empty = makeFixture({ emptySequence: true });
  await assert.rejects(() => adapter.createRoughCut(empty.ppro, [{ start: 0, end: 1 }], "EMPTY", fast), /길이가 비어|예상한 모든/);
  assert.equal(empty.project.sequences.length, 0);

  const incomplete = makeFixture({ missingLastSequenceItem: true });
  await assert.rejects(() => adapter.createRoughCut(incomplete.ppro, [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
  ], "INCOMPLETE", fast), /예상한 모든/);
  assert.equal(incomplete.project.sequences.length, 0);
});
test("rejects duplicate-name items with different project identities", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
  ], "DUPLICATE_ID", fast);
  const duplicate = structuredClone(created.sequenceSnapshot);
  duplicate.videoTracks[0].items.push({
    ...duplicate.videoTracks[0].items[0],
    projectItemId: "foreign-id",
  });
  const expectedNames = created.sequenceSnapshot.videoTracks[0].items.map((item) => item.projectItemName);
  assert.throws(
    () => snapshots.validateGeneratedSequenceSnapshot(duplicate, expectedNames),
    /예상한 모든 서브클립만/
  );
});

