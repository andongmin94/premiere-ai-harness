import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = listFiles(path.join(root, "plugin")).filter((file) => file.endsWith(".js"));
const MAX_FILE_LINES = 320;
const MAX_DECISION_TOKENS = 100;
const MAX_CALLBACK_DEPTH = 10;
const results = [];

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file).replace(/\\/g, "/");
  const lines = source.split(/\r?\n/).length;
  const decisions = [...source.matchAll(/\b(?:if|for|while|case|catch)\b|&&|\|\|/g)].length;
  const callbackDepth = maximumIndentDepth(source);
  assert(lines <= MAX_FILE_LINES, `${relative} has ${lines} lines; limit is ${MAX_FILE_LINES}`);
  assert(decisions <= MAX_DECISION_TOKENS, `${relative} has ${decisions} decision tokens; limit is ${MAX_DECISION_TOKENS}`);
  assert(callbackDepth <= MAX_CALLBACK_DEPTH, `${relative} has indentation depth ${callbackDepth}; limit is ${MAX_CALLBACK_DEPTH}`);
  results.push({ file: relative, lines, decisions, callbackDepth });
}

console.log(`COMPLEXITY PASS: ${results.length} files, max-lines=${MAX_FILE_LINES}, max-decisions=${MAX_DECISION_TOKENS}, max-indent-depth=${MAX_CALLBACK_DEPTH}`);

function maximumIndentDepth(source) {
  let maximum = 0;
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const spaces = (line.match(/^ */) || [""])[0].length;
    maximum = Math.max(maximum, Math.floor(spaces / 2));
  }
  return maximum;
}

function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function assert(condition, message) { if (!condition) throw new Error(message); }
