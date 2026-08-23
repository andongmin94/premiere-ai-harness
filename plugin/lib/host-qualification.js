(function (root, factory) {
  if (typeof module === "object" && module.exports && typeof window === "undefined") {
    module.exports = factory(require("./qualification-record.js"), require("./sequence-snapshot.js"));
  } else {
    root.PAI = Object.assign(root.PAI || {}, factory(root.PAI, root.PAI));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (records, snapshots) {
  "use strict";

  function createQualificationSessionId() {
    const random = Math.random().toString(36).slice(2, 10).padEnd(8, "0").slice(0, 8);
    return `session-${Date.now().toString(36)}-${random}`;
  }

  function beginQualification(storage, environment, selection, sessionId, completedAt) {
    return records.writeQualificationRecord(
      storage,
      records.createQualificationRecord(environment, selection, sessionId, completedAt)
    );
  }

  function readQualification(storage, environment) {
    return records.readQualificationRecord(storage, environment);
  }

  function clearQualification(storage) {
    records.clearQualificationRecord(storage);
  }

  function recordHostSelfTest(storage, environment, selection, result, completedAt) {
    const checks = result?.checks || {};
    if (result?.status !== "PASS" || result?.cleaned !== true
      || !["subclip", "sequence", "activation", "cleanup"].every((name) => checks[name] === true)) {
      throw new Error("정리까지 완료된 호스트 자체시험 PASS 결과가 필요합니다.");
    }
    return records.updateQualificationStep(storage, environment, selection, "hostSelfTest", {
      status: "PASS",
      completedAt,
      operationId: result.operationId,
    }, completedAt);
  }

  function recordRollbackSelfTest(storage, environment, selection, result, completedAt) {
    if (result?.status !== "PASS" || result?.cleaned !== true
      || result?.checks?.failureObserved !== true || result?.checks?.cleanup !== true) {
      throw new Error("의도된 실패와 정리를 모두 확인한 롤백 자체시험 PASS 결과가 필요합니다.");
    }
    return records.updateQualificationStep(storage, environment, selection, "rollbackSelfTest", {
      status: "PASS",
      completedAt,
      operationId: result.operationId,
    }, completedAt);
  }

  function recordPremiereTranscript(storage, environment, selection, details, completedAt) {
    const count = Number(details?.segmentCount);
    if (details?.source !== "premiere" || !Number.isInteger(count) || count <= 0) {
      throw new Error("실제 Premiere 전사문 분석 결과가 필요합니다.");
    }
    return records.updateQualificationStep(storage, environment, selection, "premiereTranscript", {
      status: "PASS",
      completedAt,
      segmentCount: count,
    }, completedAt);
  }

  function recordRoughCut(storage, environment, selection, result, sessionId, completedAt) {
    const segmentCount = Number(result?.segmentCount);
    snapshots.validateSequenceSegmentCount(result?.sequenceSnapshot, segmentCount);
    return records.updateQualificationStep(storage, environment, selection, "roughCut", {
      status: "PASS",
      completedAt,
      projectId: result?.projectId || selection?.projectId,
      sequenceId: result?.sequenceId,
      sequenceName: result?.sequenceName,
      operationId: result?.operationId,
      segmentCount,
      createdSessionId: sessionId,
      createdSnapshot: result?.sequenceSnapshot,
    }, completedAt);
  }

  function recordPlaybackConfirmation(storage, environment, selection, confirmed, completedAt) {
    if (confirmed !== true) throw new Error("A/V 싱크와 원본 불변을 직접 확인해야 합니다.");
    const current = records.requireQualificationRecord(storage, environment, selection);
    if (current.steps.roughCut.status !== "PASS") throw new Error("먼저 실제 러프컷을 생성하십시오.");
    return records.updateQualificationStep(storage, environment, selection, "playback", {
      status: "PASS",
      completedAt,
      confirmed: true,
    }, completedAt);
  }

  function recordPersistencePreparation(storage, environment, sessionId, preparation, completedAt) {
    const current = records.requireQualificationRecord(storage, environment);
    if (!canPreparePersistence(current)) throw new Error("러프컷 재생 확인을 먼저 완료하십시오.");
    if (preparation?.status !== "PASS") throw new Error("프로젝트 저장과 시퀀스 구조 기록을 완료하지 못했습니다.");
    const roughCut = current.steps.roughCut;
    requireSameRoughCut(roughCut, preparation);
    const snapshot = snapshots.normalizeSequenceSnapshot(preparation.sequenceSnapshot);
    if (!snapshots.sameSequenceSnapshot(roughCut.createdSnapshot, snapshot)) {
      throw new Error("러프컷 생성 후 시퀀스 구조가 바뀌었습니다. 검증을 다시 시작하십시오.");
    }
    return records.updateQualificationStep(storage, environment, null, "roughCut", {
      ...roughCut,
      preparedAt: completedAt,
      preparedSessionId: sessionId,
      persistenceSnapshot: snapshot,
    }, completedAt);
  }

  function recordPersistenceConfirmation(storage, environment, currentSessionId, verification, completedAt) {
    const current = records.requireQualificationRecord(storage, environment);
    if (!canConfirmPersistence(current, currentSessionId)) {
      throw new Error("프로젝트를 저장한 패널 세션을 닫고 새 패널 세션에서 확인하십시오.");
    }
    if (verification?.status !== "PASS") throw new Error("새 패널 세션에서 저장된 러프컷 구조를 확인하지 못했습니다.");
    const roughCut = current.steps.roughCut;
    requireSameRoughCut(roughCut, verification);
    if (!snapshots.sameSequenceSnapshot(roughCut.persistenceSnapshot, verification.sequenceSnapshot)) {
      throw new Error("저장 후 러프컷 시퀀스 구조가 달라졌습니다.");
    }
    return records.updateQualificationStep(storage, environment, null, "persistence", {
      status: "PASS",
      completedAt,
      verifiedSessionId: currentSessionId,
      sequenceId: roughCut.sequenceId,
      sequenceName: roughCut.sequenceName,
    }, completedAt);
  }

  function canPreparePersistence(record) {
    return Boolean(record?.steps?.roughCut?.status === "PASS"
      && record?.steps?.playback?.status === "PASS"
      && !record.steps.roughCut.persistenceSnapshot);
  }

  function canConfirmPersistence(record, currentSessionId) {
    const roughCut = record?.steps?.roughCut;
    return Boolean(roughCut?.status === "PASS"
      && roughCut.persistenceSnapshot
      && roughCut.preparedSessionId
      && currentSessionId
      && String(roughCut.preparedSessionId) !== String(currentSessionId));
  }

  function isQualificationComplete(record) {
    return Boolean(record && records.QUALIFICATION_STEPS.every((name) => record.steps?.[name]?.status === "PASS"));
  }

  function qualificationSummary(record) {
    if (!record) return "검증을 시작하지 않았습니다.";
    const passed = records.QUALIFICATION_STEPS.filter((name) => record.steps[name].status === "PASS").length;
    return record.status === "PASS"
      ? `실제 Premiere 검증 완료 · ${passed}/${records.QUALIFICATION_STEPS.length}`
      : `실제 Premiere 검증 진행 중 · ${passed}/${records.QUALIFICATION_STEPS.length}`;
  }

  function qualificationReport(record) {
    return record ? `${JSON.stringify(record, null, 2)}\n` : "";
  }

  function requireSameRoughCut(expected, actual) {
    if (String(actual?.projectId || "") !== expected.projectId) throw new Error("검증 중인 Premiere 프로젝트가 바뀌었습니다.");
    if (String(actual?.sequenceId || "") !== expected.sequenceId) throw new Error("검증 중인 러프컷 시퀀스가 바뀌었습니다.");
    if (String(actual?.sequenceName || "") !== expected.sequenceName) throw new Error("검증 중인 러프컷 시퀀스 이름이 바뀌었습니다.");
  }

  return {
    QUALIFICATION_STORAGE_KEY: records.QUALIFICATION_STORAGE_KEY,
    QUALIFICATION_STEPS: records.QUALIFICATION_STEPS,
    createQualificationSessionId,
    beginQualification,
    readQualification,
    clearQualification,
    recordHostSelfTest,
    recordRollbackSelfTest,
    recordPremiereTranscript,
    recordRoughCut,
    recordPlaybackConfirmation,
    recordPersistencePreparation,
    recordPersistenceConfirmation,
    qualificationMatchesSelection: records.qualificationMatchesSelection,
    canPreparePersistence,
    canConfirmPersistence,
    isQualificationComplete,
    qualificationSummary,
    qualificationReport,
  };
});
