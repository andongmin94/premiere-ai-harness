"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const adapter = require("../plugin/lib/premiere-adapter.js");
const runtime = require("../plugin/lib/premiere-runtime.js");
const { makeFixture, makeFolder } = require("./premiere-fixture.js");

const fast = { delay: async () => {}, timeoutMs: 300 };

test("inspects one supported selected clip and binds project identity", async () => {
  const { ppro } = makeFixture({ fps: 29.97, duration: 12.5, projectId: "project-42" });
  const result = await adapter.inspectSelection(ppro);
  assert.deepEqual({ projectId: result.projectId, clipId: result.clipId, duration: result.duration, frameRate: result.frameRate }, {
    projectId: "project-42", clipId: "clip-1", duration: 12.5, frameRate: 29.97,
  });
  assert.equal(result.hasTranscript, true);
});

test("loads Premiere transcript without exposing internal context objects", async () => {
  const { ppro } = makeFixture();
  const result = await adapter.loadSelectedTranscript(ppro);
  assert.match(result.json, /hello/);
  assert.equal(result.clipName, "camera.mp4");
  assert.equal(Object.hasOwn(result, "context"), false);
});

test("aligns ranges inward and rejects a keep range that collapses to zero frames", () => {
  const ranges = adapter.alignKeepRangesToFrames([{ start: 0.001, end: 1.049 }, { start: 1.05, end: 2.001 }], 3, 25);
  assert.deepEqual(ranges.map(({ startFrame, endFrame }) => ({ startFrame, endFrame })), [
    { startFrame: 1, endFrame: 26 }, { startFrame: 27, endFrame: 50 },
  ]);
  assert.throws(() => adapter.alignKeepRangesToFrames([{ start: 1.001, end: 1.01 }], 3, 25), /프레임 정렬 후 사라집니다/);
});

test("creates hard-boundary subclips in an isolated output bin and a new sequence", async () => {
  const { ppro, project, parent, source } = makeFixture();
  const result = await adapter.createRoughCut(ppro, [{ start: 0, end: 1 }, { start: 2, end: 3 }], "camera_AI_ROUGH_CUT", fast);
  assert.equal(result.segmentCount, 2);
  assert.match(result.operationId, /^PAI_OUTPUT_/);
  assert.equal(project.activeSequence.name, "camera_AI_ROUGH_CUT");
  assert.equal(project.activeSequence.clips.length, 2);
  assert.equal(project.activeSequence.clips[0].hardBoundaries, true);
  assert.deepEqual(project.activeSequence.clips[0].mediaOptions, { takeVideo: true, takeAudio: true });
  assert.equal(parent.items.includes(source), true);
  assert.ok(parent.items.find((item) => item.kind === "folder" && item.name.startsWith("PAI_OUTPUT_")));
});

test("uses a unique sequence name without overwriting an existing sequence", async () => {
  const { ppro, project } = makeFixture({ existingSequence: "AI_ROUGH_CUT" });
  const result = await adapter.createRoughCut(ppro, [{ start: 0, end: 1 }], "AI_ROUGH_CUT", fast);
  assert.equal(result.sequenceName, "AI_ROUGH_CUT_2");
  assert.deepEqual(project.sequences.map((sequence) => sequence.name), ["AI_ROUGH_CUT", "AI_ROUGH_CUT_2"]);
});

test("fails before mutation for invalid selection and unsupported source types", async () => {
  await assert.rejects(() => adapter.inspectSelection(makeFixture({ noSelection: true }).ppro), /하나만 선택/);
  await assert.rejects(() => adapter.inspectSelection(makeFixture({ multiSelection: true }).ppro), /하나만 선택/);
  await assert.rejects(() => adapter.inspectSelection(makeFixture({ offline: true }).ppro), /오프라인/);
  await assert.rejects(() => adapter.inspectSelection(makeFixture({ multicam: true }).ppro), /멀티캠/);
  await assert.rejects(() => adapter.loadSelectedTranscript(makeFixture({ hasTranscript: false }).ppro), /전사문/);
});

