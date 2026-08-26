import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "plugin");
const MAX_FILE_LINES = 320;
const MAX_DECISIONS = 120;
const MAX_INDENT_DEPTH = 10;
const MAX_AVERAGE_FILE_LINES = 240;

const files = walk(pluginRoot).filter((file) => file.endsWith(".js"));
const reports = files.map(analyze);
for (const report of reports) {
  assert(report.lines <= MAX_FILE_LINES, `${report.path} has ${report.lines} lines; limit is ${MAX_FILE_LINES}`);
  assert(report.decisions <= MAX_DECISIONS, `${report.path} has ${report.decisions} decision tokens; limit is ${MAX_DECISIONS}`);
  assert(report.maxIndentDepth <= MAX_INDENT_DEPTH, `${report.path} reaches indentation depth ${report.maxIndentDepth}; limit is ${MAX_INDENT_DEPTH}`);
}
const averageLines = reports.reduce((sum, report) => sum + report.lines, 0) / Math.max(1, reports.length);
assert(averageLines <= MAX_AVERAGE_FILE_LINES, `average plugin module size is ${averageLines.toFixed(1)} lines; limit is ${MAX_AVERAGE_FILE_LINES}`);

console.log(`COMPLEXITY PASS: ${reports.length} modules, max ${Math.max(...reports.map((report) => report.lines))} lines, average ${averageLines.toFixed(1)} lines`);

function analyze(file) {
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  const decisions = countMatches(source, /\b(?:if|for|while|catch|case)\b|&&|\|\||\?\?/g);
  const maxIndentDepth = lines.reduce((maximum, line) => {
    if (!line.trim()) return maximum;
    const spaces = line.match(/^ */)[0].length;
    return Math.max(maximum, Math.floor(spaces / 2));
  }, 0);
  return {
    path: path.relative(root, file).replace(/\\/g, "/"),
    lines: lines.length,
    decisions,
    maxIndentDepth,
  };
}

function countMatches(value, pattern) { return [...value.matchAll(pattern)].length; }
function walk(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
