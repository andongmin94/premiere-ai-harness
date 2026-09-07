(function (root, factory) {
  if (typeof module === "object" && module.exports && typeof window === "undefined") {
    module.exports = factory(Object.assign(
      {},
      require("./session-state.js"),
      require("./transcript.js"),
      require("./planner.js"),
      require("./premiere-adapter.js")
    ));
  } else {
    root.PAI = Object.assign(root.PAI || {}, factory(root.PAI));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (PAI) {
  "use strict";

  function createEditorFlow(dependencies) {
    const session = dependencies.session;
    const view = dependencies.view;
    const qualification = dependencies.qualification;
    const getPpro = dependencies.getPpro;
    const getCertified = dependencies.getCertified;
    const onStateChanged = dependencies.onStateChanged;

    async function inspectSelection() {
      const selection = await PAI.inspectSelection(getPpro());
      PAI.setSelection(session, selection);
      view.byId("transcript-input").value = "";
      view.setSelection(session.selection);
      view.renderPlan(null, handleCandidateChange);
      qualification.render();
      view.setStatus("선택 클립을 확인했습니다. 기존 분석 상태를 초기화했습니다.", "success");
      onStateChanged();
      return selection;
    }

    async function loadPremiereTranscript() {
      requireSelection();
      const loaded = await PAI.loadSelectedTranscript(getPpro());
      if (!PAI.sameSelection(session.selection, loaded)) {
        throw new Error("선택 클립이 바뀌었습니다. 다시 검사하십시오.");
      }
      const segments = PAI.parseTranscript(loaded.json, "json");
      commitTranscript(loaded, { source: "premiere", raw: loaded.json, segments });
      qualification.recordPremiereTranscript(loaded, segments);
      view.setStatus(`Premiere 전사문 ${segments.length}개 구간을 분석했습니다.`, "success");
      return segments;
    }

    async function analyzePastedTranscript() {
      const selection = requireSelection();
      const segments = PAI.parseTranscript(view.byId("transcript-input").value);
      const transcriptEnd = segments[segments.length - 1].end;
      if (transcriptEnd > selection.duration + 0.25) {
        throw new Error("전사문 길이가 선택한 원본보다 깁니다. 다른 클립의 전사문인지 확인하십시오.");
      }
      commitTranscript(selection, { source: "pasted", raw: null, segments });
      view.setStatus(`붙여넣은 전사문 ${segments.length}개 구간을 분석했습니다.`, "success");
      return segments;
    }

    function commitTranscript(selection, value) {
      if (!PAI.sameSelection(session.selection, selection)) throw new Error("분석 중 선택 클립이 바뀌었습니다.");
      PAI.setTranscript(session, value);
      planCurrentTranscript();
      onStateChanged();
    }

    function planCurrentTranscript() {
      const selection = requireSelection();
      const preset = String(view.byId("preset").value || "balanced");
      const plan = PAI.planEdits(session.segments, selection.duration, preset);
      PAI.setPlan(session, plan);
      view.renderPlan(plan, handleCandidateChange);
      return plan;
    }

    function handleCandidateChange() {
      if (!session.plan) return;
      const selectedIds = view.checkedCandidateIds();
      PAI.setPlan(session, PAI.updateSelectedCandidates(session.plan, selectedIds));
      view.renderPlan(session.plan, handleCandidateChange);
      onStateChanged();
    }

    async function applyRoughCut() {
      requireCertified();
      const approval = currentApproval();
      const selection = requireSelection();
      qualification.assertRoughCutTranscript(session.transcript, session.segments);
      const base = String(selection.clipName || "AI_ROUGH_CUT").replace(/[\\/:*?"<>|]/g, "_");
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
      const result = await PAI.createRoughCut(
        getPpro(),
        approval.keepRanges,
        `${base}_AI_ROUGH_CUT_${timestamp}`,
        {
          expectedSource: selection,
          expectedTranscriptJson: session.transcript?.source === "premiere" ? session.transcript.raw : null,
        }
      );
      qualification.recordRoughCut(result, session.transcript, session.segments);
      view.setStatus(`새 시퀀스 “${result.sequenceName}”를 만들었습니다. (${result.segmentCount}구간)`, "success");
      onStateChanged();
      return result;
    }

    function currentApproval() {
      const selection = requireSelection();
      if (!session.plan) throw new Error("먼저 전사문을 분석하십시오.");
      return PAI.buildApproval(session.plan, selection.duration);
    }

    function requireSelection() {
      if (!session.selection) throw new Error("먼저 선택 클립을 검사하십시오.");
      return session.selection;
    }

    function requireCertified() {
      if (!getCertified()) throw new Error("현재 환경에서 호스트 자체시험을 먼저 통과하십시오.");
    }

    return {
      inspectSelection,
      loadPremiereTranscript,
      analyzePastedTranscript,
      planCurrentTranscript,
      handleCandidateChange,
      applyRoughCut,
      currentApproval,
    };
  }

  return { createEditorFlow };
});
