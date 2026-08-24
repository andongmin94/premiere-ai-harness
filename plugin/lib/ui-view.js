(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports && typeof window === "undefined") module.exports = api;
  else root.PAI = Object.assign(root.PAI || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createView(document) {
    if (!document || typeof document.getElementById !== "function") throw new Error("패널 DOM을 사용할 수 없습니다.");
    let candidateInputs = [];

    function byId(id) {
      const element = document.getElementById(id);
      if (!element) throw new Error(`패널 요소를 찾지 못했습니다: ${id}`);
      return element;
    }

    function bind(id, eventName, handler) {
      byId(id).addEventListener(eventName, handler);
    }

    function setStatus(message, kind) {
      const node = byId("status");
      node.textContent = String(message || "");
      node.dataset.kind = kind || "info";
    }

    function setSelection(selection) {
      byId("selection-info").textContent = selection
        ? `${selection.projectName} · ${selection.clipName} · ${formatTime(selection.duration)} · 전사 ${selection.hasTranscript ? "있음" : "없음"}`
        : "아직 확인하지 않았습니다.";
    }

    function setHost(environment, certification, summary) {
      const badge = byId("host-badge");
      const status = byId("host-status");
      if (!environment) {
        badge.dataset.state = "fail";
        badge.textContent = "오류";
        status.textContent = "Premiere 호스트 정보를 읽지 못했습니다.";
        return;
      }
      const valid = Boolean(certification);
      badge.dataset.state = valid ? "pass" : "pending";
      badge.textContent = valid ? "인증됨" : "미인증";
      status.textContent = valid
        ? summary
        : `${environment.hostName} ${environment.hostVersion} · UXP ${environment.uxpVersion} · 플러그인 ${environment.pluginVersion} · ${environment.platform}/${environment.arch}`;
    }

    function setQualification(record, summary, report) {
      byId("qualification-status").textContent = String(summary || "검증을 시작하지 않았습니다.");
      byId("qualification-report").value = String(report || "");
      byId("qualification-status").dataset.state = record?.status === "PASS" ? "pass" : "pending";
    }

    function renderPlan(plan, onChange) {
      const root = byId("candidate-list");
      root.replaceChildren();
      candidateInputs = [];
      if (!plan || plan.candidates.length === 0) {
        root.textContent = plan ? "자동 삭제 후보가 없습니다." : "전사문을 분석하면 삭제 후보가 표시됩니다.";
        byId("plan-stats").textContent = plan ? "원본을 그대로 유지합니다." : "";
        return;
      }
      const selected = new Set(plan.selectedIds);
      for (const candidate of plan.candidates) {
        const label = document.createElement("label");
        label.className = "candidate";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.dataset.id = candidate.id;
        input.checked = selected.has(candidate.id);
        input.addEventListener("change", onChange);
        candidateInputs.push(input);
        const body = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = `${formatTime(candidate.start)}–${formatTime(candidate.end)}`;
        const detail = document.createElement("small");
        detail.textContent = `${candidate.reason} · 신뢰도 ${(candidate.confidence * 100).toFixed(0)}%`;
        body.append(title, detail);
        label.append(input, body);
        root.append(label);
      }
    }

    function setPlanStats(approval, error) {
      byId("plan-stats").textContent = error
        ? String(error.message || error)
        : `${approval.stats.selectedCount}개 삭제 · ${formatTime(approval.stats.deletedSeconds)} 제거 · ${formatTime(approval.stats.keptSeconds)} 유지`;
    }

    function selectedCandidateIds() {
      return candidateInputs.filter((input) => input.checked).map((input) => String(input.dataset.id || ""));
    }

    function updateControls(state) {
      const busy = Boolean(state.busy);
      byId("inspect").disabled = busy;
      byId("host-self-test").disabled = busy || !state.hasSelection || !state.hasHost;
      byId("load-premiere").disabled = busy || !state.hasSelection;
      byId("analyze-pasted").disabled = busy || !state.hasSelection;
      byId("cleanup-self-test").disabled = busy;
      byId("reset-data").disabled = busy;
      byId("preset").disabled = busy || !state.hasPlan;
      byId("apply").disabled = busy || !state.canApply;
      byId("qualification-start").disabled = busy || !state.canStartQualification;
      byId("rollback-self-test").disabled = busy || !state.canRunRollback;
      byId("qualification-confirm-playback").disabled = busy || !state.canConfirmPlayback;
      byId("qualification-confirm-persistence").disabled = busy || !state.canConfirmPersistence;
      byId("qualification-reset").disabled = busy || !state.hasQualification;
      for (const input of candidateInputs) input.disabled = busy;
    }

    function reset() {
      setSelection(null);
      byId("transcript-input").value = "";
      renderPlan(null, function () {});
    }

    return {
      byId,
      bind,
      setStatus,
      setSelection,
      setHost,
      setQualification,
      renderPlan,
      setPlanStats,
      selectedCandidateIds,
      updateControls,
      reset,
    };
  }

  function formatTime(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = (value % 60).toFixed(2).padStart(5, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
  }

  return { createView, formatTime };
});
