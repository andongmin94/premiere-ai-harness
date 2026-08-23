(function (root, factory) {
  if (typeof module === "object" && module.exports && typeof window === "undefined") {
    module.exports = factory(require("./host-certification.js"), require("./sequence-snapshot.js"));
  } else {
    root.PAI = Object.assign(root.PAI || {}, factory(root.PAI, root.PAI));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (certification, snapshots) {
  "use strict";

  const QUALIFICATION_FORMAT = 2;
  const QUALIFICATION_STORAGE_KEY = "pai.core.host-qualification.v2";
  const OBSOLETE_STORAGE_KEYS = Object.freeze(["pai.core.host-qualification.v1"]);
  const QUALIFICATION_STEPS = Object.freeze([
    "hostSelfTest",
    "rollbackSelfTest",
    "premiereTranscript",
    "roughCut",
    "playback",
    "persistence",
  ]);

  function createQualificationRecord(environment, selection, sessionId, completedAt) {
    const timestamp = timestampOrNow(completedAt);
    return normalizeQualificationRecord({
      formatVersion: QUALIFICATION_FORMAT,
      productVersion: String(environment?.pluginVersion || ""),
      environmentFingerprint: certification.buildHostFingerprint(environment),
      selection,
      originSessionId: normalizeSessionId(sessionId),
      startedAt: timestamp,
      updatedAt: timestamp,
      steps: Object.fromEntries(QUALIFICATION_STEPS.map((name) => [name, { status: "PENDING" }])),
    });
  }

  function readQualificationRecord(storage, environment) {
    if (!storage || typeof storage.getItem !== "function") return null;
    try {
      const record = normalizeQualificationRecord(JSON.parse(String(storage.getItem(QUALIFICATION_STORAGE_KEY) || "null")));
      return record.environmentFingerprint === certification.buildHostFingerprint(environment) ? record : null;
    } catch (_) {
      return null;
    }
  }

  function writeQualificationRecord(storage, value) {
    assertStorage(storage);
    const record = normalizeQualificationRecord(value);
    for (const key of OBSOLETE_STORAGE_KEYS) storage.removeItem(key);
    storage.setItem(QUALIFICATION_STORAGE_KEY, JSON.stringify(record));
    return record;
  }

  function clearQualificationRecord(storage) {
    if (!storage || typeof storage.removeItem !== "function") return;
    storage.removeItem(QUALIFICATION_STORAGE_KEY);
    for (const key of OBSOLETE_STORAGE_KEYS) storage.removeItem(key);
  }

  function requireQualificationRecord(storage, environment, selection) {
    const record = readQualificationRecord(storage, environment);
    if (!record) throw new Error("현재 Premiere 환경의 검증을 먼저 시작하십시오.");
    if (selection && !qualificationMatchesSelection(record, selection)) {
      throw new Error("검증을 시작한 프로젝트 또는 원본 클립이 바뀌었습니다.");
    }
    return record;
  }

  function updateQualificationStep(storage, environment, selection, stepName, stepValue, completedAt) {
    if (!QUALIFICATION_STEPS.includes(stepName)) throw new Error(`알 수 없는 검증 단계입니다: ${stepName}`);
    const current = requireQualificationRecord(storage, environment, selection);
    const timestamp = timestampOrNow(completedAt);
    const step = { ...stepValue };
    if (step.status === "PASS" && !step.completedAt) step.completedAt = timestamp;
    if (stepName === "roughCut" && step.persistenceSnapshot && !step.preparedAt) step.preparedAt = timestamp;
    const next = { ...current, updatedAt: timestamp, steps: { ...current.steps, [stepName]: step } };
    return writeQualificationRecord(storage, next);
  }

  function qualificationMatchesSelection(record, selection) {
    if (!record || !selection) return false;
    const expected = record.selection;
    return String(selection.projectId || "") === expected.projectId
      && String(selection.clipId || "") === expected.clipId
      && Math.abs(Number(selection.duration) - expected.duration) <= 0.002
      && Math.abs(Number(selection.frameRate) - expected.frameRate) <= 0.0001;
  }

  function normalizeQualificationRecord(value) {
    if (!value || Number(value.formatVersion) !== QUALIFICATION_FORMAT) throw new Error("검증 기록 형식이 올바르지 않습니다.");
    const steps = {};
    for (const name of QUALIFICATION_STEPS) steps[name] = normalizeStep(name, value.steps?.[name]);
    return Object.freeze({
      formatVersion: QUALIFICATION_FORMAT,
      status: QUALIFICATION_STEPS.every((name) => steps[name].status === "PASS") ? "PASS" : "PENDING",
      productVersion: requiredText(value.productVersion, "제품 버전"),
      environmentFingerprint: requiredText(value.environmentFingerprint, "호스트 지문"),
      selection: normalizeSelection(value.selection),
      originSessionId: normalizeSessionId(value.originSessionId),
      startedAt: normalizeTimestamp(value.startedAt),
      updatedAt: normalizeTimestamp(value.updatedAt),
      steps: Object.freeze(steps),
    });
  }

  function normalizeStep(name, value) {
    if (!value || !["PENDING", "PASS"].includes(value.status)) throw new Error(`검증 단계가 올바르지 않습니다: ${name}`);
    if (value.status === "PENDING") return Object.freeze({ status: "PENDING" });
    if (name === "hostSelfTest" || name === "rollbackSelfTest") {
      return Object.freeze({ status: "PASS", completedAt: normalizeTimestamp(value.completedAt), operationId: optionalText(value.operationId) });
    }
    if (name === "premiereTranscript") {
      return Object.freeze({ status: "PASS", completedAt: normalizeTimestamp(value.completedAt), segmentCount: positiveInteger(value.segmentCount, "전사 구간 수") });
    }
    if (name === "roughCut") return normalizeRoughCutStep(value);
    if (name === "playback") {
      if (value.confirmed !== true) throw new Error("재생 확인 기록이 올바르지 않습니다.");
      return Object.freeze({ status: "PASS", completedAt: normalizeTimestamp(value.completedAt), confirmed: true });
    }
    return Object.freeze({
      status: "PASS",
      completedAt: normalizeTimestamp(value.completedAt),
      verifiedSessionId: normalizeSessionId(value.verifiedSessionId),
      sequenceId: requiredText(value.sequenceId, "시퀀스 식별자"),
      sequenceName: requiredText(value.sequenceName, "시퀀스 이름"),
    });
  }

  function normalizeRoughCutStep(value) {
    const step = {
      status: "PASS",
      completedAt: normalizeTimestamp(value.completedAt),
      projectId: requiredText(value.projectId, "프로젝트 식별자"),
      sequenceId: requiredText(value.sequenceId, "시퀀스 식별자"),
      sequenceName: requiredText(value.sequenceName, "시퀀스 이름"),
      operationId: requiredText(value.operationId, "작업 식별자"),
      segmentCount: positiveInteger(value.segmentCount, "러프컷 구간 수"),
      createdSessionId: normalizeSessionId(value.createdSessionId),
      createdSnapshot: snapshots.normalizeSequenceSnapshot(value.createdSnapshot),
    };
    if (value.persistenceSnapshot != null) {
      step.preparedAt = normalizeTimestamp(value.preparedAt);
      step.preparedSessionId = normalizeSessionId(value.preparedSessionId);
      step.persistenceSnapshot = snapshots.normalizeSequenceSnapshot(value.persistenceSnapshot);
    }
    return Object.freeze(step);
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
    const timestamp = String(value == null ? "" : value);
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) throw new Error("검증 시간이 올바르지 않습니다.");
    return timestamp;
  }

  function timestampOrNow(value) {
    return normalizeTimestamp(value == null ? new Date().toISOString() : value);
  }

  function normalizeSessionId(value) {
    return requiredText(value, "패널 세션 식별자");
  }

  function positiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) throw new Error(`${label}가 올바르지 않습니다.`);
    return number;
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
    QUALIFICATION_FORMAT,
    QUALIFICATION_STORAGE_KEY,
    QUALIFICATION_STEPS,
    createQualificationRecord,
    readQualificationRecord,
    writeQualificationRecord,
    clearQualificationRecord,
    requireQualificationRecord,
    updateQualificationStep,
    qualificationMatchesSelection,
    normalizeQualificationRecord,
  };
});
