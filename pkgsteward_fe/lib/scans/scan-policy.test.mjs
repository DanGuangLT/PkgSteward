import assert from "node:assert/strict"
import test from "node:test"

import { pollFailureAction, shouldPoll, terminalAction } from "./scan-policy.ts"

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
