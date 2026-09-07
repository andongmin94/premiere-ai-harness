(function (root, factory) {
  if (typeof module === "object" && module.exports && typeof window === "undefined") module.exports = factory(require("./premiere-runtime.js"));
  else root.PAI = Object.assign(root.PAI || {}, factory(root.PAI));
})(typeof globalThis !== "undefined" ? globalThis : this, function (runtime) {
  "use strict";

  const ACTION_BATCH_SIZE = 32;
  const FRAME_READ_TOLERANCE = 0.001;

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

  async function verifySubclipBoundaries(clips, ranges, ppro, frameRate) {
    if (!Array.isArray(clips) || !Array.isArray(ranges) || clips.length !== ranges.length || clips.length === 0) {
      throw new Error("생성된 서브클립 source 경계를 검증할 수 없습니다.");
    }
    if (!Number.isFinite(frameRate) || frameRate <= 0) throw new Error("서브클립 source 경계 검증용 프레임레이트가 올바르지 않습니다.");
    const mediaTypes = ppro?.Constants?.MediaType;
    if (mediaTypes?.VIDEO == null || mediaTypes?.AUDIO == null) {
      throw new Error("Premiere MediaType API를 사용할 수 없어 서브클립 source 경계를 검증하지 못했습니다.");
    }
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      if (typeof clip?.getInPoint !== "function" || typeof clip?.getOutPoint !== "function") {
        throw new Error(`서브클립 ${index + 1}의 source in/out API를 사용할 수 없습니다.`);
      }
      await verifyMediaBoundary(clip, ranges[index], mediaTypes.VIDEO, "VIDEO", frameRate, index);
      await verifyMediaBoundary(clip, ranges[index], mediaTypes.AUDIO, "AUDIO", frameRate, index);
    }
    return true;
  }

  async function verifyMediaBoundary(clip, range, mediaType, label, frameRate, index) {
    const inPoint = await runtime.maybePromise(clip.getInPoint(mediaType));
    const outPoint = await runtime.maybePromise(clip.getOutPoint(mediaType));
    requireFrameBoundary(inPoint, range.startFrame, frameRate, `서브클립 ${index + 1} ${label} source in`);
    requireFrameBoundary(outPoint, range.endFrame, frameRate, `서브클립 ${index + 1} ${label} source out`);
  }

  function requireFrameBoundary(value, expectedFrame, frameRate, label) {
    const seconds = Number(value?.seconds);
    if (!Number.isFinite(seconds) || Math.abs(seconds * frameRate - Number(expectedFrame)) > FRAME_READ_TOLERANCE) {
      throw new Error(`${label} 경계가 요청한 원본 프레임과 다릅니다.`);
    }
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
    verifySubclipBoundaries,
    moveItems,
    createAndActivateSequence,
    findCreatedSequence,
    findFolderByName,
  };
});
