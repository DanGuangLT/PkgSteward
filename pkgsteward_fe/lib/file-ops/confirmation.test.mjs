import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildExecuteInput, canConfirm, confirmationKey, requiredAcknowledgements, requiresTypedText,
} from "./confirmation.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const reason = (code, level) => ({ code, level, message: "TEST" })
const summary = (level, reasons, confirmText = null) => ({
  paths: ["D:\\TEST\\node_modules"],
  risk: { level, reasons },
  confirmText,
  totals: { targetCount: 1, reclaimableBytes: 1, recycleBytes: 0 },
})
const low = summary("low", [reason("ORPHAN_NODE_MODULES", "low")])
const medium = summary("medium", [reason("NO_LOCKFILE", "medium"), reason("RECENTLY_ACTIVE", "medium")])
const high = summary("high", [reason("DELETE_WHOLE_PROJECT", "high"), reason("NO_LOCKFILE", "medium")], "TEST-app")
const input = (acknowledged = [], typedText = "") => ({ acknowledged: new Set(acknowledged), typedText })

test("low needs only the confirm button", () => {
  assert.deepEqual(requiredAcknowledgements(low), [])
  assert.equal(requiresTypedText(low), false)
  assert.equal(canConfirm(low, input()), true)
})

test("medium needs every code ticked", () => {
  assert.deepEqual(requiredAcknowledgements(medium), ["NO_LOCKFILE", "RECENTLY_ACTIVE"])
  assert.equal(requiresTypedText(medium), false)
  assert.equal(canConfirm(medium, input()), false)
  assert.equal(canConfirm(medium, input(["NO_LOCKFILE"])), false)
  assert.equal(canConfirm(medium, input(["NO_LOCKFILE", "RECENTLY_ACTIVE"])), true)
})

test("high needs every code ticked and the exact text", () => {
  const ticks = ["DELETE_WHOLE_PROJECT", "NO_LOCKFILE"]
  assert.equal(requiresTypedText(high), true)
  assert.equal(canConfirm(high, input(ticks)), false)
  assert.equal(canConfirm(high, input([], "TEST-app")), false)
  assert.equal(canConfirm(high, input(ticks, "test-app")), false)
  assert.equal(canConfirm(high, input(ticks, " TEST-app")), false)
  assert.equal(canConfirm(high, input(ticks, "TEST-app")), true)
})

test("high without server text can never be confirmed", () => {
  const broken = { ...high, confirmText: null }
  assert.equal(canConfirm(broken, input(["DELETE_WHOLE_PROJECT", "NO_LOCKFILE"], "")), false)
})

test("input sends only what the level needs", () => {
  assert.deepEqual(buildExecuteInput("TEST-id", low, input()), {
    previewId: "TEST-id", paths: low.paths, confirm: true,
  })
  assert.deepEqual(buildExecuteInput("TEST-id", medium, input(["NO_LOCKFILE", "RECENTLY_ACTIVE"])), {
    previewId: "TEST-id", paths: medium.paths, confirm: true, acknowledgedRisks: ["NO_LOCKFILE", "RECENTLY_ACTIVE"],
  })
  assert.deepEqual(buildExecuteInput("TEST-id", high, input(["DELETE_WHOLE_PROJECT", "NO_LOCKFILE"], "TEST-app")), {
    previewId: "TEST-id", paths: high.paths, confirm: true,
    acknowledgedRisks: ["DELETE_WHOLE_PROJECT", "NO_LOCKFILE"], confirmText: "TEST-app",
  })
})

test("input acknowledges the summary codes, not stale ticks", () => {
  const built = buildExecuteInput("TEST-id", medium, input(["NO_LOCKFILE", "RECENTLY_ACTIVE", "DEV_PROCESS_RUNNING"]))
  assert.deepEqual(built.acknowledgedRisks, ["NO_LOCKFILE", "RECENTLY_ACTIVE"])
})

test("no execute input exists until the confirmation is complete", () => {
  assert.equal(buildExecuteInput("TEST-id", medium, input(["NO_LOCKFILE"])), null)
  assert.equal(buildExecuteInput("TEST-id", high, input(["DELETE_WHOLE_PROJECT", "NO_LOCKFILE"], "x")), null)
})

test("key changes with preview, selection, risk or text so ticks reset", () => {
  const key = confirmationKey("TEST-id", medium)
  assert.equal(confirmationKey("TEST-id", { ...medium }), key)
  assert.notEqual(confirmationKey("TEST-other", medium), key)
  assert.notEqual(confirmationKey("TEST-id", { ...medium, paths: ["D:\\TEST\\other"] }), key)
  assert.notEqual(confirmationKey("TEST-id", { ...medium, risk: { level: "medium", reasons: [reason("NO_LOCKFILE", "medium")] } }), key)
  assert.notEqual(confirmationKey("TEST-id", { ...medium, confirmText: "DELETE 2" }), key)
})
