import { test } from "node:test"
import assert from "node:assert/strict"
import { getBrowserRunnerContext, startBrowserNpmRun, getBrowserLatestNpmRun, pollBrowserNpmRun, getBrowserNpmRunLogs, cancelBrowserNpmRun } from "./npm-runs-browser.ts"

// TEST data; không phải yêu cầu nghiệp vụ.
const id = "00000000-0000-4000-8000-000000000001"
const path = "D:\\TEST\\Việt #&+"
const input = { path, action: "script", script: "dev", requestId: id, inputHash: "a".repeat(64) }
const calls = [s => getBrowserRunnerContext(path, s), s => startBrowserNpmRun(input, s), s => getBrowserLatestNpmRun(s), s => pollBrowserNpmRun(id, s), s => getBrowserNpmRunLogs(id, 17, s), s => cancelBrowserNpmRun(id, s)]

test("six browser calls use same origin, no-store, abort signals and exact write payloads", async t => {
  const requests = []
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init })
    return Response.json({ statusCode: 202, message: "TEST", data: { jobId: id } }, { status: 202 })
  })
  for (const call of calls) {
    const controller = new AbortController()
    assert.deepEqual(await call(controller.signal), { jobId: id })
    assert.equal(requests.at(-1).init.cache, "no-store")
    controller.abort()
    assert.equal(requests.at(-1).init.signal.aborted, true)
  }
  assert.deepEqual(requests.map(r => [new URL(r.url, "http://localhost").pathname, r.init.method]), [
    ["/api/npm-runs/context", "GET"], ["/api/npm-runs", "POST"], ["/api/npm-runs/latest", "GET"],
    [`/api/npm-runs/${id}`, "GET"], [`/api/npm-runs/${id}/logs`, "GET"], [`/api/npm-runs/${id}/cancel`, "POST"],
  ])
  assert.equal(new URL(requests[0].url, "http://localhost").searchParams.get("path"), path)
  assert.equal(new URL(requests[4].url, "http://localhost").searchParams.get("cursor"), "17")
  assert.deepEqual(JSON.parse(requests[1].init.body), input)
  assert.equal(new Headers(requests[1].init.headers).get("Content-Type"), "application/json")
  assert.equal(requests[5].init.body, undefined)
})

test("transport and parser failures never retry POST; conflicts retain reason and follow path", async t => {
  for (const call of calls) {
    let count = 0
    t.mock.method(globalThis, "fetch", async () => { count++; throw new Error("TEST offline") })
    await assert.rejects(call(), { code: "BACKEND_UNAVAILABLE" })
    assert.equal(count, 1)
    const details = { reason: "RUNNING", jobId: id, requestPath: path }
    t.mock.method(globalThis, "fetch", async () => Response.json({ statusCode: 409, message: "TEST", code: "CONFLICT", details }, { status: 409 }))
    await assert.rejects(call(), e => e.statusCode === 409 && assert.deepEqual(e.details, details) === undefined)
    t.mock.method(globalThis, "fetch", async () => new Response("TEST bad JSON"))
    await assert.rejects(call(), { code: "INVALID_RESPONSE" })
    const controller = new AbortController()
    controller.abort()
    t.mock.method(globalThis, "fetch", async (_url, init) => init.signal.throwIfAborted())
    await assert.rejects(call(controller.signal), { name: "AbortError" })
  }
})
