(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PAI = Object.assign(root.PAI || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

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
    if (!Array.isArray(segments) || !segments.length) throw new Error("분석할 전사 구간이 없습니다.");
    const opts = options || {};
    const presetName = Object.prototype.hasOwnProperty.call(PRESETS, opts.preset) ? opts.preset : "balanced";
    const rules = Object.assign({}, PRESETS[presetName], opts.rules || {});
    const duration = Number.isFinite(opts.duration) ? Number(opts.duration) : segments[segments.length - 1].end;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("원본 길이가 올바르지 않습니다.");

    const candidates = [];
    detectRetakes(segments, candidates);
    detectSilences(segments, candidates, rules);
    detectFillerRuns(segments, candidates);
    detectDuplicates(segments, candidates, rules);
    const merged = mergeCandidates(candidates, duration);
    const selectedIds = selectSafeCandidates({ duration, candidates: merged, rules });
    const approved = approveCandidates({ duration, candidates: merged, rules }, selectedIds);
    return Object.freeze({
      version: 1,
      preset: presetName,
      duration,
      rules: Object.freeze(rules),
      candidates: Object.freeze(merged),
      selectedIds: Object.freeze(selectedIds),
      keepRanges: approved.keepRanges,
      stats: approved.stats,
    });
  }

  function selectSafeCandidates(plan) {
    const eligible = (plan.candidates || []).filter((candidate) => candidate.confidence >= 0.9)
      .sort((a, b) => b.confidence - a.confidence || a.start - b.start || a.end - b.end);
    const selected = [];
    for (const candidate of eligible) {
      const trial = selected.concat(candidate.id);
      try {
        approveCandidates(plan, trial);
        selected.push(candidate.id);
      } catch (error) {
        if (!/안전 상한/.test(String(error && error.message))) throw error;
      }
    }
    const order = new Map((plan.candidates || []).map((candidate, index) => [candidate.id, index]));
    return selected.sort((a, b) => order.get(a) - order.get(b));
  }

  function approveCandidates(plan, selectedIds) {
    const selected = new Set(selectedIds || []);
    const duration = Number(plan.duration);
    const rules = plan.rules || PRESETS.balanced;
    const deletions = (plan.candidates || []).filter((candidate) => selected.has(candidate.id)).map((candidate) => ({ start: candidate.start, end: candidate.end }));
    const merged = mergeRanges(deletions, duration);
    const deletedSeconds = merged.reduce((total, range) => total + range.end - range.start, 0);
    if (deletedSeconds / duration > rules.maxDeleteRatio + 1e-9) {
      throw new Error(`선택한 삭제량이 안전 상한 ${(rules.maxDeleteRatio * 100).toFixed(0)}%를 넘습니다.`);
    }
    const keepRanges = invertRanges(merged, duration).filter((range) => range.end - range.start >= rules.minKeepSeconds);
    if (!keepRanges.length) throw new Error("편집 후 남는 영상이 없습니다.");
    return Object.freeze({
      keepRanges: Object.freeze(keepRanges.map(Object.freeze)),
      stats: Object.freeze({ duration, deletedSeconds: round3(deletedSeconds), keptSeconds: round3(keepRanges.reduce((sum, range) => sum + range.end - range.start, 0)), selectedCount: deletions.length }),
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
      const deleteEarlier = normalizeForCompare(later.text).length >= normalizeForCompare(earlier.text).length;
      const target = deleteEarlier ? earlier : later;
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
    })).filter((item) => item.end - item.start >= 0.05).sort((a, b) => a.start - b.start || a.end - b.end);
    const result = [];
    for (const item of normalized) {
      const last = result[result.length - 1];
      if (last && item.start <= last.end + 0.02) {
        last.end = Math.max(last.end, item.end);
        last.confidence = Math.max(last.confidence, item.confidence);
        last.type = last.type === item.type ? last.type : "combined";
        if (!last.reason.includes(item.reason)) last.reason += ` · ${item.reason}`;
      } else result.push(Object.assign({}, item));
    }
    return result.map((item, index) => Object.freeze(Object.assign({ id: `cut-${String(index + 1).padStart(4, "0")}` }, item)));
  }

  function mergeRanges(ranges, duration) {
    const sorted = ranges.map((range) => ({ start: clamp(range.start, 0, duration), end: clamp(range.end, 0, duration) })).filter((range) => range.end > range.start).sort((a, b) => a.start - b.start || a.end - b.end);
    const result = [];
    for (const range of sorted) {
      const last = result[result.length - 1];
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
      else result.push({ start: range.start, end: range.end });
    }
    return result.map((range) => ({ start: round3(range.start), end: round3(range.end) }));
  }

  function invertRanges(deletions, duration) {
    const keep = [];
    let cursor = 0;
    for (const deletion of deletions) {
      if (deletion.start > cursor) keep.push({ start: round3(cursor), end: round3(deletion.start) });
      cursor = Math.max(cursor, deletion.end);
    }
    if (cursor < duration) keep.push({ start: round3(cursor), end: round3(duration) });
    return keep;
  }

  function candidate(type, start, end, confidence, reason) {
    return { type, start, end, confidence, reason };
  }

  function isFillerOnly(text) {
    const tokens = tokenize(text);
    return tokens.length > 0 && tokens.length <= 4 && tokens.every((token) => FILLERS.has(token));
  }

  function textSimilarity(left, right) {
    const a = new Set(tokenize(left));
    const b = new Set(tokenize(right));
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    for (const token of a) if (b.has(token)) intersection += 1;
    return intersection / Math.max(a.size, b.size);
  }

  function tokenize(text) {
    return normalizeForCompare(text).split(/\s+/).filter(Boolean);
  }

  function normalizeForCompare(text) {
    return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }
  function round3(value) { return Math.round(Number(value) * 1000) / 1000; }

  return { PRESETS, createEditPlan, approveCandidates, mergeRanges, invertRanges, textSimilarity, selectSafeCandidates };
});
