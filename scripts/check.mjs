import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(root, "plugin");
const manifest = readJson(path.join(pluginDir, "manifest.json"));
const packageJson = readJson(path.join(root, "package.json"));

assert(manifest.manifestVersion === 5, "manifestVersion must be 5");
assert(manifest.id === "com.andongmin.premiere-ai-harness.core", "unexpected plugin id");
assert(/^\d+\.\d+\.\d+$/.test(manifest.version), "manifest version must be semver");
assert(packageJson.version === manifest.version, "package and manifest versions differ");
assert(manifest.host?.app === "premierepro", "host must be premierepro");
assert(compareVersions(manifest.host?.minVersion || "0", "26.3.0") >= 0, "Premiere 26.3+ is required");
assert(Array.isArray(manifest.entrypoints) && manifest.entrypoints.length === 1, "exactly one panel entrypoint is required");
assert(manifest.entrypoints[0].id === "premiere-ai-harness-panel", "unexpected panel id");
assert(manifest.main === "index.html", "main must be index.html");
assert(!manifest.requiredPermissions, "Core plugin must not request external permissions");

const jsFiles = walk(root).filter((file) => /\.(?:js|mjs)$/.test(file) && !isIgnored(file));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`JavaScript syntax failed: ${relative(file)}\n${result.stderr}`);
}

