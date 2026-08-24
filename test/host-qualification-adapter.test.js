"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const adapter = require("../plugin/lib/premiere-adapter.js");
const { makeFixture } = require("./premiere-fixture.js");

test("rollback self-test observes an intentional failure and leaves no internal assets", async () => {
  const fixture = makeFixture();
  const result = await adapter.runRollbackSelfTest(fixture.ppro, { delay: async () => {} });
  assert.equal(result.status, "PASS");
  assert.equal(result.cleaned, true);
  assert.deepEqual(result.checks, { failureObserved: true, subclip: true, cleanup: true });
  assert.equal(fixture.project.sequences.length, 0);
  assert.equal(fixture.parent.items.some((item) => String(item.name).startsWith("PAI_INTERNAL_")), false);
});

test("rollback self-test refuses PASS when a foreign item prevents complete cleanup", async () => {
  const fixture = makeFixture({ foreignInGeneratedBin: true });
  await assert.rejects(
    () => adapter.runRollbackSelfTest(fixture.ppro, { delay: async () => {}, timeoutMs: 250 }),
    /정리에도 실패/
  );
  const generated = fixture.parent.items.find((item) => String(item.name).startsWith("PAI_INTERNAL_TEMP_"));
  assert.ok(generated, "the user-owned item and its containing bin must be preserved");
  assert.equal(generated.items.some((item) => item.name === "user-owned.mov"), true);
});

test("persisted rough-cut verification is bound to project and sequence identity", async () => {
  const fixture = makeFixture();
  const created = await adapter.createRoughCut(fixture.ppro, [{ start: 0, end: 1 }], "QUALIFIED", { delay: async () => {} });
  const expected = {
    status: "PASS",
    projectId: created.projectId,
    sequenceId: created.sequenceId,
    sequenceName: created.sequenceName,
  };
  const verified = await adapter.verifyPersistedRoughCut(fixture.ppro, expected);
  assert.equal(verified.status, "PASS");
  assert.equal(verified.sequenceId, created.sequenceId);
  assert.equal(verified.sequenceName, "QUALIFIED");

  fixture.project.guid = "different-project";
  await assert.rejects(() => adapter.verifyPersistedRoughCut(fixture.ppro, expected), /프로젝트/);
  fixture.project.guid = created.projectId;
  fixture.project.sequences = [];
  await assert.rejects(() => adapter.verifyPersistedRoughCut(fixture.ppro, expected), /찾지 못했습니다/);
});
