import { test } from "node:test"
import assert from "node:assert/strict"
import { ApiError } from "../api/response.ts"
import { initialRunnerState, isRunActive, isRunSuccessful, runnerError, runnerEligibility, buildRunRequest, runnerFollowHref } from "./runner-policy.ts"

// TEST data; không phải yêu cầu nghiệp vụ.
const context = { path: "D:\\TEST", requestPath: "D:\\TEST-alias", inputHash: "a".repeat(64), available: true,
  manager: "npm", version: "11.0.0", reason: null, warnings: ["NO_LOCKFILE"], scripts: [{ name: "install", command: "TEST", eligible: true }, { name: "--bad", command: "TEST", eligible: false }] }
const requestId = "00000000-0000-4000-8000-000000000001"

test("eligibility exposes availability, busy and uncertainty without inventing manager rules", () => {
  const base = initialRunnerState(context)
  assert.equal(runnerEligibility(base, { action: "install_all" }), null)
  for (const status of ["running", "stopping", "termination_failed"]) {
    assert.equal(isRunActive({ status, gateHeld: false }), true)
    assert.equal(runnerEligibility({ ...base, job: { status, gateHeld: false } }, { action: "install_all" }), "RUNNING")
  }
  for (const status of ["completed", "failed", "cancelled", "timed_out"]) {
    assert.equal(isRunActive({ status, gateHeld: false }), false)
    assert.equal(isRunActive({ status, gateHeld: true }), true)
  }
  assert.equal(runnerEligibility({ ...base, startUnknown: true }, { action: "install_all" }), "START_UNKNOWN")
  assert.equal(runnerEligibility({ ...base, context: { ...context, available: false, reason: "UNSUPPORTED_MANAGER", manager: "yarn" } }, { action: "install_all" }), "UNSUPPORTED_MANAGER")
  assert.equal(runnerEligibility({ ...base, context: { ...context, manager: "yarn" } }, { action: "install_all" }), null)
  for (const reason of ["READERS_RUNNING", "RUNNING"]) {
    const error = runnerError(new ApiError(409, "TEST private", "CONFLICT", { reason, jobId: requestId, requestPath: context.path }))
    assert.equal(runnerEligibility({ ...base, error }, { action: "install_all" }), reason)
  }
})

test("payloads include only action-specific fields and validate conservative package/script grammar", () => {
  const base = { path: context.requestPath, inputHash: context.inputHash, requestId }
  for (const action of ["install_all", "update_all"]) assert.deepEqual(buildRunRequest(context, { action, package: "ignored", script: "ignored" }, requestId), { ...base, action })
  for (const spec of ["alpha", "@scope/pkg", "alpha@latest", "@scope/pkg@1.2.3-beta.1+build"]) {
    assert.equal(buildRunRequest(context, { action: "install_one", package: spec }, requestId).package, spec)
  }
  for (const action of ["update_one", "uninstall_one"]) {
    assert.equal(buildRunRequest(context, { action, package: "@scope/pkg" }, requestId).package, "@scope/pkg")
    assert.throws(() => buildRunRequest(context, { action, package: "alpha@1.2.3" }, requestId), { code: "INVALID_PACKAGE_SPEC" })
  }
  for (const spec of ["--global", "alpha beta", "a..b", "A", "../x", "file:x", "https://x", "alpha@^1", "alpha@01.2.3", "alpha@9007199254740992.0.0", "alpha@1.2.3-01", "alpha@1.2.3;whoami", "alpha@*", "alpha\n", "a".repeat(215)]) {
    assert.throws(() => buildRunRequest(context, { action: "install_one", package: spec }, requestId), { code: "INVALID_PACKAGE_SPEC" })
  }
  assert.deepEqual(buildRunRequest(context, { action: "script", script: "install" }, requestId), { ...base, action: "script", script: "install" })
  for (const script of ["--bad", "missing", "__proto__"]) assert.throws(() => buildRunRequest(context, { action: "script", script }, requestId))
})

test("errors use codes/reasons only; running conflict offers explicit encoded navigation", () => {
  const details = { reason: "RUNNING", jobId: requestId, requestPath: "D:\\TEST #&+" }
  const error = runnerError(new ApiError(409, "TEST private", "CONFLICT", details))
  assert.equal(error.code, "RUNNING")
  assert.deepEqual(error.conflict, details)
  assert.equal(new URL(runnerFollowHref(error.conflict), "http://localhost").searchParams.get("path"), details.requestPath)
  for (const malformed of [{ ...details, requestPath: "" }, { ...details, jobId: 3 }, { ...details, reason: "READERS_RUNNING" }]) {
    assert.equal(runnerError(new ApiError(409, "TEST", "CONFLICT", malformed)).conflict, undefined)
  }
  assert.equal(runnerError(new Error("TEST private")).code, "UNKNOWN")
})

test("exit zero does not hide audit/cache/termination failure", () => {
  const clean = { status: "completed", exitCode: 0, failureCode: null, gateHeld: false, terminationVerified: true, auditWritten: true, refreshRequired: false }
  assert.equal(isRunSuccessful(clean), true)
  for (const patch of [{ status: "failed" }, { failureCode: "AUDIT_WRITE_FAILED" }, { auditWritten: false }, { gateHeld: true }, { terminationVerified: false }, { refreshRequired: true }, { exitCode: null }]) {
    assert.equal(isRunSuccessful({ ...clean, ...patch }), false)
  }
})