test("rejects stale project, clip, duration, frame rate, and Premiere transcript", async () => {
  const fixture = makeFixture({ transcriptJson: JSON.stringify({ segments: [{ start: 0, end: 1, text: "changed" }] }) });
  const base = { projectId: "project-guid", clipId: "clip-1", duration: 10, frameRate: 25 };
  await assert.rejects(() => adapter.createRoughCut(fixture.ppro, [{ start: 0, end: 1 }], "X", { ...fast, expectedSource: { ...base, projectId: "other" } }), /프로젝트가 바뀌었습니다/);
  await assert.rejects(() => adapter.createRoughCut(fixture.ppro, [{ start: 0, end: 1 }], "X", { ...fast, expectedSource: { ...base, clipId: "other" } }), /원본 클립이 바뀌었습니다/);
  await assert.rejects(() => adapter.createRoughCut(fixture.ppro, [{ start: 0, end: 1 }], "X", { ...fast, expectedSource: { ...base, duration: 11 } }), /원본 길이가 달라졌습니다/);
  await assert.rejects(() => adapter.createRoughCut(fixture.ppro, [{ start: 0, end: 1 }], "X", { ...fast, expectedSource: { ...base, frameRate: 30 } }), /프레임레이트가 달라졌습니다/);
  await assert.rejects(() => adapter.createRoughCut(fixture.ppro, [{ start: 0, end: 1 }], "X", {
    ...fast,
    expectedSource: base,
    expectedTranscriptJson: JSON.stringify({ segments: [{ start: 0, end: 1, text: "original" }] }),
  }), /전사문이 바뀌었습니다/);
});

test("accepts semantically identical Premiere JSON with different object key order", async () => {
  const current = JSON.stringify({ segments: [{ text: "same", end: 1, start: 0 }], meta: { b: 2, a: 1 } });
  const expected = JSON.stringify({ meta: { a: 1, b: 2 }, segments: [{ start: 0, end: 1, text: "same" }] });
  const { ppro } = makeFixture({ transcriptJson: current });
  const result = await adapter.createRoughCut(ppro, [{ start: 0, end: 1 }], "SAME", { ...fast, expectedTranscriptJson: expected });
  assert.equal(result.sequenceName, "SAME");
});

test("rolls back bins and subclips when sequence creation fails before mutation", async () => {
  const { ppro, project, parent } = makeFixture({ failSequenceBeforeCreate: true });
  await assert.rejects(() => adapter.createRoughCut(ppro, [{ start: 0, end: 1 }], "FAIL", fast), /sequence failed before create/);
  assert.equal(project.sequences.length, 0);
  assert.equal(parent.items.some((item) => String(item.name).startsWith("PAI_OUTPUT_")), false);
});

test("finds and rolls back a sequence created just before the host throws", async () => {
  const { ppro, project, parent } = makeFixture({ failSequenceAfterCreate: true });
  await assert.rejects(() => adapter.createRoughCut(ppro, [{ start: 0, end: 1 }], "PARTIAL", fast), /sequence failed after create/);
  assert.equal(project.sequences.length, 0);
  assert.equal(parent.items.some((item) => String(item.name).startsWith("PAI_OUTPUT_")), false);
});


test("rolls back the only newly created sequence even if the host renames it before throwing", async () => {
  const { ppro, project, parent } = makeFixture({ failSequenceAfterCreate: true, createdSequenceName: "HOST_RENAMED" });
  await assert.rejects(() => adapter.createRoughCut(ppro, [{ start: 0, end: 1 }], "REQUESTED", fast), /sequence failed after create/);
  assert.equal(project.sequences.length, 0);
  assert.equal(parent.items.some((item) => String(item.name).startsWith("PAI_OUTPUT_")), false);
});

test("rolls back a created sequence when activation fails", async () => {
  const { ppro, project, parent } = makeFixture({ failActivate: true, existingSequence: "EDIT" });
  await assert.rejects(() => adapter.createRoughCut(ppro, [{ start: 0, end: 1 }], "ACTIVATE_FAIL", fast), /활성화/);
  assert.deepEqual(project.sequences.map((sequence) => sequence.name), ["EDIT"]);
  assert.equal(parent.items.some((item) => String(item.name).startsWith("PAI_OUTPUT_")), false);
});

