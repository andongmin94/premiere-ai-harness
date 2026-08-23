import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(root, "plugin");
const manifestPath = path.join(pluginDir, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

assert(manifest.manifestVersion === 5, "manifestVersion must be 5");
assert(manifest.id === "com.andongmin.premiere-ai-harness.core", "unexpected plugin id");
assert(/^\d+\.\d+\.\d+$/.test(manifest.version), "version must be semver");
assert(manifest.host?.app === "premierepro", "host must be premierepro");
assert(compareVersions(manifest.host?.minVersion || "0", "26.3.0") >= 0, "Premiere 26.3+ is required");
assert(Array.isArray(manifest.entrypoints) && manifest.entrypoints.length === 1, "exactly one panel entrypoint is required");
assert(manifest.main === "index.html", "main must be index.html");

const jsFiles = walk(root).filter((file) => /\.(?:js|mjs)$/.test(file) && !file.includes(`${path.sep}dist${path.sep}`));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`JavaScript syntax failed: ${path.relative(root, file)}\n${result.stderr}`);
}

const html = fs.readFileSync(path.join(pluginDir, "index.html"), "utf8");
const indexJs = fs.readFileSync(path.join(pluginDir, "index.js"), "utf8");
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const referencedIds = new Set([...indexJs.matchAll(/\bbyId\("([^"]+)"\)/g)].map((match) => match[1]));
for (const id of referencedIds) assert(htmlIds.has(id), `index.js references missing DOM id: ${id}`);
for (const src of [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1])) {
  assert(fs.existsSync(path.join(pluginDir, src)), `missing script referenced by index.html: ${src}`);
}
for (const href of [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((match) => match[1])) {
  assert(fs.existsSync(path.join(pluginDir, href)), `missing stylesheet referenced by index.html: ${href}`);
}
assert(html.includes(`>${manifest.version}<`), "visible panel version does not match manifest version");

const pluginText = walk(pluginDir).filter((file) => /\.(?:js|html|json|css)$/.test(file)).map((file) => fs.readFileSync(file, "utf8")).join("\n");
for (const forbidden of ["eval(", "new Function", "child_process", "Invoke-WebRequest", "winget install", "localhost", "127.0.0.1"]) {
  assert(!pluginText.includes(forbidden), `forbidden runtime dependency or unsafe construct: ${forbidden}`);
}
assert(!/\bfetch\s*\(/.test(pluginText), "Core plugin must remain offline and may not call network fetch");
assert(!manifest.requiredPermissions, "Core plugin must not request external permissions");
for (const obsolete of [
  "helper", "tools/qualification-runner", "tools/host-gate",
  ".github/workflows/offline-kit-ci.yml", ".github/workflows/pre-premiere-e2e.yml",
  ".github/workflows/host-gate-ci.yml"
]) assert(!fs.existsSync(path.join(root, obsolete)), `obsolete product path must be removed: ${obsolete}`);

checkAdobeContract();
console.log(`CHECK PASS: ${jsFiles.length} JavaScript files, ${htmlIds.size} DOM ids, Adobe 26.3 contract`);

function checkAdobeContract() {
  const contract = JSON.parse(fs.readFileSync(path.join(root, "vendor", "adobe", "premierepro-26.3.0", "api-contract.json"), "utf8"));
  assert(contract.host === "premierepro" && contract.version === "26.3.0", "unexpected Adobe contract version");
  assert(Array.isArray(contract.required) && contract.required.length >= 20, "Adobe contract is incomplete");
  const adapter = fs.readFileSync(path.join(pluginDir, "lib", "premiere-adapter.js"), "utf8");
  const requiredTokens = {
    "Project.getActiveProject": "ppro.Project.getActiveProject",
    "ProjectUtils.getSelection": "ppro.ProjectUtils.getSelection",
    "ClipProjectItem.cast": "ppro.ClipProjectItem.cast",
    "FolderItem.cast": "ppro.FolderItem.cast",
    "Transcript.hasTranscript": "ppro.Transcript.hasTranscript",
    "Transcript.exportToJSON": "ppro.Transcript.exportToJSON",
    "TickTime.createWithFrameAndFrameRate": "ppro.TickTime.createWithFrameAndFrameRate",
    "FrameRate.createWithValue": "ppro.FrameRate.createWithValue",
    "Project.getActiveSequence": "project.getActiveSequence",
    "Project.getRootItem": "project.getRootItem"
  };
  for (const [name, token] of Object.entries(requiredTokens)) {
    assert(contract.required.includes(name), `Adobe contract missing: ${name}`);
    assert(adapter.includes(token), `Premiere adapter no longer exercises declared API: ${name}`);
  }
  for (const name of [
    "ProjectItemSelection.getItems", "ClipProjectItem.getMedia", "ClipProjectItem.getFootageInterpretation",
    "ClipProjectItem.createSubClipAction", "ClipProjectItem.getParentBin", "FolderItem.createBinAction",
    "FolderItem.getItems", "FolderItem.createMoveItemAction", "FolderItem.createRemoveItemAction",
    "Project.createSequenceFromMedia", "Project.getSequences", "Project.setActiveSequence",
    "Project.deleteSequence", "Project.closeSequence", "Project.getActiveSequence", "Project.getRootItem", "Project.executeTransaction",
    "Project.lockedAccess", "CompoundAction.addAction"
  ]) assert(contract.required.includes(name), `Adobe contract missing: ${name}`);
}

function walk(start) {
  const output = [];
  for (const entry of fs.readdirSync(start, { withFileTypes: true })) {
    const full = path.join(start, entry.name);
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
    if (entry.isDirectory()) output.push(...walk(full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

function compareVersions(left, right) {
  const a = String(left).split(".").map(Number);
  const b = String(right).split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta) return delta;
  }
  return 0;
}

function assert(condition, message) { if (!condition) throw new Error(message); }
