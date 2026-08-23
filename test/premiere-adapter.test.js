"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const adapterApi = require("../plugin/lib/premiere-adapter.js");

function action(apply) { return { apply }; }

function makeFolder(name, parent, context, options) {
  const folder = {
    kind: "folder",
    name,
    parent,
    items: [],
    getParentBin() { return this.parent; },
    async getItems() { return [...this.items]; },
    createBinAction(childName) {
      assert.equal(context.locked, true, "actions must be created inside lockedAccess");
      return action(() => { this.items.push(makeFolder(childName, this, context, options)); });
    },
    createMoveItemAction(item, target) {
      assert.equal(context.locked, true, "actions must be created inside lockedAccess");
      return action(() => {
        this.items = this.items.filter((entry) => entry !== item);
        target.items.push(item);
        item.parent = target;
      });
    },
    createRemoveItemAction(item) {
      assert.equal(context.locked, true, "actions must be created inside lockedAccess");
      if (options.failRemoveBin && item && item.kind === "folder") throw new Error("remove bin failed");
      return action(() => { this.items = this.items.filter((entry) => entry !== item); });
    },
  };
  return folder;
}

function makeFixture(options = {}) {
  const context = { locked: false, transaction: false };
  const root = makeFolder("Root", null, context, options);
  const parent = makeFolder("Footage", root, context, options);
  root.items.push(parent);
  const fps = options.fps || 25;
  const duration = options.duration || 10;
  const source = {
    kind: "clip",
    name: "camera.mp4",
    id: options.clipId || "clip-1",
    getId() { return this.id; },
    parent,
    getParentBin() { return this.parent; },
    async isOffline() { return Boolean(options.offline); },
    async isSequence() { return Boolean(options.sequence); },
    async isMergedClip() { return Boolean(options.merged); },
    async isMulticamClip() { return Boolean(options.multicam); },
    async getMedia() {
      const value = { seconds: duration };
      return { duration: options.syncDuration ? value : Promise.resolve(value) };
    },
    async getFootageInterpretation() { return { getFrameRate: () => fps }; },
    createSubClipAction(name, start, end, hardBoundaries, mediaOptions) {
      assert.equal(context.locked, true, "actions must be created inside lockedAccess");
      return action(() => {
        parent.items.push({
          kind: "clip",
          name,
          parent,
          source,
          startFrame: start.frame,
          endFrame: end.frame,
          hardBoundaries,
          mediaOptions,
        });
      });
    },
  };
  parent.items.push(source);

  const existing = options.existingSequence ? { guid: "old", name: options.existingSequence } : null;
  const project = {
    name: "Test Project",
    guid: "project-guid",
    sequences: existing ? [existing] : [],
    activeSequence: existing || null,
    transactions: [],
    lockedAccess(callback) {
      context.locked = true;
      try { callback(); } finally { context.locked = false; }
    },
    executeTransaction(callback, label) {
      assert.equal(context.locked, true, "executeTransaction must run inside lockedAccess");
      const actions = [];
      context.transaction = true;
      try { callback({ addAction(value) { actions.push(value); return true; } }); } finally { context.transaction = false; }
      actions.forEach((entry) => entry.apply());
      this.transactions.push({ label, count: actions.length });
      return true;
    },
    async getRootItem() { return root; },
    async getActiveSequence() { return this.activeSequence; },
    async getSequences() { return [...this.sequences]; },
    async createSequenceFromMedia(name, clips, targetBin) {
      if (options.failSequence) throw new Error("sequence failed");
      const sequence = { guid: `seq-${this.sequences.length + 1}`, name, clips: [...clips], targetBin };
      this.sequences.push(sequence);
      return sequence;
    },
    async setActiveSequence(sequence) {
      if (options.failRestore && sequence === existing) return false;
      this.activeSequence = sequence;
      return true;
    },
    async closeSequence(sequence) { if (this.activeSequence === sequence) this.activeSequence = null; return true; },
    async deleteSequence(sequence) {
      if (options.failDeleteSequence) return false;
      this.sequences = this.sequences.filter((entry) => entry !== sequence);
      if (this.activeSequence === sequence) this.activeSequence = null;
      return true;
    },
  };

  const ppro = {
    Project: { async getActiveProject() { return project; } },
    ProjectUtils: { async getSelection() { return { async getItems() { return options.noSelection ? [] : [source]; } }; } },
    ClipProjectItem: { cast(item) { if (!item || item.kind !== "clip") throw new Error("not clip"); return item; } },
    FolderItem: { cast(item) { if (!item || item.kind !== "folder") throw new Error("not folder"); return item; } },
    Transcript: {
      hasTranscript() { return options.hasTranscript !== false; },
      async exportToJSON() { return options.transcriptJson || JSON.stringify({ segments: [{ start: 0, end: 1, text: "hello" }] }); },
    },
    FrameRate: { createWithValue(value) { return { value }; } },
    TickTime: { createWithFrameAndFrameRate(frame, rate) { return { frame, rate }; } },
  };

  return { ppro, project, source, parent, root, existing };
}

