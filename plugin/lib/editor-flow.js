(function (root, factory) {
  if (typeof module === "object" && module.exports && typeof window === "undefined") {
    module.exports = factory(Object.assign(
      {},
      require("./transcript.js"),
      require("./planner.js"),
      require("./session-state.js"),
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
    const requireCertified = dependencies.requireCertified;
    const onStateChanged = typeof dependencies.onStateChanged === "function"
      ? dependencies.onStateChanged
      : function () {};

    async function inspectSelection() {
      const selection = await PAI.inspectSelection(getPpro());
      PAI.resetAnalysis(session);
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
      const segments = PAI.parseTranscriptJson(JSON.parse(loaded.json));
      commitTranscript(loaded, { source: "premiere", raw: loaded.json, segments });
      qualification.recordPremiereTranscript(loaded, segments.length);
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

    function rebuildPlan() {
      if (!session.transcript || session.segments.length === 0) return null;
      try {
        const plan = createPlan(session.selection, session.segments);
        PAI.setPlan(session, plan);
        renderPlan();
        return plan;
      } catch (error) {
        PAI.clearPlan(session);
        view.renderPlan(null, handleCandidateChange);
        view.setStatus(messageOf(error), "error");
        onStateChanged();
        return null;
      }
    }

    async function applyRoughCut() {
      requireCertified();
      const approval = currentApproval();
      const selection = requireSelection();
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
      qualification.recordRoughCut(result);
      view.setStatus(`새 시퀀스 “${result.sequenceName}”를 만들었습니다. (${result.segmentCount}구간)`, "success");
      onStateChanged();
      return result;
    }

    function controlState(certified) {
      let approvalValid = false;
      if (session.plan) {
        try {
          currentApproval();
          approvalValid = true;
        } catch (_) {
          approvalValid = false;
        }
      }
      return {
        hasSelection: Boolean(session.selection),
        hasPlan: Boolean(session.plan),
        canApply: PAI.canApply(session, certified === true) && approvalValid,
      };
    }

    function commitTranscript(selection, transcript) {
      const plan = createPlan(selection, transcript.segments);
      PAI.setSelection(session, selection);
      PAI.setTranscript(session, transcript);
      PAI.setPlan(session, plan);
      view.setSelection(session.selection);
      renderPlan();
    }

    function createPlan(selection, segments) {
      return PAI.createEditPlan(segments, {
        preset: view.byId("preset").value,
        duration: selection.duration,
      });
    }

    function renderPlan() {
      view.renderPlan(session.plan, handleCandidateChange);
      handleCandidateChange();
    }

    function handleCandidateChange() {
      if (!session.plan) {
        onStateChanged();
        return;
      }
      try {
        view.setPlanStats(currentApproval(), null);
      } catch (error) {
        view.setPlanStats(null, error);
      }
      onStateChanged();
    }

    function currentApproval() {
      if (!session.plan) throw new Error("먼저 전사문을 분석하십시오.");
      return PAI.approveCandidates(session.plan, view.selectedCandidateIds());
    }

    function requireSelection() {
      if (!session.selection) throw new Error("먼저 선택 클립을 검사하십시오.");
      return session.selection;
    }

    return {
      inspectSelection,
      loadPremiereTranscript,
      analyzePastedTranscript,
      rebuildPlan,
      applyRoughCut,
      controlState,
      currentApproval,
      renderPlan,
    };
  }

  function messageOf(error) { return String(error?.message || error); }

  return { createEditorFlow };
});
