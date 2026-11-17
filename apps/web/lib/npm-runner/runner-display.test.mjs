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

test("native shell open keeps status running after initial exit 0; recovery hold surfaces even with job null", () => {
  const shellOpen = runnerDisplay({
    ...state(),
    job: job({
      status: "running",
      phase: "executing",
      gateHeld: true,
      exitCode: 0,
      terminationVerified: false,
      auditWritten: false,
      nativeSession: { shell: "powershell", generation: 1, phase: "shell_open", available: true, sessionResult: null },
      initialCommand: { exitCode: 0, signal: null },
    }),
  }, { action: "install_all", consoleShell: "cmd" })
  assert.equal(shellOpen.status, "running")
  assert.equal(shellOpen.canCancel, true)
  assert.equal(shellOpen.busy, true)
  assert.equal(shellOpen.shellDisabled, true)
  assert.equal(shellOpen.nativeSession?.shell, "powershell")
  assert.equal(shellOpen.nativeSession?.phase, "shell_open")
  assert.equal(shellOpen.nativeSession?.initialOutcome?.exitCode, 0)

  // Initial failure cannot be masked by later normal shell exit 0
  const initialFailedShellZero = runnerDisplay({
    ...state(),
    job: job({
      status: "failed",
      failureCode: "COMMAND_FAILED",
      exitCode: 1,
      nativeSession: { shell: "cmd", generation: 1, phase: "closed", available: true, sessionResult: { exitCode: 0, signal: null } },
      initialCommand: { exitCode: 1, signal: null },
    }),
  }, selection)
  assert.equal(initialFailedShellZero.status, "failed")
  assert.equal(initialFailedShellZero.nativeSession?.sessionResult?.exitCode, 0)

  // Completion with refreshRequired maps to incomplete, never failed
  const refreshNeeded = runnerDisplay({ ...state(), job: job({ refreshRequired: true }) }, selection)
  assert.equal(refreshNeeded.status, "incomplete")

  // Recovery hold with job null
  const holdOnly = runnerDisplay({
    ...state(),
    recoveryHold: { active: true, reason: "CORRUPT_OR_PARTIAL_JOURNAL", journalPath: "D:\\TEST\\journal.json" },
    job: null,
  }, selection)
  assert.equal(holdOnly.recoveryHold, true)
  assert.equal(holdOnly.blockedReason, "RECOVERY_HOLD")
  assert.equal(holdOnly.shellDisabled, true)
  assert.equal(runnerDisplay({ ...state(), phase: "tracking", job: null }, selection).shellDisabled, true)
  assert.equal(runnerDisplay({ ...state(), startUnknown: true }, selection).shellDisabled, true)
  assert.equal(runnerDisplay({ ...state(), cancelUnknown: true }, selection).shellDisabled, true)
})
