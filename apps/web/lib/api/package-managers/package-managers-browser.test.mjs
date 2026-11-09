import { test } from "node:test"
import assert from "node:assert/strict"
import {
  getBrowserPmContext, startBrowserPmVersions, startBrowserPmPreview, executeBrowserPmPin,
  getBrowserLatestPmJob, pollBrowserPmJob, cancelBrowserPmJob,
} from "./package-managers-browser.ts"

// TEST data; not business requirements.
const id = "00000000-0000-4000-8000-000000000001"
const path = "D:\\TEST\\Việt #&+\\app"
const versions = { requestId: id, path, manager: "pnpm" }
const preview = { ...versions, targetVersion: "11.22.0" }
const execute = { requestId: id, previewId: id, confirm: true, acknowledgedRisks: ["RECENTLY_ACTIVE"] }
const cases = [
  [s => getBrowserPmContext(path, s), `/project?${new URLSearchParams({ path })}`, "GET"],
  [s => startBrowserPmVersions(versions, s), "/versions", "POST", versions],
  [s => startBrowserPmPreview(preview, s), "/project/preview", "POST", preview],
  [s => executeBrowserPmPin(execute, s), "/project/execute", "POST", execute],
  [s => getBrowserLatestPmJob(s), "/jobs/latest", "GET"],
  [s => pollBrowserPmJob(id, s), `/jobs/${id}`, "GET"],
  [s => cancelBrowserPmJob(id, s), `/jobs/${id}/cancel`, "POST"],
]

test("all seven browser calls use same origin, no-store, caller aborts and exact payloads", async t => {
  for (const [call, tail, method, body] of cases) {
    let captured
    const data = { jobId: id, requestId: id }
    t.mock.method(globalThis, "fetch", async (url, init) => {
      captured = { url, init }
      return Response.json({ statusCode: 200, message: "TEST", data })
    })
    const controller = new AbortController()
    assert.deepEqual(await call(controller.signal), data)
    assert.equal(captured.url, `/api/package-managers${tail}`)
    assert.equal(captured.init.method, method)
    assert.equal(captured.init.cache, "no-store")
    assert.equal(captured.init.body, body ? JSON.stringify(body) : undefined)
    assert.equal(new Headers(captured.init.headers).has("Authorization"), false)
    if (body) assert.equal(new Headers(captured.init.headers).get("Content-Type"), "application/json")
    controller.abort()
    assert.equal(captured.init.signal.aborted, true)
  }
})

test("latest preserves null; missing data and malformed envelopes are invalid", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ statusCode: 200, message: "TEST", data: null }))
  assert.equal(await getBrowserLatestPmJob(), null)
  for (const [call] of cases) {
    for (const body of [{ statusCode: 200, message: "TEST" }, { statusCode: 202, message: "TEST", data: {} }, []]) {
      t.mock.method(globalThis, "fetch", async () => Response.json(body))
      await assert.rejects(call(), { code: "INVALID_RESPONSE" })
    }
  }
})
