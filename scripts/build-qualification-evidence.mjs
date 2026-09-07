import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_STEPS = Object.freeze([
  "hostSelfTest",
  "rollbackSelfTest",
  "premiereTranscript",
  "roughCut",
  "playback",
  "persistence",
]);
const REMAINING_RELEASE_GATE = "Creative Cloud install, update, and removal evidence is not represented by this file";

export function buildQualificationEvidence(options = {}) {
  const packageJson = readJson(path.join(root, "package.json"));
  const version = packageJson.version;
  const sourceManifestFile = path.resolve(options.sourceManifestFile || defaultSourceManifest(version));
  const ccxManifestFile = path.resolve(options.ccxManifestFile || defaultCcxManifest(version));
  const qualificationFile = path.resolve(requiredPath(options.qualificationFile, "qualification report"));
  const outputFile = path.resolve(options.outputFile || defaultOutputFile(version));

  const sourceManifest = readJson(sourceManifestFile);
  const ccxManifest = readJson(ccxManifestFile);
  const qualification = readJson(qualificationFile);
  validateInputs(sourceManifest, ccxManifest, qualification, version);

  const sourceIdentity = qualification.selection;
  const evidence = {
    formatVersion: 1,
    evidenceKind: "premiere-ai-harness-release-qualification-evidence",
    pluginId: sourceManifest.pluginId,
    version,
    sourceCommit: String(ccxManifest.sourceCommit).toLowerCase(),
    source: {
      treeSha256: sourceManifest.treeSha256,
      manifestFile: path.basename(sourceManifestFile),
      manifestSha256: sha256(fs.readFileSync(sourceManifestFile)),
    },
    ccx: {
      file: ccxManifest.file,
      bytes: ccxManifest.bytes,
      sha256: ccxManifest.sha256,
      manifestFile: path.basename(ccxManifestFile),
      manifestSha256: sha256(fs.readFileSync(ccxManifestFile)),
      installCandidate: ccxManifest.installCandidate === true,
    },
    qualification: {
      recordFile: path.basename(qualificationFile),
      recordSha256: sha256(Buffer.from(canonicalJson(qualification))),
      environmentFingerprint: qualification.environmentFingerprint,
      sourceIdentitySha256: sha256(Buffer.from(canonicalJson({
        projectId: sourceIdentity.projectId,
        clipId: sourceIdentity.clipId,
        duration: sourceIdentity.duration,
        frameRate: sourceIdentity.frameRate,
      }))),
      transcriptFingerprint: qualification.steps.premiereTranscript.fingerprint,
      roughCutOperationId: qualification.steps.roughCut.operationId,
      persistenceVerifiedSessionId: qualification.steps.persistence.verifiedSessionId,
      startedAt: qualification.startedAt,
      updatedAt: qualification.updatedAt,
      status: qualification.status,
    },
    gates: {
      sourceAndCcxLinked: true,
      hostQualificationPassed: true,
      persistenceVerified: true,
    },
    releaseReady: false,
    remainingReleaseGate: REMAINING_RELEASE_GATE,
  };
  evidence.evidenceSha256 = sha256(Buffer.from(canonicalJson(evidence)));

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(evidence, null, 2)}\n`);
  return Object.freeze({ outputFile, ...evidence });
}

export function verifyQualificationEvidence(value) {
  const evidence = typeof value === "string" ? JSON.parse(value) : value;
  assert(evidence?.formatVersion === 1, "unexpected evidence format");
  assert(evidence?.evidenceKind === "premiere-ai-harness-release-qualification-evidence", "unexpected evidence kind");
  assertText(evidence.pluginId, "pluginId");
  assertSemver(evidence.version, "version");
  assertHex(evidence.sourceCommit, 40, "source commit");
  assertHex(evidence.source?.treeSha256, 64, "source tree SHA-256");
  assertHex(evidence.source?.manifestSha256, 64, "source manifest SHA-256");
  assertHex(evidence.ccx?.sha256, 64, "CCX SHA-256");
  assertHex(evidence.ccx?.manifestSha256, 64, "CCX manifest SHA-256");
  assert(evidence.ccx?.installCandidate === true, "CCX must be an install candidate");
  assertHex(evidence.qualification?.recordSha256, 64, "qualification record SHA-256");
  assertHex(evidence.qualification?.sourceIdentitySha256, 64, "qualification source identity SHA-256");
  assert(/^tx1-\d+-[0-9a-f]{16}$/.test(String(evidence.qualification?.transcriptFingerprint || "")), "invalid transcript fingerprint");
  assert(evidence.gates?.sourceAndCcxLinked === true, "source/CCX link gate must pass");
  assert(evidence.gates?.hostQualificationPassed === true, "host qualification gate must pass");
  assert(evidence.gates?.persistenceVerified === true, "persistence gate must pass");
  assert(evidence.releaseReady === false, "qualification evidence alone may not claim release readiness");
  assert(evidence.remainingReleaseGate === REMAINING_RELEASE_GATE, "remaining release gate is missing");
  const copy = structuredClone(evidence);
  const digest = String(copy.evidenceSha256 || "");
  delete copy.evidenceSha256;
  assertHex(digest, 64, "evidence SHA-256");
  assert(digest === sha256(Buffer.from(canonicalJson(copy))), "evidence SHA-256 does not match content");
  return Object.freeze(evidence);
}

function validateInputs(source, ccx, qualification, version) {
  assert(source?.formatVersion === 1 && source?.packageKind === "unsigned-uxp-source-directory", "invalid source manifest");
  assert(source.version === version, "source manifest version differs from package version");
  assertText(source.pluginId, "source plugin id");
  assertHex(source.treeSha256, 64, "source tree SHA-256");

  assert(ccx?.formatVersion === 1 && ccx?.packageKind === "uxp-ccx-install-candidate", "invalid CCX manifest");
  assert(ccx.pluginId === source.pluginId && ccx.version === version, "CCX identity differs from source manifest");
  assert(ccx.sourceTreeSha256 === source.treeSha256, "CCX source tree differs from source manifest");
  assertHex(String(ccx.sourceCommit || "").toLowerCase(), 40, "CCX source commit");
  assertHex(ccx.sha256, 64, "CCX SHA-256");
  assert(Number.isInteger(ccx.bytes) && ccx.bytes > 0, "invalid CCX byte count");
  assert(ccx.installCandidate === true, "CCX manifest is not an install candidate");

  assert(qualification?.formatVersion === 2 && qualification?.status === "PASS", "qualification report is not PASS");
  assert(qualification.productVersion === version, "qualification product version differs from package version");
  assertText(qualification.environmentFingerprint, "qualification environment fingerprint");
  assertText(qualification.selection?.projectId, "qualification project id");
  assertText(qualification.selection?.clipId, "qualification clip id");
  assert(Number.isFinite(Number(qualification.selection?.duration)) && Number(qualification.selection.duration) > 0, "invalid qualification duration");
  assert(Number.isFinite(Number(qualification.selection?.frameRate)) && Number(qualification.selection.frameRate) > 0, "invalid qualification frame rate");
  for (const name of REQUIRED_STEPS) assert(qualification.steps?.[name]?.status === "PASS", `qualification step is not PASS: ${name}`);
  const transcriptFingerprint = qualification.steps.premiereTranscript.fingerprint;
  assert(/^tx1-\d+-[0-9a-f]{16}$/.test(String(transcriptFingerprint || "")), "invalid qualification transcript fingerprint");
  assert(qualification.steps.roughCut.transcriptFingerprint === transcriptFingerprint, "qualification transcript provenance mismatch");
  assert(qualification.steps.roughCut.persistenceSnapshot, "qualification persistence snapshot is missing");
  assertText(qualification.steps.persistence.verifiedSessionId, "qualification persistence session id");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function requiredPath(value, label) { const text = String(value || "").trim(); if (!text) throw new Error(`${label} path is required`); return text; }
function assertText(value, label) { assert(Boolean(String(value || "").trim()), `${label} is required`); }
function assertHex(value, length, label) { assert(new RegExp(`^[0-9a-f]{${length}}$`).test(String(value || "")), `invalid ${label}`); }
function assertSemver(value, label) { assert(/^\d+\.\d+\.\d+$/.test(String(value || "")), `invalid ${label}`); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function defaultSourceManifest(version) { return path.join(root, "dist", `PremiereAIHarness-Core-${version}-uxp-source.manifest.json`); }
function defaultCcxManifest(version) { return path.join(root, "dist", `PremiereAIHarness-Core-${version}-premierepro.ccx.manifest.json`); }
function defaultOutputFile(version) { return path.join(root, "dist", `PremiereAIHarness-Core-${version}-qualification-evidence.json`); }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = buildQualificationEvidence({
    qualificationFile: process.argv[2],
    sourceManifestFile: process.argv[3],
    ccxManifestFile: process.argv[4],
    outputFile: process.argv[5],
  });
  verifyQualificationEvidence(evidence);
  console.log(`EVIDENCE PASS: ${path.basename(evidence.outputFile)} sha256:${evidence.evidenceSha256} releaseReady:${evidence.releaseReady}`);
}
