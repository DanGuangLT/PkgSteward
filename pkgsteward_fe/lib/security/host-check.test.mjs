import { test } from "node:test"
import assert from "node:assert/strict"
import { FRONTEND_PORT, isAllowedHost } from "./host-check.ts"

test("the frontend port matches the dev/start scripts", () => {
  assert.equal(FRONTEND_PORT, 24680)
})

test("accepts loopback hosts on the frontend port, any case", () => {
  for (const host of ["localhost:24680", "127.0.0.1:24680", "[::1]:24680", "LocalHost:24680"]) {
    assert.equal(isAllowedHost(host), true, host)
  }
})

test("rejects foreign, portless, wrong-port and look-alike hosts", () => {
  for (const host of [
    "evil.example:24680",
    "localhost",
    "localhost:24681",
    "localhost.evil.example:24680",
    "localhost.:24680",
    "127.0.0.2:24680",
    "::1:24680",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isAllowedHost(host), false, String(host))
  }
})
