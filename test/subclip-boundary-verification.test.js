"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const adapter = require("../plugin/lib/premiere-adapter.js");
const { makeFixture } = require("./premiere-fixture.js");

const fast = { delay: async () => {}, timeoutMs: 300 };

function hasGeneratedItem(fixture, prefix) {
  return fixture.parent.items.some((item) => String(item.name || "").startsWith(prefix));
}

test("rough cut independently verifies exact VIDEO and AUDIO source boundaries", async () => {
  const fixture = makeFixture({ fps: 29.97 });
  const result = await adapter.createRoughCut(
    fixture.ppro,
    [{ start: 0.137, end: 1.913 }, { start: 2.041, end: 2.889 }],
    "BOUNDARY_OK",
    fast
  );
  assert.equal(result.segmentCount, 2);
  assert.equal(fixture.project.sequences.length, 1);
  const generatedBin = fixture.parent.items.find((item) => String(item.name || "").startsWith("PAI_OUTPUT_"));
  assert.ok(generatedBin);
  assert.equal(generatedBin.items.length, 2);
  for (const clip of generatedBin.items) {
    assert.equal(typeof clip.getInPoint, "function");
    assert.equal(typeof clip.getOutPoint, "function");
  }
});

test("rough cut rejects a one-frame VIDEO source-in mismatch before sequence creation and rolls back", async () => {
  const fixture = makeFixture({ subclipVideoInOffsetFrames: 1 });
  await assert.rejects(
    () => adapter.createRoughCut(fixture.ppro, [{ start: 1, end: 2 }], "BAD_VIDEO_IN", fast),
    /VIDEO source in 경계/
  );
  assert.equal(fixture.project.sequences.length, 0);
  assert.equal(hasGeneratedItem(fixture, "PAI_OUTPUT_"), false);
});

test("host self-test rejects an AUDIO source-out mismatch and cleans every internal asset", async () => {
  const fixture = makeFixture({ subclipAudioOutOffsetFrames: -1 });
  await assert.rejects(() => adapter.runHostSelfTest(fixture.ppro, fast), /AUDIO source out 경계/);
  assert.equal(fixture.project.sequences.length, 0);
  assert.equal(hasGeneratedItem(fixture, "PAI_INTERNAL_"), false);
});

test("rollback self-test fails closed when Premiere does not expose subclip in-out APIs", async () => {
  const fixture = makeFixture({ missingSubclipBoundaryApi: true });
  await assert.rejects(() => adapter.runRollbackSelfTest(fixture.ppro, fast), /source in\/out API/);
  assert.equal(fixture.project.sequences.length, 0);
  assert.equal(hasGeneratedItem(fixture, "PAI_INTERNAL_"), false);
});

test("rough cut fails closed when Premiere MediaType constants are unavailable", async () => {
  const fixture = makeFixture();
  delete fixture.ppro.Constants.MediaType;
  await assert.rejects(
    () => adapter.createRoughCut(fixture.ppro, [{ start: 0, end: 1 }], "NO_MEDIA_TYPE", fast),
    /MediaType API/
  );
  assert.equal(fixture.project.sequences.length, 0);
  assert.equal(hasGeneratedItem(fixture, "PAI_OUTPUT_"), false);
});
