import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyQualificationEvidence } from "./build-qualification-evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERIFICATION_KIND = "premiere-ai-harness-creative-cloud-distribution-verification";
const EVENT_NAMES = Object.freeze(["install", "update", "removal"]);

export function initDistributionVerificationWorkspace(options = {}) {
  const qualificationEvidenceFile = path.resolve(requiredPath(options.qualificationEvidenceFile, "qualification evidence"));
  const previousVersion = requiredSemver(options.previousVersion, "previous version");
  const workspaceDirectory = path.resolve(requiredPath(options.workspaceDirectory, "workspace directory"));
  const qualification = verifyQualificationEvidence(readJson(qualificationEvidenceFile));
  if (previousVersion === qualification.version) throw new Error("previous version must differ from the current candidate version");
  assertOutsideRepository(workspaceDirectory);
  prepareEmptyDirectory(workspaceDirectory);
  for (const name of EVENT_NAMES) fs.mkdirSync(path.join(workspaceDirectory, name), { recursive: true });

  const verification = {
    formatVersion: 1,
    evidenceKind: VERIFICATION_KIND,
    verificationId: `distribution-${qualification.version}-${qualification.sourceCommit.slice(0, 12)}`,
    method: "creative-cloud-desktop",
    sellerAttested: false,
    pluginId: qualification.pluginId,
    version: qualification.version,
    sourceCommit: qualification.sourceCommit,
    ccxSha256: qualification.ccx.sha256,
    events: {
      install: {
        status: "PENDING",
        method: "creative-cloud-desktop",
        completedAt: "",
        version: qualification.version,
        panelVisible: false,
        evidenceFiles: [],
      },
      update: {
        status: "PENDING",
        method: "creative-cloud-desktop",
        completedAt: "",
        fromVersion: previousVersion,
        toVersion: qualification.version,
        samePluginId: false,
        panelVisible: false,
        evidenceFiles: [],
      },
      removal: {
        status: "PENDING",
        method: "creative-cloud-desktop",
        completedAt: "",
        version: qualification.version,
        panelAbsent: false,
        pluginOwnedResidualDataFound: null,
        evidenceFiles: [],
      },
    },
  };
  const verificationFile = path.join(workspaceDirectory, "distribution-verification.json");
  fs.writeFileSync(verificationFile, `${JSON.stringify(verification, null, 2)}\n`);
  const instructionsFile = path.join(workspaceDirectory, "README.txt");
  fs.writeFileSync(instructionsFile, instructionsText(qualification.version, previousVersion));
  return Object.freeze({
    workspaceDirectory,
    verificationFile,
    instructionsFile,
    qualificationEvidenceFile,
    pluginId: qualification.pluginId,
    version: qualification.version,
    previousVersion,
    sourceCommit: qualification.sourceCommit,
    ccxSha256: qualification.ccx.sha256,
  });
}

function prepareEmptyDirectory(directory) {
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("workspace path must be a real directory");
    if (fs.readdirSync(directory).length > 0) throw new Error("workspace directory must not already contain files");
    return;
  }
  fs.mkdirSync(directory, { recursive: true });
}

function assertOutsideRepository(directory) {
  const relative = path.relative(root, directory);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("distribution verification workspace must be outside the repository");
  }
}

function instructionsText(version, previousVersion) {
  return [
    `Premiere AI Harness Core ${version} distribution verification workspace`,
    "",
    "1. Put install proof files under install/.",
    `2. Verify update from ${previousVersion} to ${version} for the same plugin ID and put proof files under update/.`,
    "3. Remove the current candidate, confirm the panel is absent and no plugin-owned residual data remains, then put proof files under removal/.",
    "4. Edit distribution-verification.json only after each real check: set the event to PASS, add completedAt and relative evidenceFiles, and set the observed booleans.",
    "5. After all three checks really pass, set sellerAttested to true.",
    "6. Run npm run evidence:distribution with this JSON, the qualification evidence, and the exact CCX file.",
    "",
    "Do not put this workspace inside the repository and do not mark a check PASS before it is actually performed.",
    "",
  ].join("\n");
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function requiredPath(value, label) { const text = String(value || "").trim(); if (!text) throw new Error(`${label} path is required`); return text; }
function requiredSemver(value, label) { const text = String(value || "").trim(); if (!/^\d+\.\d+\.\d+$/.test(text)) throw new Error(`${label} must be semver`); return text; }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = initDistributionVerificationWorkspace({
    qualificationEvidenceFile: process.argv[2],
    previousVersion: process.argv[3],
    workspaceDirectory: process.argv[4],
  });
  console.log(`DISTRIBUTION WORKSPACE READY: ${result.workspaceDirectory}`);
}
