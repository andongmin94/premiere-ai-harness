(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports && typeof window === "undefined") module.exports = api;
  else root.PAI = Object.assign(root.PAI || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createSession() {
    return { selection: null, transcript: null, segments: [], plan: null, busy: false };
  }

  function setSelection(session, selection) {
    requireSession(session);
    const normalized = normalizeSelection(selection);
    if (!sameSelection(session.selection, normalized)) resetAnalysis(session);
    session.selection = normalized;
    return normalized;
  }

  function setTranscript(session, value) {
    requireSession(session);
    if (!session.selection) throw new Error("먼저 원본 클립을 검사하십시오.");
    if (!value || !Array.isArray(value.segments) || value.segments.length === 0) {
      throw new Error("분석할 전사 구간이 없습니다.");
    }
    const transcript = Object.freeze({
      source: value.source === "premiere" ? "premiere" : "pasted",
      raw: value.raw == null ? null : String(value.raw),
    });
    session.transcript = transcript;
    session.segments = Object.freeze(value.segments.slice());
    session.plan = null;
    return transcript;
  }

  function setPlan(session, plan) {
    requireSession(session);
    if (!session.selection || !session.transcript) throw new Error("원본과 전사문을 먼저 확인하십시오.");
    if (!plan || !Array.isArray(plan.candidates) || !Array.isArray(plan.selectedIds)) {
      throw new Error("편집안이 올바르지 않습니다.");
    }
    session.plan = plan;
    return plan;
  }

  function resetAnalysis(session) {
    requireSession(session);
    session.transcript = null;
    session.segments = [];
    session.plan = null;
    return session;
  }

  function resetSession(session) {
    requireSession(session);
    session.selection = null;
    session.busy = false;
    return resetAnalysis(session);
  }

  function setBusy(session, busy) {
    requireSession(session);
    session.busy = Boolean(busy);
    return session.busy;
  }

  function canApply(session, certified) {
    requireSession(session);
    return !session.busy && certified === true && Boolean(session.selection) && Boolean(session.plan);
  }

  function sameSelection(left, right) {
    if (!left || !right) return false;
    return left.projectId === right.projectId
      && left.clipId === right.clipId
      && Math.abs(left.duration - right.duration) <= 0.002
      && Math.abs(left.frameRate - right.frameRate) <= 0.0001;
  }

  function normalizeSelection(value) {
    if (!value) throw new Error("선택 클립 정보가 없습니다.");
    const projectId = String(value.projectId || "").trim();
    const clipId = String(value.clipId || "").trim();
    const duration = Number(value.duration);
    const frameRate = Number(value.frameRate);
    if (!projectId || !clipId || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(frameRate) || frameRate <= 0) {
      throw new Error("선택 클립 정보가 올바르지 않습니다.");
    }
    return Object.freeze({
      projectId,
      projectName: String(value.projectName || ""),
      clipName: String(value.clipName || ""),
      clipId,
      duration,
      frameRate,
      hasTranscript: Boolean(value.hasTranscript),
    });
  }

  function requireSession(session) {
    if (!session || typeof session !== "object") throw new Error("편집 세션이 올바르지 않습니다.");
  }

  return {
    createSession,
    setSelection,
    setTranscript,
    setPlan,
    resetAnalysis,
    resetSession,
    setBusy,
    canApply,
    sameSelection,
    normalizeSelection,
  };
});
