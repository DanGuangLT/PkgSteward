import assert from "node:assert/strict"
import test from "node:test"
import { initialRunnerState } from "./runner-policy.ts"
import { runnerDisplay, runnerUsesPackage } from "./runner-display.ts"

// TEST fixtures — không phải yêu cầu nghiệp vụ.
const context = { available: true, reason: null, scripts: [], requestPath: "D:/TEST", path: "D:/TEST" }
const selection = { action: "install_all" }
const state = () => initialRunnerState(context)
const job = (changes = {}) => ({ status: "completed", gateHeld: false, exitCode: 0, failureCode: null,
  terminationVerified: true, auditWritten: true, refreshRequired: false, ...changes })

test("package controls are limited to single-package actions", () => {
  for (const action of ["install_one", "update_one", "uninstall_one"]) assert.equal(runnerUsesPackage(action), true)
  for (const action of ["install_all", "update_all", "script"]) assert.equal(runnerUsesPackage(action), false)
})
test("server context error replaces the missing-scan fallback only when context is absent", () => {
  assert.equal(runnerDisplay({ ...state(), context: null }, selection, "FORBIDDEN").blockedReason, "FORBIDDEN")
  assert.equal(runnerDisplay(state(), selection, "FORBIDDEN").blockedReason, null)
  assert.equal(runnerDisplay({ ...state(), context: null, contextError: "INPUT_CHANGED" }, selection, "FORBIDDEN").blockedReason, "INPUT_CHANGED")
})
test("start uncertainty and lost tracking keep analysis and Run blocked", () => {
  for (const changes of [{ startUnknown: true }, { phase: "lost" }]) {
    const display = runnerDisplay({ ...state(), ...changes }, selection)
    assert.equal(display.busy, true)
    assert.notEqual(display.blockedReason, null)
  }
  assert.equal(runnerDisplay({ ...state(), startUnknown: true }, selection).status, "startUnknown")
  assert.equal(runnerDisplay({ ...state(), phase: "lost", job: job() }, selection).status, "lost")
})
test("cancel guard matches the session, including final log drain", () => {
  assert.equal(runnerDisplay({ ...state(), phase: "tracking" }, selection).canCancel, true)
  assert.equal(runnerDisplay({ ...state(), phase: "tracking", job: job() }, selection).canCancel, false)
  for (const status of ["running", "stopping", "termination_failed"]) {
    assert.equal(runnerDisplay({ ...state(), job: job({ status }) }, selection).canCancel, true)
  }
  assert.equal(runnerDisplay({ ...state(), job: job({ gateHeld: true }) }, selection).cancelLabel, "retryCleanup")
  assert.equal(runnerDisplay({ ...state(), job: job({ status: "termination_failed" }) }, selection).cancelLabel, "retryCleanup")
  assert.equal(runnerDisplay({ ...state(), cancelPending: true }, selection).cancelLabel, "stopping")
})
test("uncertain cancellation blocks analysis and exposes a distinct status", () => {
  const display = runnerDisplay({ ...state(), job: job(), cancelUnknown: true }, selection)
  assert.equal(display.busy, true)
  assert.equal(display.status, "cancelUnknown")
})
test("completed is success only after verified cleanup, audit and cache refresh", () => {
  assert.equal(runnerDisplay({ ...state(), job: job() }, selection).status, "success")
  for (const change of [{ exitCode: 1 }, { failureCode: "AUDIT_WRITE_FAILED" }, { terminationVerified: false },
    { auditWritten: false }, { gateHeld: true }, { refreshRequired: true }]) {
    assert.equal(runnerDisplay({ ...state(), job: job(change) }, selection).status, "incomplete")
  }
})
test("active and failed statuses remain distinct; polling failure blocks analysis", () => {
  for (const status of ["running", "stopping", "failed", "cancelled", "timed_out", "termination_failed"]) {
    assert.equal(runnerDisplay({ ...state(), job: job({ status }) }, selection).status, status)
  }
  assert.equal(runnerDisplay({ ...state(), pollError: "UNKNOWN", job: job() }, selection).busy, true)
  assert.equal(runnerDisplay({ ...state(), error: { code: "READERS_RUNNING" } }, selection).blockedReason, "READERS_RUNNING")
})