test("inspects one supported selected clip with promise-backed media duration", async () => {
  const { ppro } = makeFixture({ fps: 29.97, duration: 12.5 });
  const result = await adapterApi.inspectSelection(ppro);
  assert.equal(result.projectName, "Test Project");
  assert.equal(result.clipName, "camera.mp4");
  assert.equal(result.clipId, "clip-1");
  assert.equal(result.duration, 12.5);
  assert.equal(result.frameRate, 29.97);
  assert.equal(result.hasTranscript, true);
});

test("also accepts synchronous media duration properties", async () => {
  const { ppro } = makeFixture({ syncDuration: true });
  assert.equal((await adapterApi.inspectSelection(ppro)).duration, 10);
});

test("loads Premiere transcript and source timing", async () => {
  const { ppro } = makeFixture();
  const result = await adapterApi.loadSelectedTranscript(ppro);
  assert.match(result.json, /hello/);
  assert.equal(result.duration, 10);
  assert.equal(result.frameRate, 25);
});

test("aligns keep ranges conservatively inward to source frames", () => {
  const ranges = adapterApi.alignKeepRangesToFrames([
    { start: 0.001, end: 1.049 },
    { start: 1.05, end: 2.001 },
    { start: 2.001, end: 2.01 },
  ], 3, 25);
  assert.deepEqual(ranges.map(({ startFrame, endFrame }) => ({ startFrame, endFrame })), [
    { startFrame: 1, endFrame: 26 },
    { startFrame: 27, endFrame: 50 },
  ]);
  assert.equal(ranges[0].start >= 0.001, true);
  assert.equal(ranges[1].end <= 2.001, true);
});

test("creates hard-boundary subclips in an isolated output bin and a new sequence", async () => {
  const { ppro, project, parent, source } = makeFixture({ fps: 25 });
  const result = await adapterApi.createRoughCut(ppro, [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
  ], "camera_AI_ROUGH_CUT", { delay: async () => {} });

  assert.equal(result.segmentCount, 2);
  assert.match(result.operationId, /^PAI_OUTPUT_/);
  assert.equal(project.activeSequence.name, "camera_AI_ROUGH_CUT");
  assert.equal(project.activeSequence.clips.length, 2);
  assert.equal(project.activeSequence.clips[0].hardBoundaries, true);
  assert.deepEqual(project.activeSequence.clips[0].mediaOptions, { takeVideo: true, takeAudio: true });
  assert.equal(parent.items.includes(source), true);
  const generatedBin = parent.items.find((item) => item.kind === "folder" && item.name.startsWith("PAI_OUTPUT_"));
  assert.ok(generatedBin);
  assert.equal(generatedBin.items.length, 2);
});

test("uses a unique sequence name without overwriting an existing sequence", async () => {
  const { ppro, project } = makeFixture({ existingSequence: "AI_ROUGH_CUT" });
  const result = await adapterApi.createRoughCut(ppro, [{ start: 0, end: 1 }], "AI_ROUGH_CUT", { delay: async () => {} });
  assert.equal(result.sequenceName, "AI_ROUGH_CUT_2");
  assert.deepEqual(project.sequences.map((sequence) => sequence.name), ["AI_ROUGH_CUT", "AI_ROUGH_CUT_2"]);
});

