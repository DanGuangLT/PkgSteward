import { test } from "node:test"
import assert from "node:assert/strict"
import * as hostCheck from "./host-check.ts"

const { frontendOrigins, isAllowedApiWrite, isAllowedHost } = hostCheck
const port = 24680
const origins = ["http://localhost:24680", "http://127.0.0.1:24680", "http://[::1]:24680"]

test("accepts loopback hosts on the frontend port, any case", () => {
  for (const host of ["localhost:24680", "127.0.0.1:24680", "[::1]:24680", "LocalHost:24680"]) {
    assert.equal(isAllowedHost(host, port), true, host)
  }
})

test("accepts only SP and HTAB as surrounding optional whitespace", () => {
  for (const host of [" localhost:24680 ", "\t127.0.0.1:24680\t", " \t[::1]:24680\t "]) {
    assert.equal(isAllowedHost(host, port), true, JSON.stringify(host))
  }
})

test("rejects NBSP surrounding a loopback host", () => {
  for (const host of ["\u00a0localhost:24680\u00a0", "\u00a0localhost:24680", "localhost:24680\u00a0"]) {
    assert.equal(isAllowedHost(host, port), false, JSON.stringify(host))
  }
})

test("rejects embedded whitespace and userinfo in a loopback host", () => {
  for (const host of ["local host:24680", "local\thost:24680", "localhost: 24680", "localhost:\t24680", "user@localhost:24680"]) {
    assert.equal(isAllowedHost(host, port), false, JSON.stringify(host))
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
    assert.equal(isAllowedHost(host, port), false, String(host))
  }
})

const write = (overrides, configuredPort = port) =>
  isAllowedApiWrite(
    { method: "POST", pathname: "/api/scans", origin: null, secFetchSite: null, ...overrides },
    configuredPort
  )

test("frontend origins are exactly the three loopback origins on the frontend port", () => {
  assert.deepEqual(frontendOrigins(port), [
    "http://localhost:24680",
    "http://127.0.0.1:24680",
    "http://[::1]:24680",
  ])
})

test("API writes without Origin pass (curl, server-to-server)", () => {
  assert.equal(write({}), true)
})

test("API writes from a frontend origin pass", () => {
  for (const origin of [...origins, "HTTP://LOCALHOST:24680"]) {
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

test("accepts a loopback host on the configured port", () => {
  assert.equal(isAllowedHost("127.0.0.1:3500", 3500), true)
})

test("rejects the former frontend port when a different port is configured", () => {
  assert.equal(isAllowedHost("127.0.0.1:24680", 3500), false)
})

test("builds exactly the three loopback origins on the configured port", () => {
  assert.deepEqual(frontendOrigins(3500), [
    "http://localhost:3500",
    "http://127.0.0.1:3500",
    "http://[::1]:3500",
  ])
})

test("accepts API writes from the configured frontend origin", () => {
  assert.equal(write({ origin: "http://localhost:3500", secFetchSite: "same-origin" }, 3500), true)
})

test("rejects API writes from the former frontend origin", () => {
  assert.equal(write({ origin: "http://localhost:24680" }, 3500), false)
})

test("rejects cross-site API writes even from the configured frontend origin", () => {
  assert.equal(write({ origin: "http://localhost:3500", secFetchSite: "cross-site" }, 3500), false)
  assert.equal(write({ secFetchSite: "cross-site" }, 3500), false)
})
