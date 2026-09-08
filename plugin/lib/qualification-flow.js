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
      if (record) throw new Error("기존 실제 Premiere 검증 기록을 초기화한 뒤 다시 시작하십시오.");
      record = PAI.beginQualification(storage, requireEnvironment(), requireSelection(), sessionId);
      render();
      return record;
    }

    function recordHostSelfTest(result) {
      if (!matchesCurrentSelection()) return null;
      record = PAI.recordHostSelfTest(storage, requireEnvironment(), requireSelection(), result);
      render();
      return record;
    }

    async function runRollbackSelfTest() {
      const current = requireActiveQualification();
      if (current.steps.hostSelfTest.status !== "PASS") throw new Error("현재 원본의 호스트 자체시험을 먼저 통과하십시오.");
      const selection = requireSelection();
      const result = await PAI.runRollbackSelfTest(getPpro(), { expectedSource: selection });
      record = PAI.recordRollbackSelfTest(storage, requireEnvironment(), selection, result);
      render();
      return result;
    }

    function recordPremiereTranscript(selection, segments) {
      if (!record || !PAI.qualificationMatchesSelection(record, selection)) return null;
      const fingerprint = PAI.transcriptFingerprint(segments);
      record = PAI.recordPremiereTranscript(storage, requireEnvironment(), selection, {
        source: "premiere",
        segmentCount: segments.length,
        fingerprint,
      });
      render();
      return record;
    }

    function assertRoughCutTranscript(transcript, segments) {
      if (!matchesCurrentSelection()) return null;
      const current = requireActiveQualification();
      if (current.steps.roughCut.status === "PASS") {
        throw new Error("qualification 러프컷은 이미 기록되었습니다. 다른 러프컷을 만들려면 검증 기록을 초기화하십시오.");
      }
      if (current.steps.premiereTranscript.status !== "PASS") {
        throw new Error("실제 Premiere 전사문을 먼저 불러와 검증하십시오.");
      }
      if (transcript?.source !== "premiere") {
        throw new Error("실제 Premiere 전사문으로 만든 편집안만 qualification 러프컷으로 사용할 수 있습니다.");
      }
      const fingerprint = PAI.transcriptFingerprint(segments);
      if (fingerprint !== current.steps.premiereTranscript.fingerprint) {
        throw new Error("검증한 Premiere 전사문과 현재 편집안의 전사문이 다릅니다. 다시 불러오십시오.");
      }
      return fingerprint;
    }

    function recordRoughCut(result, transcript, segments) {
      if (!matchesCurrentSelection()) return null;
      const fingerprint = assertRoughCutTranscript(transcript, segments);
      record = PAI.recordRoughCut(
        storage,
        requireEnvironment(),
        requireSelection(),
        result,
        sessionId,
        fingerprint
      );
      render();
      return record;
    }

    function confirmPlayback() {
      requireActiveQualification();
      record = PAI.recordPlaybackConfirmation(storage, requireEnvironment(), requireSelection(), true);
      render();
      return record;
    }

    async function preparePersistence() {
      if (!record || !PAI.canPreparePersistence(record)) throw new Error("프로젝트 저장 전 검증 단계를 모두 완료하십시오.");
      const preparation = await PAI.preparePersistedRoughCut(getPpro(), record.steps.roughCut);
      record = PAI.recordPersistencePreparation(storage, requireEnvironment(), sessionId, preparation);
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
        canStartQualification: Boolean(environment && selection && !record),
        canRunRollback: Boolean(matching && record.steps.hostSelfTest.status === "PASS"),
        canConfirmPlayback: Boolean(matching
          && record.steps.roughCut.status === "PASS"
          && record.steps.playback.status !== "PASS"),
        canPreparePersistence: Boolean(environment && record && PAI.canPreparePersistence(record)),
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
      assertRoughCutTranscript,
      recordRoughCut,
      confirmPlayback,
      preparePersistence,
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
