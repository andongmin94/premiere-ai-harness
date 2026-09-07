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
function previousVersion() { return packageJson.version === "0.0.0" ? "0.0.1" : "0.0.0"; }
function snapshot() {
  const item = { projectItemId: "subclip-1", projectItemName: "clip-1", start: 0, end: 1 };
  return { formatVersion: 1, end: 1, videoTracks: [{ index: 0, items: [item] }], audioTracks: [{ index: 0, items: [item] }] };
}

async function makeQualificationEvidence(directory) {
  const api = await import("../scripts/build-qualification-evidence.mjs");
  const pluginId = "com.andongmin.premiere-ai-harness.core";
  const sourceCommit = "a".repeat(40);
  const treeSha256 = "1".repeat(64);
  const ccxSha256 = "2".repeat(64);
  const fingerprint = "tx1-1-0123456789abcdef";
  const sourceManifestFile = writeJson(directory, "source.manifest.json", {
    formatVersion: 1,
    packageKind: "unsigned-uxp-source-directory",
    pluginId,
    version: packageJson.version,
    treeSha256,
  });
  const ccxManifestFile = writeJson(directory, "ccx.manifest.json", {
    formatVersion: 1,
    packageKind: "uxp-ccx-install-candidate",
    pluginId,
    version: packageJson.version,
    sourceCommit,
    sourceTreeSha256: treeSha256,
    file: `PremiereAIHarness-Core-${packageJson.version}-premierepro.ccx`,
    bytes: 1234,
    sha256: ccxSha256,
    installCandidate: true,
  });
  const qualificationFile = writeJson(directory, "qualification.json", {
    formatVersion: 2,
    status: "PASS",
    productVersion: packageJson.version,
    environmentFingerprint: `hostName=premierepro|hostVersion=26.3.1|uxpVersion=8.2.0|pluginVersion=${packageJson.version}|platform=win32|arch=x64`,
    selection: { projectId: "project-1", clipId: "clip-1", duration: 10, frameRate: 25 },
    originSessionId: "session-one",
    startedAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:10:00.000Z",
    steps: {
      hostSelfTest: { status: "PASS", completedAt: "2026-09-07T00:01:00.000Z", operationId: "host-test" },
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
  });
  const evidenceFile = path.join(directory, "qualification-evidence.json");
  api.buildQualificationEvidence({ sourceManifestFile, ccxManifestFile, qualificationFile, outputFile: evidenceFile });
  return { evidenceFile, pluginId, sourceCommit, ccxSha256 };
}

async function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pai-workspace-init-"));
  try {
    const inputs = path.join(root, "inputs");
    fs.mkdirSync(inputs);
    const qualification = await makeQualificationEvidence(inputs);
    await run({ root, ...qualification });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("creates an external pending verification workspace from qualification evidence", async () => {
  const api = await import("../scripts/init-distribution-verification.mjs");
  await withFixture(async (fixture) => {
    const workspaceDirectory = path.join(fixture.root, "workspace");
    const result = api.initDistributionVerificationWorkspace({
      qualificationEvidenceFile: fixture.evidenceFile,
      previousVersion: previousVersion(),
      workspaceDirectory,
    });
    const record = JSON.parse(fs.readFileSync(result.verificationFile, "utf8"));
    assert.equal(record.pluginId, fixture.pluginId);
    assert.equal(record.version, packageJson.version);
    assert.equal(record.sourceCommit, fixture.sourceCommit);
    assert.equal(record.ccxSha256, fixture.ccxSha256);
    assert.equal(record.sellerAttested, false);
    assert.equal(record.events.install.status, "PENDING");
    assert.equal(record.events.update.status, "PENDING");
    assert.equal(record.events.update.fromVersion, previousVersion());
    assert.equal(record.events.removal.status, "PENDING");
    assert.equal(record.events.removal.pluginOwnedResidualDataFound, null);
    for (const name of ["install", "update", "removal"]) {
      assert.equal(fs.statSync(path.join(workspaceDirectory, name)).isDirectory(), true);
      assert.deepEqual(record.events[name].evidenceFiles, []);
    }
    assert.match(fs.readFileSync(result.instructionsFile, "utf8"), /Do not.*PASS before it is actually performed/);
  });
});

test("refuses repository workspaces and a current-version update source", async () => {
  const api = await import("../scripts/init-distribution-verification.mjs");
  await withFixture(async (fixture) => {
    const repositoryWorkspace = path.join(__dirname, "..", "dist", "verification-workspace-test");
    assert.throws(() => api.initDistributionVerificationWorkspace({
      qualificationEvidenceFile: fixture.evidenceFile,
      previousVersion: previousVersion(),
      workspaceDirectory: repositoryWorkspace,
    }), /outside the repository/);
    assert.equal(fs.existsSync(repositoryWorkspace), false);

    assert.throws(() => api.initDistributionVerificationWorkspace({
      qualificationEvidenceFile: fixture.evidenceFile,
      previousVersion: packageJson.version,
      workspaceDirectory: path.join(fixture.root, "same-version"),
    }), /must differ/);
  });
});

test("refuses to overwrite a non-empty workspace", async () => {
  const api = await import("../scripts/init-distribution-verification.mjs");
  await withFixture(async (fixture) => {
    const workspaceDirectory = path.join(fixture.root, "existing");
    fs.mkdirSync(workspaceDirectory);
    fs.writeFileSync(path.join(workspaceDirectory, "keep.txt"), "keep");
    assert.throws(() => api.initDistributionVerificationWorkspace({
      qualificationEvidenceFile: fixture.evidenceFile,
      previousVersion: previousVersion(),
      workspaceDirectory,
    }), /must not already contain files/);
    assert.equal(fs.readFileSync(path.join(workspaceDirectory, "keep.txt"), "utf8"), "keep");
  });
});

test("rejects tampered qualification evidence before creating a workspace", async () => {
  const api = await import("../scripts/init-distribution-verification.mjs");
  await withFixture(async (fixture) => {
    const broken = JSON.parse(fs.readFileSync(fixture.evidenceFile, "utf8"));
    broken.ccx.sha256 = sha256("tampered");
    fs.writeFileSync(fixture.evidenceFile, `${JSON.stringify(broken, null, 2)}\n`);
    const workspaceDirectory = path.join(fixture.root, "tampered");
    assert.throws(() => api.initDistributionVerificationWorkspace({
      qualificationEvidenceFile: fixture.evidenceFile,
      previousVersion: previousVersion(),
      workspaceDirectory,
    }), /evidence SHA-256/);
    assert.equal(fs.existsSync(workspaceDirectory), false);
  });
});

test("rejects a path whose existing symlink parent resolves into the repository", { skip: process.platform === "win32" }, async () => {
  const api = await import("../scripts/init-distribution-verification.mjs");
  await withFixture(async (fixture) => {
    const repositoryRoot = path.resolve(__dirname, "..");
    const link = path.join(fixture.root, "repo-link");
    fs.symlinkSync(repositoryRoot, link, "dir");
    const workspaceDirectory = path.join(link, "dist", "workspace-through-link");
    assert.throws(() => api.initDistributionVerificationWorkspace({
      qualificationEvidenceFile: fixture.evidenceFile,
      previousVersion: previousVersion(),
      workspaceDirectory,
    }), /resolves inside the repository/);
    assert.equal(fs.existsSync(path.join(repositoryRoot, "dist", "workspace-through-link")), false);
  });
});
