import { test } from "node:test"
import assert from "node:assert/strict"
import { startBrowserDiskUsage, pollBrowserDiskUsage, cancelBrowserDiskUsage } from "./disk-usage-browser.ts"
import { ApiError, toApiErrorResponse } from "./response.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const id = "TEST/job\\đo #&+%?"
const input = { path: "D:\\TEST\\Thư mục # & +\\node_modules", view: "packages", force: false }
const start = { jobId: id, status: "running" }
const job = { ...start, measuredAt: null, sizeBytes: null, partial: true }
const calls = [
  () => startBrowserDiskUsage(input),
  () => pollBrowserDiskUsage(id),
  () => cancelBrowserDiskUsage(id),
]
const envelope = (data, statusCode = 200) => ({ statusCode, message: "OK", code: "SUCCESS", data })

test("browser only calls /api/disk-usage", async (t) => {
  const requests = []
  const data = [start, job, { ...job, status: "cancelled" }]
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const index = requests.push({ url, init }) - 1
    const status = index === 0 ? 202 : 200
    return Response.json(envelope(data[index], status), { status })
  })
  for (const [index, call] of calls.entries()) assert.deepEqual(await call(), data[index])
  assert.deepEqual(requests.map(({ url, init }) => [url, init.method]), [
    ["/api/disk-usage", "POST"],
    [`/api/disk-usage/${encodeURIComponent(id)}`, "GET"],
    [`/api/disk-usage/${encodeURIComponent(id)}/cancel`, "POST"],
  ])
  assert.equal(requests[1].init.body, undefined)
  assert.equal(requests[2].init.body, undefined)
})

test("JSON POST and signal forwarded", async (t) => {
  for (const call of [
    (signal) => startBrowserDiskUsage(input, signal),
    (signal) => pollBrowserDiskUsage(id, signal),
    (signal) => cancelBrowserDiskUsage(id, signal),
  ]) {
    const controller = new AbortController()
    let request
    t.mock.method(globalThis, "fetch", async (url, init) => {
      request = { url, init }
      return Response.json(envelope(job))
    })
    await call(controller.signal)
    assert.ok(request.init.signal instanceof AbortSignal)
    assert.equal(request.init.signal.aborted, false)
    controller.abort()
    assert.equal(request.init.signal.aborted, true)
    if (request.url === "/api/disk-usage") {
      assert.equal(new Headers(request.init.headers).get("Content-Type"), "application/json")
      assert.deepEqual(JSON.parse(request.init.body), input)
    }
  }
})

test("cancel/get preserve envelope code", async (t) => {
  for (const call of calls) {
    for (const [status, code] of [[400, "VALIDATION_ERROR"], [403, "FORBIDDEN"], [404, "NOT_FOUND"], [409, "CONFLICT"], [429, "RATE_LIMITED"], [503, "SERVICE_UNAVAILABLE"]]) {
      const body = { statusCode: status, message: "TEST error", code, details: { jobId: id, path: input.path } }
      t.mock.method(globalThis, "fetch", async () => Response.json(body, { status }))
      await assert.rejects(call(), (error) => {
        assert.ok(error instanceof ApiError)
        assert.deepEqual(toApiErrorResponse(error, "/api/disk-usage").body.details, body.details)
        assert.equal(error.statusCode, status)
        assert.equal(error.code, code)
        assert.equal(error.message, body.message)
        return true
      })
    }
  }
})

test("no-store", async (t) => {
  const caches = []
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    caches.push(init.cache)
    return Response.json(envelope(job))
  })
  for (const call of calls) await call()
  assert.deepEqual(caches, ["no-store", "no-store", "no-store"])
})

test("abort and malformed payload errors use existing parser", async (t) => {
  for (const call of [
    (signal) => startBrowserDiskUsage(input, signal),
    (signal) => pollBrowserDiskUsage(id, signal),
    (signal) => cancelBrowserDiskUsage(id, signal),
  ]) {
    const controller = new AbortController()
    controller.abort("TEST abort")
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      init.signal.throwIfAborted()
      throw new Error("TEST expected an aborted signal")
    })
    await assert.rejects(call(controller.signal), { name: "AbortError" })
    for (const response of [new Response("TEST malformed JSON"), Response.json({ statusCode: 200, message: "OK" })]) {
      t.mock.method(globalThis, "fetch", async () => response)
      await assert.rejects(call(), (error) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.statusCode, 502)
        assert.equal(error.code, "INVALID_RESPONSE")
        return true
      })
    }
  }
})
