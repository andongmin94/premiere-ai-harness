(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PAI = Object.assign(root.PAI || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CERTIFICATION_FORMAT = 1;
  const CERTIFICATION_STORAGE_KEY = "pai.core.host-certification.v1";
  const REQUIRED_CHECKS = Object.freeze(["subclip", "sequence", "activation", "cleanup"]);

  function normalizeHostEnvironment(value) {
    const input = value || {};
    const environment = {
      hostName: normalize(input.hostName, true),
      hostVersion: normalize(input.hostVersion),
      uxpVersion: normalize(input.uxpVersion),
      pluginVersion: normalize(input.pluginVersion),
      platform: normalize(input.platform, true),
      arch: normalize(input.arch, true),
    };
    for (const [key, item] of Object.entries(environment)) {
      if (!item) throw new Error(`호스트 환경의 ${key} 값을 확인하지 못했습니다.`);
    }
    return Object.freeze(environment);
  }

  function buildHostFingerprint(value) {
    const environment = normalizeHostEnvironment(value);
    return Object.entries(environment)
      .map(([key, item]) => `${key}=${encodeURIComponent(item)}`)
      .join("|");
  }

  function createCertification(environment, result, createdAt) {
    const checkResult = result || {};
    if (checkResult.status !== "PASS" || checkResult.cleaned !== true) {
      throw new Error("호스트 자체시험과 시험 자산 정리가 모두 통과해야 인증할 수 있습니다.");
    }
    const checks = Object.fromEntries(REQUIRED_CHECKS.map((name) => [name, checkResult.checks?.[name] === true]));
    if (REQUIRED_CHECKS.some((name) => !checks[name])) {
      throw new Error("호스트 자체시험의 필수 검증 항목이 누락되었습니다.");
    }
    return Object.freeze({
      formatVersion: CERTIFICATION_FORMAT,
      fingerprint: buildHostFingerprint(environment),
      createdAt: createdAt || new Date().toISOString(),
      checks: Object.freeze(checks),
    });
  }

  function isCertificationValid(value, environment) {
    const certification = normalizeCertification(value);
    if (!certification) return false;
    if (certification.fingerprint !== buildHostFingerprint(environment)) return false;
    return REQUIRED_CHECKS.every((name) => certification.checks[name] === true);
  }

  function serializeCertification(value) {
    const certification = normalizeCertification(value);
    if (!certification) throw new Error("저장할 호스트 인증 데이터가 올바르지 않습니다.");
    return JSON.stringify(certification);
  }

  function parseCertification(raw) {
    if (!raw) return null;
    try { return normalizeCertification(JSON.parse(String(raw))); }
    catch (_) { return null; }
  }

  function readCertification(storage, environment) {
    if (!storage || typeof storage.getItem !== "function") return null;
    const certification = parseCertification(storage.getItem(CERTIFICATION_STORAGE_KEY));
    return certification && isCertificationValid(certification, environment) ? certification : null;
  }

  function writeCertification(storage, environment, result) {
    if (!storage || typeof storage.setItem !== "function") throw new Error("플러그인 저장소를 사용할 수 없습니다.");
    const certification = createCertification(environment, result);
    storage.setItem(CERTIFICATION_STORAGE_KEY, serializeCertification(certification));
    return certification;
  }

  function clearCertification(storage) {
    if (storage && typeof storage.removeItem === "function") storage.removeItem(CERTIFICATION_STORAGE_KEY);
  }

  function normalizeCertification(value) {
    if (!value || value.formatVersion !== CERTIFICATION_FORMAT || typeof value.fingerprint !== "string") return null;
    if (!value.createdAt || Number.isNaN(Date.parse(value.createdAt))) return null;
    const checks = value.checks || {};
    if (REQUIRED_CHECKS.some((name) => typeof checks[name] !== "boolean")) return null;
    return Object.freeze({
      formatVersion: CERTIFICATION_FORMAT,
      fingerprint: value.fingerprint,
      createdAt: value.createdAt,
      checks: Object.freeze(Object.fromEntries(REQUIRED_CHECKS.map((name) => [name, checks[name]]))),
    });
  }

  function normalize(value, lowerCase) {
    const text = String(value == null ? "" : value).trim();
    return lowerCase ? text.toLowerCase() : text;
  }

  return {
    CERTIFICATION_STORAGE_KEY,
    REQUIRED_CHECKS,
    normalizeHostEnvironment,
    buildHostFingerprint,
    createCertification,
    isCertificationValid,
    serializeCertification,
    parseCertification,
    readCertification,
    writeCertification,
    clearCertification,
  };
});
