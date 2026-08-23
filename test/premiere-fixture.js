"use strict";

const assert = require("node:assert/strict");

function action(apply) { return { apply }; }
function tick(seconds) { return { seconds }; }

function makeFolder(name, parent, context, options) {
  return {
    kind: "folder",
    name,
    parent,
    items: [],
    getParentBin() { return this.parent; },
    async getItems() {
      if (options.hideGeneratedBinReads > 0 && this === context.parent) {
        options.hideGeneratedBinReads -= 1;
        return this.items.filter((item) => !String(item.name).startsWith("PAI_"));
      }
      return [...this.items];
    },
    createBinAction(childName) {
      assert.equal(context.locked, true, "actions must be created inside lockedAccess");
      return action(() => {
        const child = makeFolder(childName, this, context, options);
        this.items.push(child);
        if (String(childName).startsWith("PAI_") && options.foreignInGeneratedBin) {
          child.items.push({ kind: "clip", name: "user-owned.mov", id: "foreign-clip", parent: child, getId() { return this.id; } });
        }
      });
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
      if (options.failRemoveBin && item?.kind === "folder") throw new Error("remove bin failed");
      return action(() => { this.items = this.items.filter((entry) => entry !== item); });
    },
  };
}

function makeFixture(inputOptions = {}) {
  const options = Object.assign({ hideGeneratedBinReads: 0 }, inputOptions);
  const context = { locked: false, parent: null, nextClipId: 1 };
  const root = makeFolder("Root", null, context, options);
  const parent = makeFolder("Footage", root, context, options);
  context.parent = parent;
  root.items.push(parent);
  const fps = options.fps || 25;
  const duration = options.duration || 10;
  const source = {
    kind: "clip",
    name: options.clipName || "camera.mp4",
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
        const clip = {
          kind: "clip",
          name,
          id: `subclip-${context.nextClipId++}`,
          parent,
          source,
          startFrame: start.frame,
          endFrame: end.frame,
          hardBoundaries,
          mediaOptions,
          getId() { return this.id; },
          getParentBin() { return this.parent; },
        };
        parent.items.push(clip);
      });
    },
  };
  parent.items.push(source);

  function makeTrackItem(projectItem, start, end) {
    return {
      async getStartTime() { return tick(start); },
      async getEndTime() { return tick(end); },
      async getProjectItem() { return projectItem; },
    };
  }

  function makeTrack(items) {
    return {
      getTrackItems(type, includeEmpty) {
        assert.equal(type, 1);
        assert.equal(includeEmpty, false);
        return [...items];
      },
    };
  }

  function makeSequence(name, clips, guid) {
    let cursor = 0;
    const timelineItems = [];
    if (!options.emptySequence) {
      const selected = options.missingLastSequenceItem ? clips.slice(0, -1) : clips;
      for (const clip of selected) {
        const length = Math.max(0, Number(clip.endFrame) - Number(clip.startFrame)) / fps;
        timelineItems.push(makeTrackItem(clip, cursor, cursor + length));
        cursor += length;
      }
    }
    const videoItems = options.omitVideo ? [] : timelineItems.map((item) => item);
    const audioItems = options.omitAudio ? [] : timelineItems.map((item) => item);
    const sequence = {
      guid,
      name,
      clips: [...clips],
      targetBin: null,
      videoItems,
      audioItems,
      async getEndTime() { return tick(cursor); },
      async getVideoTrackCount() { return videoItems.length || options.includeEmptyVideoTrack ? 1 : 0; },
      async getAudioTrackCount() { return audioItems.length || options.includeEmptyAudioTrack ? 1 : 0; },
      async getVideoTrack(index) { if (index !== 0) return null; return makeTrack(videoItems); },
      async getAudioTrack(index) { if (index !== 0) return null; return makeTrack(audioItems); },
    };
    sequence.targetBin = options.targetBin || null;
    return sequence;
  }

  const existing = options.existingSequence
    ? makeSequence(options.existingSequence, [], "old-sequence")
    : null;
  const project = {
    name: options.projectName || "Test Project",
    guid: options.projectId || "project-guid",
    path: options.projectPath || "C:/project/test.prproj",
    sequences: existing ? [existing] : [],
    activeSequence: existing || null,
    transactions: [],
    saveCount: 0,
    lockedAccess(callback) {
      context.locked = true;
      try { return callback(); }
      finally { context.locked = false; }
    },
    executeTransaction(callback, label) {
      assert.equal(context.locked, true, "executeTransaction must run inside lockedAccess");
      const actions = [];
      callback({ addAction(value) { actions.push(value); return options.rejectAddAction ? false : true; } });
      if (options.rejectTransaction) return false;
      actions.forEach((entry) => entry.apply());
      this.transactions.push({ label, count: actions.length });
      return true;
    },
    async getRootItem() { return root; },
    async getActiveSequence() { return this.activeSequence; },
    async getSequences() { return [...this.sequences]; },
    async createSequenceFromMedia(name, clips, targetBin) {
      if (options.failSequenceBeforeCreate) throw new Error("sequence failed before create");
      const sequenceItem = makeSequence(options.createdSequenceName || name, clips, `seq-${this.sequences.length + 1}`);
      sequenceItem.targetBin = targetBin;
      this.sequences.push(sequenceItem);
      if (options.failSequenceAfterCreate) throw new Error("sequence failed after create");
      return sequenceItem;
    },
    async setActiveSequence(sequenceItem) {
      if (options.failRestore && sequenceItem === existing) return false;
      if (options.failActivate && sequenceItem !== existing) return false;
      this.activeSequence = sequenceItem;
      return true;
    },
    async closeSequence(sequenceItem) {
      if (this.activeSequence === sequenceItem) this.activeSequence = null;
      return true;
    },
    async deleteSequence(sequenceItem) {
      if (options.failDeleteSequence) return false;
      this.sequences = this.sequences.filter((entry) => entry !== sequenceItem);
      if (this.activeSequence === sequenceItem) this.activeSequence = null;
      return true;
    },
    async save() {
      this.saveCount += 1;
      if (options.failSave) return false;
      if (typeof options.onSave === "function") options.onSave(this);
      return true;
    },
  };

  const ppro = {
    Constants: { TrackItemType: { CLIP: 1 } },
    Project: { async getActiveProject() { return options.noProject ? null : project; } },
    ProjectUtils: {
      async getSelection() {
        return { async getItems() { return options.noSelection ? [] : options.multiSelection ? [source, source] : [source]; } };
      },
    },
    ClipProjectItem: { cast(item) { return item?.kind === "clip" ? item : null; } },
    FolderItem: { cast(item) { return item?.kind === "folder" ? item : null; } },
    Transcript: {
      hasTranscript() { return options.hasTranscript !== false; },
      async exportToJSON() {
        return options.transcriptJson || JSON.stringify({ segments: [{ start: 0, end: 1, text: "hello" }] });
      },
    },
    FrameRate: { createWithValue(value) { return options.failFrameRate ? null : { value }; } },
    TickTime: { createWithFrameAndFrameRate(frame, rate) { return { frame, rate }; } },
  };

  return { options, context, ppro, project, source, parent, root, existing };
}

module.exports = { makeFixture, makeFolder };
