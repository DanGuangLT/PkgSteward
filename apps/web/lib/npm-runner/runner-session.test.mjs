import { test } from "node:test"
import assert from "node:assert/strict"
import { ApiError } from "../api/response.ts"
import { createRunnerSession } from "./runner-session.ts"

// TEST data; không phải yêu cầu nghiệp vụ.
const path = "D:\\TEST"
const other = "D:\\TEST-other"
const id = "00000000-0000-4000-8000-000000000001"
const requestId = "00000000-0000-4000-8000-000000000002"
const context = (patch = {}) => ({ path, requestPath: path, scanId: "TEST-scan", inputHash: "a".repeat(64), manager: "npm", version: "11.0.0", available: true, reason: null, scripts: [{ name: "dev", command: "TEST", eligible: true }], warnings: [], ...patch })
const job = (patch = {}) => ({ jobId: id, requestId, path, requestPath: path, scanId: "TEST-scan", action: "install_all", manager: "npm", version: "11.0.0", package: null, script: null, status: "running", phase: "executing", startedAt: "TEST-time", finishedAt: null, spawned: true, exitCode: null, signal: null, failureCode: null, stopReason: null, terminationVerified: false, mayHaveChanged: true, gateHeld: true, auditWritten: false, refreshRequired: false, warningCodes: [], firstCursor: 0, endCursor: 0, droppedBytes: 0, ...patch })
const terminal = (patch = {}) => job({ status: "completed", phase: "done", gateHeld: false, terminationVerified: true, auditWritten: true, exitCode: 0, ...patch })
const page = (seqs = [], patch = {}) => ({ jobId: id, firstCursor: 0, nextCursor: seqs.at(-1) + 1 || 0, endCursor: seqs.at(-1) + 1 || 0, truncated: false, droppedBytes: 0, chunks: seqs.map(seq => ({ seq, stream: "stdout", text: `TEST-${seq}` })), ...patch })
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness(t) {
  let now = 0, serial = 0, visible = true
  const requests = [], timers = new Map(), listeners = new Set(), changes = [], mutations = []
  const api = Object.fromEntries(["context", "start", "latest", "get", "logs", "cancel"].map(method => [method, (...args) => {
    const pending = deferred()
    requests.push({ method, args, ...pending })
    return pending.promise
  }]))
  const session = createRunnerSession({ api,
    clock: { setTimeout(callback, delay) { const n = ++serial; timers.set(n, { at: now + delay, callback }); return n }, clearTimeout(n) { timers.delete(n) } },
    visibility: { isVisible: () => visible, subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) } },
    onChange: state => changes.push(state), onMutated: value => mutations.push(value.jobId), uuid: () => requestId,
  })
  t.after(() => session.dispose())
  const all = method => requests.filter(r => r.method === method)
  const last = method => all(method).at(-1)
  return { session, requests, timers, listeners, changes, mutations, all, last,
    async init() { const ready = session.refresh(context()); last("latest").reject(new ApiError(404, "TEST", "NOT_FOUND")); await ready },
    async start() { const ready = session.start({ action: "install_all" }); last("start").resolve({ jobId: id, requestId, status: "running" }); await ready; await flush() },
    async tick(ms) { now += ms; for (const [n, timer] of [...timers]) if (timer.at <= now) { timers.delete(n); timer.callback() }; await flush() },
    async visible(value) { visible = value; for (const cb of listeners) cb(); await flush() },
    async cycle(snapshot = job(), logs = page()) { last("get")?.resolve(snapshot); last("logs").resolve(logs); await flush() },
  }
}

