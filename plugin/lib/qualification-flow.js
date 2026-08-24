(function (root, factory) {
  if (typeof module === "object" && module.exports && typeof window === "undefined") {
    module.exports = factory(Object.assign(
      {},
      require("./host-qualification.js"),
      require("./premiere-adapter.js")
    ));
  } else {
    root.PAI = Object.assign(root.PAI || {}, factory(root.PAI));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (PAI) {
  "use strict";

  function createQualificationFlow(dependencies) {
    const storage = dependencies.storage;
    const view = dependencies.view;
    const getEnvironment = dependencies.getEnvironment;
    const getSelection = dependencies.getSelection;
    const getPpro = dependencies.getPpro;
    const sessionId = dependencies.sessionId || PAI.createQualificationSessionId();
    let record = null;

    function load() {
      const environment = getEnvironment();
      record = environment ? PAI.readQualification(storage, environment) : null;
      render();
      return record;
    }

    function start() {
      const environment = requireEnvironment();
      const selection = requireSelection();
      record = PAI.beginQualification(storage, environment, selection, sessionId);
      render();
      return record;
    }

    function recordHostSelfTest(result) {
      if (!record || !matchesCurrentSelection()) return null;
      record = PAI.recordHostSelfTest(storage, requireEnvironment(), requireSelection(), result);
      render();
      return record;
    }

    async function runRollbackSelfTest() {
      requireActiveQualification();
      const result = await PAI.runRollbackSelfTest(getPpro());
      record = PAI.recordRollbackSelfTest(storage, requireEnvironment(), requireSelection(), result);
      render();
      return result;
    }

    function recordPremiereTranscript(selection, segmentCount) {
      if (!record || !PAI.qualificationMatchesSelection(record, selection)) return null;
      record = PAI.recordPremiereTranscript(storage, requireEnvironment(), selection, {
        source: "premiere",
        segmentCount,
      });
      render();
      return record;
    }

    function recordRoughCut(result) {
      if (!record || !matchesCurrentSelection()) return null;
      record = PAI.recordRoughCut(storage, requireEnvironment(), requireSelection(), result, sessionId);
      render();
      return record;
    }

    function confirmPlayback() {
      requireActiveQualification();
      record = PAI.recordPlaybackConfirmation(storage, requireEnvironment(), requireSelection(), true);
      render();
      return record;
    }

    async function confirmPersistence() {
      if (!record) throw new Error("실제 Premiere 검증을 먼저 시작하십시오.");
      const verification = await PAI.verifyPersistedRoughCut(getPpro(), record.steps.roughCut);
      record = PAI.recordPersistenceConfirmation(storage, requireEnvironment(), sessionId, verification);
      render();
      return record;
    }

    function clear() {
      PAI.clearQualification(storage);
      record = null;
      render();
    }

    function render() {
      view.setQualification(record, PAI.qualificationSummary(record), PAI.qualificationReport(record));
    }

    function controlState() {
      const environment = getEnvironment();
      const selection = getSelection();
      const matching = Boolean(record && selection && PAI.qualificationMatchesSelection(record, selection));
      return {
        hasQualification: Boolean(record),
        canStartQualification: Boolean(environment && selection),
        canRunRollback: matching,
        canConfirmPlayback: Boolean(matching
          && record.steps.roughCut.status === "PASS"
          && record.steps.playback.status !== "PASS"),
        canConfirmPersistence: Boolean(environment && record && PAI.canConfirmPersistence(record, sessionId)),
      };
    }

    function matchesCurrentSelection() {
      return Boolean(record && getSelection() && PAI.qualificationMatchesSelection(record, getSelection()));
    }

    function requireActiveQualification() {
      if (!record) throw new Error("실제 Premiere 검증을 먼저 시작하십시오.");
      if (!matchesCurrentSelection()) throw new Error("검증을 시작한 프로젝트 또는 원본 클립을 다시 선택하십시오.");
      return record;
    }

    function requireEnvironment() {
      const environment = getEnvironment();
      if (!environment) throw new Error("Premiere 호스트 정보를 읽지 못했습니다.");
      return environment;
    }

    function requireSelection() {
      const selection = getSelection();
      if (!selection) throw new Error("먼저 선택 클립을 검사하십시오.");
      return selection;
    }

    return {
      load,
      start,
      recordHostSelfTest,
      runRollbackSelfTest,
      recordPremiereTranscript,
      recordRoughCut,
      confirmPlayback,
      confirmPersistence,
      clear,
      render,
      controlState,
      getRecord: function () { return record; },
      getSessionId: function () { return sessionId; },
    };
  }

  return { createQualificationFlow };
});
