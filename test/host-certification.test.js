"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const certification = require("../plugin/lib/host-certification.js");

const host = {
  hostName: "premierepro",
  hostVersion: "26.3.1",
  uxpVersion: "8.2.0",
  pluginVersion: "0.2.0",
  platform: "win32",
  arch: "x64",
};

test("builds deterministic environment fingerprints", () => {
  const first = certification.buildHostFingerprint(host);
  const second = certification.buildHostFingerprint({ ...host });
  assert.equal(first, second);
  assert.match(first, /hostVersion=26\.3\.1/);
});

test("accepts only a cleaned PASS self-test", () => {
  assert.throws(() => certification.createCertification(host, { status: "PASS", cleaned: false }), /정리/);
  const value = certification.createCertification(host, {
    status: "PASS",
    cleaned: true,
    checks: { subclip: true, sequence: true, activation: true, cleanup: true },
  }, "2026-08-21T00:00:00.000Z");
  assert.equal(value.checks.cleanup, true);
  assert.equal(certification.isCertificationValid(value, host), true);
});

test("invalidates certification when Premiere, UXP, plugin, OS, or architecture changes", () => {
  const value = certification.createCertification(host, { status: "PASS", cleaned: true, checks: { cleanup: true } });
  for (const [field, changed] of [
    ["hostVersion", "26.4.0"],
    ["uxpVersion", "8.3.0"],
    ["pluginVersion", "0.3.0"],
    ["platform", "darwin"],
    ["arch", "arm64"],
  ]) {
    assert.equal(certification.isCertificationValid(value, { ...host, [field]: changed }), false, field);
  }
});

test("serializes, parses, and rejects malformed stored values", () => {
  const value = certification.createCertification(host, { status: "PASS", cleaned: true, checks: { cleanup: true } });
  const parsed = certification.parseCertification(certification.serializeCertification(value));
  assert.equal(parsed.fingerprint, value.fingerprint);
  assert.equal(certification.parseCertification("not json"), null);
  assert.equal(certification.parseCertification(JSON.stringify({ formatVersion: 99 })), null);
});
