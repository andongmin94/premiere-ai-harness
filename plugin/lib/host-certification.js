(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PAI = Object.assign(root.PAI || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FORMAT_VERSION = 1;
  const STORAGE_KEY = "pai.core.hostCertification.v1";

  function normalizeHostInfo(input) {
    const value = input || {};
    return Object.freeze({
      hostName: clean(value.hostName || value.name || "premierepro"),
      hostVersion: clean(value.hostVersion || value.version || ""),
      uxpVersion: clean(value.uxpVersion || ""),
      pluginVersion: clean(value.pluginVersion || ""),
      platform: clean(value.platform || ""),
      arch: clean(value.arch || ""),
    });
  }

  function buildHostFingerprint(input) {
    const value = normalizeHostInfo(input);
    for (const field of ["hostVersion", "uxpVersion", "pluginVersion", "platform", "arch"]) {
      if (!value[field]) throw new Error(`호스트 정보가 불완전합니다: ${field}`);
    }
    return [
      `format=${FORMAT_VERSION}`,
      `host=${value.hostName}`,
      `hostVersion=${value.hostVersion}`,
      `uxp=${value.uxpVersion}`,
      `plugin=${value.pluginVersion}`,
      `platform=${value.platform}`,
      `arch=${value.arch}`,
    ].join("|");
  }

  function createCertification(hostInfo, selfTestResult, completedAt) {
    const result = selfTestResult || {};
    if (result.status !== "PASS" || result.cleaned !== true) {
      throw new Error("정리까지 완료된 PASS 자체시험만 인증할 수 있습니다.");
    }
    return Object.freeze({
      formatVersion: FORMAT_VERSION,
      fingerprint: buildHostFingerprint(hostInfo),
      completedAt: String(completedAt || new Date().toISOString()),
      checks: Object.freeze({
        subclip: Boolean(result.checks && result.checks.subclip),
        sequence: Boolean(result.checks && result.checks.sequence),
        activation: Boolean(result.checks && result.checks.activation),
        cleanup: Boolean(result.checks && result.checks.cleanup),
      }),
    });
  }

  function serializeCertification(certification) {
    return JSON.stringify(certification);
  }

  function parseCertification(raw) {
    if (!raw || typeof raw !== "string") return null;
    try {
      const value = JSON.parse(raw);
      if (!value || value.formatVersion !== FORMAT_VERSION || typeof value.fingerprint !== "string") return null;
      if (typeof value.completedAt !== "string" || !value.checks || value.checks.cleanup !== true) return null;
      return Object.freeze(value);
    } catch (_) {
      return null;
    }
  }

  function isCertificationValid(certification, hostInfo) {
    if (!certification) return false;
    try { return certification.fingerprint === buildHostFingerprint(hostInfo) && certification.checks.cleanup === true; }
    catch (_) { return false; }
  }

  function certificationSummary(certification) {
    if (!certification) return "미인증";
    const date = new Date(certification.completedAt);
    return Number.isNaN(date.getTime()) ? "인증됨" : `인증됨 · ${date.toLocaleString()}`;
  }

  function clean(value) { return String(value == null ? "" : value).trim(); }

  return {
    HOST_CERTIFICATION_STORAGE_KEY: STORAGE_KEY,
    normalizeHostInfo,
    buildHostFingerprint,
    createCertification,
    serializeCertification,
    parseCertification,
    isCertificationValid,
    certificationSummary,
  };
});
