(function () {
  "use strict";
  const state = { ppro: null, segments: [], plan: null, duration: 0, frameRate: 0, clipName: "", clipId: "" };

  document.addEventListener("DOMContentLoaded", function () {
    bind("inspect", inspect);
    bind("load-premiere", loadPremiereTranscript);
    bind("analyze-pasted", analyzePastedTranscript);
    bind("apply", applyRoughCut);
    byId("preset").addEventListener("change", rebuildPlan);
    setStatus("프로젝트 패널에서 원본 클립 하나를 선택하십시오.", "info");
  });

  function getPpro() {
    if (!state.ppro) state.ppro = require("premierepro");
    return state.ppro;
  }

  async function inspect() {
    await withBusy(async function () {
      const info = await PAI.inspectSelection(getPpro());
      state.duration = info.duration;
      state.frameRate = info.frameRate;
      state.clipName = info.clipName;
      state.clipId = info.clipId;
      byId("selection-info").textContent = `${info.projectName} · ${info.clipName} · ${formatTime(info.duration)} · 전사 ${info.hasTranscript ? "있음" : "없음"}`;
      setStatus("선택 클립을 확인했습니다.", "success");
    });
  }

  async function loadPremiereTranscript() {
    await withBusy(async function () {
      const loaded = await PAI.loadSelectedTranscript(getPpro());
      state.duration = loaded.duration;
      state.frameRate = loaded.frameRate;
      state.clipName = loaded.context.clip.name;
      state.clipId = loaded.clipId;
      state.segments = PAI.parseTranscriptJson(JSON.parse(loaded.json));
      buildPlan();
      setStatus(`Premiere 전사문 ${state.segments.length}개 구간을 분석했습니다.`, "success");
    });
  }

  async function analyzePastedTranscript() {
    await withBusy(async function () {
      if (!state.clipId || !state.duration) throw new Error("먼저 ‘선택 클립 검사’를 실행하십시오.");
      const value = byId("transcript-input").value;
      state.segments = PAI.parseTranscript(value);
      const transcriptEnd = state.segments[state.segments.length - 1].end;
      if (transcriptEnd > state.duration + 0.25) throw new Error("전사문 길이가 선택한 원본보다 깁니다. 다른 클립의 전사문인지 확인하십시오.");
      buildPlan();
      setStatus(`붙여넣은 전사문 ${state.segments.length}개 구간을 분석했습니다.`, "success");
    });
  }

  function rebuildPlan() {
    if (!state.segments.length) return;
    try { buildPlan(); } catch (error) { setStatus(error.message, "error"); }
  }

  function buildPlan() {
    state.plan = PAI.createEditPlan(state.segments, { preset: byId("preset").value, duration: state.duration });
    renderCandidates();
    byId("apply").disabled = false;
  }

  function renderCandidates() {
    const root = byId("candidate-list");
    root.innerHTML = "";
    if (!state.plan.candidates.length) {
      root.textContent = "자동 삭제 후보가 없습니다.";
      byId("plan-stats").textContent = "원본을 그대로 유지합니다.";
      return;
    }
    const selected = new Set(state.plan.selectedIds);
    state.plan.candidates.forEach(function (candidate) {
      const label = document.createElement("label");
      label.className = "candidate";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.id = candidate.id;
      input.checked = selected.has(candidate.id);
      input.addEventListener("change", updateStats);
      const body = document.createElement("span");
      body.innerHTML = `<strong>${escapeHtml(formatTime(candidate.start))}–${escapeHtml(formatTime(candidate.end))}</strong><small>${escapeHtml(candidate.reason)} · 신뢰도 ${(candidate.confidence * 100).toFixed(0)}%</small>`;
      label.append(input, body);
      root.append(label);
    });
    updateStats();
  }

  function updateStats() {
    try {
      const approval = currentApproval();
      byId("plan-stats").textContent = `${approval.stats.selectedCount}개 삭제 · ${formatTime(approval.stats.deletedSeconds)} 제거 · ${formatTime(approval.stats.keptSeconds)} 유지`;
      byId("apply").disabled = false;
    } catch (error) {
      byId("plan-stats").textContent = error.message;
      byId("apply").disabled = true;
    }
  }

  function currentApproval() {
    const selectedIds = Array.from(document.querySelectorAll(".candidate input:checked")).map((input) => input.dataset.id);
    return PAI.approveCandidates(state.plan, selectedIds);
  }

  async function applyRoughCut() {
    await withBusy(async function () {
      if (!state.plan) throw new Error("먼저 전사문을 분석하십시오.");
      const approval = currentApproval();
      const base = (state.clipName || "AI_ROUGH_CUT").replace(/[\\/:*?"<>|]/g, "_");
      const sequenceName = `${base}_AI_ROUGH_CUT_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`;
      const result = await PAI.createRoughCut(getPpro(), approval.keepRanges, sequenceName, {
        expectedSource: { clipId: state.clipId, duration: state.duration, frameRate: state.frameRate },
      });
      setStatus(`새 시퀀스 “${result.sequenceName}”를 만들었습니다. (${result.segmentCount}구간)`, "success");
    });
  }

  async function withBusy(task) {
    setBusy(true);
    try { await task(); }
    catch (error) { setStatus(error && error.message ? error.message : String(error), "error"); }
    finally { setBusy(false); }
  }

  function setBusy(busy) {
    document.querySelectorAll("button").forEach((button) => { button.disabled = busy || (button.id === "apply" && !state.plan); });
  }

  function setStatus(message, kind) {
    const node = byId("status");
    node.textContent = message;
    node.dataset.kind = kind || "info";
  }

  function bind(id, handler) { byId(id).addEventListener("click", handler); }
  function byId(id) { return document.getElementById(id); }
  function formatTime(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = (value % 60).toFixed(2).padStart(5, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
})();
