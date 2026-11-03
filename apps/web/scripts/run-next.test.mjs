import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const frontendDirectory = fileURLToPath(new URL("../", import.meta.url))
const scriptPath = fileURLToPath(new URL("./run-next.mjs", import.meta.url))

const run = (mode, overrides) => spawnSync(process.execPath, [scriptPath, mode], {
  cwd: frontendDirectory,
  env: { ...process.env, PORT: "3500", HOST: "127.0.0.1", ...overrides },
  encoding: "utf8",
  shell: false,
  timeout: 5000,
})

test("invalid PORT exits unsuccessfully with a PORT error before starting Next", () => {
  const result = run("dev", { PORT: "abc" })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.ok(Number.isInteger(result.status))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /PORT/)
})

test("non-loopback HOST exits unsuccessfully with a HOST error before starting Next", () => {
  const result = run("dev", { HOST: "0.0.0.0" })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.ok(Number.isInteger(result.status))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /HOST/)
})

test("unsupported build mode exits unsuccessfully with a mode error", () => {
  const result = run("build", { PORT: "abc" })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.ok(Number.isInteger(result.status))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /build/)
})
