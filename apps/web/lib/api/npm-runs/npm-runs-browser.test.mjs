import { test } from "node:test"
import assert from "node:assert/strict"
import {
  getBrowserRunnerContext,
  startBrowserNpmRun,
  getBrowserLatestNpmRun,
  clearBrowserRecoveryHold,
  pollBrowserNpmRun,
  getBrowserNpmRunLogs,
  cancelBrowserNpmRun,
  getBrowserNpmRunTerminalOutput,
  claimBrowserNpmRunTerminal,
  sendBrowserNpmRunTerminalInput,
  getBrowserNpmRunTerminalInputAck,
  resizeBrowserNpmRunTerminal,
} from "./npm-runs-browser.ts"

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

test("five terminal browser calls use same origin, no-store, abort signals and exact payloads", async t => {
  const requests = []
  const tabId = "00000000-0000-4000-8000-000000000011"
  const token = "00000000-0000-4000-8000-000000000012"
  const claimBody = { requestId: id, generation: 1, tabId, takeover: false }
  const inputBody = { requestId: id, generation: 1, tabId, token, writerGeneration: 1, sequence: 1, text: "y\r" }
  const ackBody = { requestId: id, generation: 1, tabId, token, writerGeneration: 1, sequence: 1 }
  const resizeBody = { requestId: id, generation: 1, tabId, token, writerGeneration: 1, cols: 120, rows: 30 }
  const terminalCalls = [
    s => getBrowserNpmRunTerminalOutput(id, 1, 64, s),
    s => claimBrowserNpmRunTerminal(id, claimBody, s),
    s => sendBrowserNpmRunTerminalInput(id, inputBody, s),
    s => getBrowserNpmRunTerminalInputAck(id, ackBody, s),
    s => resizeBrowserNpmRunTerminal(id, resizeBody, s),
  ]
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init })
    return Response.json({ statusCode: 200, message: "TEST", data: { ok: true } }, { status: 200 })
  })
  for (const call of terminalCalls) {
    const controller = new AbortController()
    assert.deepEqual(await call(controller.signal), { ok: true })
    assert.equal(requests.at(-1).init.cache, "no-store")
    controller.abort()
    assert.equal(requests.at(-1).init.signal.aborted, true)
  }
  assert.deepEqual(requests.map(r => [new URL(r.url, "http://localhost").pathname, r.init.method]), [
    [`/api/npm-runs/${id}/terminal-output`, "GET"],
    [`/api/npm-runs/${id}/terminal-claim`, "POST"],
    [`/api/npm-runs/${id}/terminal-input`, "POST"],
    [`/api/npm-runs/${id}/terminal-input-ack`, "POST"],
    [`/api/npm-runs/${id}/terminal-resize`, "POST"],
  ])
  assert.equal(new URL(requests[0].url, "http://localhost").searchParams.get("generation"), "1")
  assert.equal(new URL(requests[0].url, "http://localhost").searchParams.get("cursor"), "64")
  assert.deepEqual(JSON.parse(requests[1].init.body), claimBody)
  assert.deepEqual(JSON.parse(requests[2].init.body), inputBody)
  assert.deepEqual(JSON.parse(requests[3].init.body), ackBody)
  assert.deepEqual(JSON.parse(requests[4].init.body), resizeBody)
})

test("clearBrowserRecoveryHold sends exact confirm body once and handles latest recovery hold union", async t => {
  const requests = []
  const holdPayload = { recoveryHold: { active: true, reason: "UNRESOLVED_NATIVE_SESSION", journalPath: "D:\\TEST\\journal.json" }, job: null }
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init })
    if (String(url).endsWith("/latest")) {
      return Response.json({ statusCode: 200, message: "TEST", data: holdPayload }, { status: 200 })
    }
    return Response.json({ statusCode: 200, message: "TEST", data: { cleared: true, recoveryHold: null } }, { status: 200 })
  })
  const controller = new AbortController()
  assert.deepEqual(await getBrowserLatestNpmRun(controller.signal), holdPayload)
  assert.deepEqual(await clearBrowserRecoveryHold({ confirm: true }, controller.signal), { cleared: true, recoveryHold: null })
  assert.equal(new URL(requests[1].url, "http://localhost").pathname, "/api/npm-runs/recovery/clear")
  assert.equal(requests[1].init.method, "POST")
  assert.equal(requests[1].init.cache, "no-store")
  assert.deepEqual(JSON.parse(requests[1].init.body), { confirm: true })
})
