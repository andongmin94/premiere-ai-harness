"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function writeJson(directory, name, value) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function snapshot() {
  const item = { projectItemId: "subclip-1", projectItemName: "clip-1", start: 0, end: 1, sourceIn: 0, sourceOut: 1 };
  return {
    formatVersion: 2,
    end: 1,
    videoTracks: [{ index: 0, items: [item] }],
    audioTracks: [{ index: 0, items: [item] }],
  };
}

function qualificationReport(overrides = {}) {
  const fingerprint = "tx1-1-0123456789abcdef";
  return {
    formatVersion: 2,
    status: "PASS",
    productVersion: "0.5.1",
    environmentFingerprint: "hostName=premierepro|hostVersion=26.3.1|uxpVersion=8.2.0|pluginVersion=0.5.1|platform=win32|arch=x64",
    selection: {
      projectId: "project-1",
      projectName: "Test Project",
      clipId: "clip-1",
      clipName: "camera.mp4",
      duration: 10,
      frameRate: 25,
    },
    originSessionId: "session-one",
    startedAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:10:00.000Z",
    steps: {
      hostSelfTest: { status: "PASS", completedAt: "2026-09-07T00:01:00.000Z", operationId: "self-test" },
      rollbackSelfTest: { status: "PASS", completedAt: "2026-09-07T00:02:00.000Z", operationId: "rollback-test" },
      premiereTranscript: { status: "PASS", completedAt: "2026-09-07T00:03:00.000Z", segmentCount: 1, fingerprint },
      roughCut: {
        status: "PASS",
        completedAt: "2026-09-07T00:04:00.000Z",
        projectId: "project-1",
        sequenceId: "sequence-1",
        sequenceName: "camera_AI_ROUGH_CUT",
        operationId: "PAI_OUTPUT_test",
        segmentCount: 1,
        createdSessionId: "session-one",
        transcriptFingerprint: fingerprint,
        createdSnapshot: snapshot(),
        preparedAt: "2026-09-07T00:06:00.000Z",
        preparedSessionId: "session-one",
        persistenceSnapshot: snapshot(),
      },
      playback: { status: "PASS", completedAt: "2026-09-07T00:05:00.000Z", confirmed: true },
      persistence: {
        status: "PASS",
        completedAt: "2026-09-07T00:10:00.000Z",
        verifiedSessionId: "session-two",
        sequenceId: "sequence-1",
        sequenceName: "camera_AI_ROUGH_CUT",
      },
    },
    ...overrides,
  };
}

function sourceManifest(overrides = {}) {
  return {
    formatVersion: 1,
    packageKind: "unsigned-uxp-source-directory",
    installable: false,
    requiresAdobeUxpDeveloperToolPackaging: true,
    pluginId: "com.andongmin.premiere-ai-harness.core",
    version: "0.5.1",
    directory: "PremiereAIHarness-Core-0.5.1-uxp-source",
    treeSha256: "1".repeat(64),
    entries: [],
    ...overrides,
  };
}

function ccxManifest(overrides = {}) {
  return {
    formatVersion: 1,
    packageKind: "uxp-ccx-install-candidate",
    pluginId: "com.andongmin.premiere-ai-harness.core",
    version: "0.5.1",
    host: "premierepro",
    sourceCommit: "a".repeat(40),
    sourceTreeSha256: "1".repeat(64),
    file: "PremiereAIHarness-Core-0.5.1-premierepro.ccx",
    bytes: 12345,
    sha256: "2".repeat(64),
    installCandidate: true,
    installVerified: false,
    distributionReady: false,
    entries: [],
    ...overrides,
  };
}

async function withFixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pai-evidence-test-"));
  try {
    const sourceManifestFile = writeJson(directory, "source.manifest.json", sourceManifest());
    const ccxManifestFile = writeJson(directory, "ccx.manifest.json", ccxManifest());
    const qualificationFile = writeJson(directory, "qualification.json", qualificationReport());
    const outputFile = path.join(directory, "evidence.json");
    await run({ directory, sourceManifestFile, ccxManifestFile, qualificationFile, outputFile });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("builds linked evidence without claiming release readiness", async () => {
  const api = await import("../scripts/build-qualification-evidence.mjs");
  await withFixture(async (files) => {
    const evidence = api.buildQualificationEvidence(files);
    assert.equal(evidence.releaseReady, false);
    assert.equal(evidence.gates.sourceAndCcxLinked, true);
    assert.equal(evidence.gates.hostQualificationPassed, true);
    assert.equal(evidence.qualification.transcriptFingerprint, "tx1-1-0123456789abcdef");
    assert.equal(evidence.source.treeSha256, "1".repeat(64));
    assert.equal(evidence.ccx.sha256, "2".repeat(64));
    assert.match(evidence.remainingReleaseGate, /install, update, and removal/);
    const stored = JSON.parse(fs.readFileSync(files.outputFile, "utf8"));
    assert.deepEqual(api.verifyQualificationEvidence(stored), stored);
  });
});

test("rejects source, version, and transcript provenance mismatches", async () => {
  const api = await import("../scripts/build-qualification-evidence.mjs");
  await withFixture(async (files) => {
    writeJson(files.directory, "ccx.manifest.json", ccxManifest({ sourceTreeSha256: "3".repeat(64) }));
    assert.throws(() => api.buildQualificationEvidence(files), /source tree differs/);

    writeJson(files.directory, "ccx.manifest.json", ccxManifest());
    writeJson(files.directory, "qualification.json", qualificationReport({ productVersion: "0.5.2" }));
    assert.throws(() => api.buildQualificationEvidence(files), /product version differs/);

    const broken = qualificationReport();
    broken.steps.roughCut.transcriptFingerprint = "tx1-1-fedcba9876543210";
    writeJson(files.directory, "qualification.json", broken);
    assert.throws(() => api.buildQualificationEvidence(files), /provenance mismatch/);
  });
});

test("rejects snapshot v1 and source-boundary drift in external qualification reports", async () => {
  const api = await import("../scripts/build-qualification-evidence.mjs");
  await withFixture(async (files) => {
    const legacy = qualificationReport();
    legacy.steps.roughCut.createdSnapshot.formatVersion = 1;
    writeJson(files.directory, "qualification.json", legacy);
    assert.throws(() => api.buildQualificationEvidence(files), /snapshot v2/);

    const drifted = qualificationReport();
    for (const group of [drifted.steps.roughCut.persistenceSnapshot.videoTracks, drifted.steps.roughCut.persistenceSnapshot.audioTracks]) {
      group[0].items[0].sourceIn = 0.04;
    }
    writeJson(files.directory, "qualification.json", drifted);
    assert.throws(() => api.buildQualificationEvidence(files), /source-aware snapshots differ/);
  });
});

test("detects evidence tampering and never upgrades qualification evidence into release readiness", async () => {
  const api = await import("../scripts/build-qualification-evidence.mjs");
  await withFixture(async (files) => {
    writeJson(files.directory, "ccx.manifest.json", ccxManifest({ installVerified: true, distributionReady: true }));
    const evidence = api.buildQualificationEvidence(files);
    assert.equal(evidence.releaseReady, false);
    const tampered = JSON.parse(fs.readFileSync(files.outputFile, "utf8"));
    tampered.ccx.bytes += 1;
    assert.throws(() => api.verifyQualificationEvidence(tampered), /evidence SHA-256 does not match/);
  });
});
