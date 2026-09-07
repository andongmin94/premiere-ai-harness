"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const adapter = require("../plugin/lib/premiere-adapter.js");
const { makeFixture } = require("./premiere-fixture.js");

const fast = { delay: async () => {}, timeoutMs: 300 };

function hasGeneratedItem(fixture, prefix) {
  return fixture.parent.items.some((item) => String(item.name || "").startsWith(prefix));
}

test("rough cut keeps source project-item in-out state unchanged while using the same media file", async () => {
  const fixture = makeFixture({
    sourceVideoInFrame: 7,
    sourceVideoOutFrame: 220,
    sourceAudioInFrame: 5,
    sourceAudioOutFrame: 225,
  });
  const before = {
    videoIn: (await fixture.source.getInPoint("video")).seconds,
    videoOut: (await fixture.source.getOutPoint("video")).seconds,
    audioIn: (await fixture.source.getInPoint("audio")).seconds,
    audioOut: (await fixture.source.getOutPoint("audio")).seconds,
  };
  const result = await adapter.createRoughCut(fixture.ppro, [{ start: 1, end: 2 }], "SOURCE_OK", fast);
  assert.equal(result.segmentCount, 1);
  assert.equal(fixture.project.sequences.length, 1);
  assert.deepEqual({
    videoIn: (await fixture.source.getInPoint("video")).seconds,
    videoOut: (await fixture.source.getOutPoint("video")).seconds,
    audioIn: (await fixture.source.getInPoint("audio")).seconds,
    audioOut: (await fixture.source.getOutPoint("audio")).seconds,
  }, before);
});

test("rough cut rejects a generated subclip that resolves to a different media file and rolls back", async () => {
  const fixture = makeFixture({ subclipMediaPath: "C:/media/wrong-camera.mp4" });
  await assert.rejects(
    () => adapter.createRoughCut(fixture.ppro, [{ start: 1, end: 2 }], "WRONG_MEDIA", fast),
    /다른 미디어/
  );
  assert.equal(fixture.project.sequences.length, 0);
  assert.equal(hasGeneratedItem(fixture, "PAI_OUTPUT_"), false);
});

test("host self-test rejects source in-out mutation caused during subclip creation and cleans internal assets", async () => {
  const fixture = makeFixture({ mutateSourceVideoInFrames: 1 });
  await assert.rejects(() => adapter.runHostSelfTest(fixture.ppro, fast), /원본 VIDEO in\/out 상태가 바뀌었습니다/);
  assert.equal(fixture.project.sequences.length, 0);
  assert.equal(hasGeneratedItem(fixture, "PAI_INTERNAL_"), false);
});

test("rough cut rechecks source invariance after sequence creation and removes the created sequence on failure", async () => {
  const fixture = makeFixture();
  const originalCreateSequence = fixture.project.createSequenceFromMedia.bind(fixture.project);
  const originalGetOutPoint = fixture.source.getOutPoint.bind(fixture.source);
  fixture.project.createSequenceFromMedia = async function (name, clips, targetBin) {
    const sequence = await originalCreateSequence(name, clips, targetBin);
    fixture.source.getOutPoint = async function (mediaType) {
      const value = await originalGetOutPoint(mediaType);
      return { seconds: value.seconds + (mediaType === "video" ? 1 / 25 : 0) };
    };
    return sequence;
  };
  await assert.rejects(
    () => adapter.createRoughCut(fixture.ppro, [{ start: 1, end: 2 }], "MUTATED_AFTER_SEQUENCE", fast),
    /원본 VIDEO in\/out 상태가 바뀌었습니다/
  );
  assert.equal(fixture.project.sequences.length, 0);
  assert.equal(hasGeneratedItem(fixture, "PAI_OUTPUT_"), false);
});

test("source identity APIs must be available before any rough-cut mutation", async () => {
  const missingPath = makeFixture({ missingSourceMediaPathApi: true });
  await assert.rejects(
    () => adapter.createRoughCut(missingPath.ppro, [{ start: 0, end: 1 }], "NO_PATH_API", fast),
    /원본 검증 API/
  );
  assert.equal(missingPath.project.transactions.length, 0);
  assert.equal(hasGeneratedItem(missingPath, "PAI_OUTPUT_"), false);

  const missingBoundaries = makeFixture({ missingSourceBoundaryApi: true });
  await assert.rejects(
    () => adapter.createRoughCut(missingBoundaries.ppro, [{ start: 0, end: 1 }], "NO_SOURCE_BOUNDARY", fast),
    /원본 검증 API/
  );
  assert.equal(missingBoundaries.project.transactions.length, 0);
});

test("rollback self-test also rejects wrong subclip media identity and leaves no internal assets", async () => {
  const fixture = makeFixture({ subclipMediaPath: "C:/media/other.mp4" });
  await assert.rejects(() => adapter.runRollbackSelfTest(fixture.ppro, fast), /다른 미디어/);
  assert.equal(fixture.project.sequences.length, 0);
  assert.equal(hasGeneratedItem(fixture, "PAI_INTERNAL_"), false);
});
