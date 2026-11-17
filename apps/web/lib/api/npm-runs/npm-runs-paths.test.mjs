import { test } from "node:test"
import assert from "node:assert/strict"
import { npmRunsPaths } from "./npm-runs-paths.ts"

// TEST data; không phải yêu cầu nghiệp vụ.
test("runner URLs preserve local paths, encode ids and validate safe cursors", () => {
  const path = "D:\\TEST\\Tiếng Việt # & + %?"
  const id = "00000000-0000-4000-8000-000000000001"
  assert.equal(new URL(npmRunsPaths.context(path), "http://localhost").searchParams.get("path"), path)
  assert.equal(npmRunsPaths.start, "/npm-runs")
  assert.equal(npmRunsPaths.latest, "/npm-runs/latest")
  assert.equal(npmRunsPaths.recoveryClear, "/npm-runs/recovery/clear")
  assert.equal(npmRunsPaths.job(id), `/npm-runs/${id}`)
  assert.equal(npmRunsPaths.cancel("TEST/#?"), `/npm-runs/${encodeURIComponent("TEST/#?")}/cancel`)
  for (const cursor of [0, 42, Number.MAX_SAFE_INTEGER]) {
    assert.equal(new URL(npmRunsPaths.logs(id, cursor), "http://localhost").searchParams.get("cursor"), String(cursor))
  }
  for (const cursor of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => npmRunsPaths.logs(id, cursor), RangeError)
  }
})

test("terminal runner URLs encode ids and validate generation and cursor", () => {
  const id = "00000000-0000-4000-8000-000000000001"
  assert.equal(npmRunsPaths.terminalClaim(id), `/npm-runs/${id}/terminal-claim`)
  assert.equal(npmRunsPaths.terminalInput(id), `/npm-runs/${id}/terminal-input`)
  assert.equal(npmRunsPaths.terminalInputAck(id), `/npm-runs/${id}/terminal-input-ack`)
  assert.equal(npmRunsPaths.terminalResize(id), `/npm-runs/${id}/terminal-resize`)
  const outUrl = new URL(npmRunsPaths.terminalOutput(id, 2, 128), "http://localhost")
  assert.equal(outUrl.pathname, `/npm-runs/${id}/terminal-output`)
  assert.equal(outUrl.searchParams.get("generation"), "2")
  assert.equal(outUrl.searchParams.get("cursor"), "128")
  for (const badGen of [0, -1, 1.5, NaN]) {
    assert.throws(() => npmRunsPaths.terminalOutput(id, badGen, 0), RangeError)
  }
  for (const badCursor of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => npmRunsPaths.terminalOutput(id, 1, badCursor), RangeError)
  }
})
