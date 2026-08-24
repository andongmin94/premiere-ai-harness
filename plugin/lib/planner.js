(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports && typeof window === "undefined") module.exports = api;
  else root.PAI = Object.assign(root.PAI || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EPSILON = 1e-9;
  const PRESETS = Object.freeze({
    conservative: Object.freeze({ silenceSeconds: 1.2, preservePause: 0.25, duplicateSimilarity: 0.94, maxDeleteRatio: 0.25, minKeepSeconds: 0.3 }),
    balanced: Object.freeze({ silenceSeconds: 0.8, preservePause: 0.2, duplicateSimilarity: 0.88, maxDeleteRatio: 0.4, minKeepSeconds: 0.25 }),
    tight: Object.freeze({ silenceSeconds: 0.55, preservePause: 0.15, duplicateSimilarity: 0.82, maxDeleteRatio: 0.55, minKeepSeconds: 0.2 }),
  });
  const RETAKE_SIGNALS = [
    /(?:아|어)?\s*(?:잠깐만|다시\s*(?:할게|갈게|가겠습니다|말할게|말씀드리겠습니다)|여기부터\s*다시|한\s*번\s*더)/i,
    /(?:let me|i(?:'|’)ll)\s+(?:start|say|do)\s+(?:that\s+)?again|take\s+(?:that|it)\s+again|start\s+over/i,
  ];
  const FILLERS = new Set(["어", "음", "아", "그", "뭐", "약간", "이제", "그러니까", "uh", "um", "erm", "hmm"]);

  function createEditPlan(segments, options) {
    if (!Array.isArray(segments) || segments.length === 0) throw new Error("분석할 전사 구간이 없습니다.");
    const opts = options || {};
    const presetName = Object.prototype.hasOwnProperty.call(PRESETS, opts.preset) ? opts.preset : "balanced";
    const rules = Object.freeze(Object.assign({}, PRESETS[presetName], opts.rules || {}));
    validateRules(rules);
    const duration = Number.isFinite(opts.duration) ? Number(opts.duration) : Number(segments[segments.length - 1].end);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("원본 길이가 올바르지 않습니다.");
    const transcriptEnd = segments.reduce((maximum, segment) => Math.max(maximum, Number(segment.end)), 0);
    if (!Number.isFinite(transcriptEnd) || transcriptEnd > duration + 0.001) throw new Error("전사문 길이가 원본보다 깁니다.");

    const candidates = [];
    detectRetakes(segments, candidates);
    detectSilences(segments, candidates, rules);
    detectFillerRuns(segments, candidates);
    detectDuplicates(segments, candidates, rules);
    const merged = mergeCandidates(candidates, duration);
    const basePlan = Object.freeze({ duration, candidates: Object.freeze(merged), rules });
    const selectedIds = selectSafeCandidates(basePlan);
    const approved = approveCandidates(basePlan, selectedIds);
    return Object.freeze({
      version: 1,
      preset: presetName,
      duration,
      rules,
      candidates: basePlan.candidates,
      selectedIds: Object.freeze(selectedIds),
      keepRanges: approved.keepRanges,
      stats: approved.stats,
    });
  }

  function selectSafeCandidates(plan) {
    const eligible = (plan.candidates || []).filter((candidate) => candidate.confidence >= 0.9)
      .sort((left, right) => right.confidence - left.confidence || left.start - right.start || left.end - right.end);
    const selected = [];
    for (const candidate of eligible) {
      try {
        approveCandidates(plan, selected.concat(candidate.id));
        selected.push(candidate.id);
      } catch (error) {
        if (error?.code !== "PAI_APPROVAL_SAFETY") throw error;
      }
    }
    const order = new Map((plan.candidates || []).map((candidate, index) => [candidate.id, index]));
    return selected.sort((left, right) => order.get(left) - order.get(right));
  }

  function approveCandidates(plan, selectedIds) {
    validatePlan(plan);
    const candidateById = new Map(plan.candidates.map((candidate) => [String(candidate.id), candidate]));
    const selected = new Set((selectedIds || []).map(String));
    for (const id of selected) if (!candidateById.has(id)) throw new Error(`현재 편집안에 없는 삭제 후보입니다: ${id}`);

    const duration = Number(plan.duration);
    const rules = plan.rules || PRESETS.balanced;
    const deletions = [...selected].map((id) => candidateById.get(id)).map(({ start, end }) => ({ start, end }));
    const merged = mergeRanges(deletions, duration);
    const deletedSecondsRaw = merged.reduce((total, range) => total + range.end - range.start, 0);
    if (deletedSecondsRaw / duration > rules.maxDeleteRatio + EPSILON) {
      throw approvalSafetyError(`선택한 삭제량이 안전 상한 ${(rules.maxDeleteRatio * 100).toFixed(0)}%를 넘습니다.`);
    }

    const keepRanges = invertRanges(merged, duration);
    if (keepRanges.length === 0) throw approvalSafetyError("편집 후 남는 영상이 없습니다.");
    if (merged.length > 0) {
      const short = keepRanges.find((range) => range.end - range.start + EPSILON < rules.minKeepSeconds);
      if (short) throw approvalSafetyError(`선택 결과 ${rules.minKeepSeconds.toFixed(2)}초보다 짧은 유지 구간이 생깁니다. 삭제 후보 선택을 조정하십시오.`);
    }

    const keptSecondsRaw = keepRanges.reduce((total, range) => total + range.end - range.start, 0);
    if (Math.abs(deletedSecondsRaw + keptSecondsRaw - duration) > 0.001) throw new Error("편집 구간 합계가 원본 길이와 일치하지 않습니다.");
    return Object.freeze({
      keepRanges: Object.freeze(keepRanges.map((range) => Object.freeze(range))),
      stats: Object.freeze({ duration: round3(duration), deletedSeconds: round3(deletedSecondsRaw), keptSeconds: round3(keptSecondsRaw), selectedCount: selected.size }),
    });
  }

  function detectRetakes(segments, output) {
    segments.forEach((segment, index) => {
      if (!RETAKE_SIGNALS.some((pattern) => pattern.test(segment.text))) return;
      let start = segment.start;
      if (index > 0) {
        const previous = segments[index - 1];
        const gap = segment.start - previous.end;
        if (gap <= 1.5 && !/[.!?。！？]$/.test(previous.text)) start = previous.start;
      }
      output.push(candidate("retake", start, segment.end, 0.99, "재촬영 신호가 포함된 구간"));
    });
  }

  function detectSilences(segments, output, rules) {
    for (let index = 1; index < segments.length; index += 1) {
      const previous = segments[index - 1];
      const current = segments[index];
      const gap = current.start - previous.end;
      if (gap < rules.silenceSeconds) continue;
      const start = previous.end + rules.preservePause;
      const end = current.start - rules.preservePause;
      if (end - start >= 0.2) output.push(candidate("silence", start, end, Math.min(0.98, 0.82 + gap / 10), `긴 무음 ${gap.toFixed(2)}초`));
    }
  }

  function detectFillerRuns(segments, output) {
    let runStart = -1;
    for (let index = 0; index <= segments.length; index += 1) {
      const filler = index < segments.length && isFillerOnly(segments[index].text);
      if (filler && runStart < 0) runStart = index;
      if ((!filler || index === segments.length) && runStart >= 0) {
        const runEnd = index - 1;
        if (runEnd - runStart + 1 >= 2) output.push(candidate("filler", segments[runStart].start, segments[runEnd].end, 0.92, "연속 필러 발화"));
        runStart = -1;
      }
    }
  }

  function detectDuplicates(segments, output, rules) {
    for (let index = 1; index < segments.length; index += 1) {
      const earlier = segments[index - 1];
      const later = segments[index];
      if (later.start - earlier.end > 3) continue;
      const similarity = textSimilarity(earlier.text, later.text);
      if (similarity < rules.duplicateSimilarity) continue;
      const target = normalizeForCompare(later.text).length >= normalizeForCompare(earlier.text).length ? earlier : later;
      output.push(candidate("duplicate", target.start, target.end, Math.min(0.97, 0.75 + similarity * 0.22), `유사 반복 발화 ${(similarity * 100).toFixed(0)}%`));
    }
  }

  function mergeCandidates(candidates, duration) {
    const normalized = candidates.map((item) => ({
      type: item.type,
      start: clamp(round3(item.start), 0, duration),
      end: clamp(round3(item.end), 0, duration),
      confidence: clamp(item.confidence, 0, 1),
      reason: item.reason,
    })).filter((item) => item.end - item.start >= 0.05).sort((left, right) => left.start - right.start || left.end - right.end);
    const result = [];
    for (const item of normalized) {
      const previous = result[result.length - 1];
      if (previous && item.start <= previous.end + 0.02) {
        previous.end = Math.max(previous.end, item.end);
        previous.confidence = Math.max(previous.confidence, item.confidence);
        previous.type = previous.type === item.type ? previous.type : "combined";
        if (!previous.reason.includes(item.reason)) previous.reason += ` · ${item.reason}`;
      } else result.push(Object.assign({}, item));
    }
    return result.map((item, index) => Object.freeze(Object.assign({ id: `cut-${String(index + 1).padStart(4, "0")}` }, item)));
  }

  function mergeRanges(ranges, duration) {
    const sorted = ranges.map((range) => ({ start: clamp(Number(range.start), 0, duration), end: clamp(Number(range.end), 0, duration) }))
      .filter((range) => range.end > range.start).sort((left, right) => left.start - right.start || left.end - right.end);
    const result = [];
    for (const range of sorted) {
      const previous = result[result.length - 1];
      if (previous && range.start <= previous.end + EPSILON) previous.end = Math.max(previous.end, range.end);
      else result.push({ start: range.start, end: range.end });
    }
    return result.map((range) => ({ start: round3(range.start), end: round3(range.end) }));
  }

  function invertRanges(deletions, duration) {
    const keep = [];
    let cursor = 0;
    for (const deletion of deletions) {
      if (deletion.start > cursor + EPSILON) keep.push({ start: round3(cursor), end: round3(deletion.start) });
      cursor = Math.max(cursor, deletion.end);
    }
    if (cursor < duration - EPSILON) keep.push({ start: round3(cursor), end: round3(duration) });
    return keep;
  }

  function validatePlan(plan) {
    if (!plan || !Array.isArray(plan.candidates) || !Number.isFinite(Number(plan.duration)) || Number(plan.duration) <= 0) throw new Error("편집안이 올바르지 않습니다.");
    validateRules(plan.rules || PRESETS.balanced);
    const ids = new Set();
    for (const item of plan.candidates) {
      const id = String(item?.id || "");
      if (!id || ids.has(id)) throw new Error("편집안의 삭제 후보 ID가 올바르지 않습니다.");
      ids.add(id);
    }
  }

  function validateRules(rules) {
    for (const name of ["silenceSeconds", "preservePause", "duplicateSimilarity", "maxDeleteRatio", "minKeepSeconds"]) {
      if (!Number.isFinite(Number(rules?.[name]))) throw new Error(`편집 규칙 ${name} 값이 올바르지 않습니다.`);
    }
    if (rules.maxDeleteRatio <= 0 || rules.maxDeleteRatio >= 1) throw new Error("삭제량 안전 상한은 0과 1 사이여야 합니다.");
    if (rules.minKeepSeconds <= 0) throw new Error("최소 유지 구간은 0보다 커야 합니다.");
  }

  function approvalSafetyError(message) { const error = new Error(message); error.code = "PAI_APPROVAL_SAFETY"; return error; }
  function candidate(type, start, end, confidence, reason) { return { type, start, end, confidence, reason }; }
  function isFillerOnly(text) { const tokens = tokenize(text); return tokens.length > 0 && tokens.length <= 4 && tokens.every((token) => FILLERS.has(token)); }
  function textSimilarity(left, right) { const first = new Set(tokenize(left)); const second = new Set(tokenize(right)); if (!first.size || !second.size) return 0; let intersection = 0; for (const token of first) if (second.has(token)) intersection += 1; return intersection / Math.max(first.size, second.size); }
  function tokenize(text) { return normalizeForCompare(text).split(/\s+/).filter(Boolean); }
  function normalizeForCompare(text) { return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim(); }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }
  function round3(value) { return Math.round(Number(value) * 1000) / 1000; }

  return { PRESETS, createEditPlan, approveCandidates, mergeRanges, invertRanges, textSimilarity, selectSafeCandidates };
});
