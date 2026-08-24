"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../plugin/lib/session-state.js");

function selection(overrides = {}) {
  return Object.assign({ projectId: "p1", projectName: "P", clipId: "c1", clipName: "C", duration: 10, frameRate: 25, hasTranscript: true }, overrides);
}

test("selection changes invalidate transcript and plan", () => {
  const session = state.createSession();
  state.setSelection(session, selection());
  state.setTranscript(session, { source: "pasted", raw: null, segments: [{ start: 0, end: 1, text: "x" }] });
  state.setPlan(session, { candidates: [], selectedIds: [] });
  state.setSelection(session, selection({ projectId: "p2" }));
  assert.equal(session.transcript, null);
  assert.equal(session.plan, null);
});

test("same selection preserves analysis and canApply follows busy/certification", () => {
  const session = state.createSession();
  state.setSelection(session, selection());
  state.setTranscript(session, { source: "premiere", raw: "{}", segments: [{ start: 0, end: 1, text: "x" }] });
  state.setPlan(session, { candidates: [], selectedIds: [] });
  state.setSelection(session, selection());
  assert.ok(session.plan);
  assert.equal(state.canApply(session, true), true);
  state.setBusy(session, true);
  assert.equal(state.canApply(session, true), false);
});

test("requires project and clip identity", () => {
  assert.throws(() => state.normalizeSelection(selection({ projectId: "" })), /올바르지 않습니다/);
  assert.throws(() => state.normalizeSelection(selection({ clipId: "" })), /올바르지 않습니다/);
});
