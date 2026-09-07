import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyQualificationEvidence } from "./build-qualification-evidence.mjs";

const EVENT_NAMES = Object.freeze(["install", "update", "removal"]);
const MAX_EVIDENCE_FILES = 20;
const MAX_EVIDENCE_BYTES = 50 * 1024 * 1024;
const MAX_CCX_BYTES = 1024 * 1024 * 1024;
const VERIFICATION_KIND = "premiere-ai-harness-creative-cloud-distribution-verification";
const EVIDENCE_KIND = "premiere-ai-harness-final-distribution-evidence";

export function buildDistributionEvidence(options = {}) {
  const qualificationEvidenceFile = path.resolve(requiredPath(options.qualificationEvidenceFile, "qualification evidence"));
  const verificationFile = path.resolve(requiredPath(options.verificationFile, "distribution verification"));
  const ccxFile = path.resolve(requiredPath(options.ccxFile, "CCX file"));
  const qualificationEvidence = verifyQualificationEvidence(readJson(qualificationEvidenceFile));
  const outputFile = path.resolve(options.outputFile || defaultOutputFile(qualificationEvidence.version));
  const verification = readJson(verificationFile);
  const ccx = inspectFile(ccxFile, null, MAX_CCX_BYTES);
  validateVerification(verification, qualificationEvidence, ccx);

  const verificationDirectory = path.dirname(verificationFile);
  const events = Object.fromEntries(EVENT_NAMES.map((name) => [
    name,
    normalizeEvent(name, verification.events[name], verificationDirectory, qualificationEvidence.version),
  ]));
  const evidence = {
    formatVersion: 1,
    evidenceKind: EVIDENCE_KIND,
    assurance: "seller-recorded-manual-distribution-verification",
    adobeAttestation: false,
    pluginId: qualificationEvidence.pluginId,
    version: qualificationEvidence.version,
    sourceCommit: qualificationEvidence.sourceCommit,
    qualificationEvidence: {
      file: path.basename(qualificationEvidenceFile),
      sha256: sha256(fs.readFileSync(qualificationEvidenceFile)),
      evidenceSha256: qualificationEvidence.evidenceSha256,
    },
    ccx: {
      file: path.basename(ccxFile),
      bytes: ccx.bytes,
      sha256: ccx.sha256,
    },
    distributionVerification: {
      recordFile: path.basename(verificationFile),
      recordSha256: sha256(Buffer.from(canonicalJson(verification))),
      verificationId: requiredText(verification.verificationId, "verificationId"),
      method: "creative-cloud-desktop",
      sellerAttested: true,
      events,
    },
    gates: {
      qualificationEvidencePassed: true,
      exactCcxMatched: true,
      installPassed: true,
      updatePassed: true,
      removalPassed: true,
      evidenceFilesHashed: true,
    },
    releaseReady: true,
  };
  evidence.evidenceSha256 = sha256(Buffer.from(canonicalJson(evidence)));
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(evidence, null, 2)}\n`);
  return Object.freeze({ outputFile, ...evidence });
}

export function verifyDistributionEvidence(value) {
  const evidence = typeof value === "string" ? JSON.parse(value) : value;
  assert(evidence?.formatVersion === 1 && evidence?.evidenceKind === EVIDENCE_KIND, "unexpected distribution evidence format");
  assert(evidence.assurance === "seller-recorded-manual-distribution-verification", "unexpected distribution evidence assurance");
  assert(evidence.adobeAttestation === false, "distribution evidence must not claim Adobe attestation");
  assertText(evidence.pluginId, "pluginId");
  assertSemver(evidence.version, "version");
  assertHex(evidence.sourceCommit, 40, "source commit");
  assertHex(evidence.qualificationEvidence?.sha256, 64, "qualification evidence SHA-256");
  assertHex(evidence.qualificationEvidence?.evidenceSha256, 64, "qualification evidence content SHA-256");
  assertHex(evidence.ccx?.sha256, 64, "CCX SHA-256");
  assert(Number.isInteger(evidence.ccx?.bytes) && evidence.ccx.bytes > 0 && evidence.ccx.bytes <= MAX_CCX_BYTES, "invalid CCX byte count");
  assertHex(evidence.distributionVerification?.recordSha256, 64, "distribution verification record SHA-256");
  assert(evidence.distributionVerification?.method === "creative-cloud-desktop", "unexpected distribution verification method");
  assert(evidence.distributionVerification?.sellerAttested === true, "seller attestation is missing");
  for (const name of EVENT_NAMES) validateStoredEvent(name, evidence.distributionVerification?.events?.[name], evidence.version);
  for (const name of ["qualificationEvidencePassed", "exactCcxMatched", "installPassed", "updatePassed", "removalPassed", "evidenceFilesHashed"]) {
    assert(evidence.gates?.[name] === true, `distribution gate is not PASS: ${name}`);
  }
  assert(evidence.releaseReady === true, "complete distribution evidence must be releaseReady");
  const copy = structuredClone(evidence);
  const digest = String(copy.evidenceSha256 || "");
  delete copy.evidenceSha256;
  assertHex(digest, 64, "distribution evidence SHA-256");
  assert(digest === sha256(Buffer.from(canonicalJson(copy))), "distribution evidence SHA-256 does not match content");
  return Object.freeze(evidence);
}

function validateVerification(value, qualification, ccx) {
  assert(value?.formatVersion === 1 && value?.evidenceKind === VERIFICATION_KIND, "invalid distribution verification record");
  assert(value.method === "creative-cloud-desktop", "distribution verification must use Creative Cloud Desktop");
  assert(value.pluginId === qualification.pluginId, "distribution verification plugin differs from qualification evidence");
  assert(value.version === qualification.version, "distribution verification version differs from qualification evidence");
  assert(String(value.sourceCommit || "").toLowerCase() === qualification.sourceCommit, "distribution verification commit differs from qualification evidence");
  assert(String(value.ccxSha256 || "").toLowerCase() === qualification.ccx.sha256, "distribution verification CCX SHA-256 differs from qualification evidence");
  assert(ccx.sha256 === qualification.ccx.sha256, "actual CCX file does not match qualification evidence");
  assert(ccx.bytes === qualification.ccx.bytes, "actual CCX byte count does not match qualification evidence");
  assertText(value.verificationId, "verificationId");
  assert(value.sellerAttested === true, "sellerAttested must be true");
  for (const name of EVENT_NAMES) assert(value.events?.[name]?.status === "PASS", `distribution event is not PASS: ${name}`);
}

function normalizeEvent(name, value, baseDirectory, version) {
  assert(value?.status === "PASS", `${name} event is not PASS`);
  assert(value.method === "creative-cloud-desktop", `${name} event must use Creative Cloud Desktop`);
  const completedAt = validTimestamp(value.completedAt, `${name} completedAt`);
  if (name === "install") {
    assert(value.version === version && value.panelVisible === true, "install verification is incomplete");
  } else if (name === "update") {
    assertSemver(value.fromVersion, "update fromVersion");
    assert(value.fromVersion !== version && value.toVersion === version, "update version path is invalid");
    assert(value.samePluginId === true && value.panelVisible === true, "update verification is incomplete");
  } else {
    assert(value.version === version && value.panelAbsent === true, "removal verification is incomplete");
    assert(value.pluginOwnedResidualDataFound === false, "plugin-owned residual data remains after removal");
  }
  const evidenceFiles = inspectEvidenceFiles(value.evidenceFiles, baseDirectory, name);
  return Object.freeze({
    status: "PASS",
    completedAt,
    ...(name === "install" ? { version, panelVisible: true } : {}),
    ...(name === "update" ? { fromVersion: value.fromVersion, toVersion: version, samePluginId: true, panelVisible: true } : {}),
    ...(name === "removal" ? { version, panelAbsent: true, pluginOwnedResidualDataFound: false } : {}),
    evidenceFiles,
  });
}

function inspectEvidenceFiles(value, baseDirectory, label) {
  assert(Array.isArray(value) && value.length > 0 && value.length <= MAX_EVIDENCE_FILES, `${label} evidenceFiles must contain 1-${MAX_EVIDENCE_FILES} files`);
  const names = new Set();
  return Object.freeze(value.map((entry, index) => {
    const relative = String(entry || "").trim();
    assert(relative && !path.isAbsolute(relative), `${label} evidence file ${index + 1} must be a relative path`);
    const resolved = path.resolve(baseDirectory, relative);
    const rootPrefix = `${path.resolve(baseDirectory)}${path.sep}`;
    assert(resolved.startsWith(rootPrefix), `${label} evidence file escapes the verification directory`);
    const canonicalRelative = path.relative(baseDirectory, resolved);
    const file = inspectFile(resolved, canonicalRelative, MAX_EVIDENCE_BYTES);
    assert(!names.has(file.file), `${label} evidence file name is duplicated`);
    names.add(file.file);
    return Object.freeze(file);
  }));
}

function inspectFile(file, displayName, maxBytes) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), `evidence path is not a regular file: ${file}`);
  assert(stat.size > 0 && stat.size <= maxBytes, `evidence file size is invalid: ${file}`);
  return {
    file: displayName ? normalizeRelative(displayName) : path.basename(file),
    bytes: stat.size,
    sha256: sha256(fs.readFileSync(file)),
  };
}

function validateStoredEvent(name, value, version) {
  assert(value?.status === "PASS", `invalid stored ${name} event`);
  validTimestamp(value.completedAt, `${name} completedAt`);
  assert(Array.isArray(value.evidenceFiles) && value.evidenceFiles.length > 0 && value.evidenceFiles.length <= MAX_EVIDENCE_FILES, `stored ${name} evidence files are invalid`);
  for (const file of value.evidenceFiles) {
    const filename = requiredText(file.file, `${name} evidence file`);
    assert(!path.isAbsolute(filename) && !normalizeRelative(filename).split("/").includes(".."), `invalid stored ${name} evidence path`);
    assert(Number.isInteger(file.bytes) && file.bytes > 0 && file.bytes <= MAX_EVIDENCE_BYTES, `invalid ${name} evidence byte count`);
    assertHex(file.sha256, 64, `${name} evidence SHA-256`);
  }
  if (name === "install") assert(value.version === version && value.panelVisible === true, "stored install event is incomplete");
  if (name === "update") {
    assertSemver(value.fromVersion, "stored update fromVersion");
    assert(value.toVersion === version && value.fromVersion !== version && value.samePluginId === true && value.panelVisible === true, "stored update event is incomplete");
  }
  if (name === "removal") assert(value.version === version && value.panelAbsent === true && value.pluginOwnedResidualDataFound === false, "stored removal event is incomplete");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function requiredPath(value, label) { const text = String(value || "").trim(); if (!text) throw new Error(`${label} path is required`); return text; }
function requiredText(value, label) { const text = String(value || "").trim(); if (!text) throw new Error(`${label} is required`); return text; }
function validTimestamp(value, label) { const text = requiredText(value, label); if (Number.isNaN(Date.parse(text))) throw new Error(`${label} is invalid`); return text; }
function assertText(value, label) { requiredText(value, label); }
function assertHex(value, length, label) { assert(new RegExp(`^[0-9a-f]{${length}}$`).test(String(value || "").toLowerCase()), `invalid ${label}`); }
function assertSemver(value, label) { assert(/^\d+\.\d+\.\d+$/.test(String(value || "")), `invalid ${label}`); }
function normalizeRelative(value) { return String(value).replace(/\\/g, "/"); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function defaultOutputFile(version) { return path.join(process.cwd(), "dist", `PremiereAIHarness-Core-${version}-distribution-evidence.json`); }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = buildDistributionEvidence({
    qualificationEvidenceFile: process.argv[2],
    verificationFile: process.argv[3],
    ccxFile: process.argv[4],
    outputFile: process.argv[5],
  });
  verifyDistributionEvidence(evidence);
  console.log(`DISTRIBUTION EVIDENCE PASS: ${path.basename(evidence.outputFile)} sha256:${evidence.evidenceSha256} releaseReady:${evidence.releaseReady}`);
}
