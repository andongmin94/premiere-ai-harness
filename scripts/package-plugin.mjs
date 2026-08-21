import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectDirectoryEntries, createZip } from "./lib/zip.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function packagePlugin(outputFile = defaultOutput()) {
  const pluginDir = path.join(root, "plugin");
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8"));
  const entries = collectDirectoryEntries(pluginDir, {
    filter(relative, stat) {
      if (!stat.isFile()) return stat.isDirectory();
      return !relative.startsWith(".") && !relative.endsWith("~");
    },
  });
  entries.push({ name: "LICENSE", data: fs.readFileSync(path.join(root, "LICENSE")), mode: 0o100644 });
  entries.push({ name: "NOTICE", data: fs.readFileSync(path.join(root, "NOTICE")), mode: 0o100644 });
  entries.push({ name: "README.txt", data: fs.readFileSync(path.join(root, "plugin", "README.txt")), mode: 0o100644 });
  const result = createZip(entries, outputFile);
  const digest = sha256File(outputFile);
  fs.writeFileSync(`${outputFile}.sha256`, `${digest}  ${path.basename(outputFile)}\n`);
  const artifact = {
    formatVersion: 1,
    pluginId: manifest.id,
    version: manifest.version,
    file: path.basename(outputFile),
    bytes: result.bytes,
    sha256: digest,
    entries: entries.map((entry) => ({ name: entry.name, bytes: Buffer.byteLength(entry.data), sha256: crypto.createHash("sha256").update(entry.data).digest("hex") })).sort((a, b) => a.name.localeCompare(b.name, "en")),
  };
  fs.writeFileSync(`${outputFile}.manifest.json`, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

function defaultOutput() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugin", "manifest.json"), "utf8"));
  return path.join(root, "dist", `PremiereAIHarness-Core-${manifest.version}.ccx`);
}

function sha256File(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const artifact = packagePlugin(process.argv[2] ? path.resolve(process.argv[2]) : defaultOutput());
  console.log(`PACKAGE PASS: ${artifact.file} ${artifact.bytes} bytes sha256:${artifact.sha256}`);
}
