import { test } from "node:test"
import assert from "node:assert/strict"
import { API_TIMEOUT_MS, requestApi } from "./request.ts"
import { ApiError } from "./response.ts"
import { cancelBrowserScan, pollBrowserScan, startBrowserScan } from "./scan-browser.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const envelope = (data, statusCode = 200) => ({ statusCode, message: "OK", data })
const unavailable = (error) => {
  assert.ok(error instanceof ApiError)
  assert.equal(error.statusCode, 503)
  assert.equal(error.code, "BACKEND_UNAVAILABLE")
  assert.equal(error.message.includes("TEST-private"), false)
  return true
}

test("fetch receives no-store even when init overrides it", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/scans")
    assert.equal(init.cache, "no-store")
    return Response.json(envelope({ scanId: "TEST-scan" }))
  })
  await requestApi("/api/scans", { cache: "force-cache" })
})

test("method, headers, body and a combined caller signal are forwarded", async (t) => {
  const controller = new AbortController()
  const headers = { "Content-Type": "application/json" }
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.method, "POST")
    assert.equal(init.headers, headers)
    assert.equal(init.body, "TEST-body")
    assert.ok(init.signal instanceof AbortSignal)
    assert.notEqual(init.signal, controller.signal)
    assert.equal(init.signal.aborted, false)
    controller.abort()
    assert.equal(init.signal.aborted, true)
    throw init.signal.reason
  })
  await assert.rejects(
    requestApi("/api/scans", { method: "POST", headers, body: "TEST-body", signal: controller.signal }),
    { name: "AbortError" }
  )
})

test("timeout is exactly 10000ms and its signal is passed to fetch", async (t) => {
  const timeout = new AbortController()
  assert.equal(API_TIMEOUT_MS, 10000)
  const factory = t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    assert.equal(milliseconds, 10000)
    return timeout.signal
  })
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.signal, timeout.signal)
    return Response.json(envelope("TEST-data"))
  })
  assert.deepEqual(await requestApi("/api/scans"), envelope("TEST-data"))
  assert.equal(factory.mock.callCount(), 1)
})

test("network rejection becomes safe 503 BACKEND_UNAVAILABLE", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("TEST-private connection error")
  })
  await assert.rejects(requestApi("/api/scans"), unavailable)
})

test("timeout becomes 503 BACKEND_UNAVAILABLE without a real 10s wait", async (t) => {
  const timeout = new AbortController()
  t.mock.method(AbortSignal, "timeout", () => timeout.signal)
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    timeout.abort(new DOMException("TEST-private timeout", "TimeoutError"))
    throw init.signal.reason
  })
  await assert.rejects(requestApi("/api/scans"), unavailable)
})

test("parser ApiError keeps its HTTP status, code and details", async (t) => {
  const body = {
    statusCode: 400,
    message: "Validation failed",
    code: "VALIDATION_ERROR",
    details: [{ property: "id" }],
  }
  t.mock.method(globalThis, "fetch", async () => Response.json(body, { status: 400 }))
  await assert.rejects(requestApi("/api/scans/TEST-invalid"), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.statusCode, body.statusCode)
    assert.equal(error.message, body.message)
    assert.equal(error.code, body.code)
    assert.deepEqual(error.details, body.details)
    return true
  })
})

test("malformed response stays INVALID_RESPONSE instead of becoming a network error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>TEST-private</html>"))
  await assert.rejects(requestApi("/api/scans"), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.statusCode, 502)
    assert.equal(error.code, "INVALID_RESPONSE")
    return true
  })
})

test("caller abort stays AbortError, including an already aborted custom reason", async (t) => {
  for (const reason of [undefined, "TEST-custom reason"]) {
    const controller = new AbortController()
    controller.abort(reason)
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      assert.equal(init.signal.aborted, true)
      throw init.signal.reason
    })
    await assert.rejects(requestApi("/api/scans", { signal: controller.signal }), { name: "AbortError" })
  }
})

test("timeout while reading the response body remains BACKEND_UNAVAILABLE", async (t) => {
  const timeout = new AbortController()
  t.mock.method(AbortSignal, "timeout", () => timeout.signal)
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(stream) {
      queueMicrotask(() => {
        timeout.abort(new DOMException("TEST-private body timeout", "TimeoutError"))
        stream.error(timeout.signal.reason)
      })
    },
  })))
  await assert.rejects(requestApi("/api/scans"), unavailable)
})

test("caller abort while reading the response body stays AbortError", async (t) => {
  const controller = new AbortController()
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(stream) {
      queueMicrotask(() => {
        controller.abort()
        stream.error(controller.signal.reason)
      })
    },
  })))
  await assert.rejects(requestApi("/api/scans", { signal: controller.signal }), { name: "AbortError" })
})

test("browser start/poll/cancel use only same-origin encoded paths and unwrap 202/200 payloads", async (t) => {
  const id = "TEST/id?query#hash %"
  const start = { scanId: id, status: "running" }
  const job = {
    ...start,
    partial: false,
    progress: { visitedDirs: 3, foundProjects: 1, skippedCount: 0 },
    startedAt: "2026-10-22T05:00:00.000Z",
  }
  const cancelled = { ...job, status: "cancelled", finishedAt: "2026-10-22T05:00:01.000Z" }
  const requests = [
    { path: "/api/scans", method: "POST", data: start, status: 202 },
    { path: `/api/scans/${encodeURIComponent(id)}`, method: "GET", data: job, status: 200 },
    { path: `/api/scans/${encodeURIComponent(id)}/cancel`, method: "POST", data: cancelled, status: 200 },
  ]
  const controller = new AbortController()
  let count = 0
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const expected = requests[count++]
    assert.equal(url, expected.path)
    assert.equal(init.method, expected.method)
    assert.equal(init.cache, "no-store")
    assert.ok(init.signal instanceof AbortSignal)
    assert.equal(init.body, undefined)
    return Response.json(envelope(expected.data, expected.status), { status: expected.status })
  })
  assert.deepEqual(await startBrowserScan(controller.signal), start)
  assert.deepEqual(await pollBrowserScan(id, controller.signal), job)
  assert.deepEqual(await cancelBrowserScan(id, controller.signal), cancelled)
  assert.equal(count, 3)
})
