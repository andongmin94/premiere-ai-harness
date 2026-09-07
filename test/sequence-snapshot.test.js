"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const snapshots = require("../plugin/lib/sequence-snapshot.js");
const adapter = require("../plugin/lib/premiere-adapter.js");
const { makeFixture } = require("./premiere-fixture.js");

const fast = { delay: async () => {}, timeoutMs: 300 };

function expectedSegments(snapshot) {
  const tracks = [...snapshot.videoTracks, ...snapshot.audioTracks];
  const track = tracks.find((item) => item.items.length > 0);
  return track.items.map((item) => ({ name: item.projectItemName, duration: item.end - item.start }));
}

test("reads deterministic video and audio sequence structure with source ranges", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
  ], "SNAPSHOT", fast);
  const snapshot = created.sequenceSnapshot;
  assert.equal(snapshot.formatVersion, 3);
  assert.equal(snapshot.end, 2);
  assert.equal(snapshot.videoTracks[0].items.length, 2);
  assert.equal(snapshot.audioTracks[0].items.length, 2);
  assert.deepEqual({
    projectSourceIn: snapshot.videoTracks[0].items[1].projectSourceIn,
    projectSourceOut: snapshot.videoTracks[0].items[1].projectSourceOut,
    trackSourceIn: snapshot.videoTracks[0].items[1].trackSourceIn,
    trackSourceOut: snapshot.videoTracks[0].items[1].trackSourceOut,
  }, { projectSourceIn: 2, projectSourceOut: 3, trackSourceIn: 0, trackSourceOut: 1 });
  assert.deepEqual(snapshots.validateSequenceSegmentCount(snapshot, 2), snapshot);
  assert.deepEqual(snapshots.validateGeneratedSequenceSnapshot(snapshot, expectedSegments(snapshot)), snapshot);
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
  const expected = expectedSegments(created.sequenceSnapshot);
  const duplicate = structuredClone(created.sequenceSnapshot);
  duplicate.videoTracks[0].items.push({
    ...duplicate.videoTracks[0].items[0],
    projectItemId: "foreign-id",
  });
  assert.throws(
    () => snapshots.validateGeneratedSequenceSnapshot(duplicate, expected),
    /예상한 모든 서브클립만/
  );
});

test("rejects shifted clip boundaries even when clip ids and count still match", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
  ], "SHIFTED", fast);
  const expected = expectedSegments(created.sequenceSnapshot);
  const shifted = structuredClone(created.sequenceSnapshot);
  for (const tracks of [shifted.videoTracks, shifted.audioTracks]) {
    tracks[0].items[1].start += 0.1;
    tracks[0].items[1].end += 0.1;
  }
  shifted.end += 0.1;
  assert.throws(
    () => snapshots.validateGeneratedSequenceSnapshot(shifted, expected),
    /클립 경계 또는 길이|종료 시간/
  );
});

test("rejects initially slipped generated TrackItems before blessing the snapshot baseline", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [{ start: 1, end: 2 }], "INITIAL_SLIP", fast);
  const expected = expectedSegments(created.sequenceSnapshot);
  const slipped = structuredClone(created.sequenceSnapshot);
  for (const tracks of [slipped.videoTracks, slipped.audioTracks]) {
    tracks[0].items[0].trackSourceIn += 0.1;
    tracks[0].items[0].trackSourceOut += 0.1;
  }
  assert.throws(() => snapshots.validateGeneratedSequenceSnapshot(slipped, expected), /source 범위/);
});

test("rejects changed generated-subclip order", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
  ], "ORDER", fast);
  const expected = expectedSegments(created.sequenceSnapshot);
  const reordered = structuredClone(created.sequenceSnapshot);
  for (const tracks of [reordered.videoTracks, reordered.audioTracks]) {
    const first = tracks[0].items[0];
    const second = tracks[0].items[1];
    [first.projectItemId, second.projectItemId] = [second.projectItemId, first.projectItemId];
    [first.projectItemName, second.projectItemName] = [second.projectItemName, first.projectItemName];
  }
  assert.throws(
    () => snapshots.validateGeneratedSequenceSnapshot(reordered, expected),
    /서브클립 순서/
  );
});

test("rejects inconsistent A/V timeline or track source boundaries for the same generated subclip", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
  ], "AV_MISMATCH", fast);
  const expected = expectedSegments(created.sequenceSnapshot);

  const timelineMismatch = structuredClone(created.sequenceSnapshot);
  timelineMismatch.audioTracks[0].items[1].end += 0.1;
  assert.throws(() => snapshots.validateGeneratedSequenceSnapshot(timelineMismatch, expected), /A\/V timeline 또는 source/);

  const sourceMismatch = structuredClone(created.sequenceSnapshot);
  sourceMismatch.audioTracks[0].items[1].trackSourceIn += 0.1;
  assert.throws(() => snapshots.validateGeneratedSequenceSnapshot(sourceMismatch, expected), /A\/V timeline 또는 source/);
});

test("rejects a partial A/V layout while still allowing truly single-media sequences", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
  ], "PARTIAL_AV", fast);
  const expected = expectedSegments(created.sequenceSnapshot);
  const partial = structuredClone(created.sequenceSnapshot);
  partial.videoTracks[0].items.pop();
  assert.throws(
    () => snapshots.validateGeneratedSequenceSnapshot(partial, expected),
    /video 트랙에 일부 유지 구간/
  );
});