test("fails before mutation for unsupported selection and source types", async () => {
  await assert.rejects(() => adapterApi.inspectSelection(makeFixture({ noSelection: true }).ppro), /하나만 선택/);
  await assert.rejects(() => adapterApi.inspectSelection(makeFixture({ offline: true }).ppro), /오프라인/);
  await assert.rejects(() => adapterApi.inspectSelection(makeFixture({ multicam: true }).ppro), /멀티캠/);
  await assert.rejects(() => adapterApi.loadSelectedTranscript(makeFixture({ hasTranscript: false }).ppro), /전사문/);
});

test("rejects applying a plan after the selected source changes", async () => {
  const { ppro } = makeFixture({ clipId: "new-source" });
  await assert.rejects(
    () => adapterApi.createRoughCut(ppro, [{ start: 0, end: 1 }], "STALE", {
      delay: async () => {},
      expectedSource: { clipId: "old-source", duration: 10, frameRate: 25 },
    }),
    /원본 클립이 바뀌었습니다/
  );
});

test("rejects applying after the Premiere transcript changes", async () => {
  const original = JSON.stringify({ segments: [{ start: 0, end: 1, text: "original" }] });
  const changed = JSON.stringify({ segments: [{ start: 0, end: 1, text: "changed" }] });
  const { ppro } = makeFixture({ transcriptJson: changed });
  await assert.rejects(
    () => adapterApi.createRoughCut(ppro, [{ start: 0, end: 1 }], "STALE_TRANSCRIPT", {
      delay: async () => {},
      expectedTranscriptJson: original,
    }),
    /전사문이 바뀌었습니다/
  );
});

test("rolls back generated bin and subclips when sequence creation fails", async () => {
  const { ppro, project, parent } = makeFixture({ failSequence: true });
  await assert.rejects(
    () => adapterApi.createRoughCut(ppro, [{ start: 0, end: 1 }], "FAIL", { delay: async () => {} }),
    /sequence failed/
  );
  assert.equal(project.sequences.length, 0);
  assert.equal(parent.items.some((item) => item.kind === "folder" && item.name.startsWith("PAI_OUTPUT_")), false);
});

test("host self-test verifies mutation, removes every test asset, and restores prior sequence", async () => {
  const { ppro, project, parent, existing } = makeFixture({ existingSequence: "EDIT" });
  const result = await adapterApi.runHostSelfTest(ppro, { delay: async () => {} });
  assert.equal(result.status, "PASS");
  assert.equal(result.cleaned, true);
  assert.deepEqual(result.checks, { subclip: true, sequence: true, activation: true, cleanup: true });
  assert.equal(project.activeSequence, existing);
  assert.deepEqual(project.sequences, [existing]);
  assert.equal(parent.items.some((item) => String(item.name).startsWith(adapterApi.SELF_TEST_PREFIX)), false);
});

test("host self-test refuses certification when cleanup cannot complete", async () => {
  const { ppro } = makeFixture({ failRemoveBin: true });
  await assert.rejects(() => adapterApi.runHostSelfTest(ppro, { delay: async () => {}, timeoutMs: 10 }), /정리/);
});

test("recovery cleanup deletes only internal self-test artifacts", async () => {
  const { ppro, project, root, parent } = makeFixture();
  const output = makeFolder("PAI_OUTPUT_keep", parent, { locked: false, transaction: false }, {});
  const stale = makeFolder(`${adapterApi.SELF_TEST_PREFIX}old_BIN`, parent, { locked: false, transaction: false }, {});
  parent.items.push(output, stale);
  project.sequences.push({ guid: "stale-seq", name: `${adapterApi.SELF_TEST_PREFIX}old` });

  const result = await adapterApi.cleanupSelfTestArtifacts(ppro, { delay: async () => {} });
  assert.equal(result.status, "PASS");
  assert.equal(parent.items.includes(output), true);
  assert.equal(parent.items.includes(stale), false);
  assert.equal(project.sequences.some((sequence) => String(sequence.name).startsWith(adapterApi.SELF_TEST_PREFIX)), false);
  assert.equal(root.items.includes(parent), true);
});

test("rejects source ranges outside media duration", () => {
  assert.throws(() => adapterApi.alignKeepRangesToFrames([{ start: 0, end: 11 }], 10, 25), /시간/);
  assert.throws(() => adapterApi.alignKeepRangesToFrames([], 10, 25), /유지할 구간/);
});
