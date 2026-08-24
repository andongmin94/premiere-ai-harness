(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports && typeof window === "undefined") module.exports = api;
  else root.PAI = Object.assign(root.PAI || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_TIMEOUT_MS = 12000;
  const POLL_INTERVAL_MS = 150;
  const FRAME_EPSILON = 1e-7;
  const OUTPUT_PREFIX = "PAI_OUTPUT_";
  const SELF_TEST_PREFIX = "PAI_INTERNAL_SELFTEST_";
  const TEMP_PREFIX = "PAI_INTERNAL_TEMP_";
  const INTERNAL_PATTERN = /^PAI_INTERNAL_(?:SELFTEST|TEMP)_[a-z0-9]+_[a-z0-9]{8}(?:_(?:BIN|CLIP))?$/i;

  async function selectedClipContext(ppro) {
    if (!ppro?.Project?.getActiveProject || !ppro?.ProjectUtils?.getSelection || !ppro?.ClipProjectItem?.cast) throw new Error("Premiere UXP API를 불러오지 못했습니다.");
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("열린 Premiere 프로젝트가 없습니다.");
    const selection = await ppro.ProjectUtils.getSelection(project);
    const items = Array.from(selection?.getItems ? await selection.getItems() : []);
    if (items.length !== 1) throw new Error("프로젝트 패널에서 원본 미디어 클립 하나만 선택하십시오.");
    const clip = safeCast(ppro.ClipProjectItem, items[0]);
    if (!clip) throw new Error("선택 항목은 일반 미디어 클립이어야 합니다.");
    return Object.freeze({ project, clip });
  }

  async function assertSupportedClip(clip) {
    if (await callBoolean(clip, "isOffline")) throw new Error("오프라인 미디어는 편집할 수 없습니다.");
    if (await callBoolean(clip, "isSequence")) throw new Error("중첩 시퀀스는 현재 지원하지 않습니다.");
    if (await callBoolean(clip, "isMergedClip")) throw new Error("병합 클립은 현재 지원하지 않습니다.");
    if (await callBoolean(clip, "isMulticamClip")) throw new Error("멀티캠 원본은 현재 Core 러프컷에서 지원하지 않습니다.");
    if (typeof clip?.createSubClipAction !== "function") throw new Error("Premiere Pro 26.3 이상이 필요합니다.");
  }

  async function readSourceTiming(clip) {
    const media = await clip.getMedia();
    const durationValue = await maybePromise(media?.duration);
    const duration = Number(durationValue?.seconds);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 12 * 60 * 60) throw new Error("원본 미디어 길이를 확인하지 못했습니다.");
    const interpretation = await clip.getFootageInterpretation();
    const frameRate = Number(await maybePromise(interpretation?.getFrameRate?.()));
    if (!Number.isFinite(frameRate) || frameRate < 1 || frameRate > 240) throw new Error("원본 미디어 프레임레이트를 확인하지 못했습니다.");
    return Object.freeze({ duration, frameRate });
  }

  function alignKeepRangesToFrames(ranges, duration, frameRate) {
    if (!Array.isArray(ranges) || ranges.length === 0) throw new Error("유지할 구간이 없습니다.");
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("원본 길이가 올바르지 않습니다.");
    if (!Number.isFinite(frameRate) || frameRate <= 0) throw new Error("프레임레이트가 올바르지 않습니다.");
    const maxFrame = Math.floor(duration * frameRate + FRAME_EPSILON);
    const normalized = ranges.map((range, index) => normalizeRange(range, index, duration, frameRate, maxFrame));
    const collapsed = normalized.find((range) => range.endFrame <= range.startFrame);
    if (collapsed) throw new Error(`유지 구간 ${collapsed.index + 1}이 프레임 정렬 후 사라집니다. 삭제 후보 선택을 조정하십시오.`);
    normalized.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
    const merged = [];
    for (const range of normalized) {
      const previous = merged[merged.length - 1];
      if (previous && range.startFrame <= previous.endFrame) mergeRange(previous, range, frameRate);
      else merged.push({ ...range });
    }
    return merged.map(({ index: _index, ...range }) => Object.freeze(range));
  }

  function verifyExpectedSource(project, clip, timing, expected) {
    if (!expected) return;
    const actualProjectId = projectIdentity(project);
    const actualClipId = clipIdentity(clip);
    if (expected.projectId && actualProjectId && String(expected.projectId) !== actualProjectId) throw new Error("편집안을 만든 프로젝트가 바뀌었습니다. 다시 분석하십시오.");
    if (expected.clipId && actualClipId && String(expected.clipId) !== actualClipId) throw new Error("편집안을 만든 뒤 선택한 원본 클립이 바뀌었습니다. 다시 분석하십시오.");
    if (Number.isFinite(expected.duration) && Math.abs(Number(expected.duration) - timing.duration) > 0.002) throw new Error("편집안을 만든 뒤 원본 길이가 달라졌습니다. 다시 분석하십시오.");
    if (Number.isFinite(expected.frameRate) && Math.abs(Number(expected.frameRate) - timing.frameRate) > 0.0001) throw new Error("편집안을 만든 뒤 원본 프레임레이트가 달라졌습니다. 다시 분석하십시오.");
  }

  async function verifyExpectedTranscript(ppro, clip, expectedRaw) {
    if (expectedRaw == null) return;
    if (!await maybePromise(ppro.Transcript.hasTranscript(clip))) throw new Error("편집안을 만든 뒤 Premiere 전사문이 제거되었습니다. 다시 분석하십시오.");
    const currentRaw = await ppro.Transcript.exportToJSON(clip);
    if (canonicalJson(currentRaw) !== canonicalJson(expectedRaw)) throw new Error("편집안을 만든 뒤 Premiere 전사문이 바뀌었습니다. 다시 분석하십시오.");
  }

  function runTransaction(project, label, actionFactories) {
    if (!Array.isArray(actionFactories) || actionFactories.length === 0) return;
    if (typeof project?.lockedAccess !== "function" || typeof project?.executeTransaction !== "function") throw new Error("Premiere 편집 트랜잭션 API를 사용할 수 없습니다.");
    let result;
    let failure;
    project.lockedAccess(function () {
      try {
        result = project.executeTransaction(function (compoundAction) {
          for (const factory of actionFactories) {
            const action = typeof factory === "function" ? factory() : factory;
            if (!action || compoundAction.addAction(action) === false) throw new Error("Premiere 작업을 트랜잭션에 추가하지 못했습니다.");
          }
        }, label);
      } catch (error) { failure = error; }
    });
    if (failure) throw failure;
    if (result === false) throw new Error("Premiere가 편집 트랜잭션을 거부했습니다.");
  }

  async function poll(check, delay, failureMessage, timeoutMs) {
    const wait = typeof delay === "function" ? delay : sleep;
    const deadline = Date.now() + normalizeTimeout(timeoutMs);
    while (Date.now() < deadline) {
      const value = await check();
      if (value) return value;
      await wait(POLL_INTERVAL_MS);
    }
    throw new Error(failureMessage);
  }

  async function uniqueSequenceName(project, requested) {
    const names = new Set((await project.getSequences() || []).map((sequence) => String(sequence?.name || "")));
    if (!names.has(requested)) return requested;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${requested}_${index}`;
      if (!names.has(candidate)) return candidate;
    }
    throw new Error("새 시퀀스 이름을 만들지 못했습니다.");
  }

  function makeOperationId(prefix) {
    const random = Math.random().toString(36).slice(2, 10).padEnd(8, "0").slice(0, 8);
    return `${prefix}${Date.now().toString(36)}_${random}`;
  }

  function safeCast(caster, value) { try { return caster?.cast ? caster.cast(value) || null : null; } catch (_) { return null; } }
  function projectIdentity(project) { return String(project?.guid || project?.id || project?.projectId || project?.name || ""); }
  function isInternalName(value) { return INTERNAL_PATTERN.test(String(value || "")); }
  function sanitizeName(value) { return String(value || "AI_ROUGH_CUT").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 180) || "AI_ROUGH_CUT"; }
  function sequenceIdentity(value) { return String(value?.guid || value?.id || value?.name || ""); }
  function clipIdentity(value) { try { return String(value?.getId?.() || value?.id || ""); } catch (_) { return String(value?.id || ""); } }
  function messageOf(error) { return error?.message ? String(error.message) : String(error); }
  function maybePromise(value) { return Promise.resolve(value); }
  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function canonicalJson(raw) { try { return JSON.stringify(sortJson(JSON.parse(String(raw)))); } catch (_) { return String(raw == null ? "" : raw).trim(); } }
  function sortJson(value) { if (Array.isArray(value)) return value.map(sortJson); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])])); return value; }
  async function callBoolean(target, method) { return typeof target?.[method] === "function" && Boolean(await target[method]()); }

  function normalizeRange(range, index, duration, frameRate, maxFrame) {
    const start = Number(range?.start);
    const end = Number(range?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration + FRAME_EPSILON) throw new Error(`유지 구간 ${index + 1}의 시간이 올바르지 않습니다.`);
    const startFrame = Math.max(0, Math.ceil(start * frameRate - FRAME_EPSILON));
    const endFrame = Math.min(maxFrame, Math.floor(end * frameRate + FRAME_EPSILON));
    return { index, startFrame, endFrame, start: startFrame / frameRate, end: endFrame / frameRate, adjustedStart: Math.abs(startFrame / frameRate - start) > FRAME_EPSILON, adjustedEnd: Math.abs(endFrame / frameRate - end) > FRAME_EPSILON };
  }
  function mergeRange(target, source, frameRate) { target.endFrame = Math.max(target.endFrame, source.endFrame); target.end = target.endFrame / frameRate; target.adjustedEnd = target.adjustedEnd || source.adjustedEnd; }
  function normalizeTimeout(value) { return Number.isFinite(value) ? Math.max(250, Math.min(60000, value)) : DEFAULT_TIMEOUT_MS; }

  return {
    DEFAULT_TIMEOUT_MS, OUTPUT_PREFIX, SELF_TEST_PREFIX, TEMP_PREFIX,
    selectedClipContext, assertSupportedClip, readSourceTiming, alignKeepRangesToFrames,
    verifyExpectedSource, verifyExpectedTranscript, runTransaction, poll, uniqueSequenceName,
    makeOperationId, safeCast, projectIdentity, isInternalName, sanitizeName, sequenceIdentity,
    clipIdentity, messageOf, maybePromise, sleep, canonicalJson,
  };
});