test("one explicit UUID/POST and parallel status/log cycle; timer begins only after both settle", async t => {
  const h = harness(t)
  await h.init()
  await h.start()
  void h.session.start({ action: "install_all" })
  assert.equal(h.all("start").length, 1)
  assert.deepEqual(h.last("start").args[0], { path, action: "install_all", requestId, inputHash: "a".repeat(64) })
  assert.equal(h.all("get").length, 1)
  assert.equal(h.all("logs").length, 1)
  h.last("get").resolve(job())
  await flush()
  await h.tick(5000)
  assert.equal(h.timers.size, 0)
  assert.equal(h.all("get").length, 1)
  h.last("logs").resolve(page([0]))
  await flush()
  await h.tick(999)
  assert.equal(h.all("get").length, 1)
  await h.tick(1)
  assert.equal(h.all("get").length, 2)
  assert.equal(h.last("logs").args[1], 1)
})

test("hidden aborts both GETs; ignored abort must settle before resume at retained cursor", async t => {
  const h = harness(t)
  await h.init(); await h.start(); await h.cycle(job({ endCursor: 1 }), page([0])); await h.tick(1000)
  const oldGet = h.last("get"), oldLogs = h.last("logs")
  await h.visible(false)
  assert.equal(oldGet.args[1].aborted, true)
  assert.equal(oldLogs.args[2].aborted, true)
  await h.visible(true)
  assert.equal(h.all("get").length, 2)
  oldGet.resolve(terminal()); oldLogs.resolve(page([1]))
  await flush()
  assert.equal(h.session.getSnapshot().job.status, "running")
  assert.equal(h.all("get").length, 3)
  assert.equal(h.last("logs").args[1], 1)
})

test("terminal stops status polling and drains logs to endCursor; spawned job refreshes once", async t => {
  const h = harness(t)
  await h.init(); await h.start()
  await h.cycle(terminal({ endCursor: 3 }), page([0], { endCursor: 3 }))
  assert.deepEqual(h.mutations, [id])
  assert.equal(h.all("context").length, 1)
  h.last("context").resolve(context({ inputHash: "b".repeat(64) })); await flush()
  await h.tick(1000)
  assert.equal(h.all("get").length, 1)
  assert.equal(h.all("logs").length, 2)
  h.last("logs").resolve(page([1, 2])); await flush(); await h.tick(5000)
  assert.equal(h.session.getSnapshot().phase, "idle")
  assert.deepEqual(h.session.getSnapshot().logs.chunks.map(c => c.seq), [0, 1, 2])
  assert.deepEqual(h.mutations, [id])
  assert.equal(h.all("start").length, 1)
  const next = h.session.start({ action: "install_all" })
  assert.equal(h.all("start").length, 2)
  h.last("start").resolve({ jobId: "TEST-next", requestId, status: "running" }); await next
})

test("ambiguous start recovers only matching requestId using latest; never re-POSTs", async t => {
  for (const mismatch of [false, true, "missing"]) {
    const h = harness(t)
    await h.init()
    const started = h.session.start({ action: "install_all" })
    h.last("start").reject(new ApiError(503, "TEST", "BACKEND_UNAVAILABLE")); await flush()
    if (mismatch === "missing") h.last("latest").reject(new ApiError(404, "TEST", "NOT_FOUND"))
    else h.last("latest").resolve(job({ requestId: mismatch ? "TEST-other" : requestId }))
    await started; await flush()
    assert.equal(h.session.getSnapshot().startUnknown, Boolean(mismatch))
    void h.session.start({ action: "install_all" })
    await h.tick(5000)
    assert.equal(h.all("start").length, 1)
    assert.equal(h.all("get").length, mismatch ? 0 : 1)
  }
})

test("409 RUNNING offers follow without switching; READERS_RUNNING exposes busy reason", async t => {
  for (const reason of ["RUNNING", "READERS_RUNNING"]) {
    const h = harness(t)
    await h.init()
    const started = h.session.start({ action: "install_all" })
    h.last("start").reject(new ApiError(409, "TEST", "CONFLICT", { reason, jobId: id, requestPath: other })); await started
    assert.equal(h.session.getSnapshot().error.code, reason)
    assert.equal(h.session.getSnapshot().requestPath, path)
    assert.equal(h.all("get").length, 0)
    assert.equal(h.session.follow(), reason === "RUNNING" ? `/projects?${new URLSearchParams({ path: other })}` : null)
  }
})

