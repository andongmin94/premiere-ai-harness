"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const packageJson = require("../package.json");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function writeJson(directory, name, value) { const file = path.join(directory, name); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); return file; }
function writeFile(directory, name, value) { const file = path.join(directory, name); fs.writeFileSync(file, value); return file; }
function previousVersion() { return packageJson.version === "0.0.0" ? "0.0.1" : "0.0.0"; }

function snapshot() {
  const item = { projectItemId: "subclip-1", projectItemName: "clip-1", start: 0, end: 1 };
  return { formatVersion: 1, end: 1, videoTracks: [{ index: 0, items: [item] }], audioTracks: [{ index: 0, items: [item] }] };
}

function sourceManifest() {
  return {
    formatVersion: 1,
    packageKind: "unsigned-uxp-source-directory",
    pluginId: "com.andongmin.premiere-ai-harness.core",
    version: packageJson.version,
    treeSha256: "1".repeat(64),
  };
}

function qualificationReport() {
  const fingerprint = "tx1-1-0123456789abcdef";
  return {
    formatVersion: 2,
    status: "PASS",
    productVersion: packageJson.version,
    environmentFingerprint: `hostName=premierepro|hostVersion=26.3.1|uxpVersion=8.2.0|pluginVersion=${packageJson.version}|platform=win32|arch=x64`,
    selection: { projectId: "project-1", clipId: "clip-1", duration: 10, frameRate: 25 },
    originSessionId: "session-one",
    startedAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:10:00.000Z",
    steps: {
      hostSelfTest: { status: "PASS", completedAt: "2026-09-07T00:01:00.000Z", operationId: "self-test" },
      rollbackSelfTest: { status: "PASS", completedAt: "2026-09-07T00:02:00.000Z", operationId: "rollback-test" },
      premiereTranscript: { status: "PASS", completedAt: "2026-09-07T00:03:00.000Z", segmentCount: 1, fingerprint },
      roughCut: {
        status: "PASS", completedAt: "2026-09-07T00:04:00.000Z", projectId: "project-1", sequenceId: "sequence-1",
        sequenceName: "camera_AI_ROUGH_CUT", operationId: "PAI_OUTPUT_test", segmentCount: 1,
        createdSessionId: "session-one", transcriptFingerprint: fingerprint, createdSnapshot: snapshot(),
        preparedAt: "2026-09-07T00:06:00.000Z", preparedSessionId: "session-one", persistenceSnapshot: snapshot(),
      },
      playback: { status: "PASS", completedAt: "2026-09-07T00:05:00.000Z", confirmed: true },
      persistence: { status: "PASS", completedAt: "2026-09-07T00:10:00.000Z", verifiedSessionId: "session-two", sequenceId: "sequence-1", sequenceName: "camera_AI_ROUGH_CUT" },
    },
  };
}

async function makeFixture() {
  const qualificationApi = await import("../scripts/build-qualification-evidence.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pai-distribution-evidence-"));
  const ccxBytes = Buffer.from("exact deterministic ccx bytes");
  const ccxFile = writeFile(directory, `PremiereAIHarness-Core-${packageJson.version}-premierepro.ccx`, ccxBytes);
  const commit = "a".repeat(40);
  const sourceManifestFile = writeJson(directory, "source.manifest.json", sourceManifest());
  const ccxManifestFile = writeJson(directory, "ccx.manifest.json", {
    formatVersion: 1,
    packageKind: "uxp-ccx-install-candidate",
    pluginId: sourceManifest().pluginId,
    version: packageJson.version,
    sourceCommit: commit,
    sourceTreeSha256: sourceManifest().treeSha256,
    file: path.basename(ccxFile),
    bytes: ccxBytes.length,
    sha256: sha256(ccxBytes),
    installCandidate: true,
  });
  const qualificationFile = writeJson(directory, "qualification.json", qualificationReport());
  const qualificationEvidenceFile = path.join(directory, "qualification-evidence.json");
  qualificationApi.buildQualificationEvidence({ sourceManifestFile, ccxManifestFile, qualificationFile, outputFile: qualificationEvidenceFile });

  writeFile(directory, "install-proof.txt", "Creative Cloud install PASS\n");
  writeFile(directory, "update-proof.txt", "Creative Cloud update PASS\n");
  writeFile(directory, "remove-proof.txt", "Creative Cloud removal PASS\n");
  const verificationFile = writeJson(directory, "distribution-verification.json", verificationRecord({ commit, ccxSha256: sha256(ccxBytes) }));
  return { directory, ccxFile, qualificationEvidenceFile, verificationFile, commit, ccxSha256: sha256(ccxBytes) };
}

