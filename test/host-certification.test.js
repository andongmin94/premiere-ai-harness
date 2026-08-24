"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const certification = require("../plugin/lib/host-certification.js");

const host = {
  hostName: "premierepro",
  hostVersion: "26.3.1",
  uxpVersion: "8.2.0",
  pluginVersion: "0.3.1",
  platform: "win32",
  arch: "x64",
};

function passResult(overrides = {}) {
  return Object.assign({
    status: "PASS",
    cleaned: true,
    checks: { subclip: true, sequence: true, activation: true, cleanup: true },
  }, overrides);
}

test("builds deterministic environment fingerprints", () => {
  const first = certification.buildHostFingerprint(host);
  const second = certification.buildHostFingerprint({ ...host });
  assert.equal(first, second);
  assert.match(first, /hostVersion=26.3.1/);
});

test("accepts only a fully checked and cleaned PASS self-test", () => {
  assert.throws(() => certification.createCertification(host, passResult({ cleaned: false })), /정리/);
  assert.throws(() => certification.createCertification(host, passResult({ checks: { subclip: true, sequence: true, activation: false, cleanup: true } })), /누락/);
  const value = certification.createCertification(host, passResult(), "2026-08-21T00:00:00.000Z");
  assert.equal(certification.isCertificationValid(value, host), true);
  assert.equal(certification.certificationSummary(value).startsWith("인증됨"), true);
});

test("invalidates certification when the host environment changes", () => {
  const value = certification.createCertification(host, passResult());
  for (const [field, changed] of [
    ["hostVersion", "26.4.0"], ["uxpVersion", "8.3.0"], ["pluginVersion", "0.4.0"],
    ["platform", "darwin"], ["arch", "arm64"],
  ]) assert.equal(certification.isCertificationValid(value, { ...host, [field]: changed }), false, field);
});

test("reads, writes, and clears only its own storage key", () => {
  const values = new Map([["other", "keep"]]);
  const storage = {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const value = certification.writeCertification(storage, host, passResult());
  assert.equal(certification.readCertification(storage, host).fingerprint, value.fingerprint);
  certification.clearCertification(storage);
  assert.equal(values.get("other"), "keep");
  assert.equal(certification.readCertification(storage, host), null);
});

test("rejects malformed stored values", () => {
  assert.equal(certification.parseCertification("not json"), null);
  assert.equal(certification.parseCertification(JSON.stringify({ formatVersion: 99 })), null);
  assert.throws(() => certification.normalizeHostEnvironment({}), /확인하지 못했습니다/);
});