test("mount discovers global active run; only same-path active job is followed automatically", async t => {
  for (const target of [path, other]) {
    const h = harness(t)
    const ready = h.session.refresh(context())
    h.last("latest").resolve(job({ requestPath: target, path: target })); await ready; await flush()
    assert.equal(h.all("start").length, 0)
    assert.equal(h.all("get").length, target === path ? 1 : 0)
    assert.equal(h.session.getSnapshot().requestPath, path)
    if (target !== path) assert.equal(h.session.getSnapshot().error.conflict.requestPath, other)
  }
})

test("poll network error pauses across visibility changes; retry/404 retain historical tail", async t => {
  const h = harness(t)
  await h.init(); await h.start(); await h.cycle(job({ endCursor: 1 }), page([0])); await h.tick(1000)
  h.last("get").reject(new ApiError(503, "TEST", "BACKEND_UNAVAILABLE")); h.last("logs").resolve(page([1])); await flush()
  await h.tick(5000); await h.visible(false); await h.visible(true)
  assert.equal(h.all("get").length, 2)
  assert.equal(h.session.getSnapshot().pollError, "BACKEND_UNAVAILABLE")
  h.session.retryPoll(); h.session.retryPoll()
  assert.equal(h.all("get").length, 3)
  h.last("get").reject(new ApiError(404, "TEST", "NOT_FOUND")); h.last("logs").reject(new ApiError(404, "TEST", "NOT_FOUND")); await flush()
  assert.equal(h.session.getSnapshot().phase, "lost")
  assert.deepEqual(h.session.getSnapshot().logs.chunks.map(c => c.seq), [0, 1])
  h.session.retryPoll(); await h.tick(5000)
  assert.equal(h.all("get").length, 3)
})

test("cancel once fences late polls; failed cancel stays unconfirmed until manual status retry", async t => {
  const h = harness(t)
  await h.init(); await h.start()
  const cancelled = h.session.cancel(); void h.session.cancel()
  assert.equal(h.all("cancel").length, 1)
  assert.equal(h.last("get").args[1].aborted, true)
  await h.cycle(terminal(), page([0]))
  h.last("cancel").reject(new Error("TEST unknown")); await cancelled
  assert.equal(h.session.getSnapshot().cancelUnknown, true)
  assert.equal(h.session.getSnapshot().job, null)
  await h.tick(5000)
  assert.equal(h.all("get").length, 1)
  h.session.retryPoll()
  await h.cycle(terminal({ status: "cancelled" }), page())
  assert.equal(h.session.getSnapshot().cancelUnknown, false)
  assert.equal(h.session.getSnapshot().job.status, "cancelled")
})

test("termination_failed/gateHeld disables Run; retry cleanup is same cancel endpoint and refresh once", async t => {
  const h = harness(t)
  await h.init(); await h.start()
  await h.cycle(terminal({ status: "termination_failed", failureCode: "TERMINATION_UNCONFIRMED", gateHeld: true, terminationVerified: false }), page())
  assert.deepEqual(h.mutations, [id])
  h.last("context").resolve(context()); await flush()
  await h.session.start({ action: "install_all" })
  assert.equal(h.all("start").length, 1)
  const cleaned = h.session.cancel()
  assert.equal(h.last("cancel").args[0], id)
  h.last("cancel").resolve(terminal({ status: "cancelled" })); await cleaned
  assert.deepEqual(h.mutations, [id])
  await h.tick(5000)
  assert.equal(h.all("get").length, 1)
})