function verificationRecord({ commit = "a".repeat(40), ccxSha256 = "2".repeat(64), overrides = {} } = {}) {
  return {
    formatVersion: 1,
    evidenceKind: "premiere-ai-harness-creative-cloud-distribution-verification",
    verificationId: "seller-verification-001",
    method: "creative-cloud-desktop",
    sellerAttested: true,
    pluginId: sourceManifest().pluginId,
    version: packageJson.version,
    sourceCommit: commit,
    ccxSha256,
    events: {
      install: { status: "PASS", method: "creative-cloud-desktop", completedAt: "2026-09-07T01:00:00.000Z", version: packageJson.version, panelVisible: true, evidenceFiles: ["install-proof.txt"] },
      update: { status: "PASS", method: "creative-cloud-desktop", completedAt: "2026-09-07T01:10:00.000Z", fromVersion: previousVersion(), toVersion: packageJson.version, samePluginId: true, panelVisible: true, evidenceFiles: ["update-proof.txt"] },
      removal: { status: "PASS", method: "creative-cloud-desktop", completedAt: "2026-09-07T01:20:00.000Z", version: packageJson.version, panelAbsent: true, pluginOwnedResidualDataFound: false, evidenceFiles: ["remove-proof.txt"] },
    },
    ...overrides,
  };
}

async function withFixture(run) {
  const fixture = await makeFixture();
  try { await run(fixture); }
  finally { fs.rmSync(fixture.directory, { recursive: true, force: true }); }
}

test("promotes linked qualification and Creative Cloud evidence to releaseReady", async () => {
  const api = await import("../scripts/build-distribution-evidence.mjs");
  await withFixture(async (files) => {
    const outputFile = path.join(files.directory, "distribution-evidence.json");
    const evidence = api.buildDistributionEvidence({ qualificationEvidenceFile: files.qualificationEvidenceFile, verificationFile: files.verificationFile, ccxFile: files.ccxFile, outputFile });
    assert.equal(evidence.releaseReady, true);
    assert.equal(evidence.adobeAttestation, false);
    assert.equal(evidence.ccx.sha256, files.ccxSha256);
    assert.equal(evidence.sourceCommit, files.commit);
    assert.equal(evidence.distributionVerification.events.install.evidenceFiles.length, 1);
    const stored = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    assert.deepEqual(api.verifyDistributionEvidence(stored), stored);
  });
});

test("rejects a CCX file that is not the qualified artifact", async () => {
  const api = await import("../scripts/build-distribution-evidence.mjs");
  await withFixture(async (files) => {
    fs.appendFileSync(files.ccxFile, "tampered");
    assert.throws(() => api.buildDistributionEvidence({ qualificationEvidenceFile: files.qualificationEvidenceFile, verificationFile: files.verificationFile, ccxFile: files.ccxFile }), /actual CCX/);
  });
});

test("requires complete install, update, removal, and local proof files", async () => {
  const api = await import("../scripts/build-distribution-evidence.mjs");
  await withFixture(async (files) => {
    let record = verificationRecord({ commit: files.commit, ccxSha256: files.ccxSha256 });
    record.events.update.fromVersion = packageJson.version;
    writeJson(files.directory, "distribution-verification.json", record);
    assert.throws(() => api.buildDistributionEvidence({ qualificationEvidenceFile: files.qualificationEvidenceFile, verificationFile: files.verificationFile, ccxFile: files.ccxFile }), /update version path/);

    record = verificationRecord({ commit: files.commit, ccxSha256: files.ccxSha256 });
    record.events.removal.pluginOwnedResidualDataFound = true;
    writeJson(files.directory, "distribution-verification.json", record);
    assert.throws(() => api.buildDistributionEvidence({ qualificationEvidenceFile: files.qualificationEvidenceFile, verificationFile: files.verificationFile, ccxFile: files.ccxFile }), /residual data/);

    record = verificationRecord({ commit: files.commit, ccxSha256: files.ccxSha256 });
    record.events.install.evidenceFiles = ["missing-proof.txt"];
    writeJson(files.directory, "distribution-verification.json", record);
    assert.throws(() => api.buildDistributionEvidence({ qualificationEvidenceFile: files.qualificationEvidenceFile, verificationFile: files.verificationFile, ccxFile: files.ccxFile }), /ENOENT|no such file/);
  });
});

test("rejects verification records that escape their evidence directory", async () => {
  const api = await import("../scripts/build-distribution-evidence.mjs");
  await withFixture(async (files) => {
    const record = verificationRecord({ commit: files.commit, ccxSha256: files.ccxSha256 });
    record.events.install.evidenceFiles = ["../outside.txt"];
    writeJson(files.directory, "distribution-verification.json", record);
    assert.throws(() => api.buildDistributionEvidence({ qualificationEvidenceFile: files.qualificationEvidenceFile, verificationFile: files.verificationFile, ccxFile: files.ccxFile }), /escapes the verification directory/);
  });
});

test("detects tampering with the final distribution evidence", async () => {
  const api = await import("../scripts/build-distribution-evidence.mjs");
  await withFixture(async (files) => {
    const outputFile = path.join(files.directory, "distribution-evidence.json");
    api.buildDistributionEvidence({ qualificationEvidenceFile: files.qualificationEvidenceFile, verificationFile: files.verificationFile, ccxFile: files.ccxFile, outputFile });
    const tampered = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    tampered.releaseReady = false;
    assert.throws(() => api.verifyDistributionEvidence(tampered), /releaseReady|SHA-256/);
  });
});
