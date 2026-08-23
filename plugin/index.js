(function () {
  "use strict";

  const state = {
    ppro: null,
    segments: [],
    plan: null,
    duration: 0,
    frameRate: 0,
    clipName: "",
    clipId: "",
    premiereTranscriptJson: null,
    hostInfo: null,
    certification: null,
    busy: false,
  };

  document.addEventListener("DOMContentLoaded", function () {
    bind("run-self-test", runSelfTest);
    bind("cleanup-self-test", cleanupSelfTestArtifacts);
    bind("inspect", inspect);
    bind("load-premiere", loadPremiereTranscript);
    bind("analyze-pasted", analyzePastedTranscript);
    bind("apply", applyRoughCut);
    bind("reset-plugin-data", resetPluginData);
    byId("preset").addEventListener("change", rebuildPlan);
    initializeHost();
    setStatus("프로젝트 패널에서 원본 클립 하나를 선택하십시오.", "info");
  });

  function getPpro() {
    if (!state.ppro) state.ppro = require("premierepro");
    return state.ppro;
  }

  function initializeHost() {
    try {
      const uxp = require("uxp");
      const os = require("os");
      state.hostInfo = PAI.normalizeHostInfo({
        hostName: uxp.host && uxp.host.name,
        hostVersion: uxp.host && uxp.host.version,
        uxpVersion: uxp.versions && uxp.versions.uxp,
        pluginVersion: uxp.versions && uxp.versions.plugin,
        platform: os.platform(),
        arch: os.arch(),
      });
      state.certification = PAI.parseCertification(window.localStorage.getItem(PAI.HOST_CERTIFICATION_STORAGE_KEY));
      byId("host-info").textContent = `${state.hostInfo.hostName} ${state.hostInfo.hostVersion} · UXP ${state.hostInfo.uxpVersion} · 플러그인 ${state.hostInfo.pluginVersion} · ${state.hostInfo.platform}/${state.hostInfo.arch}`;
      updateCertificationUi();
    } catch (error) {
      state.hostInfo = null;
      state.certification = null;
      byId("host-info").textContent = `호스트 정보를 읽지 못했습니다: ${messageOf(error)}`;
      setCertificationBadge("fail", "오류");
      byId("certification-info").textContent = "이 환경에서는 실제 편집을 적용할 수 없습니다.";
      updateApplyAvailability();
    }
  }

  async function runSelfTest() {
    await withBusy(async function () {
      if (!state.hostInfo) throw new Error("Premiere 호스트 정보를 읽지 못했습니다.");
      const result = await PAI.runHostSelfTest(getPpro());
      const certification = PAI.createCertification(state.hostInfo, result);
      window.localStorage.setItem(PAI.HOST_CERTIFICATION_STORAGE_KEY, PAI.serializeCertification(certification));
      state.certification = certification;
      updateCertificationUi();
      setStatus("호스트 자체시험과 자동 정리를 모두 통과했습니다.", "success");
    });
  }

  async function cleanupSelfTestArtifacts() {
    if (!confirm("이 플러그인의 내부 자체시험 이름을 가진 임시 빈과 시퀀스만 정리합니다. 계속하시겠습니까?")) return;
    await withBusy(async function () {
      const result = await PAI.cleanupSelfTestArtifacts(getPpro());
      setStatus(`자체시험 흔적 정리 완료 · 빈 ${result.removedBins}개 · 시퀀스 ${result.removedSequences}개`, "success");
    });
  }

  async function inspect() {
    await withBusy(async function () {
      const info = await PAI.inspectSelection(getPpro());
      state.duration = info.duration;
      state.frameRate = info.frameRate;
      state.clipName = info.clipName;
      state.clipId = info.clipId;
      state.segments = [];
      state.plan = null;
      state.premiereTranscriptJson = null;
      clearPlanUi();
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
      state.premiereTranscriptJson = loaded.json;
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
      state.premiereTranscriptJson = null;
      const transcriptEnd = state.segments[state.segments.length - 1].end;
      if (transcriptEnd > state.duration + 0.25) throw new Error("전사문 길이가 선택한 원본보다 깁니다. 다른 클립의 전사문인지 확인하십시오.");
      buildPlan();
      setStatus(`붙여넣은 전사문 ${state.segments.length}개 구간을 분석했습니다.`, "success");
    });
  }

  function rebuildPlan() {
    if (!state.segments.length) return;
    try { buildPlan(); }
    catch (error) { setStatus(messageOf(error), "error"); }
  }

  function buildPlan() {
    state.plan = PAI.createEditPlan(state.segments, { preset: byId("preset").value, duration: state.duration });
    renderCandidates();
    updateApplyAvailability();
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
    } catch (error) {
      byId("plan-stats").textContent = messageOf(error);
    }
    updateApplyAvailability();
  }

  function currentApproval() {
    const selectedIds = Array.from(document.querySelectorAll(".candidate input:checked")).map((input) => input.dataset.id);
    return PAI.approveCandidates(state.plan, selectedIds);
  }

  async function applyRoughCut() {
    await withBusy(async function () {
      if (!state.plan) throw new Error("먼저 전사문을 분석하십시오.");
      requireValidCertification();
      const approval = currentApproval();
      const base = (state.clipName || "AI_ROUGH_CUT").replace(/[\\/:*?"<>|]/g, "_");
      const sequenceName = `${base}_AI_ROUGH_CUT_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`;
      const result = await PAI.createRoughCut(getPpro(), approval.keepRanges, sequenceName, {
        expectedSource: { clipId: state.clipId, duration: state.duration, frameRate: state.frameRate },
        expectedTranscriptJson: state.premiereTranscriptJson,
      });
      setStatus(`새 시퀀스 “${result.sequenceName}”를 만들었습니다. (${result.segmentCount}구간)`, "success");
    });
  }

  function resetPluginData() {
    if (!confirm("호스트 인증과 이 플러그인의 모든 로컬 설정을 삭제합니다. 프로젝트 안의 러프컷 시퀀스는 유지됩니다. 계속하시겠습니까?")) return;
    try {
      window.localStorage.clear();
      state.certification = null;
      resetSessionState();
      updateCertificationUi();
      setStatus("플러그인 로컬 데이터와 호스트 인증을 초기화했습니다.", "success");
    } catch (error) {
      setStatus(`플러그인 데이터 초기화 실패: ${messageOf(error)}`, "error");
    }
  }

  function resetSessionState() {
    state.segments = [];
    state.plan = null;
    state.duration = 0;
    state.frameRate = 0;
    state.clipName = "";
    state.clipId = "";
    state.premiereTranscriptJson = null;
    byId("selection-info").textContent = "아직 확인하지 않았습니다.";
    byId("transcript-input").value = "";
    clearPlanUi();
  }

  function clearPlanUi() {
    byId("candidate-list").textContent = "전사문을 분석하면 삭제 후보가 표시됩니다.";
    byId("plan-stats").textContent = "";
    updateApplyAvailability();
  }

  function updateCertificationUi() {
    const valid = Boolean(state.hostInfo && PAI.isCertificationValid(state.certification, state.hostInfo));
    if (valid) {
      setCertificationBadge("pass", "인증됨");
      byId("certification-info").textContent = PAI.certificationSummary(state.certification);
    } else {
      setCertificationBadge("pending", "미인증");
      byId("certification-info").textContent = state.certification
        ? "Premiere, UXP 또는 플러그인 버전이 바뀌었습니다. 자체시험을 다시 실행하십시오."
        : "이 Premiere 환경은 아직 인증되지 않았습니다.";
    }
    updateApplyAvailability();
  }

  function setCertificationBadge(stateName, text) {
    const badge = byId("certification-badge");
    badge.dataset.state = stateName;
    badge.textContent = text;
  }

  function requireValidCertification() {
    if (!state.hostInfo || !PAI.isCertificationValid(state.certification, state.hostInfo)) {
      throw new Error("현재 Premiere 환경의 호스트 자체시험을 먼저 통과하십시오.");
    }
  }

  function updateApplyAvailability() {
    const certified = Boolean(state.hostInfo && PAI.isCertificationValid(state.certification, state.hostInfo));
    byId("apply").disabled = state.busy || !state.plan || !certified;
  }

  async function withBusy(task) {
    setBusy(true);
    try { await task(); }
    catch (error) { setStatus(messageOf(error), "error"); }
    finally { setBusy(false); }
  }

  function setBusy(busy) {
    state.busy = busy;
    document.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
    updateApplyAvailability();
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
  function messageOf(error) { return String(error && error.message ? error.message : error); }
})();