test("path changes and dispose fence late start/status/log/context responses without stopping BE", async t => {
  const h = harness(t)
  await h.init(); await h.start()
  const oldGet = h.last("get"), oldLogs = h.last("logs")
  const refresh = h.session.refresh(context({ path: other, requestPath: other }))
  h.last("latest").reject(new ApiError(404, "TEST", "NOT_FOUND")); await refresh
  oldGet.resolve(terminal()); oldLogs.resolve(page([0])); await flush()
  assert.equal(h.session.getSnapshot().requestPath, other)
  assert.equal(h.session.getSnapshot().logs.chunks.length, 0)
  assert.deepEqual(h.mutations, [])
  const started = h.session.start({ action: "install_all" })
  const pending = h.last("start")
  const count = h.changes.length
  h.session.dispose()
  pending.resolve({ jobId: id, requestId, status: "running" }); await started
  assert.equal(h.changes.length, count)
  assert.equal(h.listeners.size, 0)
  assert.equal(h.all("cancel").length, 0)
})

test("preflight failure does not refresh; context GET failure preserves terminal logs and blocks stale input", async t => {
  for (const spawned of [false, true]) {
    const h = harness(t)
    await h.init(); await h.start(); await h.cycle(terminal({ status: "failed", spawned, failureCode: "INPUT_CHANGED", endCursor: 1 }), page([0]))
    assert.equal(h.all("context").length, spawned ? 1 : 0)
    if (spawned) {
      h.last("context").reject(new ApiError(503, "TEST", "BACKEND_UNAVAILABLE")); await flush()
      assert.equal(h.session.getSnapshot().context, null)
      assert.equal(h.session.getSnapshot().contextError, "BACKEND_UNAVAILABLE")
    }
    assert.equal(h.session.getSnapshot().logs.chunks.length, 1)
  }
})

test("mismatched status/log ids pause as invalid responses without corrupting job or tail", async t => {
  const h = harness(t)
  await h.init(); await h.start(); await h.cycle(job({ jobId: "TEST-wrong" }), page([0], { jobId: "TEST-wrong" }))
  assert.equal(h.session.getSnapshot().pollError, "INVALID_RESPONSE")
  assert.equal(h.session.getSnapshot().job, null)
  assert.equal(h.session.getSnapshot().logs.chunks.length, 0)
})

test("cleanup retry interrupts context refresh safely and re-reads context without duplicate mutation notification", async t => {
  const h = harness(t)
  await h.init(); await h.start()
  await h.cycle(terminal({ status: "termination_failed", gateHeld: true, failureCode: "AUDIT_WRITE_FAILED" }), page())
  const oldContext = h.last("context")
  const cleaned = h.session.cancel()
  assert.equal(oldContext.args[1].aborted, true)
  h.last("cancel").resolve(terminal({ status: "cancelled" })); await cleaned
  oldContext.resolve(context({ inputHash: "b".repeat(64) })); await flush()
  assert.equal(h.all("context").length, 2)
  h.last("context").resolve(context({ inputHash: "c".repeat(64) })); await flush()
  assert.equal(h.session.getSnapshot().refreshing, false)
  assert.equal(h.session.getSnapshot().context.inputHash, "c".repeat(64))
  assert.deepEqual(h.mutations, [id])
})

test("completed log drain cannot issue cancel POST", async t => {
  const h = harness(t)
  await h.init(); await h.start()
  await h.cycle(terminal({ endCursor: 3 }), page([0], { endCursor: 3 }))
  void h.session.cancel()
  assert.equal(h.all("cancel").length, 0)
})

