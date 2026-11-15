import assert from "node:assert/strict"
import test from "node:test"

import { initialScanUiState, pollFailureAction, shouldPoll, terminalAction } from "./scan-policy.ts"

test("a fresh page tracks the running scan with its existing progress", () => {
  const activeScan = { scanId: "TEST-scan", status: "running", progress: { visitedDirs: 6, foundProjects: 2, skippedCount: 0 } }
  assert.deepEqual(initialScanUiState(activeScan), {
    phase: "tracking", scanId: activeScan.scanId, job: activeScan, cancelPending: false,
  })
})

test("a page stays idle when the active lookup has no running scan", () => {
  assert.deepEqual(initialScanUiState(null), { phase: "idle" })
  assert.deepEqual(initialScanUiState({ scanId: "TEST-scan", status: "completed" }), { phase: "idle" })
})

for (const [code, action] of [
  ["NOT_FOUND", "abandon"],
  ["BACKEND_UNAVAILABLE", "pause"],
  ["RATE_LIMITED", "pause"],
  ["UNKNOWN", "pause"],
]) {
  test(`${code} ${action}s`, () => {
    assert.equal(pollFailureAction(code), action)
  })
}

test("visible running polls", () => {
  assert.equal(shouldPoll("running", true), true)
})

test("hidden running pauses", () => {
  assert.equal(shouldPoll("running", false), false)
})

for (const status of ["completed", "timed_out", "cancelled", "failed"]) {
  test(`${status} stops polling in visible and hidden tabs`, () => {
    assert.equal(shouldPoll(status, true), false)
    assert.equal(shouldPoll(status, false), false)
  })
}

for (const [status, action] of [
  ["completed", "refresh"],
  ["timed_out", "refresh"],
  ["cancelled", "cancelled"],
  ["failed", "failed"],
  ["running", "none"],
]) {
  test(`${status} has terminal action ${action}`, () => {
    assert.equal(terminalAction(status), action)
  })
}