const html = read(path.join(pluginDir, "index.html"));
const indexJs = read(path.join(pluginDir, "index.js"));
const pluginJsText = walk(pluginDir).filter((file) => file.endsWith(".js")).map(read).join("\n");
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const referencedIds = new Set([...pluginJsText.matchAll(/\b(?:byId|bind)\("([^"]+)"/g)].map((match) => match[1]));
for (const id of referencedIds) assert(htmlIds.has(id), `plugin JavaScript references missing DOM id: ${id}`);

const scriptSources = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
const expectedScripts = [
  "lib/transcript.js", "lib/planner.js", "lib/host-certification.js", "lib/host-qualification.js",
  "lib/session-state.js", "lib/premiere-runtime.js", "lib/generated-assets.js", "lib/generated-cleanup.js",
  "lib/premiere-adapter.js", "lib/qualification-flow.js", "lib/editor-flow.js", "lib/ui-view.js", "index.js",
];
assert(JSON.stringify(scriptSources) === JSON.stringify(expectedScripts), "index.html script order is incorrect");
for (const source of scriptSources) assert(fs.existsSync(path.join(pluginDir, source)), `missing script: ${source}`);
for (const href of [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((match) => match[1])) {
  assert(fs.existsSync(path.join(pluginDir, href)), `missing stylesheet: ${href}`);
}
assert(html.includes(`>${manifest.version}<`), "visible panel version does not match manifest version");
assert(indexJs.includes("entrypoints.setup"), "UXP entrypoints.setup registration is missing");
assert(indexJs.includes(manifest.entrypoints[0].id), "controller panel id differs from manifest");

const pluginText = walk(pluginDir).filter((file) => /\.(?:js|html|json|css)$/.test(file)).map(read).join("\n");
for (const forbidden of [
  "eval(", "new Function", "child_process", "Invoke-WebRequest", "winget install",
  "localhost", "127.0.0.1", "localStorage.clear(", "confirm(", "alert(",
]) assert(!pluginText.includes(forbidden), `forbidden runtime dependency or unsafe construct: ${forbidden}`);
assert(!/\bfetch\s*\(/.test(pluginText), "Core plugin must remain offline and may not call network fetch");

for (const file of ["README.md", "STATUS.md", "docs/STATUS.md", "plugin/README.txt"]) {
  assert(read(path.join(root, file)).includes(manifest.version), `${file} does not mention current version ${manifest.version}`);
}
for (const obsolete of [
  "helper", "tools", ".bootstrap", "audit", "temp", "scripts/lib/zip.mjs",
  ".github/workflows/audit-source-export.yml", ".github/workflows/export-source-temp.yml",
  ".github/workflows/offline-kit-ci.yml",
  ".github/workflows/pre-premiere-e2e.yml", ".github/workflows/host-gate-ci.yml",
]) assert(!fs.existsSync(path.join(root, obsolete)), `obsolete path must be removed: ${obsolete}`);

validateReceipt();
checkAdobeContract(pluginText);
console.log(`CHECK PASS: ${jsFiles.length} JavaScript files, ${htmlIds.size} DOM ids, Adobe 26.3 contract, version ${manifest.version}`);

function validateReceipt() {
  const reportsDir = path.join(root, "reports");
  if (!fs.existsSync(reportsDir)) return;
  const entries = fs.readdirSync(reportsDir).sort();
  assert(JSON.stringify(entries) === JSON.stringify(["product-ci.json"]), "reports may contain only product-ci.json");
  const receipt = readJson(path.join(reportsDir, "product-ci.json"));
  assert(receipt.formatVersion === 1, "CI receipt format is invalid");
  assert(receipt.version === manifest.version, "CI receipt version differs from the product version");
  assert(["PENDING", "PASS", "FAIL"].includes(receipt.status), "CI receipt status is invalid");
  if (receipt.status === "PASS") {
    assert(receipt.packageKind === "unsigned-uxp-source-directory", "CI receipt package kind is invalid");
    assert(receipt.installable === false, "unsigned source must not be marked installable");
    assert(/^[a-f0-9]{64}$/.test(receipt.treeSha256 || ""), "CI receipt tree SHA-256 is invalid");
    assert(typeof receipt.verifiedCommit === "string" && receipt.verifiedCommit.length >= 7, "CI receipt commit is missing");
  }
  if (receipt.status === "PENDING") assert(typeof receipt.reason === "string" && receipt.reason.length > 0, "pending CI receipt needs a reason");
}

function checkAdobeContract(text) {
  const contract = readJson(path.join(root, "vendor", "adobe", "premierepro-26.3.0", "api-contract.json"));
  assert(contract.host === "premierepro" && contract.version === "26.3.0", "unexpected Adobe contract version");
  const requiredTokens = {
    "Project.getActiveProject": "ppro.Project.getActiveProject",
    "ProjectUtils.getSelection": "ppro.ProjectUtils.getSelection",
    "ClipProjectItem.cast": "ppro.ClipProjectItem",
    "FolderItem.cast": "ppro.FolderItem",
    "Transcript.hasTranscript": "ppro.Transcript.hasTranscript",
    "Transcript.exportToJSON": "ppro.Transcript.exportToJSON",
    "TickTime.createWithFrameAndFrameRate": "ppro.TickTime.createWithFrameAndFrameRate",
    "FrameRate.createWithValue": "ppro.FrameRate.createWithValue",
    "ClipProjectItem.createSubClipAction": "createSubClipAction",
    "FolderItem.createBinAction": "createBinAction",
    "FolderItem.createMoveItemAction": "createMoveItemAction",
    "FolderItem.createRemoveItemAction": "createRemoveItemAction",
    "Project.createSequenceFromMedia": "createSequenceFromMedia",
    "Project.getSequences": "getSequences",
    "Project.setActiveSequence": "setActiveSequence",
    "Project.deleteSequence": "deleteSequence",
    "Project.closeSequence": "closeSequence",
    "Project.executeTransaction": "executeTransaction",
    "Project.lockedAccess": "lockedAccess",
    "CompoundAction.addAction": "addAction",
  };
  for (const [name, token] of Object.entries(requiredTokens)) {
    assert(contract.required.includes(name), `Adobe contract missing: ${name}`);
    assert(text.includes(token), `plugin no longer exercises declared API: ${name}`);
  }
}

function read(file) { return fs.readFileSync(file, "utf8"); }
function readJson(file) { return JSON.parse(read(file)); }
function relative(file) { return path.relative(root, file).replace(/\\/g, "/"); }
function isIgnored(file) { return file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}dist${path.sep}`); }
function walk(start) {
  const output = [];
  for (const entry of fs.readdirSync(start, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
    const full = path.join(start, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}
function compareVersions(left, right) {
  const first = String(left).split(".").map(Number);
  const second = String(right).split(".").map(Number);
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    const delta = (first[index] || 0) - (second[index] || 0);
    if (delta) return delta;
  }
  return 0;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