test("every terminal outcome drains final logs; hidden mount and stale context callbacks stay fenced", async t => {
  for (const status of ["completed", "failed", "cancelled", "timed_out", "termination_failed"]) {
    const h = harness(t)
    await h.visible(false)
    await h.session.refresh(context())
    assert.equal(h.all("latest").length, 0)
    await h.visible(true)
    h.last("latest").resolve(job()); await flush()
    await h.cycle(terminal({ status, gateHeld: status === "termination_failed", endCursor: 1 }), page([0]))
    assert.deepEqual(h.mutations, [id])
    const oldContext = h.last("context")
    const switched = h.session.refresh(context({ requestPath: other, path: other }))
    h.last("latest").reject(new ApiError(404, "TEST", "NOT_FOUND")); await switched
    oldContext.resolve(context()); await flush()
    assert.equal(h.session.getSnapshot().context.requestPath, other)
    assert.equal(h.session.getSnapshot().refreshing, false)
    await h.tick(5000)
    assert.equal(h.all("get").length, 1)
  }
})

test("late start/cancel responses after route switch cannot adopt an old run", async t => {
  for (const command of ["start", "cancel"]) {
    const h = harness(t)
    await h.init()
    if (command === "cancel") { await h.start(); await h.cycle(job(), page()) }
    const pending = command === "start" ? h.session.start({ action: "install_all" }) : h.session.cancel()
    const old = h.last(command)
    const switched = h.session.refresh(context({ path: other, requestPath: other }))
    h.last("latest").reject(new ApiError(404, "TEST", "NOT_FOUND")); await switched
    old.resolve(command === "start" ? { jobId: id, requestId, status: "running" } : terminal())
    await pending
    assert.equal(old.args[1].aborted, true)
    assert.equal(h.session.getSnapshot().jobId, null)
    assert.equal(h.session.getSnapshot().requestPath, other)
    assert.deepEqual(h.mutations, [])
  }
})

function deferredCall(args) {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { args, promise, resolve, reject }
}

function terminalHarness(t, initialPath = "D:/work/app-a") {
  const flush = () => new Promise(resolve => setImmediate(resolve))
  const timers = new Map()
  let nextTimer = 1
  let visible = true
  let visibleListener = () => {}
  let nextUuid = 0
  const calls = {
    context: [], start: [], latest: [], get: [], logs: [], cancel: [],
    terminalOutput: [], claimTerminal: [], terminalInput: [], terminalInputAck: [], resizeTerminal: [],
  }
  const makeCall = (name) => (...args) => {
    const entry = deferredCall(args)
    calls[name].push(entry)
    return entry.promise
  }
  const api = {
    context: makeCall("context"),
    start: makeCall("start"),
    latest: makeCall("latest"),
    get: makeCall("get"),
    logs: makeCall("logs"),
    cancel: makeCall("cancel"),
    terminalOutput: makeCall("terminalOutput"),
    claimTerminal: makeCall("claimTerminal"),
    terminalInput: makeCall("terminalInput"),
    terminalInputAck: makeCall("terminalInputAck"),
    resizeTerminal: makeCall("resizeTerminal"),
  }
  const mutations = []
  const session = createRunnerSession({
    api,
    clock: {
      setTimeout(cb, delay) { const handle = nextTimer++; timers.set(handle, { cb, delay }); return handle },
      clearTimeout(handle) { timers.delete(handle) },
    },
    visibility: {
      isVisible() { return visible },
      subscribe(cb) { visibleListener = cb; return () => { visibleListener = () => {} } },
    },
    onChange() {},
    onMutated(j) { mutations.push(j) },
    uuid: () => `00000000-0000-4000-8000-${String(++nextUuid).padStart(12, "0")}`,
  })
  t.after(() => session.dispose())

  const makeContext = (reqPath = initialPath) => ({
    requestPath: reqPath,
    path: reqPath,
    scanId: "scan-1",
    inputHash: "b".repeat(64),
    manager: "npm",
    version: "11.0.0",
    available: true,
    terminalAvailable: true,
    reason: null,
    scripts: [],
    warnings: [],
  })
  const makeJob = (over = {}) => ({
    jobId: "00000000-0000-4000-8000-000000000901",
    requestId: session.getSnapshot().requestId ?? "00000000-0000-4000-8000-000000000002",
    status: "running",
    requestPath: initialPath,
    path: initialPath,
    scanId: "scan-1",
    action: "install_all",
    manager: "npm",
    version: "11.0.0",
    package: null,
    script: null,
    phase: "executing",
    startedAt: "2026-11-16T00:00:00.000Z",
    finishedAt: null,
    spawned: true,
    exitCode: null,
    signal: null,
    failureCode: null,
    stopReason: null,
    terminationVerified: false,
    mayHaveChanged: false,
    gateHeld: false,
    auditWritten: false,
    refreshRequired: false,
    warningCodes: [],
    firstCursor: 0,
    endCursor: 0,
    droppedBytes: 0,
    terminal: {
      mode: "pty",
      generation: 1,
      available: true,
      ready: true,
      firstCursor: 0,
      endCursor: 0,
      droppedBytes: 0,
      writerGeneration: null,
      inputBlocked: false,
    },
    ...over,
  })
  const emptyLogs = (jobId = "00000000-0000-4000-8000-000000000901") => ({
    jobId,
    firstCursor: 0,
    nextCursor: 0,
    endCursor: 0,
    truncated: false,
    droppedBytes: 0,
    chunks: [],
  })

  async function fireTimers() {
    const entries = [...timers.entries()]
    timers.clear()
    for (const [, entry] of entries) entry.cb()
    await flush()
  }

  return {
    session,
    calls,
    mutations,
    flush,
    fireTimers,
    makeContext,
    makeJob,
    emptyLogs,
    setVisible(next) { visible = next; visibleListener() },
    last(name) { return calls[name][calls[name].length - 1] },
  }
}

