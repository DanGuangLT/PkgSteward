import { test } from "node:test"
import assert from "node:assert/strict"
import {
  cancelBrowserOperation, cancelBrowserPreview, executeBrowserDelete, getBrowserActiveOperation, getBrowserFileTree,
  pollBrowserOperation, pollBrowserPreview, startBrowserCleanupPreview, startBrowserDeletePreview, summarizeBrowserPreview,
} from "./file-ops-browser.ts"
import { API_TIMEOUT_MS } from "./request.ts"
import { ApiError } from "./response.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const id = "TEST/mã #&+%?"
const encoded = encodeURIComponent(id)
const paths = ["D:\\TEST\\Thư mục # & +\\node_modules"]
const execute = { previewId: id, paths, confirm: true, acknowledgedRisks: ["NO_LOCKFILE"], confirmText: "DELETE 1" }
const cleanup = { includeKinds: ["node_modules"], olderThanDays: 30 }
const envelope = (data, statusCode = 200) => ({ statusCode, message: "OK", code: "SUCCESS", data })

const calls = [
  ["POST", "/api/file-ops/cleanup/preview", (signal) => startBrowserCleanupPreview(cleanup, signal), cleanup],
  ["POST", "/api/file-ops/delete/preview", (signal) => startBrowserDeletePreview(paths, signal), { paths }],
  ["GET", `/api/file-ops/previews/${encoded}`, (signal) => pollBrowserPreview(id, signal)],
  ["POST", `/api/file-ops/previews/${encoded}/cancel`, (signal) => cancelBrowserPreview(id, signal)],
  ["POST", `/api/file-ops/previews/${encoded}/summary`, (signal) => summarizeBrowserPreview(id, paths, signal), { paths }],
  ["POST", "/api/file-ops/delete/execute", (signal) => executeBrowserDelete(execute, signal), execute],
  ["GET", "/api/file-ops/operations/active", (signal) => getBrowserActiveOperation(signal)],
  ["GET", `/api/file-ops/operations/${encoded}`, (signal) => pollBrowserOperation(id, signal)],
  ["POST", `/api/file-ops/operations/${encoded}/cancel`, (signal) => cancelBrowserOperation(id, signal)],
  ["GET", `/api/file-ops/tree?${new URLSearchParams({ path: paths[0] })}`, (signal) => getBrowserFileTree(paths[0], signal)],
]

test("browser only calls same-origin /api/file-ops with no-store and JSON bodies", async (t) => {
  for (const [method, url, call, body] of calls) {
    let request
    t.mock.method(globalThis, "fetch", async (target, init) => {
      request = { target, init }
      return Response.json(envelope({ TEST: true }))
    })
    assert.deepEqual(await call(), { TEST: true })
    assert.equal(request.target, url)
    assert.equal(request.init.method, method)
    assert.equal(request.init.cache, "no-store")
    if (body === undefined) {
      assert.equal(request.init.body, undefined)
    } else {
      assert.equal(new Headers(request.init.headers).get("Content-Type"), "application/json")
      assert.deepEqual(JSON.parse(request.init.body), body)
    }
  }
})

test("caller signal is forwarded", async (t) => {
  for (const [, , call] of calls) {
    const controller = new AbortController()
    let signal
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      signal = init.signal
      return Response.json(envelope({ TEST: true }))
    })
    await call(controller.signal)
    assert.equal(signal.aborted, false)
    controller.abort()
    assert.equal(signal.aborted, true)
  }
})

test("error codes and details survive for every call", async (t) => {
  for (const [, , call] of calls) {
    for (const [status, code] of [
      [400, "VALIDATION_ERROR"], [404, "NOT_FOUND"], [409, "RISK_CHANGED"], [409, "TARGET_CHANGED"],
      [409, "SCAN_CHANGED"], [413, "PAYLOAD_TOO_LARGE"], [429, "RATE_LIMITED"],
    ]) {
      const details = { paths }
      t.mock.method(globalThis, "fetch", async () => Response.json({ statusCode: status, message: "TEST error", code, details }, { status }))
      await assert.rejects(call(), (error) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.statusCode, status)
        assert.equal(error.code, code)
        assert.deepEqual(error.details, details)
        return true
      })
    }
  }
})

test("no active operation is null, not an invalid response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(envelope(null)))
  assert.equal(await getBrowserActiveOperation(), null)
})

test("only execute waits past the shared timeout", async (t) => {
  const factory = t.mock.method(AbortSignal, "timeout", () => new AbortController().signal)
  t.mock.method(globalThis, "fetch", async () => Response.json(envelope({ TEST: true })))
  await executeBrowserDelete(execute)
  assert.equal(factory.mock.callCount(), 0)
  await pollBrowserPreview(id)
  assert.equal(factory.mock.callCount(), 1)
  assert.equal(factory.mock.calls[0].arguments[0], API_TIMEOUT_MS)
})
