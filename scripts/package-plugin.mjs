import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".md", ".txt"]);
const TEXT_FILENAMES = new Set(["LICENSE", "NOTICE"]);

export function packagePlugin(outputDirectory = defaultOutputDirectory()) {
  const pluginDir = path.join(root, "plugin");
  const manifest = readJson(path.join(pluginDir, "manifest.json"));
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  copyDirectory(pluginDir, outputDirectory);
  copyFileForPackage(path.join(root, "LICENSE"), path.join(outputDirectory, "LICENSE"));
  copyFileForPackage(path.join(root, "NOTICE"), path.join(outputDirectory, "NOTICE"));

  const entries = listFiles(outputDirectory).map((file) => {
    const data = fs.readFileSync(file);
    return {
      path: normalizePath(path.relative(outputDirectory, file)),
      bytes: data.length,
      sha256: sha256(data),
    };
  }).sort((left, right) => left.path.localeCompare(right.path, "en"));
  const treeSha256 = sha256(Buffer.from(entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`).join("")));
  const artifact = {
    formatVersion: 1,
    packageKind: "unsigned-uxp-source-directory",
    installable: false,
    requiresAdobeUxpDeveloperToolPackaging: true,
    pluginId: manifest.id,
    version: manifest.version,
    directory: path.basename(outputDirectory),
    treeSha256,
    entries,
  };
  const manifestFile = `${outputDirectory}.manifest.json`;
  fs.writeFileSync(manifestFile, `${JSON.stringify(artifact, null, 2)}\n`);
  return Object.freeze({ outputDirectory, manifestFile, ...artifact });
}

function defaultOutputDirectory() {
  const manifest = readJson(path.join(root, "plugin", "manifest.json"));
  return path.join(root, "dist", `PremiereAIHarness-Core-${manifest.version}-uxp-source`);
}

function copyDirectory(source, destination) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (entry.name.startsWith(".") || entry.name.endsWith("~")) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyDirectory(from, to);
    } else if (entry.isFile()) {
      copyFileForPackage(from, to);
    } else {
      throw new Error(`Unsupported source entry: ${from}`);
    }
  }
}

function copyFileForPackage(source, destination) {
  const extension = path.extname(source).toLowerCase();
  const filename = path.basename(source);
  if (TEXT_EXTENSIONS.has(extension) || TEXT_FILENAMES.has(filename)) {
    fs.writeFileSync(destination, normalizeTextForPackage(fs.readFileSync(source, "utf8")), "utf8");
    return;
  }
  fs.copyFileSync(source, destination);
}

export function normalizeTextForPackage(value) {
  return String(value).replace(/\r\n?/g, "\n");
}

function listFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function normalizePath(value) { return String(value).replace(/\\/g, "/"); }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const artifact = packagePlugin(process.argv[2] ? path.resolve(process.argv[2]) : defaultOutputDirectory());
  console.log(`PACKAGE PASS: ${artifact.directory} ${artifact.entries.length} files tree-sha256:${artifact.treeSha256}`);
}