test("terminal session polls terminalOutput and drains trailing output after completion", async t => {
  const h = terminalHarness(t)
  const p = h.session.refresh(h.makeContext())
  h.last("latest").reject(new ApiError(404, "NONE", "NOT_FOUND"))
  await p

  h.session.resizeTerminal(100, 32)
  const startP = h.session.start({ action: "install_all" })
  assert.equal(h.last("start").args[0].terminal, true)
  assert.equal(h.last("start").args[0].cols, 100)
  assert.equal(h.last("start").args[0].rows, 32)
  h.last("start").resolve({
    jobId: "00000000-0000-4000-8000-000000000901",
    requestId: h.last("start").args[0].requestId,
    status: "running",
  })
  await startP

  // Cycle 1 discovers terminal.available = true and ready = true
  h.last("get").resolve(h.makeJob({ terminal: { mode: "pty", generation: 1, available: true, ready: true, firstCursor: 0, endCursor: 6, droppedBytes: 0, writerGeneration: null, inputBlocked: false } }))
  h.last("logs").resolve(h.emptyLogs())
  await h.flush()

  // Cycle 2 fetches first terminal chunk while job finishes with more unread output
  await h.fireTimers()
  h.last("get").resolve(h.makeJob({
    status: "completed",
    phase: "done",
    finishedAt: "2026-11-16T00:00:02.000Z",
    exitCode: 0,
    terminationVerified: true,
    auditWritten: true,
    terminal: { mode: "pty", generation: 1, available: true, ready: false, firstCursor: 0, endCursor: 12, droppedBytes: 0, writerGeneration: null, inputBlocked: false },
  }))
  h.last("logs").resolve(h.emptyLogs())
  h.last("terminalOutput").resolve({
    jobId: "00000000-0000-4000-8000-000000000901",
    generation: 1,
    firstCursor: 0,
    nextCursor: 6,
    endCursor: 12,
    gap: false,
    truncated: false,
    parserReset: false,
    droppedBytes: 0,
    chunks: [{ cursor: 0, endCursor: 6, text: "ready\n" }],
  })
  await h.flush()
  assert.equal(h.session.getSnapshot().phase, "tracking")

  // Cycle 3 drains trailing terminal output (cursor 6 -> 12) then becomes idle
  await h.fireTimers()
  h.last("logs").resolve(h.emptyLogs())
  h.last("terminalOutput").resolve({
    jobId: "00000000-0000-4000-8000-000000000901",
    generation: 1,
    firstCursor: 0,
    nextCursor: 12,
    endCursor: 12,
    gap: false,
    truncated: false,
    parserReset: false,
    droppedBytes: 0,
    chunks: [{ cursor: 6, endCursor: 12, text: "done!\n" }],
  })
  await h.flush()
  assert.equal(h.session.getSnapshot().phase, "idle")
  assert.equal(h.session.getSnapshot().terminal.output.chunks.map(c => c.text).join(""), "ready\ndone!\n")
})

