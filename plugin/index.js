(function (root, factory) {
  if (typeof module === "object" && module.exports && typeof window === "undefined") {
    module.exports = factory(Object.assign(
      {},
      require("./lib/transcript.js"),
      require("./lib/planner.js"),
      require("./lib/host-certification.js"),
      require("./lib/session-state.js"),
      require("./lib/premiere-adapter.js"),
      require("./lib/ui-view.js")
    ));
  } else {
    const api = factory(root.PAI);
    root.PAIController = api;
    api.start(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (PAI) {
  "use strict";

  const PANEL_ID = "premiere-ai-harness-panel";

  function start(root) {
    const requireFn = root.require || (typeof require === "function" ? require : null);
    if (!requireFn) throw new Error("UXP 모듈 로더를 사용할 수 없습니다.");
    const uxp = requireFn("uxp");
    if (!uxp?.entrypoints?.setup) throw new Error("UXP entrypoints API를 사용할 수 없습니다.");
    uxp.entrypoints.setup({ panels: { [PANEL_ID]: { show() {}, hide() {} } } });
    root.document.addEventListener("DOMContentLoaded", function () {
      createController({ document: root.document, storage: root.localStorage, requireFn }).initialize();
    });
  }

  function createController(dependencies) {
    const view = PAI.createView(dependencies.document);
    const storage = dependencies.storage;
    const requireFn = dependencies.requireFn;
    const session = PAI.createSession();
    let ppro = null;
    let hostEnvironment = null;
    let certification = null;

    function initialize() {
      bindEvents();
      initializeHost();
      view.reset();
      view.setStatus("프로젝트 패널에서 원본 클립 하나를 선택하십시오.", "info");
      refreshControls();
    }

    function bindEvents() {
      view.bind("inspect", "click", inspectSelection);
      view.bind("host-self-test", "click", runHostSelfTest);
      view.bind("cleanup-self-test", "click", cleanupSelfTestArtifacts);
      view.bind("load-premiere", "click", loadPremiereTranscript);
      view.bind("analyze-pasted", "click", analyzePastedTranscript);
      view.bind("apply", "click", applyRoughCut);
      view.bind("reset-data", "click", resetPluginData);
      view.bind("preset", "change", rebuildPlan);
    }

    function initializeHost() {
      try {
        const uxp = requireFn("uxp");
        const os = requireFn("os");
        hostEnvironment = PAI.normalizeHostEnvironment({
          hostName: uxp.host?.name,
          hostVersion: uxp.host?.version,
          uxpVersion: uxp.versions?.uxp,
          pluginVersion: uxp.versions?.plugin,
          platform: typeof os.platform === "function" ? os.platform() : "unknown",
          arch: typeof os.arch === "function" ? os.arch() : "unknown",
        });
        certification = PAI.readCertification(storage, hostEnvironment);
        renderHost();
      } catch (error) {
        hostEnvironment = null;
        certification = null;
        view.setHost(null, null, "");
        view.setStatus(`호스트 정보 초기화 실패: ${messageOf(error)}`, "error");
      }
    }

    async function inspectSelection() {
      await withBusy(async function () {
        const selection = await PAI.inspectSelection(getPpro());
        PAI.resetAnalysis(session);
        PAI.setSelection(session, selection);
        view.byId("transcript-input").value = "";
        view.setSelection(session.selection);
        view.renderPlan(null, handleCandidateChange);
        view.setStatus("선택 클립을 확인했습니다. 기존 분석 상태를 초기화했습니다.", "success");
      });
    }

    async function runHostSelfTest() {
      await withBusy(async function () {
        if (!session.selection) throw new Error("먼저 선택 클립을 검사하십시오.");
        if (!hostEnvironment) throw new Error("Premiere 호스트 정보를 읽지 못했습니다.");
        const result = await PAI.runHostSelfTest(getPpro());
        certification = PAI.writeCertification(storage, hostEnvironment, result);
        renderHost();
        view.setStatus("호스트 자체시험과 자동 정리를 모두 통과했습니다.", "success");
      });
    }

    async function cleanupSelfTestArtifacts() {
      await withBusy(async function () {
        const result = await PAI.cleanupSelfTestArtifacts(getPpro());
        view.setStatus(`자체시험 흔적 정리 완료 · 빈 ${result.removedBins}개 · 시퀀스 ${result.removedSequences}개`, "success");
      });
    }

    async function loadPremiereTranscript() {
      await withBusy(async function () {
        const loaded = await PAI.loadSelectedTranscript(getPpro());
        const segments = PAI.parseTranscriptJson(JSON.parse(loaded.json));
        commitTranscript(loaded, { source: "premiere", raw: loaded.json, segments });
        view.setStatus(`Premiere 전사문 ${segments.length}개 구간을 분석했습니다.`, "success");
      });
    }

    async function analyzePastedTranscript() {
      await withBusy(async function () {
        if (!session.selection) throw new Error("먼저 선택 클립을 검사하십시오.");
        const segments = PAI.parseTranscript(view.byId("transcript-input").value);
        const transcriptEnd = segments[segments.length - 1].end;
        if (transcriptEnd > session.selection.duration + 0.25) {
          throw new Error("전사문 길이가 선택한 원본보다 깁니다. 다른 클립의 전사문인지 확인하십시오.");
        }
        commitTranscript(session.selection, { source: "pasted", raw: null, segments });
        view.setStatus(`붙여넣은 전사문 ${segments.length}개 구간을 분석했습니다.`, "success");
      });
    }

    function commitTranscript(selection, transcript) {
      const plan = PAI.createEditPlan(transcript.segments, {
        preset: view.byId("preset").value,
        duration: selection.duration,
      });
      PAI.setSelection(session, selection);
      PAI.setTranscript(session, transcript);
      PAI.setPlan(session, plan);
      view.setSelection(session.selection);
      renderPlan();
    }

    function rebuildPlan() {
      if (!session.transcript || session.segments.length === 0) return;
      try {
        const plan = PAI.createEditPlan(session.segments, {
          preset: view.byId("preset").value,
          duration: session.selection.duration,
        });
        PAI.setPlan(session, plan);
        renderPlan();
      } catch (error) {
        session.plan = null;
        view.renderPlan(null, handleCandidateChange);
        view.setStatus(messageOf(error), "error");
        refreshControls();
      }
    }

    function renderPlan() {
      view.renderPlan(session.plan, handleCandidateChange);
      handleCandidateChange();
    }

    function handleCandidateChange() {
      if (!session.plan) {
        refreshControls();
        return;
      }
      try {
        view.setPlanStats(currentApproval(), null);
      } catch (error) {
        view.setPlanStats(null, error);
      }
      refreshControls();
    }

    function currentApproval() {
      if (!session.plan) throw new Error("먼저 전사문을 분석하십시오.");
      return PAI.approveCandidates(session.plan, view.selectedCandidateIds());
    }

    async function applyRoughCut() {
      await withBusy(async function () {
        requireValidCertification();
        const approval = currentApproval();
        const selection = session.selection;
        const base = String(selection.clipName || "AI_ROUGH_CUT").replace(/[\\/:*?"<>|]/g, "_");
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
        const result = await PAI.createRoughCut(getPpro(), approval.keepRanges, `${base}_AI_ROUGH_CUT_${timestamp}`, {
          expectedSource: selection,
          expectedTranscriptJson: session.transcript?.source === "premiere" ? session.transcript.raw : null,
        });
        view.setStatus(`새 시퀀스 “${result.sequenceName}”를 만들었습니다. (${result.segmentCount}구간)`, "success");
      });
    }

    function resetPluginData() {
      try {
        PAI.clearCertification(storage);
        certification = null;
        PAI.resetSession(session);
        view.reset();
        renderHost();
        view.setStatus("플러그인 소유 데이터와 현재 편집 세션을 초기화했습니다.", "success");
        refreshControls();
      } catch (error) {
        view.setStatus(`플러그인 데이터 초기화 실패: ${messageOf(error)}`, "error");
      }
    }

    function renderHost() {
      const valid = Boolean(hostEnvironment && PAI.isCertificationValid(certification, hostEnvironment));
      if (!valid) certification = null;
      view.setHost(hostEnvironment, certification, PAI.certificationSummary(certification));
    }

    function requireValidCertification() {
      if (!hostEnvironment || !PAI.isCertificationValid(certification, hostEnvironment)) {
        throw new Error("현재 Premiere 환경의 호스트 자체시험을 먼저 통과하십시오.");
      }
    }

    async function withBusy(task) {
      if (session.busy) return;
      PAI.setBusy(session, true);
      refreshControls();
      try {
        await task();
      } catch (error) {
        view.setStatus(messageOf(error), "error");
      } finally {
        PAI.setBusy(session, false);
        refreshControls();
      }
    }

    function refreshControls() {
      let approvalValid = false;
      if (session.plan) {
        try {
          currentApproval();
          approvalValid = true;
        } catch (_) {
          approvalValid = false;
        }
      }
      const certified = Boolean(hostEnvironment && PAI.isCertificationValid(certification, hostEnvironment));
      view.updateControls({
        busy: session.busy,
        hasSelection: Boolean(session.selection),
        hasPlan: Boolean(session.plan),
        hasHost: Boolean(hostEnvironment),
        canApply: PAI.canApply(session, certified) && approvalValid,
      });
    }

    function getPpro() {
      if (!ppro) ppro = requireFn("premierepro");
      return ppro;
    }

    return {
      initialize,
      inspectSelection,
      runHostSelfTest,
      cleanupSelfTestArtifacts,
      loadPremiereTranscript,
      analyzePastedTranscript,
      applyRoughCut,
      resetPluginData,
      getSession: function () { return session; },
    };
  }

  function messageOf(error) { return String(error?.message || error); }

  return { PANEL_ID, start, createController };
});
