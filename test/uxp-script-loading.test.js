"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const pluginDir = path.resolve(__dirname, "..", "plugin");
const scripts = [
  "lib/transcript.js", "lib/planner.js", "lib/host-certification.js", "lib/session-state.js",
  "lib/premiere-runtime.js", "lib/generated-assets.js", "lib/generated-cleanup.js",
  "lib/premiere-adapter.js", "lib/ui-view.js", "index.js",
];

test("script-tag loading uses the UXP global path even when a module object exists", () => {
  let registered = null;
  const context = {
    console,
    module: { exports: {} },
    document: { addEventListener(name, handler) { assert.equal(name, "DOMContentLoaded"); assert.equal(typeof handler, "function"); } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    require(name) {
      if (name === "uxp") return { entrypoints: { setup(value) { registered = value; } } };
      throw new Error(`unexpected early require: ${name}`);
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const relative of scripts) {
    vm.runInContext(fs.readFileSync(path.join(pluginDir, relative), "utf8"), context, { filename: relative });
  }
  assert.equal(typeof context.PAI.parseTranscript, "function");
  assert.equal(typeof context.PAI.createRoughCut, "function");
  assert.equal(typeof context.PAIController.createController, "function");
  assert.ok(registered.panels[context.PAIController.PANEL_ID]);
  assert.deepEqual(context.module.exports, {});
});
