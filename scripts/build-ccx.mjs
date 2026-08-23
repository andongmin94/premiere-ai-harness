import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packagePlugin } from "./package-plugin.mjs";
import { verifyCcxAgainstDirectory } from "./ccx-format.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXED_TIME = new Date("1980-01-01T00:00:00.000Z");

export function buildCcx(options = {}) {
  assert(process.platform !== "win32", "deterministic CCX packaging requires the POSIX Info-ZIP tool; use GitHub Actions or Adobe UXP Developer Tool on Windows");
  assertInfoZip();

  const source = packagePlugin(options.sourceDirectory);
  const outputFile = path.resolve(options.outputFile || defaultOutputFile(source.version));
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "pai-ccx-stage-"));
  try {
    copyDirectory(source.outputDirectory, stage);
    normalizeStage(stage);
    const files = listRelativeFiles(stage);
    assert(files.length === source.entries.length, "staged CCX file count differs from the source package");
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.rmSync(outputFile, { force: true });

    const result = spawnSync("zip", ["-X", "-D", "-q", "-9", outputFile, ...files], {
      cwd: stage,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Info-ZIP failed with exit code ${result.status}: ${result.stderr || result.stdout}`);

    const inspected = verifyCcxAgainstDirectory(outputFile, source.outputDirectory);
    const digest = inspected.sha256;
    const sidecar = {
      formatVersion: 1,
      packageKind: "uxp-ccx-install-candidate",
      pluginId: readJson(path.join(source.outputDirectory, "manifest.json")).id,
      version: source.version,
      host: "premierepro",
      sourceCommit: String(options.sourceCommit || process.env.GITHUB_SHA || "unverified-local"),
      sourceTreeSha256: source.treeSha256,
      file: path.basename(outputFile),
      bytes: inspected.bytes,
      sha256: digest,
      installCandidate: true,
      installVerified: false,
      distributionReady: false,
      archive: {
        format: "zip",
        fixedTimestamp: FIXED_TIME.toISOString(),
        dataDescriptors: false,
        encrypted: false,
      },
      entries: inspected.entries.map(({ name, bytes, compressedBytes, crc32, sha256, method }) => ({
        path: name,
        bytes,
        compressedBytes,
        crc32,
        sha256,
        compressionMethod: method,
      })),
    };
    fs.writeFileSync(`${outputFile}.sha256`, `${digest}  ${path.basename(outputFile)}\n`);
    fs.writeFileSync(`${outputFile}.manifest.json`, `${JSON.stringify(sidecar, null, 2)}\n`);
    return Object.freeze({ outputFile, source, ...sidecar });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function defaultOutputFile(version) {
  return path.join(root, "dist", `PremiereAIHarness-Core-${version}-premierepro.ccx`);
}

function assertInfoZip() {
  const result = spawnSync("zip", ["-v"], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (result.error && result.error.code === "ENOENT") {
    throw new Error("Info-ZIP 3.0 was not found. Use the GitHub Actions CCX artifact or Adobe UXP Developer Tool.");
  }
  if (result.error) throw result.error;
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert(result.status === 0 && /This is Zip 3\.0/.test(output), "Info-ZIP 3.0 is required for deterministic CCX packaging");
}

function copyDirectory(source, destination) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyDirectory(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    } else {
      throw new Error(`unsupported source entry for CCX: ${from}`);
    }
  }
}

function normalizeStage(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      fs.chmodSync(full, 0o755);
      normalizeStage(full);
    } else if (entry.isFile()) {
      fs.chmodSync(full, 0o644);
    }
    fs.utimesSync(full, FIXED_TIME, FIXED_TIME);
  }
  fs.chmodSync(directory, 0o755);
  fs.utimesSync(directory, FIXED_TIME, FIXED_TIME);
}

function listRelativeFiles(directory) {
  const output = [];
  visit(directory, "");
  return output.sort((left, right) => left.localeCompare(right, "en"));

  function visit(current, relative) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full, nextRelative);
      else if (entry.isFile()) output.push(nextRelative);
      else throw new Error(`unsupported staged CCX entry: ${full}`);
    }
  }
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function assert(condition, message) { if (!condition) throw new Error(message); }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const artifact = buildCcx();
  console.log(`CCX CANDIDATE PASS: ${path.basename(artifact.outputFile)} ${artifact.bytes} bytes sha256:${artifact.sha256}`);
}
