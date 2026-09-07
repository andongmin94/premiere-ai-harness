"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const adapter = require("../plugin/lib/premiere-adapter.js");
const { makeFixture } = require("./premiere-fixture.js");

const fast = { delay: async () => {}, timeoutMs: 300 };

function expectedSource() {
  return { projectId: "project-guid", clipId: "clip-1", duration: 10, frameRate: 25 };
}

test("rollback self-test observes an intentional failure and leaves no internal assets", async () => {
  const fixture = makeFixture();
  const result = await adapter.runRollbackSelfTest(fixture.ppro, { ...fast, expectedSource: expectedSource() });
  assert.equal(result.status, "PASS");
  assert.equal(result.cleaned, true);
  assert.deepEqual(
    { projectId: result.projectId, clipId: result.clipId, duration: result.duration, frameRate: result.frameRate },
    expectedSource()
  );
  assert.deepEqual(result.checks, { failureObserved: true, subclip: true, cleanup: true });
  assert.equal(fixture.project.sequences.length, 0);
  assert.equal(fixture.parent.items.some((item) => String(item.name).startsWith("PAI_INTERNAL_")), false);
});

test("host and rollback self-tests reject a stale source before any mutation", async () => {
  for (const run of [adapter.runHostSelfTest, adapter.runRollbackSelfTest]) {
    const fixture = makeFixture();
    fixture.source.id = "clip-2";
    await assert.rejects(() => run(fixture.ppro, { ...fast, expectedSource: expectedSource() }), /원본 클립이 바뀌었습니다/);
    assert.equal(fixture.project.transactions.length, 0);
    assert.equal(fixture.project.sequences.length, 0);
    assert.equal(fixture.parent.items.some((item) => String(item.name).startsWith("PAI_INTERNAL_")), false);
  }
});

test("self-tests fail closed when an expected host identity disappears", async () => {
  const missingClip = makeFixture();
  missingClip.source.id = "";
  await assert.rejects(
    () => adapter.runHostSelfTest(missingClip.ppro, { ...fast, expectedSource: expectedSource() }),
    /원본 클립이 바뀌었습니다/
  );
  assert.equal(missingClip.project.transactions.length, 0);

  const missingProject = makeFixture();
  missingProject.project.guid = "";
  await assert.rejects(
    () => adapter.runRollbackSelfTest(missingProject.ppro, { ...fast, expectedSource: expectedSource() }),
    /프로젝트가 바뀌었습니다/
  );
  assert.equal(missingProject.project.transactions.length, 0);
});

test("rollback self-test refuses PASS when a foreign item prevents complete cleanup", async () => {
  const fixture = makeFixture({ foreignInGeneratedBin: true });
  await assert.rejects(() => adapter.runRollbackSelfTest(fixture.ppro, fast), /정리에도 실패/);
  const generated = fixture.parent.items.find((item) => String(item.name).startsWith("PAI_INTERNAL_TEMP_"));
  assert.ok(generated, "the user-owned item and its containing bin must be preserved");
  assert.equal(generated.items.some((item) => item.name === "user-owned.mov"), true);
});

test("persistence preparation saves the project and later verification requires the exact structure", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [{ start: 0, end: 1 }], "QUALIFIED", fast);
  const roughCut = {
    status: "PASS",
    projectId: created.projectId,
    sequenceId: created.sequenceId,
    sequenceName: created.sequenceName,
    segmentCount: created.segmentCount,
    createdSnapshot: created.sequenceSnapshot,
  };
  const prepared = await adapter.preparePersistedRoughCut(fixture.ppro, roughCut);
  assert.equal(prepared.status, "PASS");
  assert.equal(fixture.project.saveCount, 1);

  const expected = { ...roughCut, persistenceSnapshot: prepared.sequenceSnapshot };
  const verified = await adapter.verifyPersistedRoughCut(fixture.ppro, expected);
  assert.equal(verified.sequenceId, created.sequenceId);
  assert.equal(verified.sequenceName, "QUALIFIED");

  fixture.project.activeSequence.videoItems[0].getEndTime = async () => ({ seconds: 0.5 });
  await assert.rejects(() => adapter.verifyPersistedRoughCut(fixture.ppro, expected), /구조가 달라졌습니다/);
});

test("persistence preparation rejects save failure and mutation during save", async () => {
  const failedSave = makeFixture({ failSave: true });
  const created = await adapter.createRoughCut(failedSave.ppro, [{ start: 0, end: 1 }], "QUALIFIED", fast);
  const roughCut = {
    status: "PASS",
    projectId: created.projectId,
    sequenceId: created.sequenceId,
    sequenceName: created.sequenceName,
    segmentCount: created.segmentCount,
    createdSnapshot: created.sequenceSnapshot,
  };
  await assert.rejects(() => adapter.preparePersistedRoughCut(failedSave.ppro, roughCut), /저장하지 못했습니다/);

  const mutated = makeFixture({
    onSave(project) {
      project.activeSequence.audioItems[0].getEndTime = async () => ({ seconds: 0.5 });
    },
  });
  const createdMutated = await adapter.createRoughCut(mutated.ppro, [{ start: 0, end: 1 }], "QUALIFIED", fast);
  await assert.rejects(() => adapter.preparePersistedRoughCut(mutated.ppro, {
    status: "PASS",
    projectId: createdMutated.projectId,
    sequenceId: createdMutated.sequenceId,
    sequenceName: createdMutated.sequenceName,
    segmentCount: createdMutated.segmentCount,
    createdSnapshot: createdMutated.sequenceSnapshot,
  }), /저장 중/);
});

test("persisted verification is bound to exact project and sequence identity", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [{ start: 0, end: 1 }], "QUALIFIED", fast);
  const expected = {
    status: "PASS",
    projectId: created.projectId,
    sequenceId: created.sequenceId,
    sequenceName: created.sequenceName,
    segmentCount: created.segmentCount,
    persistenceSnapshot: created.sequenceSnapshot,
  };
  fixture.project.guid = "different-project";
  await assert.rejects(() => adapter.verifyPersistedRoughCut(fixture.ppro, expected), /프로젝트/);
  fixture.project.guid = created.projectId;
  fixture.project.sequences = [];
  await assert.rejects(() => adapter.verifyPersistedRoughCut(fixture.ppro, expected), /찾지 못했습니다/);
});
