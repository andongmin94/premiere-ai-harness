(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PAI = Object.assign(root.PAI || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ACTION_BATCH_SIZE = 32;
  const POLL_TIMEOUT_MS = 8000;
  const POLL_INTERVAL_MS = 120;
  const FRAME_EPSILON = 1e-7;
  const OUTPUT_PREFIX = "PAI_OUTPUT_";
  const SELF_TEST_PREFIX = "PAI_INTERNAL_SELFTEST_";
  const TEMP_PREFIX = "PAI_INTERNAL_TEMP_";

  async function inspectSelection(ppro) {
    const context = await selectedClipContext(ppro);
    await assertSupportedClip(context.clip);
    const timing = await readSourceTiming(context.clip);
    return Object.freeze({
      projectName: context.project.name,
      clipName: context.clip.name,
      clipId: clipIdentity(context.clip),
      duration: timing.duration,
      frameRate: timing.frameRate,
      hasTranscript: Boolean(await maybePromise(ppro.Transcript.hasTranscript(context.clip))),
    });
  }

  async function loadSelectedTranscript(ppro) {
    const context = await selectedClipContext(ppro);
    await assertSupportedClip(context.clip);
    if (!await maybePromise(ppro.Transcript.hasTranscript(context.clip))) {
      throw new Error("선택한 클립에 Premiere 전사문이 없습니다.");
    }
    const json = await ppro.Transcript.exportToJSON(context.clip);
    if (!json) throw new Error("Premiere 전사문을 내보내지 못했습니다.");
    const timing = await readSourceTiming(context.clip);
    return Object.freeze({ context, json, clipId: clipIdentity(context.clip), duration: timing.duration, frameRate: timing.frameRate });
  }

  async function createRoughCut(ppro, keepRanges, sequenceName, options) {
    const context = await selectedClipContext(ppro);
    await assertSupportedClip(context.clip);
    const project = context.project;
    const parentBin = await maybePromise(context.clip.getParentBin());
    if (!parentBin) throw new Error("선택 클립의 프로젝트 빈을 찾지 못했습니다.");

    const timing = await readSourceTiming(context.clip);
    verifyExpectedSource(context.clip, timing, options && options.expectedSource);
    await verifyExpectedTranscript(ppro, context.clip, options && options.expectedTranscriptJson);
    const aligned = alignKeepRangesToFrames(keepRanges, timing.duration, timing.frameRate);
    if (!aligned.length) throw new Error("프레임 정렬 후 유지할 구간이 없습니다.");

    const requestedName = sanitizeName(sequenceName || "AI_ROUGH_CUT");
    const safeName = await uniqueSequenceName(project, requestedName);
    const operationId = makeOperationId(OUTPUT_PREFIX);
    const runBinName = `${operationId}_GENERATED`;
    const subclipNames = aligned.map((range, index) => `${operationId}_${String(index + 1).padStart(3, "0")}_${range.startFrame}-${range.endFrame}`);
    const frameRateObject = ppro.FrameRate.createWithValue(timing.frameRate);
    if (!frameRateObject) throw new Error("Premiere 프레임레이트 객체를 만들지 못했습니다.");

    let runBin = null;
    let subclips = [];
    let sequence = null;
    const delay = options && typeof options.delay === "function" ? options.delay : sleep;

    try {
      runBin = await createRunBin(project, parentBin, runBinName, ppro, delay);
      await createSubclips(project, context.clip, aligned, subclipNames, frameRateObject, ppro);
      subclips = await waitForNamedClipItems(parentBin, subclipNames, ppro, delay);
      await moveItems(project, parentBin, runBin, subclips);
      await waitForNamedClipItems(runBin, subclipNames, ppro, delay);

      sequence = await project.createSequenceFromMedia(safeName, subclips, runBin);
      if (!sequence) throw new Error("새 시퀀스를 만들지 못했습니다.");
      const activated = await project.setActiveSequence(sequence);
      if (activated === false) throw new Error("새 시퀀스를 활성화하지 못했습니다.");

      const sequences = await project.getSequences();
      if (!(sequences || []).some((item) => sequenceIdentity(item) === sequenceIdentity(sequence))) {
        throw new Error("Premiere 프로젝트에서 생성된 시퀀스를 다시 확인하지 못했습니다.");
      }

      return Object.freeze({
        sequenceName: sequence.name || safeName,
        segmentCount: subclips.length,
        operationId,
        frameRate: timing.frameRate,
        adjustedBoundaryCount: aligned.reduce((sum, range) => sum + Number(range.adjustedStart) + Number(range.adjustedEnd), 0),
      });
    } catch (error) {
      const cleanup = await cleanupGenerated({ project, parentBin, runBin, subclips, sequence }, { delay, strict: false });
      if (!cleanup.cleaned) {
        throw new Error(`${messageOf(error)} 자동 정리도 완료하지 못했습니다: ${cleanup.errors.join(" / ")}`);
      }
      throw error;
    }
  }

  async function runHostSelfTest(ppro, options) {
    const context = await selectedClipContext(ppro);
    await assertSupportedClip(context.clip);
    const project = context.project;
    const parentBin = await maybePromise(context.clip.getParentBin());
    if (!parentBin) throw new Error("선택 클립의 프로젝트 빈을 찾지 못했습니다.");
    const timing = await readSourceTiming(context.clip);
    const totalFrames = Math.floor(timing.duration * timing.frameRate + FRAME_EPSILON);
    if (totalFrames < 2) throw new Error("자체시험에는 두 프레임 이상의 원본이 필요합니다.");

    const previousActive = typeof project.getActiveSequence === "function" ? await project.getActiveSequence() : null;
    const startFrame = totalFrames > 4 ? 1 : 0;
    const testFrames = Math.min(Math.max(2, Math.round(timing.frameRate * 0.5)), totalFrames - startFrame);
    const endFrame = startFrame + testFrames;
    const range = Object.freeze({
      startFrame,
      endFrame,
      start: startFrame / timing.frameRate,
      end: endFrame / timing.frameRate,
      adjustedStart: false,
      adjustedEnd: false,
    });
    const operationId = makeOperationId(SELF_TEST_PREFIX);
    const runBinName = `${operationId}_BIN`;
    const subclipName = `${operationId}_CLIP`;
    const sequenceName = operationId;
    const frameRateObject = ppro.FrameRate.createWithValue(timing.frameRate);
    if (!frameRateObject) throw new Error("Premiere 프레임레이트 객체를 만들지 못했습니다.");
    const delay = options && typeof options.delay === "function" ? options.delay : sleep;

    let runBin = null;
    let subclips = [];
    let sequence = null;
    try {
      runBin = await createRunBin(project, parentBin, runBinName, ppro, delay);
      await createSubclips(project, context.clip, [range], [subclipName], frameRateObject, ppro);
      subclips = await waitForNamedClipItems(parentBin, [subclipName], ppro, delay);
      await moveItems(project, parentBin, runBin, subclips);
      await waitForNamedClipItems(runBin, [subclipName], ppro, delay);

      sequence = await project.createSequenceFromMedia(sequenceName, subclips, runBin);
      if (!sequence) throw new Error("자체시험 시퀀스를 만들지 못했습니다.");
      const activated = await project.setActiveSequence(sequence);
      if (activated === false) throw new Error("자체시험 시퀀스를 활성화하지 못했습니다.");
      const sequences = await project.getSequences();
      if (!(sequences || []).some((item) => sequenceIdentity(item) === sequenceIdentity(sequence))) {
        throw new Error("자체시험 시퀀스를 프로젝트에서 다시 확인하지 못했습니다.");
      }

      const cleanup = await cleanupGenerated(
        { project, parentBin, runBin, subclips, sequence },
        { delay, timeoutMs: options && options.timeoutMs, strict: true, restoreActive: previousActive, expectedBinName: runBinName }
      );
      return Object.freeze({
        status: "PASS",
        cleaned: cleanup.cleaned,
        operationId,
        clipId: clipIdentity(context.clip),
        duration: timing.duration,
        frameRate: timing.frameRate,
        checks: Object.freeze({ subclip: true, sequence: true, activation: true, cleanup: cleanup.cleaned }),
      });
    } catch (error) {
      const cleanup = await cleanupGenerated(
        { project, parentBin, runBin, subclips, sequence },
        { delay, timeoutMs: options && options.timeoutMs, strict: false, restoreActive: previousActive, expectedBinName: runBinName }
      );
      if (!cleanup.cleaned) {
        throw new Error(`${messageOf(error)} 자체시험 흔적 자동 정리에도 실패했습니다: ${cleanup.errors.join(" / ")}`);
      }
      throw error;
    }
  }

  async function cleanupSelfTestArtifacts(ppro, options) {
    if (!ppro || !ppro.Project || !ppro.FolderItem) throw new Error("Premiere UXP API를 불러오지 못했습니다.");
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("열린 Premiere 프로젝트가 없습니다.");
    if (typeof project.getRootItem !== "function") throw new Error("프로젝트 루트 조회 API를 사용할 수 없습니다.");
    const root = await project.getRootItem();
    if (!root) throw new Error("프로젝트 루트 빈을 찾지 못했습니다.");
    const delay = options && typeof options.delay === "function" ? options.delay : sleep;
    const timeoutMs = options && Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs) : POLL_TIMEOUT_MS;
    const errors = [];
    let removedSequences = 0;
    let removedBins = 0;

    const sequences = await project.getSequences();
    for (const sequence of sequences || []) {
      if (!isInternalSelfTestName(sequence && sequence.name)) continue;
      try {
        try { await project.closeSequence(sequence); } catch (_) { /* not necessarily open */ }
        const deleted = await project.deleteSequence(sequence);
        if (deleted === false) throw new Error(`시퀀스 삭제 거부: ${sequence.name}`);
        removedSequences += 1;
      } catch (error) { errors.push(messageOf(error)); }
    }

    const targets = await findInternalFolders(root, ppro);
    for (const target of targets.sort((a, b) => b.depth - a.depth)) {
      try {
        const children = await target.folder.getItems();
        if (children && children.length) executeActions(project, children.map((item) => function () { return target.folder.createRemoveItemAction(item); }), "Premiere AI Harness: 자체시험 자산 정리");
        executeActions(project, [function () { return target.parent.createRemoveItemAction(target.folder); }], "Premiere AI Harness: 자체시험 빈 정리");
        removedBins += 1;
      } catch (error) { errors.push(messageOf(error)); }
    }

    try {
      await poll(async function () {
        const remainingSequences = (await project.getSequences() || []).some((sequence) => isInternalSelfTestName(sequence && sequence.name));
        const remainingFolders = (await findInternalFolders(root, ppro)).length > 0;
        return !remainingSequences && !remainingFolders;
      }, delay, "자체시험 흔적이 프로젝트에 남아 있습니다.", timeoutMs);
    } catch (error) { errors.push(messageOf(error)); }

    if (errors.length) throw new Error(`자체시험 흔적 정리를 완료하지 못했습니다: ${errors.join(" / ")}`);
    return Object.freeze({ status: "PASS", removedSequences, removedBins });
  }

  async function selectedClipContext(ppro) {
    if (!ppro || !ppro.Project || !ppro.ProjectUtils || !ppro.ClipProjectItem) {
      throw new Error("Premiere UXP API를 불러오지 못했습니다.");
    }
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("열린 Premiere 프로젝트가 없습니다.");
    const selection = await ppro.ProjectUtils.getSelection(project);
    const items = selection ? await selection.getItems() : [];
    if (!Array.isArray(items) || items.length !== 1) {
      throw new Error("프로젝트 패널에서 원본 미디어 클립 하나만 선택하십시오.");
    }
    let clip = null;
    try { clip = ppro.ClipProjectItem.cast(items[0]); } catch (_) { clip = null; }
    if (!clip) throw new Error("선택 항목은 일반 미디어 클립이어야 합니다.");
    return Object.freeze({ project, clip });
  }

  async function assertSupportedClip(clip) {
    if (typeof clip.isOffline === "function" && await clip.isOffline()) throw new Error("오프라인 미디어는 편집할 수 없습니다.");
    if (typeof clip.isSequence === "function" && await clip.isSequence()) throw new Error("중첩 시퀀스는 현재 지원하지 않습니다.");
    if (typeof clip.isMergedClip === "function" && await clip.isMergedClip()) throw new Error("병합 클립은 현재 지원하지 않습니다.");
    if (typeof clip.isMulticamClip === "function" && await clip.isMulticamClip()) throw new Error("멀티캠 원본은 현재 Core 러프컷에서 지원하지 않습니다.");
    if (typeof clip.createSubClipAction !== "function") throw new Error("Premiere Pro 26.3 이상이 필요합니다.");
  }

  async function readSourceTiming(clip) {
    const media = await clip.getMedia();
    const durationValue = await maybePromise(media && media.duration);
    const duration = Number(durationValue && durationValue.seconds);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 12 * 60 * 60) {
      throw new Error("원본 미디어 길이를 확인하지 못했습니다.");
    }
    const interpretation = await clip.getFootageInterpretation();
    const frameRate = Number(await maybePromise(interpretation && interpretation.getFrameRate && interpretation.getFrameRate()));
    if (!Number.isFinite(frameRate) || frameRate < 1 || frameRate > 240) {
      throw new Error("원본 미디어 프레임레이트를 확인하지 못했습니다.");
    }
    return Object.freeze({ duration, frameRate });
  }

  function alignKeepRangesToFrames(ranges, duration, frameRate) {
    if (!Array.isArray(ranges) || !ranges.length) throw new Error("유지할 구간이 없습니다.");
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("원본 길이가 올바르지 않습니다.");
    if (!Number.isFinite(frameRate) || frameRate <= 0) throw new Error("프레임레이트가 올바르지 않습니다.");

    const sorted = ranges.map((range, index) => {
      const start = Number(range && range.start);
      const end = Number(range && range.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration + FRAME_EPSILON) {
        throw new Error(`유지 구간 ${index + 1}의 시간이 올바르지 않습니다.`);
      }
      const startFrame = Math.max(0, Math.ceil(start * frameRate - FRAME_EPSILON));
      const endFrame = Math.min(Math.floor(duration * frameRate + FRAME_EPSILON), Math.floor(end * frameRate + FRAME_EPSILON));
      return {
        startFrame,
        endFrame,
        start: startFrame / frameRate,
        end: endFrame / frameRate,
        adjustedStart: Math.abs(startFrame / frameRate - start) > FRAME_EPSILON,
        adjustedEnd: Math.abs(endFrame / frameRate - end) > FRAME_EPSILON,
      };
    }).filter((range) => range.endFrame > range.startFrame)
      .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);

    const merged = [];
    for (const range of sorted) {
      const last = merged[merged.length - 1];
      if (last && range.startFrame <= last.endFrame) {
        last.endFrame = Math.max(last.endFrame, range.endFrame);
        last.end = last.endFrame / frameRate;
        last.adjustedEnd = last.adjustedEnd || range.adjustedEnd;
      } else {
        merged.push(Object.assign({}, range));
      }
    }
    return merged.map((range) => Object.freeze(range));
  }

  function verifyExpectedSource(clip, timing, expected) {
    if (!expected) return;
    const actualId = clipIdentity(clip);
    if (expected.clipId && actualId && String(expected.clipId) !== actualId) {
      throw new Error("편집안을 만든 뒤 선택한 원본 클립이 바뀌었습니다. 다시 분석하십시오.");
    }
    if (Number.isFinite(expected.duration) && Math.abs(Number(expected.duration) - timing.duration) > 0.002) {
      throw new Error("편집안을 만든 뒤 원본 길이가 달라졌습니다. 다시 분석하십시오.");
    }
    if (Number.isFinite(expected.frameRate) && Math.abs(Number(expected.frameRate) - timing.frameRate) > 0.0001) {
      throw new Error("편집안을 만든 뒤 원본 프레임레이트가 달라졌습니다. 다시 분석하십시오.");
    }
  }

  async function verifyExpectedTranscript(ppro, clip, expectedJson) {
    if (!expectedJson) return;
    if (!await maybePromise(ppro.Transcript.hasTranscript(clip))) {
      throw new Error("편집안을 만든 뒤 Premiere 전사문이 사라졌습니다. 다시 분석하십시오.");
    }
    const current = await ppro.Transcript.exportToJSON(clip);
    if (canonicalJson(current) !== canonicalJson(expectedJson)) {
      throw new Error("편집안을 만든 뒤 Premiere 전사문이 바뀌었습니다. 다시 분석하십시오.");
    }
  }

  async function uniqueSequenceName(project, requested) {
    const names = new Set((await project.getSequences() || []).map((sequence) => String(sequence.name || "")));
    if (!names.has(requested)) return requested;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${requested}_${index}`;
      if (!names.has(candidate)) return candidate;
    }
    throw new Error("새 시퀀스 이름을 만들지 못했습니다.");
  }

  async function createRunBin(project, parentBin, name, ppro, delay) {
    executeActions(project, [function () { return parentBin.createBinAction(name, false); }], "Premiere AI Harness: 작업 빈 생성");
    const item = await poll(async function () {
      const items = await parentBin.getItems();
      return (items || []).find((entry) => String(entry.name || "") === name) || null;
    }, delay, `작업 빈 “${name}”을 찾지 못했습니다.`);
    let folder = null;
    try { folder = ppro.FolderItem.cast(item); } catch (_) { folder = null; }
    if (!folder) throw new Error("생성된 작업 빈을 FolderItem으로 확인하지 못했습니다.");
    return folder;
  }

  async function createSubclips(project, sourceClip, ranges, names, frameRateObject, ppro) {
    for (let offset = 0; offset < ranges.length; offset += ACTION_BATCH_SIZE) {
      const actions = [];
      for (let index = offset; index < Math.min(offset + ACTION_BATCH_SIZE, ranges.length); index += 1) {
        const range = ranges[index];
        const start = ppro.TickTime.createWithFrameAndFrameRate(range.startFrame, frameRateObject);
        const end = ppro.TickTime.createWithFrameAndFrameRate(range.endFrame, frameRateObject);
        actions.push(function () { return sourceClip.createSubClipAction(names[index], start, end, true, { takeVideo: true, takeAudio: true }); });
      }
      executeActions(project, actions, "Premiere AI Harness: 유지 구간 서브클립 생성");
    }
  }

  async function waitForNamedClipItems(folder, names, ppro, delay) {
    const expected = new Set(names);
    return poll(async function () {
      const items = await folder.getItems();
      const found = [];
      for (const item of items || []) {
        if (!expected.has(String(item.name || ""))) continue;
        try { found.push(ppro.ClipProjectItem.cast(item)); } catch (_) { /* not a clip */ }
      }
      return found.length === expected.size ? found.sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name)) : null;
    }, delay, `생성된 서브클립 ${names.length}개를 확인하지 못했습니다.`);
  }

  async function moveItems(project, sourceFolder, targetFolder, items) {
    for (let offset = 0; offset < items.length; offset += ACTION_BATCH_SIZE) {
      const actions = items.slice(offset, offset + ACTION_BATCH_SIZE).map((item) => function () { return sourceFolder.createMoveItemAction(item, targetFolder); });
      executeActions(project, actions, "Premiere AI Harness: 생성 서브클립 정리");
    }
  }

  function executeActions(project, actionFactories, label) {
    if (!actionFactories || !actionFactories.length) return;
    let committed = false;
    project.lockedAccess(function () {
      const actions = actionFactories.map(function (factory) {
        const action = factory();
        if (!action) throw new Error("Premiere 작업 Action을 만들지 못했습니다.");
        return action;
      });
      committed = project.executeTransaction(function (compoundAction) {
        for (const action of actions) {
          if (compoundAction.addAction(action) === false) {
            throw new Error("Premiere 작업을 트랜잭션에 추가하지 못했습니다.");
          }
        }
      }, label);
    });
    if (!committed) throw new Error("Premiere가 편집 트랜잭션을 거부했습니다.");
  }

  async function cleanupGenerated(resources, options) {
    const project = resources.project;
    const parentBin = resources.parentBin;
    const delay = options && typeof options.delay === "function" ? options.delay : sleep;
    const timeoutMs = options && Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs) : POLL_TIMEOUT_MS;
    const errors = [];

    if (resources.sequence) {
      try { await project.closeSequence(resources.sequence); } catch (_) { /* sequence may not be open */ }
      try {
        const deleted = await project.deleteSequence(resources.sequence);
        if (deleted === false) throw new Error("생성 시퀀스 삭제를 Premiere가 거부했습니다.");
      } catch (error) { errors.push(messageOf(error)); }
    }

    if (options && options.restoreActive) {
      try {
        const restored = await project.setActiveSequence(options.restoreActive);
        if (restored === false) throw new Error("기존 활성 시퀀스를 복원하지 못했습니다.");
      } catch (error) { errors.push(messageOf(error)); }
    }

    if (resources.runBin) {
      try {
        const items = await resources.runBin.getItems();
        if (items && items.length) executeActions(project, items.map((item) => function () { return resources.runBin.createRemoveItemAction(item); }), "Premiere AI Harness: 생성 서브클립 정리");
        executeActions(project, [function () { return parentBin.createRemoveItemAction(resources.runBin); }], "Premiere AI Harness: 생성 작업 빈 정리");
      } catch (error) { errors.push(messageOf(error)); }
    } else if (resources.subclips && resources.subclips.length) {
      try { executeActions(project, resources.subclips.map((item) => function () { return parentBin.createRemoveItemAction(item); }), "Premiere AI Harness: 생성 서브클립 정리"); }
      catch (error) { errors.push(messageOf(error)); }
    }

    try {
      await poll(async function () {
        const sequences = await project.getSequences();
        const sequenceGone = !resources.sequence || !(sequences || []).some((item) => sequenceIdentity(item) === sequenceIdentity(resources.sequence));
        const items = parentBin ? await parentBin.getItems() : [];
        const binName = (options && options.expectedBinName) || (resources.runBin && resources.runBin.name);
        const binGone = !binName || !(items || []).some((item) => String(item.name || "") === String(binName));
        return sequenceGone && binGone;
      }, delay, "생성 자산 정리 결과를 확인하지 못했습니다.", timeoutMs);
    } catch (error) { errors.push(messageOf(error)); }

    const result = Object.freeze({ cleaned: errors.length === 0, errors: Object.freeze(errors.slice()) });
    if (options && options.strict && !result.cleaned) throw new Error(result.errors.join(" / "));
    return result;
  }

  async function findInternalFolders(rootFolder, ppro) {
    const found = [];
    async function visit(folder, depth) {
      const items = await folder.getItems();
      for (const item of items || []) {
        let child = null;
        try { child = ppro.FolderItem.cast(item); } catch (_) { child = null; }
        if (!child) continue;
        if (isInternalSelfTestName(child.name)) found.push({ folder: child, parent: folder, depth });
        else await visit(child, depth + 1);
      }
    }
    await visit(rootFolder, 1);
    return found;
  }

  async function poll(check, delay, failureMessage, timeoutMs) {
    const deadline = Date.now() + (Number.isFinite(timeoutMs) ? timeoutMs : POLL_TIMEOUT_MS);
    while (Date.now() < deadline) {
      const value = await check();
      if (value) return value;
      await delay(POLL_INTERVAL_MS);
    }
    throw new Error(failureMessage);
  }

  function makeOperationId(prefix) { return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function isInternalSelfTestName(name) { return String(name || "").startsWith(SELF_TEST_PREFIX) || String(name || "").startsWith(TEMP_PREFIX); }
  function canonicalJson(value) {
    try { return JSON.stringify(JSON.parse(String(value))); }
    catch (_) { return String(value || "").trim(); }
  }
  function maybePromise(value) { return Promise.resolve(value); }
  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function sanitizeName(value) { return String(value || "AI_ROUGH_CUT").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 180) || "AI_ROUGH_CUT"; }
  function sequenceIdentity(sequence) { return String((sequence && (sequence.guid || sequence.id)) || (sequence && sequence.name) || ""); }
  function clipIdentity(clip) {
    try { return String((clip && typeof clip.getId === "function" && clip.getId()) || (clip && clip.id) || ""); }
    catch (_) { return String((clip && clip.id) || ""); }
  }
  function messageOf(error) { return String(error && error.message ? error.message : error); }

  return {
    OUTPUT_PREFIX,
    SELF_TEST_PREFIX,
    inspectSelection,
    loadSelectedTranscript,
    createRoughCut,
    runHostSelfTest,
    cleanupSelfTestArtifacts,
    selectedClipContext,
    alignKeepRangesToFrames,
    readSourceTiming,
    verifyExpectedSource,
    verifyExpectedTranscript,
  };
});