test("preserves foreign items in a generated bin and reports incomplete cleanup", async () => {
  const { ppro, parent } = makeFixture({ failSequenceBeforeCreate: true, foreignInGeneratedBin: true });
  await assert.rejects(() => adapter.createRoughCut(ppro, [{ start: 0, end: 1 }], "FOREIGN", fast), /플러그인이 만들지 않은 항목/);
  const generated = parent.items.find((item) => String(item.name).startsWith("PAI_OUTPUT_"));
  assert.ok(generated);
  assert.ok(generated.items.some((item) => item.name === "user-owned.mov"));
});

test("host self-test mutates, cleans, and restores the prior active sequence", async () => {
  const { ppro, project, parent, existing } = makeFixture({ existingSequence: "EDIT" });
  const result = await adapter.runHostSelfTest(ppro, fast);
  assert.equal(result.status, "PASS");
  assert.equal(result.cleaned, true);
  assert.deepEqual(result.checks, { subclip: true, sequence: true, activation: true, cleanup: true });
  assert.equal(project.activeSequence, existing);
  assert.deepEqual(project.sequences, [existing]);
  assert.equal(parent.items.some((item) => runtime.isInternalName(item.name)), false);
});

test("host self-test refuses certification when cleanup cannot complete", async () => {
  const { ppro } = makeFixture({ failRemoveBin: true });
  await assert.rejects(() => adapter.runHostSelfTest(ppro, fast), /정리/);
});

test("recovery cleanup removes exact internal names and preserves output and user bins", async () => {
  const fixture = makeFixture();
  const internalBase = `${adapter.SELF_TEST_PREFIX}abc12345_deadbeef`;
  const internal = makeFolder(`${internalBase}_BIN`, fixture.parent, fixture.context, fixture.options);
  internal.items.push({ kind: "clip", name: `${internalBase}_CLIP`, parent: internal });
  const output = makeFolder("PAI_OUTPUT_keep", fixture.parent, fixture.context, fixture.options);
  const lookalike = makeFolder("PAI_INTERNAL_SELFTEST_user", fixture.parent, fixture.context, fixture.options);
  fixture.parent.items.push(internal, output, lookalike);
  fixture.project.sequences.push({ guid: "stale-seq", name: internalBase });

  const result = await adapter.cleanupSelfTestArtifacts(fixture.ppro, fast);
  assert.equal(result.status, "PASS");
  assert.equal(fixture.parent.items.includes(internal), false);
  assert.equal(fixture.parent.items.includes(output), true);
  assert.equal(fixture.parent.items.includes(lookalike), true);
});

test("rejects more than the output segment limit before mutation", async () => {
  const ranges = Array.from({ length: adapter.MAX_OUTPUT_SEGMENTS + 1 }, (_, index) => ({ start: index * 1.5, end: index * 1.5 + 0.5 }));
  const { ppro, project, parent } = makeFixture({ duration: 1000 });
  await assert.rejects(() => adapter.createRoughCut(ppro, ranges, "TOO_MANY", fast), /500개/);
  assert.equal(project.sequences.length, 0);
  assert.equal(parent.items.some((item) => String(item.name).startsWith("PAI_OUTPUT_")), false);
});

test("rollback deletes only the newly created sequence when the host reuses a user sequence name", async () => {
  const fixture = makeFixture({
    existingSequence: "USER_SEQUENCE",
    createdSequenceName: "USER_SEQUENCE",
    failSequenceAfterCreate: true,
  });
  await assert.rejects(() => adapter.createRoughCut(
    fixture.ppro,
    [{ start: 0, end: 1 }],
    "REQUESTED_NAME",
    fast
  ), /sequence failed after create/);
  assert.deepEqual(fixture.project.sequences.map((sequence) => sequence.guid), ["old-sequence"]);
  assert.equal(fixture.project.sequences[0].name, "USER_SEQUENCE");
});
