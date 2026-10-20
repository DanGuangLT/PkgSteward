import { test } from "node:test"
import assert from "node:assert/strict"
import { FRONTEND_ORIGINS, FRONTEND_PORT, isAllowedApiWrite, isAllowedHost } from "./host-check.ts"

test("the frontend port matches the dev/start scripts", () => {
  assert.equal(FRONTEND_PORT, 24680)
})

test("accepts loopback hosts on the frontend port, any case", () => {
  for (const host of ["localhost:24680", "127.0.0.1:24680", "[::1]:24680", "LocalHost:24680"]) {
    assert.equal(isAllowedHost(host), true, host)
  }
})

test("accepts only SP and HTAB as surrounding optional whitespace", () => {
  for (const host of [" localhost:24680 ", "\t127.0.0.1:24680\t", " \t[::1]:24680\t "]) {
    assert.equal(isAllowedHost(host), true, JSON.stringify(host))
  }
})

test("rejects NBSP surrounding a loopback host", () => {
  for (const host of ["\u00a0localhost:24680\u00a0", "\u00a0localhost:24680", "localhost:24680\u00a0"]) {
    assert.equal(isAllowedHost(host), false, JSON.stringify(host))
  }
})

test("rejects embedded whitespace and userinfo in a loopback host", () => {
  for (const host of ["local host:24680", "local\thost:24680", "localhost: 24680", "localhost:\t24680", "user@localhost:24680"]) {
    assert.equal(isAllowedHost(host), false, JSON.stringify(host))
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

const write = (overrides) =>
  isAllowedApiWrite({ method: "POST", pathname: "/api/scans", origin: null, secFetchSite: null, ...overrides })

test("frontend origins are exactly the three loopback origins on the frontend port", () => {
  assert.deepEqual([...FRONTEND_ORIGINS], [
    "http://localhost:24680",
    "http://127.0.0.1:24680",
    "http://[::1]:24680",
  ])
})

test("API writes without Origin pass (curl, server-to-server)", () => {
  assert.equal(write({}), true)
})

test("API writes from a frontend origin pass", () => {
  for (const origin of [...FRONTEND_ORIGINS, "HTTP://LOCALHOST:24680"]) {
    assert.equal(write({ origin, secFetchSite: "same-origin" }), true, origin)
  }
})

test("(a) API writes from any other Origin are rejected", () => {
  for (const origin of ["http://evil.example", "null", "", "http://localhost:24681", "https://localhost:24680"]) {
    assert.equal(write({ origin }), false, origin)
  }
})

test("(b) API writes marked Sec-Fetch-Site: cross-site are rejected, even without Origin", () => {
  assert.equal(write({ secFetchSite: "cross-site" }), false)
  assert.equal(write({ secFetchSite: "Cross-Site" }), false)
  assert.equal(write({ origin: "http://localhost:24680", secFetchSite: "cross-site" }), false)
  assert.equal(write({ secFetchSite: "same-site" }), true)
  assert.equal(write({ secFetchSite: "none" }), true)
})

test("every write method is checked; reads and non-API paths are not", () => {
  for (const method of ["POST", "PUT", "PATCH", "delete"]) {
    assert.equal(write({ method, origin: "http://evil.example" }), false, method)
  }
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(write({ method, origin: "http://evil.example" }), true, method)
  }
  assert.equal(write({ pathname: "/api", origin: "http://evil.example" }), false)
  assert.equal(write({ pathname: "/design-system", origin: "http://evil.example" }), true)
  assert.equal(write({ pathname: "/apix", origin: "http://evil.example" }), true)
})
