(function (root, factory) {
  if (typeof module === "object" && module.exports && typeof window === "undefined") {
    module.exports = factory(require("./host-certification.js"));
  } else {
    root.PAI = Object.assign(root.PAI || {}, factory(root.PAI));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (certificationApi) {
  "use strict";

  const QUALIFICATION_FORMAT = 1;
  const QUALIFICATION_STORAGE_KEY = "pai.core.host-qualification.v1";
  const QUALIFICATION_STEPS = Object.freeze([
    "hostSelfTest",
    "rollbackSelfTest",
    "premiereTranscript",
    "roughCut",
    "playback",
    "persistence",
  ]);

  function createQualificationSessionId() {
    const random = Math.random().toString(36).slice(2, 10).padEnd(8, "0").slice(0, 8);
    return `session-${Date.now().toString(36)}-${random}`;
  }

  function beginQualification(storage, environment, selection, sessionId, completedAt) {
    assertStorage(storage);
    const timestamp = normalizeTimestamp(completedAt);
    const record = {
      formatVersion: QUALIFICATION_FORMAT,
      status: "PENDING",
      productVersion: String(environment?.pluginVersion || ""),
      environmentFingerprint: certificationApi.buildHostFingerprint(environment),
      selection: normalizeSelection(selection),
      originSessionId: normalizeSessionId(sessionId),
      startedAt: timestamp,
      updatedAt: timestamp,
      steps: Object.fromEntries(QUALIFICATION_STEPS.map((name) => [name, { status: "PENDING" }])),
    };
    return writeQualification(storage, record);
  }

  function readQualification(storage, environment) {
    if (!storage || typeof storage.getItem !== "function") return null;
    const record = parseQualification(storage.getItem(QUALIFICATION_STORAGE_KEY));
    if (!record) return null;
    try {
      return record.environmentFingerprint === certificationApi.buildHostFingerprint(environment) ? record : null;
    } catch (_) {
      return null;
    }
  }

  function clearQualification(storage) {
    if (storage && typeof storage.removeItem === "function") storage.removeItem(QUALIFICATION_STORAGE_KEY);
  }

  function recordHostSelfTest(storage, environment, selection, result, completedAt) {
    const checks = result?.checks || {};
    if (result?.status !== "PASS" || result?.cleaned !== true
      || !["subclip", "sequence", "activation", "cleanup"].every((name) => checks[name] === true)) {
      throw new Error("정리까지 완료된 호스트 자체시험 PASS 결과가 필요합니다.");
    }
    return updateQualification(storage, environment, selection, "hostSelfTest", {
      status: "PASS",
      completedAt: normalizeTimestamp(completedAt),
      operationId: optionalText(result.operationId),
    }, completedAt);
  }

  function recordRollbackSelfTest(storage, environment, selection, result, completedAt) {
    if (result?.status !== "PASS" || result?.cleaned !== true
      || result?.checks?.failureObserved !== true || result?.checks?.cleanup !== true) {
      throw new Error("의도된 실패와 정리를 모두 확인한 롤백 자체시험 PASS 결과가 필요합니다.");
    }
    return updateQualification(storage, environment, selection, "rollbackSelfTest", {
      status: "PASS",
      completedAt: normalizeTimestamp(completedAt),
      operationId: optionalText(result.operationId),
    }, completedAt);
  }

  function recordPremiereTranscript(storage, environment, selection, details, completedAt) {
    const count = Number(details?.segmentCount);
    if (details?.source !== "premiere" || !Number.isInteger(count) || count <= 0) {
      throw new Error("실제 Premiere 전사문 분석 결과가 필요합니다.");
    }
    return updateQualification(storage, environment, selection, "premiereTranscript", {
      status: "PASS",
      completedAt: normalizeTimestamp(completedAt),
      segmentCount: count,
    }, completedAt);
  }

  function recordRoughCut(storage, environment, selection, result, sessionId, completedAt) {
    const sequenceName = requiredText(result?.sequenceName, "생성 시퀀스 이름");
    const operationId = requiredText(result?.operationId, "작업 식별자");
    const segmentCount = Number(result?.segmentCount);
    if (!Number.isInteger(segmentCount) || segmentCount <= 0) throw new Error("생성된 러프컷 구간 수가 올바르지 않습니다.");
    return updateQualification(storage, environment, selection, "roughCut", {
      status: "PASS",
      completedAt: normalizeTimestamp(completedAt),
      projectId: requiredText(result?.projectId || selection?.projectId, "프로젝트 식별자"),
      sequenceId: optionalText(result?.sequenceId),
      sequenceName,
      operationId,
      segmentCount,
      createdSessionId: normalizeSessionId(sessionId),
    }, completedAt);
  }

  function recordPlaybackConfirmation(storage, environment, selection, confirmed, completedAt) {
    if (confirmed !== true) throw new Error("A/V 싱크와 원본 불변을 직접 확인해야 합니다.");
    const current = requireQualification(storage, environment, selection);
    if (current.steps.roughCut.status !== "PASS") throw new Error("먼저 실제 러프컷을 생성하십시오.");
    return updateQualification(storage, environment, selection, "playback", {
      status: "PASS",
      completedAt: normalizeTimestamp(completedAt),
      confirmed: true,
    }, completedAt);
  }

  function recordPersistenceConfirmation(storage, environment, currentSessionId, verification, completedAt) {
    const current = requireQualification(storage, environment);
    if (!canConfirmPersistence(current, currentSessionId)) {
      throw new Error("러프컷을 만든 세션을 종료한 뒤 새 패널 세션에서 확인하십시오.");
    }
    if (verification?.status !== "PASS") throw new Error("저장 후 다시 열린 러프컷 시퀀스를 확인하지 못했습니다.");
    const roughCut = current.steps.roughCut;
    if (roughCut.projectId && String(verification.projectId || "") !== roughCut.projectId) {
      throw new Error("검증 중인 Premiere 프로젝트가 바뀌었습니다.");
    }
    if (roughCut.sequenceId && verification.sequenceId && String(verification.sequenceId) !== roughCut.sequenceId) {
      throw new Error("검증 중인 러프컷 시퀀스가 바뀌었습니다.");
    }
    if (String(verification.sequenceName || "") !== roughCut.sequenceName) {
      throw new Error("검증 중인 러프컷 시퀀스 이름이 바뀌었습니다.");
    }
    return updateQualification(storage, environment, null, "persistence", {
      status: "PASS",
      completedAt: normalizeTimestamp(completedAt),
      verifiedSessionId: normalizeSessionId(currentSessionId),
      sequenceId: optionalText(verification.sequenceId),
      sequenceName: roughCut.sequenceName,
    }, completedAt);
  }

  function qualificationMatchesSelection(record, selection) {
    if (!record || !selection) return false;
    const expected = record.selection;
    return String(selection.projectId || "") === expected.projectId
      && String(selection.clipId || "") === expected.clipId
      && Math.abs(Number(selection.duration) - expected.duration) <= 0.002
      && Math.abs(Number(selection.frameRate) - expected.frameRate) <= 0.0001;
  }

  function canConfirmPersistence(record, currentSessionId) {
    return Boolean(record?.steps?.roughCut?.status === "PASS"
      && record.steps.roughCut.createdSessionId
      && currentSessionId
      && String(record.steps.roughCut.createdSessionId) !== String(currentSessionId));
  }

  function isQualificationComplete(record) {
    return Boolean(record && QUALIFICATION_STEPS.every((name) => record.steps?.[name]?.status === "PASS"));
  }

  function qualificationSummary(record) {
    if (!record) return "검증을 시작하지 않았습니다.";
    const passed = QUALIFICATION_STEPS.filter((name) => record.steps[name].status === "PASS").length;
    return record.status === "PASS"
      ? `실제 Premiere 검증 완료 · ${passed}/${QUALIFICATION_STEPS.length}`
      : `실제 Premiere 검증 진행 중 · ${passed}/${QUALIFICATION_STEPS.length}`;
  }

  function qualificationReport(record) {
    return record ? `${JSON.stringify(record, null, 2)}\n` : "";
  }

  function updateQualification(storage, environment, selection, stepName, stepValue, completedAt) {
    if (!QUALIFICATION_STEPS.includes(stepName)) throw new Error(`알 수 없는 검증 단계입니다: ${stepName}`);
    const current = requireQualification(storage, environment, selection);
    const next = JSON.parse(JSON.stringify(current));
    next.steps[stepName] = stepValue;
    next.updatedAt = normalizeTimestamp(completedAt);
    next.status = QUALIFICATION_STEPS.every((name) => next.steps[name].status === "PASS") ? "PASS" : "PENDING";
    return writeQualification(storage, next);
  }

  function requireQualification(storage, environment, selection) {
    const current = readQualification(storage, environment);
    if (!current) throw new Error("현재 Premiere 환경의 검증을 먼저 시작하십시오.");
    if (selection && !qualificationMatchesSelection(current, selection)) {
      throw new Error("검증을 시작한 프로젝트 또는 원본 클립이 바뀌었습니다.");
    }
    return current;
  }

  function writeQualification(storage, value) {
    assertStorage(storage);
    const normalized = normalizeQualification(value);
    storage.setItem(QUALIFICATION_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function parseQualification(raw) {
    if (!raw) return null;
    try { return normalizeQualification(JSON.parse(String(raw))); }
    catch (_) { return null; }
  }

  function normalizeQualification(value) {
    if (!value || value.formatVersion !== QUALIFICATION_FORMAT) throw new Error("검증 기록 형식이 올바르지 않습니다.");
    const selection = normalizeSelection(value.selection);
    const steps = {};
    for (const name of QUALIFICATION_STEPS) {
      const step = value.steps?.[name];
      if (!step || !["PENDING", "PASS"].includes(step.status)) throw new Error(`검증 단계가 올바르지 않습니다: ${name}`);
      steps[name] = Object.freeze(Object.assign({}, step));
    }
    const record = {
      formatVersion: QUALIFICATION_FORMAT,
      status: QUALIFICATION_STEPS.every((name) => steps[name].status === "PASS") ? "PASS" : "PENDING",
      productVersion: requiredText(value.productVersion, "제품 버전"),
      environmentFingerprint: requiredText(value.environmentFingerprint, "호스트 지문"),
      selection,
      originSessionId: normalizeSessionId(value.originSessionId),
      startedAt: normalizeTimestamp(value.startedAt),
      updatedAt: normalizeTimestamp(value.updatedAt),
      steps: Object.freeze(steps),
    };
    return Object.freeze(record);
  }

  function normalizeSelection(value) {
    const duration = Number(value?.duration);
    const frameRate = Number(value?.frameRate);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(frameRate) || frameRate <= 0) {
      throw new Error("검증할 원본의 길이 또는 프레임레이트가 올바르지 않습니다.");
    }
    return Object.freeze({
      projectId: requiredText(value?.projectId, "프로젝트 식별자"),
      projectName: optionalText(value?.projectName),
      clipId: requiredText(value?.clipId, "클립 식별자"),
      clipName: optionalText(value?.clipName),
      duration,
      frameRate,
    });
  }

  function normalizeTimestamp(value) {
    const timestamp = String(value || new Date().toISOString());
    if (Number.isNaN(Date.parse(timestamp))) throw new Error("검증 시간이 올바르지 않습니다.");
    return timestamp;
  }

  function normalizeSessionId(value) {
    const sessionId = String(value || "").trim();
    if (!sessionId) throw new Error("패널 세션 식별자가 필요합니다.");
    return sessionId;
  }

  function requiredText(value, label) {
    const text = String(value == null ? "" : value).trim();
    if (!text) throw new Error(`${label} 값이 필요합니다.`);
    return text;
  }

  function optionalText(value) { return String(value == null ? "" : value).trim(); }
  function assertStorage(storage) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new Error("플러그인 저장소를 사용할 수 없습니다.");
    }
  }

  return {
    QUALIFICATION_STORAGE_KEY,
    QUALIFICATION_STEPS,
    createQualificationSessionId,
    beginQualification,
    readQualification,
    clearQualification,
    recordHostSelfTest,
    recordRollbackSelfTest,
    recordPremiereTranscript,
    recordRoughCut,
    recordPlaybackConfirmation,
    recordPersistenceConfirmation,
    qualificationMatchesSelection,
    canConfirmPersistence,
    isQualificationComplete,
    qualificationSummary,
    qualificationReport,
  };
});