test("terminal writer claim, single-flight input, unknown-ack reconciliation, and takeover blocking", async t => {
  const h = terminalHarness(t)
  const p = h.session.refresh(h.makeContext())
  h.last("latest").reject(new ApiError(404, "NONE", "NOT_FOUND"))
  await p

  const startP = h.session.start({ action: "install_all" })
  h.last("start").resolve({
    jobId: "00000000-0000-4000-8000-000000000901",
    requestId: h.last("start").args[0].requestId,
    status: "running",
  })
  await startP
  h.last("get").resolve(h.makeJob())
  h.last("logs").resolve(h.emptyLogs())
  await h.flush()

  const claimP = h.session.claimTerminal(false)
  h.last("claimTerminal").resolve({
    tabId: h.session.getSnapshot().terminal.tabId,
    token: "tok-1",
    writerGeneration: 1,
  })
  await claimP
  assert.equal(h.session.getSnapshot().terminal.writer?.writerGeneration, 1)

  const input1 = h.session.sendTerminalInput("y\r")
  // Concurrent input while in-flight is ignored (single-flight)
  const inputConcurrent = h.session.sendTerminalInput("z\r")
  assert.equal(h.calls.terminalInput.length, 1)
  h.last("terminalInput").reject(new ApiError(504, "Gateway timeout", "GATEWAY_TIMEOUT"))
  await Promise.all([input1, inputConcurrent])

  assert.equal(h.session.getSnapshot().terminal.inputUnknown, true)
  assert.equal(h.session.getSnapshot().terminal.pendingSequence, 1)

  // Blocking: neither new input nor takeover may run while inputUnknown is true
  await h.session.sendTerminalInput("n\r")
  await h.session.claimTerminal(true)
  assert.equal(h.calls.terminalInput.length, 1)
  assert.equal(h.calls.claimTerminal.length, 1)

  // Reconcile resolves unknown state via terminalInputAck
  const ackP = h.session.reconcileTerminalInput()
  assert.equal(h.last("terminalInputAck").args[1].sequence, 1)
  h.last("terminalInputAck").resolve({
    jobId: "00000000-0000-4000-8000-000000000901",
    generation: 1,
    writerGeneration: 1,
    sequence: 1,
    status: "delivered",
    receivedAt: 1000,
  })
  await ackP
  assert.equal(h.session.getSnapshot().terminal.inputUnknown, false)
  assert.equal(h.session.getSnapshot().terminal.pendingSequence, null)

  const input2 = h.session.sendTerminalInput("n\r")
  assert.equal(h.last("terminalInput").args[1].sequence, 2)
  h.last("terminalInput").resolve({
    jobId: "00000000-0000-4000-8000-000000000901",
    generation: 1,
    writerGeneration: 1,
    sequence: 2,
    status: "delivered",
    receivedAt: 2000,
  })
  await input2
  assert.equal(h.session.getSnapshot().terminal.nextSequence, 3)
})

