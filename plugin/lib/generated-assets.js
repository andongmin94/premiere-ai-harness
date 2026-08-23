(function (root, factory) {
  if (typeof module === "object" && module.exports && typeof window === "undefined") module.exports = factory(require("./premiere-runtime.js"));
  else root.PAI = Object.assign(root.PAI || {}, factory(root.PAI));
})(typeof globalThis !== "undefined" ? globalThis : this, function (runtime) {
  "use strict";

  const ACTION_BATCH_SIZE = 32;

  async function createGeneratedBin(resources, ppro, options) {
    runtime.runTransaction(resources.project, "Premiere AI Harness: 작업 빈 생성", [
      function () { return resources.parentBin.createBinAction(resources.binName, false); },
    ]);
    resources.runBin = await runtime.poll(async function () {
      return findFolderByName(resources.parentBin, resources.binName, ppro);
    }, options?.delay, `작업 빈 “${resources.binName}”을 찾지 못했습니다.`, options?.timeoutMs);
    return resources.runBin;
  }

  async function createSubclips(project, sourceClip, ranges, names, frameRateObject, ppro) {
    for (let offset = 0; offset < ranges.length; offset += ACTION_BATCH_SIZE) {
      const factories = [];
      for (let index = offset; index < Math.min(offset + ACTION_BATCH_SIZE, ranges.length); index += 1) {
        const range = ranges[index];
        factories.push(function () {
          const start = ppro.TickTime.createWithFrameAndFrameRate(range.startFrame, frameRateObject);
          const end = ppro.TickTime.createWithFrameAndFrameRate(range.endFrame, frameRateObject);
          return sourceClip.createSubClipAction(names[index], start, end, true, { takeVideo: true, takeAudio: true });
        });
      }
      runtime.runTransaction(project, "Premiere AI Harness: 유지 구간 서브클립 생성", factories);
    }
  }

  async function waitForNamedClips(folder, names, ppro, options) {
    const expected = new Set(names.map(String));
    return runtime.poll(async function () {
      const found = [];
      for (const item of await folder.getItems() || []) {
        if (!expected.has(String(item?.name || ""))) continue;
        const clip = runtime.safeCast(ppro.ClipProjectItem, item);
        if (clip) found.push(clip);
      }
      if (found.length !== expected.size) return null;
      return found.sort((left, right) => names.indexOf(String(left.name)) - names.indexOf(String(right.name)));
    }, options?.delay, `생성된 서브클립 ${names.length}개를 확인하지 못했습니다.`, options?.timeoutMs);
  }

  async function moveItems(project, sourceFolder, targetFolder, items) {
    for (let offset = 0; offset < items.length; offset += ACTION_BATCH_SIZE) {
      const batch = items.slice(offset, offset + ACTION_BATCH_SIZE);
      runtime.runTransaction(project, "Premiere AI Harness: 생성 서브클립 정리", batch.map(function (item) {
        return function () { return sourceFolder.createMoveItemAction(item, targetFolder); };
      }));
    }
  }

  async function createAndActivateSequence(resources, clips, targetBin) {
    const project = resources.project;
    try {
      const sequence = await project.createSequenceFromMedia(resources.sequenceName, clips, targetBin);
      if (!sequence) throw new Error("새 시퀀스를 만들지 못했습니다.");
      resources.sequence = sequence;
      if (await project.setActiveSequence(sequence) === false) throw new Error("새 시퀀스를 활성화하지 못했습니다.");
      const identity = runtime.sequenceIdentity(sequence);
      const exists = (await project.getSequences() || []).some((item) => runtime.sequenceIdentity(item) === identity);
      if (!exists) throw new Error("생성된 시퀀스를 프로젝트에서 다시 확인하지 못했습니다.");
      return sequence;
    } catch (error) {
      if (!resources.sequence) resources.sequence = await findCreatedSequence(project, resources.sequenceBaseline);
      throw error;
    }
  }

  async function findCreatedSequence(project, baseline) {
    const previous = baseline instanceof Set ? baseline : new Set();
    const created = (await project.getSequences() || []).filter((sequence) => {
      const identity = runtime.sequenceIdentity(sequence);
      return identity && !previous.has(identity);
    });
    return created.length === 1 ? created[0] : null;
  }

  async function findFolderByName(parent, name, ppro) {
    if (!parent || !name || !ppro) return null;
    for (const item of await parent.getItems() || []) {
      if (String(item?.name || "") !== String(name)) continue;
      return runtime.safeCast(ppro.FolderItem, item);
    }
    return null;
  }

  return {
    createGeneratedBin,
    createSubclips,
    waitForNamedClips,
    moveItems,
    createAndActivateSequence,
    findCreatedSequence,
    findFolderByName,
  };
});
