(function (root, factory) {
  if (typeof module === "object" && module.exports && typeof window === "undefined") {
    module.exports = factory(Object.assign(
      {},
      require("./lib/host-certification.js"),
      require("./lib/sequence-snapshot.js"),
      require("./lib/qualification-record.js"),
      require("./lib/host-qualification.js"),
      require("./lib/session-state.js"),
      require("./lib/premiere-adapter.js"),
      require("./lib/qualification-flow.js"),
      require("./lib/editor-flow.js"),
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

    const qualification = PAI.createQualificationFlow({
      storage,
      view,
      sessionId: dependencies.sessionId,
      getEnvironment: function () { return hostEnvironment; },
      getSelection: function () { return session.selection; },
      getPpro,
    });
    const editor = PAI.createEditorFlow({
      session,
      view,
      qualification,
      getPpro,
      requireCertified: requireValidCertification,
      onStateChanged: refreshControls,
    });

    function initialize() {
      bindEvents();
      view.reset();
      initializeHost();
      qualification.load();
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
      view.bind("preset", "change", editor.rebuildPlan);
      view.bind("qualification-start", "click", startQualification);
      view.bind("rollback-self-test", "click", runRollbackSelfTest);
      view.bind("qualification-confirm-playback", "click", confirmQualificationPlayback);
      view.bind("qualification-prepare-persistence", "click", prepareQualificationPersistence);
      view.bind("qualification-confirm-persistence", "click", confirmQualificationPersistence);
      view.bind("qualification-reset", "click", resetQualification);
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

    function inspectSelection() { return withBusy(editor.inspectSelection); }
    function loadPremiereTranscript() { return withBusy(editor.loadPremiereTranscript); }
    function analyzePastedTranscript() { return withBusy(editor.analyzePastedTranscript); }
    function applyRoughCut() { return withBusy(editor.applyRoughCut); }

    async function runHostSelfTest() {
      return withBusy(async function () {
        if (!session.selection) throw new Error("먼저 선택 클립을 검사하십시오.");
        if (!hostEnvironment) throw new Error("Premiere 호스트 정보를 읽지 못했습니다.");
        const result = await PAI.runHostSelfTest(getPpro());
        certification = PAI.writeCertification(storage, hostEnvironment, result);
        qualification.recordHostSelfTest(result);
        renderHost();
        view.setStatus("호스트 자체시험과 자동 정리를 모두 통과했습니다.", "success");
      });
    }

    function runRollbackSelfTest() {
      return withBusy(async function () {
        await qualification.runRollbackSelfTest();
        view.setStatus("의도된 실패와 생성 자산 롤백을 모두 확인했습니다.", "success");
      });
    }

    function cleanupSelfTestArtifacts() {
      return withBusy(async function () {
        const result = await PAI.cleanupSelfTestArtifacts(getPpro());
        view.setStatus(`자체시험 흔적 정리 완료 · 빈 ${result.removedBins}개 · 시퀀스 ${result.removedSequences}개`, "success");
      });
    }

    function startQualification() {
      return withBusy(async function () {
        qualification.start();
        view.setStatus("현재 프로젝트와 원본으로 실제 Premiere 검증을 시작했습니다.", "success");
      });
    }

    function confirmQualificationPlayback() {
      return withBusy(async function () {
        qualification.confirmPlayback();
        view.setStatus("A/V 싱크와 원본 불변 확인을 기록했습니다. 프로젝트 저장·구조 기록을 실행하십시오.", "success");
      });
    }

    function prepareQualificationPersistence() {
      return withBusy(async function () {
        await qualification.preparePersistence();
        view.setStatus("프로젝트를 저장하고 러프컷 구조를 기록했습니다. 패널을 닫고 새 패널 세션에서 확인하십시오.", "success");
      });
    }

    function confirmQualificationPersistence() {
      return withBusy(async function () {
        await qualification.confirmPersistence();
        view.setStatus("새 패널 세션에서 저장된 러프컷 구조가 동일함을 확인했습니다.", "success");
      });
    }

    function resetQualification() {
      qualification.clear();
      view.setStatus("실제 Premiere 검증 기록을 초기화했습니다.", "success");
      refreshControls();
    }

    function resetPluginData() {
      try {
        PAI.clearCertification(storage);
        certification = null;
        qualification.clear();
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
        return await task();
      } catch (error) {
        view.setStatus(messageOf(error), "error");
        return undefined;
      } finally {
        PAI.setBusy(session, false);
        refreshControls();
      }
    }

    function refreshControls() {
      const certified = Boolean(hostEnvironment && PAI.isCertificationValid(certification, hostEnvironment));
      view.updateControls(Object.assign({
        busy: session.busy,
        hasHost: Boolean(hostEnvironment),
      }, editor.controlState(certified), qualification.controlState()));
    }

    function getPpro() {
      if (!ppro) ppro = requireFn("premierepro");
      return ppro;
    }

    return {
      initialize,
      inspectSelection,
      runHostSelfTest,
      runRollbackSelfTest,
      cleanupSelfTestArtifacts,
      loadPremiereTranscript,
      analyzePastedTranscript,
      applyRoughCut,
      startQualification,
      confirmQualificationPlayback,
      prepareQualificationPersistence,
      confirmQualificationPersistence,
      resetQualification,
      resetPluginData,
      getSession: function () { return session; },
      getQualification: qualification.getRecord,
      getQualificationSessionId: qualification.getSessionId,
    };
  }

  function messageOf(error) { return String(error?.message || error); }

  return { PANEL_ID, start, createController };
});
