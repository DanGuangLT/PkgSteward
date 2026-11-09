import { test } from "node:test"
import assert from "node:assert/strict"
import {
  getBrowserGlobalSnapshot, startBrowserGlobalInventory, startBrowserGlobalVersions,
  startBrowserGlobalPreview, executeBrowserGlobalPackage, getBrowserLatestGlobalJob,
  pollBrowserGlobalJob, getBrowserGlobalLogs, cancelBrowserGlobalJob,
} from "./global-packages-browser.ts"

// TEST data; not business requirements.
const id = "00000000-0000-4000-8000-000000000001"
const activity = { requestId: id }
const versions = { ...activity, manager: "pnpm", package: "@test/Việt #&+" }
const preview = { ...versions, action: "change", targetVersion: "1.2.3" }
const execute = { ...activity, previewId: id, confirm: true, acknowledgedRisks: ["MACHINE_WIDE"], confirmText: "TEST exact text" }
const cases = [
  [s => getBrowserGlobalSnapshot(s), "", "GET"],
  [s => startBrowserGlobalInventory(activity, s), "/inventory", "POST", activity],
  [s => startBrowserGlobalVersions(versions, s), "/versions", "POST", versions],
  [s => startBrowserGlobalPreview(preview, s), "/preview", "POST", preview],
  [s => executeBrowserGlobalPackage(execute, s), "/execute", "POST", execute],
  [s => getBrowserLatestGlobalJob(s), "/jobs/latest", "GET"],
  [s => pollBrowserGlobalJob(id, s), `/jobs/${id}`, "GET"],
  [s => getBrowserGlobalLogs(id, 17, s), `/jobs/${id}/logs?cursor=17`, "GET"],
  [s => cancelBrowserGlobalJob(id, s), `/jobs/${id}/cancel`, "POST"],
]

test("all nine browser calls use same origin, no-store, caller aborts and exact payloads", async t => {
  for (const [call, tail, method, body] of cases) {
    let captured
    const data = { jobId: id, requestId: id }
    t.mock.method(globalThis, "fetch", async (url, init) => {
      captured = { url, init }
      return Response.json({ statusCode: 200, message: "TEST", data })
    })
    const controller = new AbortController()
    assert.deepEqual(await call(controller.signal), data)
    assert.equal(captured.url, `/api/global-packages${tail}`)
    assert.equal(captured.init.method, method)
    assert.equal(captured.init.cache, "no-store")
    assert.equal(captured.init.body, body ? JSON.stringify(body) : undefined)
    assert.equal(new Headers(captured.init.headers).has("Authorization"), false)
    if (body) assert.equal(new Headers(captured.init.headers).get("Content-Type"), "application/json")
    controller.abort()
    assert.equal(captured.init.signal.aborted, true)
  }
})

test("snapshot/latest preserve null; missing data and malformed envelopes are invalid", async t => {
  for (const call of [getBrowserGlobalSnapshot, getBrowserLatestGlobalJob]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ statusCode: 200, message: "TEST", data: null }))
    assert.equal(await call(), null)
  }
  for (const [call] of cases) {
    for (const body of [{ statusCode: 200, message: "TEST" }, { statusCode: 202, message: "TEST", data: {} }, []]) {
      t.mock.method(globalThis, "fetch", async () => Response.json(body))
      await assert.rejects(call(), { code: "INVALID_RESPONSE" })
    }
  }
})

test("transport/body failures do not retry; structured error reasons survive", async t => {
  for (const [call] of cases) {
    let count = 0
    t.mock.method(globalThis, "fetch", async () => { count++; throw new Error("TEST offline") })
    await assert.rejects(call(), { code: "BACKEND_UNAVAILABLE" })
    assert.equal(count, 1)
    t.mock.method(globalThis, "fetch", async () => new Response("TEST invalid JSON"))
    await assert.rejects(call(), { code: "INVALID_RESPONSE" })
    const details = { reason: "PREVIEW_CHANGED" }
    t.mock.method(globalThis, "fetch", async () => Response.json({ statusCode: 409, message: "TEST", code: "CONFLICT", details }, { status: 409 }))
    await assert.rejects(call(), e => e.code === "CONFLICT" && e.statusCode === 409 && assert.deepEqual(e.details, details) === undefined)
    const controller = new AbortController()
    controller.abort()
    t.mock.method(globalThis, "fetch", async (_url, init) => init.signal.throwIfAborted())
    await assert.rejects(call(controller.signal), { name: "AbortError" })
  }
})

test("every POST has no timeout signal and never retries an ambiguous body read", async t => {
  for (const [call, , method] of cases) {
    if (method !== "POST") continue
    const controller = new AbortController()
    let count = 0
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      count++
      assert.equal(init.signal, controller.signal)
      return new Response(new ReadableStream({ start(stream) { stream.error(new Error("TEST dropped body")) } }))
    })
    await assert.rejects(call(controller.signal), { code: "INVALID_RESPONSE" })
    assert.equal(count, 1)
  }
})
