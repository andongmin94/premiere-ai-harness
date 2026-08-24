import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeTextForPackage, packagePlugin } from "./package-plugin.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pai-package-test-"));
assert.equal(normalizeTextForPackage("a\r\nb\rc\n"), "a\nb\nc\n", "text packaging must normalize CRLF and CR to LF");
try {
  const first = packagePlugin(path.join(temp, "one"));
  const second = packagePlugin(path.join(temp, "two"));
  assert.equal(first.treeSha256, second.treeSha256, "source package must be deterministic");
  assert.equal(first.packageKind, "unsigned-uxp-source-directory");
  assert.equal(first.installable, false);
  assert.equal(first.requiresAdobeUxpDeveloperToolPackaging, true);

  const expected = [
    "LICENSE", "NOTICE", "README.txt", "index.html", "index.js",
    "lib/generated-assets.js", "lib/generated-cleanup.js", "lib/host-certification.js", "lib/planner.js",
    "lib/premiere-adapter.js", "lib/premiere-runtime.js", "lib/session-state.js",
    "lib/transcript.js", "lib/ui-view.js", "manifest.json", "styles.css",
  ];
  assert.deepEqual(first.entries.map((entry) => entry.path), expected.sort((left, right) => left.localeCompare(right, "en")));
  const manifest = JSON.parse(fs.readFileSync(path.join(first.outputDirectory, "manifest.json"), "utf8"));
  assert.equal(manifest.version, "0.3.1");
  assert.equal(manifest.id, "com.andongmin.premiere-ai-harness.core");
  assert.equal(fs.readdirSync(temp).some((name) => name.endsWith(".ccx")), false);
  console.log(`PACKAGE TEST PASS: ${first.entries.length} files, deterministic tree-sha256:${first.treeSha256}`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
