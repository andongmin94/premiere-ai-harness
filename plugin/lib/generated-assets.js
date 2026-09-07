(function (root, factory) {
  if (typeof module === "object" && module.exports && typeof window === "undefined") module.exports = factory(require("./premiere-runtime.js"));
  else root.PAI = Object.assign(root.PAI || {}, factory(root.PAI));
})(typeof globalThis !== "undefined" ? globalThis : this, function (runtime) {
  "use strict";

  const ACTION_BATCH_SIZE = 32;
  const FRAME_READ_TOLERANCE = 0.001;

  async function captureSourceState(clip, ppro, frameRate) {
    if (!Number.isFinite(frameRate) || frameRate <= 0) throw new Error("원본 상태 검증용 프레임레이트가 올바르지 않습니다.");
    const mediaTypes = requireMediaTypes(ppro);
    const mediaPath = await readMediaPath(clip, "원본 클립");
    return Object.freeze({
      mediaPath,
      video: await readBoundarySnapshot(clip, mediaTypes.VIDEO, frameRate, "원본 VIDEO"),
      audio: await readBoundarySnapshot(clip, mediaTypes.AUDIO, frameRate, "원본 AUDIO"),
    });
  }

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

  async function verifyGeneratedSubclips(sourceClip, clips, ranges, sourceState, ppro, frameRate) {
    if (!sourceState?.mediaPath) throw new Error("원본 상태 snapshot이 없어 생성 결과를 검증할 수 없습니다.");
    await verifySourceInvariant(sourceClip, sourceState, ppro, frameRate);
    for (let index = 0; index < clips.length; index += 1) {
      const mediaPath = await readMediaPath(clips[index], `서브클립 ${index + 1}`);
      if (mediaPath !== sourceState.mediaPath) throw new Error(`서브클립 ${index + 1}이 선택한 원본과 다른 미디어를 가리킵니다.`);
    }
    await verifySubclipBoundaries(clips, ranges, ppro, frameRate);
    return true;
  }

  async function verifySourceInvariant(clip, expected, ppro, frameRate) {
    const current = await captureSourceState(clip, ppro, frameRate);
    if (current.mediaPath !== expected.mediaPath) throw new Error("서브클립 생성 중 원본 미디어 경로가 바뀌었습니다.");
    requireSameSnapshot(current.video, expected.video, "원본 VIDEO");
    requireSameSnapshot(current.audio, expected.audio, "원본 AUDIO");
  }

  async function verifySubclipBoundaries(clips, ranges, ppro, frameRate) {
    if (!Array.isArray(clips) || !Array.isArray(ranges) || clips.length !== ranges.length || clips.length === 0) {
      throw new Error("생성된 서브클립 source 경계를 검증할 수 없습니다.");
    }
    if (!Number.isFinite(frameRate) || frameRate <= 0) throw new Error("서브클립 source 경계 검증용 프레임레이트가 올바르지 않습니다.");
    const mediaTypes = requireMediaTypes(ppro);
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      await verifyMediaBoundary(clip, ranges[index], mediaTypes.VIDEO, "VIDEO", frameRate, index);
      await verifyMediaBoundary(clip, ranges[index], mediaTypes.AUDIO, "AUDIO", frameRate, index);
    }
    return true;
  }

  async function verifyMediaBoundary(clip, range, mediaType, label, frameRate, index) {
    const snapshot = await readBoundarySnapshot(clip, mediaType, frameRate, `서브클립 ${index + 1} ${label}`);
    requireFrameBoundary(snapshot.inFrame, range.startFrame, `서브클립 ${index + 1} ${label} source in`);
    requireFrameBoundary(snapshot.outFrame, range.endFrame, `서브클립 ${index + 1} ${label} source out`);
  }

  async function readBoundarySnapshot(clip, mediaType, frameRate, label) {
    if (typeof clip?.getInPoint !== "function" || typeof clip?.getOutPoint !== "function") {
      throw new Error(`${label} source in/out API를 사용할 수 없습니다.`);
    }
    const inPoint = await runtime.maybePromise(clip.getInPoint(mediaType));
    const outPoint = await runtime.maybePromise(clip.getOutPoint(mediaType));
    const inFrame = Number(inPoint?.seconds) * frameRate;
    const outFrame = Number(outPoint?.seconds) * frameRate;
    if (!Number.isFinite(inFrame) || !Number.isFinite(outFrame)) throw new Error(`${label} source 경계를 읽지 못했습니다.`);
    return Object.freeze({ inFrame, outFrame });
  }

  async function readMediaPath(clip, label) {
    if (typeof clip?.getMediaFilePath !== "function") throw new Error(`${label}의 미디어 경로 API를 사용할 수 없습니다.`);
    const mediaPath = String(await runtime.maybePromise(clip.getMediaFilePath()) || "").trim();
    if (!mediaPath) throw new Error(`${label}의 미디어 파일 경로를 확인하지 못했습니다.`);
    return mediaPath;
  }

  function requireMediaTypes(ppro) {
    const mediaTypes = ppro?.Constants?.MediaType;
    if (mediaTypes?.VIDEO == null || mediaTypes?.AUDIO == null) {
      throw new Error("Premiere MediaType API를 사용할 수 없어 source 무결성을 검증하지 못했습니다.");
    }
    return mediaTypes;
  }

  function requireFrameBoundary(actualFrame, expectedFrame, label) {
    if (Math.abs(Number(actualFrame) - Number(expectedFrame)) > FRAME_READ_TOLERANCE) {
      throw new Error(`${label} 경계가 요청한 원본 프레임과 다릅니다.`);
    }
  }

  function requireSameSnapshot(actual, expected, label) {
    if (Math.abs(actual.inFrame - expected.inFrame) > FRAME_READ_TOLERANCE
      || Math.abs(actual.outFrame - expected.outFrame) > FRAME_READ_TOLERANCE) {
      throw new Error(`서브클립 생성 중 ${label} in/out 상태가 바뀌었습니다.`);
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
    captureSourceState,
    createGeneratedBin,
    createSubclips,
    waitForNamedClips,
    verifyGeneratedSubclips,
    verifySubclipBoundaries,
    moveItems,
    createAndActivateSequence,
    findCreatedSequence,
    findFolderByName,
  };
});
