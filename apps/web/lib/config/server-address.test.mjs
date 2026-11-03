import { test } from "node:test"
import assert from "node:assert/strict"
import { parseFrontendHost, parseFrontendPort, resolveServerAddress } from "./server-address.ts"

for (const value of [undefined, "", " \t "]) {
  test(`defaults an unset PORT (${JSON.stringify(value)}) to 24680`, () => {
    assert.deepEqual(parseFrontendPort(value), { ok: true, value: 24680 })
  })

  test(`defaults an unset HOST (${JSON.stringify(value)}) to 127.0.0.1`, () => {
    assert.deepEqual(parseFrontendHost(value), { ok: true, value: "127.0.0.1" })
  })
}

for (const [value, expected] of [["3500", 3500], [" 3500 ", 3500], ["65535", 65535], ["1", 1]]) {
  test(`parses decimal PORT ${JSON.stringify(value)}`, () => {
    assert.deepEqual(parseFrontendPort(value), { ok: true, value: expected })
  })
}

for (const value of ["0", "65536", "abc", "3500.5", "-1", "+3500", "1e3", "0x10", " 35 00 "]) {
  test(`rejects invalid PORT ${JSON.stringify(value)} with an actionable error`, () => {
    const result = parseFrontendPort(value)
    assert.equal(result.ok, false)
    assert.match(result.message, /PORT/)
    assert.ok(result.message.includes(value.trim()), result.message)
    assert.match(result.message, /1.*65535/)
  })
}

for (const [value, expected] of [
  ["127.0.0.1", "127.0.0.1"],
  ["localhost", "localhost"],
  ["::1", "::1"],
  ["LOCALHOST", "localhost"],
  [" \tLocalHost \t", "localhost"],
]) {
  test(`parses and normalizes loopback HOST ${JSON.stringify(value)}`, () => {
    assert.deepEqual(parseFrontendHost(value), { ok: true, value: expected })
  })
}

for (const value of ["0.0.0.0", "192.168.1.5", "[::1]", "::", "127.0.0.2", "localhost.", "example.com"]) {
  test(`rejects invalid HOST ${JSON.stringify(value)} with an actionable error`, () => {
    const result = parseFrontendHost(value)
    assert.equal(result.ok, false)
    assert.match(result.message, /HOST/)
    assert.ok(result.message.includes(value), result.message)
    for (const allowed of ["127.0.0.1", "localhost", "::1"]) {
      assert.ok(result.message.includes(allowed), result.message)
    }
  })
}

test("real environment values take precedence over both env files", () => {
  assert.deepEqual(resolveServerAddress([
    { PORT: "3500", HOST: "localhost" },
    { PORT: "4500", HOST: "::1" },
    { PORT: "5500", HOST: "127.0.0.1" },
  ]), { ok: true, port: 3500, host: "localhost" })
})

test(".env.local takes precedence over .env when real environment values are absent", () => {
  assert.deepEqual(resolveServerAddress([
    {},
    { PORT: "4500", HOST: "::1" },
    { PORT: "5500", HOST: "localhost" },
  ]), { ok: true, port: 4500, host: "::1" })
})

test("empty real environment values fall through to .env.local", () => {
  assert.deepEqual(resolveServerAddress([
    { PORT: "", HOST: " \t " },
    { PORT: "4500", HOST: "localhost" },
    { PORT: "5500", HOST: "::1" },
  ]), { ok: true, port: 4500, host: "localhost" })
})

test("empty or missing higher-priority values fall through to .env", () => {
  assert.deepEqual(resolveServerAddress([
    { PORT: " \t ", HOST: "" },
    { PORT: undefined, HOST: " " },
    { PORT: "5500", HOST: "::1" },
  ]), { ok: true, port: 5500, host: "::1" })
})

test("PORT and HOST are resolved independently from different sources", () => {
  assert.deepEqual(resolveServerAddress([
    { PORT: "3500", HOST: "" },
    { PORT: "4500", HOST: " localhost " },
    { PORT: "5500", HOST: "::1" },
  ]), { ok: true, port: 3500, host: "localhost" })
})

test("HOST can come from the real environment while PORT comes from a file", () => {
  assert.deepEqual(resolveServerAddress([
    { PORT: " ", HOST: "::1" },
    { PORT: "4500", HOST: "localhost" },
  ]), { ok: true, port: 4500, host: "::1" })
})

test("no sources use the default server address", () => {
  assert.deepEqual(resolveServerAddress([]), { ok: true, port: 24680, host: "127.0.0.1" })
})

test("exhausted empty sources use the default server address", () => {
  assert.deepEqual(resolveServerAddress([
    { PORT: "", HOST: undefined },
    { PORT: " \t ", HOST: "" },
    {},
  ]), { ok: true, port: 24680, host: "127.0.0.1" })
})

for (const [name, invalid] of [["PORT", "abc"], ["HOST", "0.0.0.0"]]) {
  for (const source of ["real environment", ".env.local"]) {
    test(`invalid ${name} in ${source} fails instead of falling through to a valid value`, () => {
      const invalidSource = { [name]: invalid }
      const sources = source === "real environment"
        ? [invalidSource, { PORT: "4500", HOST: "localhost" }, { PORT: "5500", HOST: "::1" }]
        : [{}, invalidSource, { PORT: "5500", HOST: "::1" }]
      const result = resolveServerAddress(sources)
      assert.equal(result.ok, false)
      assert.ok(result.message.includes(name), result.message)
      assert.ok(result.message.includes(invalid), result.message)
    })
  }
}
