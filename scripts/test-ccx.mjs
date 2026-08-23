import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCcx } from "./build-ccx.mjs";
import { inspectCcx, verifyCcxAgainstDirectory } from "./ccx-format.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pai-ccx-test-"));
try {
  const first = buildCcx({ sourceDirectory: path.join(temp, "source-one"), outputFile: path.join(temp, "one.ccx"), sourceCommit: "test-commit" });
  const second = buildCcx({ sourceDirectory: path.join(temp, "source-two"), outputFile: path.join(temp, "two.ccx"), sourceCommit: "test-commit" });

  assert.equal(first.sha256, second.sha256, "CCX bytes must be deterministic");
  assert.deepEqual(fs.readFileSync(first.outputFile), fs.readFileSync(second.outputFile), "CCX files must be byte-identical");
  assert.equal(first.packageKind, "uxp-ccx-install-candidate");
  assert.equal(first.installCandidate, true);
  assert.equal(first.installVerified, false);
  assert.equal(first.distributionReady, false);
  assert.equal(first.sourceTreeSha256, first.source.treeSha256);
  assert.equal(first.sourceCommit, "test-commit");

  const inspected = verifyCcxAgainstDirectory(first.outputFile, first.source.outputDirectory);
  assert.equal(inspected.entries[0].localOffset, 0);
  assert.ok(inspected.entries.every((entry) => (entry.flags & 0x0009) === 0), "CCX must be unencrypted and descriptor-free");
  assert.ok(inspected.entries.every((entry) => [0, 8].includes(entry.method)));
  assert.equal(inspected.entries.filter((entry) => entry.name === "manifest.json").length, 1);

  const manifest = JSON.parse(fs.readFileSync(path.join(first.source.outputDirectory, "manifest.json"), "utf8"));
  assert.equal(manifest.version, first.version);
  assert.equal(manifest.host.app, "premierepro");
  assert.equal(Array.isArray(manifest.host), false, "distribution manifest must target one host object");

  const appended = path.join(temp, "trailing.ccx");
  fs.copyFileSync(first.outputFile, appended);
  fs.appendFileSync(appended, Buffer.from([0]));
  assert.throws(() => inspectCcx(appended), /trailing bytes/);

  const descriptor = path.join(temp, "descriptor.ccx");
  const mutated = fs.readFileSync(first.outputFile);
  mutated.writeUInt16LE(mutated.readUInt16LE(6) | 0x0008, 6);
  fs.writeFileSync(descriptor, mutated);
  assert.throws(() => inspectCcx(descriptor), /data descriptors|flags differ/);

  console.log(`CCX TEST PASS: ${inspected.entries.length} files, deterministic sha256:${first.sha256}`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