test("terminal resize coalesces rapid changes and sends clamped size with writer lease", async t => {
  const h = terminalHarness(t)
  const p = h.session.refresh(h.makeContext())
  h.last("latest").reject(new ApiError(404, "NONE", "NOT_FOUND"))
  await p

  const startP = h.session.start({ action: "install_all" })
  h.last("start").resolve({
    jobId: "00000000-0000-4000-8000-000000000901",
    requestId: h.last("start").args[0].requestId,
    status: "running",
  })
  await startP
  h.last("get").resolve(h.makeJob())
  h.last("logs").resolve(h.emptyLogs())
  await h.flush()

  const claimP = h.session.claimTerminal(false)
  h.last("claimTerminal").resolve({
    tabId: h.session.getSnapshot().terminal.tabId,
    token: "tok-2",
    writerGeneration: 2,
  })
  await claimP

  h.session.resizeTerminal(1, 24) // invalid -> ignored
  h.session.resizeTerminal(90, 24)
  h.session.resizeTerminal(120, 40)
  assert.equal(h.calls.resizeTerminal.length, 0)

  await h.fireTimers()
  assert.equal(h.calls.resizeTerminal.length, 1)
  assert.equal(h.last("resizeTerminal").args[1].cols, 120)
  assert.equal(h.last("resizeTerminal").args[1].rows, 40)
  assert.equal(h.last("resizeTerminal").args[1].writerGeneration, 2)
  h.last("resizeTerminal").resolve({ queued: true })
  await h.flush()
})

test("syncProjectContext preserves active terminal run and Stop capability across route navigation", async t => {
  const h = terminalHarness(t, "D:/work/app-a")
  const p = h.session.refresh(h.makeContext("D:/work/app-a"))
  h.last("latest").reject(new ApiError(404, "NONE", "NOT_FOUND"))
  await p

  const startP = h.session.start({ action: "install_all" })
  h.last("start").resolve({
    jobId: "00000000-0000-4000-8000-000000000901",
    requestId: h.last("start").args[0].requestId,
    status: "running",
  })
  await startP
  h.last("get").resolve(h.makeJob())
  h.last("logs").resolve(h.emptyLogs())
  await h.flush()

  await h.fireTimers()
  h.last("get").resolve(h.makeJob({
    terminal: { mode: "pty", generation: 1, available: true, ready: true, firstCursor: 0, endCursor: 7, droppedBytes: 0, writerGeneration: null, inputBlocked: false },
  }))
  h.last("logs").resolve(h.emptyLogs())
  h.last("terminalOutput").resolve({
    jobId: "00000000-0000-4000-8000-000000000901",
    generation: 1,
    firstCursor: 0,
    nextCursor: 7,
    endCursor: 7,
    gap: false,
    truncated: false,
    parserReset: false,
    droppedBytes: 0,
    chunks: [{ cursor: 0, endCursor: 7, text: "step 1\n" }],
  })
  await h.flush()

  // Switch route/project context while job is running
  h.session.syncProjectContext(h.makeContext("D:/work/app-b"), "D:/work/app-b")
  assert.equal(h.session.getSnapshot().requestPath, "D:/work/app-b")
  assert.equal(h.session.getSnapshot().jobId, "00000000-0000-4000-8000-000000000901")
  assert.equal(h.session.getSnapshot().phase, "tracking")
  assert.equal(h.session.getSnapshot().terminal.output.chunks.map(c => c.text).join(""), "step 1\n")

  // Stop still works after route navigation
  const cancelP = h.session.cancel()
  assert.equal(h.calls.cancel.length, 1)
  assert.equal(h.last("cancel").args[0], "00000000-0000-4000-8000-000000000901")
  h.last("cancel").resolve(h.makeJob({
    status: "cancelled",
    phase: "done",
    finishedAt: "2026-11-16T00:00:03.000Z",
    stopReason: "cancel",
    terminationVerified: true,
    auditWritten: true,
    terminal: { mode: "pty", generation: 1, available: true, ready: false, firstCursor: 0, endCursor: 7, droppedBytes: 0, writerGeneration: null, inputBlocked: false },
  }))
  await cancelP
  assert.equal(h.session.getSnapshot().phase, "idle")
})
