import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packagePlugin } from "./package-plugin.mjs";
import { readZipEntries } from "./lib/zip.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pai-package-test-"));
try {
  const first = path.join(temp, "one.ccx");
  const second = path.join(temp, "two.ccx");
  packagePlugin(first);
  packagePlugin(second);
  assert.equal(hash(first), hash(second), "CCX packaging must be deterministic");

  const entries = readZipEntries(first);
  const expected = [
    "LICENSE", "NOTICE", "README.txt", "index.html", "index.js", "lib/planner.js", "lib/premiere-adapter.js", "lib/transcript.js", "manifest.json", "styles.css",
  ];
  assert.deepEqual([...entries.keys()].sort(), expected.sort());
  const manifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
  assert.equal(manifest.id, "com.andongmin.premiere-ai-harness.core");
  assert.equal(manifest.host.app, "premierepro");
  assert.equal(manifest.host.minVersion, "26.3.0");
  assert.ok(entries.get("LICENSE").length > 1000);
  console.log(`PACKAGE TEST PASS: ${entries.size} entries, deterministic sha256:${hash(first)}`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
