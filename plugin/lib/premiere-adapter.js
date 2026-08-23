(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./premiere-runtime.js"), require("./generated-assets.js"));
  } else {
    root.PAI = Object.assign(root.PAI || {}, factory(root.PAI, root.PAI));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (runtime, assets) {
  "use strict";

  async function inspectSelection(ppro) {
    const context = await getSupportedContext(ppro);
    const timing = await runtime.readSourceTiming(context.clip);
    return Object.freeze({
      projectName: String(context.project.name || ""),
      clipName: String(context.clip.name || ""),
      clipId: runtime.clipIdentity(context.clip),
      duration: timing.duration,
      frameRate: timing.frameRate,
      hasTranscript: Boolean(await runtime.maybePromise(ppro.Transcript.hasTranscript(context.clip))),
    });
  }

  async function loadSelectedTranscript(ppro) {
    const context = await getSupportedContext(ppro);
    if (!await runtime.maybePromise(ppro.Transcript.hasTranscript(context.clip))) throw new Error("선택한 클립에 Premiere 전사문이 없습니다.");
    const json = await ppro.Transcript.exportToJSON(context.clip);
    if (!json) throw new Error("Premiere 전사문을 내보내지 못했습니다.");
    const timing = await runtime.readSourceTiming(context.clip);
    return Object.freeze({
      json: String(json),
      projectName: String(context.project.name || ""),
      clipName: String(context.clip.name || ""),
      clipId: runtime.clipIdentity(context.clip),
      duration: timing.duration,
      frameRate: timing.frameRate,
      hasTranscript: true,
    });
  }

  async function createRoughCut(ppro, keepRanges, sequenceName, options) {
    const settings = options || {};
    const context = await getSupportedContext(ppro);
    const timing = await runtime.readSourceTiming(context.clip);
    runtime.verifyExpectedSource(context.clip, timing, settings.expectedSource);
    await runtime.verifyExpectedTranscript(ppro, context.clip, settings.expectedTranscriptJson);
    const ranges = runtime.alignKeepRangesToFrames(keepRanges, timing.duration, timing.frameRate);
    const parentBin = await runtime.maybePromise(context.clip.getParentBin());
    if (!parentBin) throw new Error("선택 클립의 프로젝트 빈을 찾지 못했습니다.");

    const previousActive = await readActiveSequence(context.project);
    const operationId = runtime.makeOperationId(runtime.OUTPUT_PREFIX);
    const resources = createResourceRecord(context.project, parentBin, operationId, ranges.length);
    const requestedName = runtime.sanitizeName(sequenceName || "AI_ROUGH_CUT");
    const safeName = await runtime.uniqueSequenceName(context.project, requestedName);

    try {
      await buildGeneratedSequence(ppro, context.clip, ranges, safeName, resources, { ...settings, frameRate: timing.frameRate });
      return Object.freeze({
        sequenceName: String(resources.sequence.name || safeName),
        segmentCount: resources.subclips.length,
        operationId,
        frameRate: timing.frameRate,
        adjustedBoundaryCount: ranges.reduce((sum, range) => sum + Number(range.adjustedStart) + Number(range.adjustedEnd), 0),
      });
    } catch (error) {
      const cleanup = await assets.cleanupGenerated(resources, { delay: settings.delay, timeoutMs: settings.timeoutMs, restoreActive: previousActive });
      if (!cleanup.cleaned) throw new Error(`${runtime.messageOf(error)} 자동 정리도 완료하지 못했습니다: ${cleanup.errors.join(" / ")}`);
      throw error;
    }
  }

  async function runHostSelfTest(ppro, options) {
    const settings = options || {};
    const context = await getSupportedContext(ppro);
    const timing = await runtime.readSourceTiming(context.clip);
    const ranges = selfTestRange(timing.duration, timing.frameRate);
    const parentBin = await runtime.maybePromise(context.clip.getParentBin());
    if (!parentBin) throw new Error("선택 클립의 프로젝트 빈을 찾지 못했습니다.");

    const previousActive = await readActiveSequence(context.project);
    const operationId = runtime.makeOperationId(runtime.SELF_TEST_PREFIX);
    const resources = createResourceRecord(context.project, parentBin, operationId, 1, "_BIN", "_CLIP");
    try {
      await buildGeneratedSequence(ppro, context.clip, ranges, operationId, resources, { ...settings, frameRate: timing.frameRate });
      const cleanup = await assets.cleanupGenerated(resources, { delay: settings.delay, timeoutMs: settings.timeoutMs, restoreActive: previousActive });
      if (!cleanup.cleaned) throw new Error(`자체시험 흔적 정리에 실패했습니다: ${cleanup.errors.join(" / ")}`);
      return Object.freeze({
        status: "PASS",
        cleaned: true,
        operationId,
        clipId: runtime.clipIdentity(context.clip),
        duration: timing.duration,
        frameRate: timing.frameRate,
        checks: Object.freeze({ subclip: true, sequence: true, activation: true, cleanup: true }),
      });
    } catch (error) {
      const cleanup = await assets.cleanupGenerated(resources, { delay: settings.delay, timeoutMs: settings.timeoutMs, restoreActive: previousActive });
      if (!cleanup.cleaned) throw new Error(`${runtime.messageOf(error)} 자체시험 흔적 자동 정리에도 실패했습니다: ${cleanup.errors.join(" / ")}`);
      throw error;
    }
  }

  async function cleanupSelfTestArtifacts(ppro, options) {
    return assets.cleanupInternalArtifacts(ppro, options || {});
  }

  async function buildGeneratedSequence(ppro, sourceClip, ranges, sequenceName, resources, options) {
    const frameRateObject = ppro.FrameRate.createWithValue(options.frameRate);
    if (!frameRateObject) throw new Error("Premiere 프레임레이트 객체를 만들지 못했습니다.");
    resources.runBin = await assets.createGeneratedBin(resources.project, resources.parentBin, resources.binName, ppro, options);
    await assets.createSubclips(resources.project, sourceClip, ranges, resources.subclipNames, frameRateObject, ppro);
    resources.subclips = await assets.waitForNamedClips(resources.parentBin, resources.subclipNames, ppro, options);
    await assets.moveItems(resources.project, resources.parentBin, resources.runBin, resources.subclips);
    await assets.waitForNamedClips(resources.runBin, resources.subclipNames, ppro, options);
    resources.sequence = await assets.createAndActivateSequence(resources.project, sequenceName, resources.subclips, resources.runBin);
  }

  function createResourceRecord(project, parentBin, operationId, count, binSuffix, clipSuffix) {
    return {
      project,
      parentBin,
      operationId,
      binName: `${operationId}${binSuffix || "_GENERATED"}`,
      subclipNames: Array.from({ length: count }, function (_, index) {
        return clipSuffix ? `${operationId}${clipSuffix}` : `${operationId}_${String(index + 1).padStart(3, "0")}`;
      }),
      runBin: null,
      subclips: [],
      sequence: null,
    };
  }

  async function getSupportedContext(ppro) {
    const context = await runtime.selectedClipContext(ppro);
    await runtime.assertSupportedClip(context.clip);
    return context;
  }

  async function readActiveSequence(project) {
    return typeof project.getActiveSequence === "function" ? project.getActiveSequence() : null;
  }

  function selfTestRange(duration, frameRate) {
    const totalFrames = Math.floor(duration * frameRate + 1e-7);
    if (totalFrames < 2) throw new Error("자체시험에는 두 프레임 이상의 원본이 필요합니다.");
    const startFrame = totalFrames > 4 ? 1 : 0;
    const length = Math.min(Math.max(2, Math.round(frameRate * 0.5)), totalFrames - startFrame);
    return [Object.freeze({
      startFrame,
      endFrame: startFrame + length,
      start: startFrame / frameRate,
      end: (startFrame + length) / frameRate,
      adjustedStart: false,
      adjustedEnd: false,
    })];
  }

  return {
    OUTPUT_PREFIX: runtime.OUTPUT_PREFIX,
    SELF_TEST_PREFIX: runtime.SELF_TEST_PREFIX,
    TEMP_PREFIX: runtime.TEMP_PREFIX,
    inspectSelection,
    loadSelectedTranscript,
    createRoughCut,
    runHostSelfTest,
    cleanupSelfTestArtifacts,
    alignKeepRangesToFrames: runtime.alignKeepRangesToFrames,
  };
});
