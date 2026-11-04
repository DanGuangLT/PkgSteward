import { test } from "node:test"
import assert from "node:assert/strict"
import { ApiError } from "../api/response.ts"
import { createGlobalSession, initialGlobalState } from "./global-session.ts"
import { RUNNER_LOG_MAX_BYTES, RUNNER_LOG_MAX_CHUNKS } from "../npm-runner/runner-log-view.ts"

// TEST data; not business requirements. All IO, timers and visibility are fakes.
const id = "00000000-0000-4000-8000-000000000001"
const requestId = "00000000-0000-4000-8000-000000000002"
const previewId = "00000000-0000-4000-8000-000000000003"
const epoch = Date.parse("2026-01-01T00:00:00Z")
const selection = { manager: "npm", package: "@test/tool", action: "remove" }
const snapshot = { revision: "TEST-revision", asOf: new Date(epoch).toISOString(), stale: false, managers: [] }
const preview = {
  ...selection, previewId, createdAt: new Date(epoch).toISOString(), expiresAt: new Date(epoch + 300000).toISOString(),
  managerVersion: "11.0.0", currentVersion: "1.0.0", requestedVersion: null, targetVersion: null,
  globalRoot: "D:\\TEST\\node_modules", binDir: "D:\\TEST", bins: { before: [], after: [], added: [], removed: [], replaced: [] },
  warningCodes: ["GLOBAL_CONSUMERS_UNKNOWN"], risk: { level: "high", reasons: [{ code: "MACHINE_WIDE", level: "high", message: "TEST" }] },
  confirmText: "REMOVE GLOBAL npm @test/tool",
}
const job = (patch = {}) => ({
  jobId: id, requestId, previewId: null, kind: "inventory", manager: null, managerVersion: null, action: null, package: null,
  currentVersion: null, targetVersion: null, status: "running", phase: "preflight", startedAt: new Date(epoch).toISOString(),
  finishedAt: null, mutationSpawned: false, mayHaveChanged: false, exitCode: null, signal: null, stopReason: null,
  terminationVerified: false, gateHeld: false, auditWritten: false, refreshRequired: false, failureCode: null,
  warningCodes: [], firstCursor: 0, endCursor: 0, droppedBytes: 0, preview: null, versions: null, ...patch,
})
const terminal = (patch = {}) => job({ status: "completed", phase: "done", finishedAt: new Date(epoch).toISOString(), terminationVerified: true, auditWritten: true, exitCode: 0, ...patch })
const page = (seqs = [], patch = {}) => ({
  jobId: id, firstCursor: 0, nextCursor: seqs.length ? seqs.at(-1) + 1 : 0, endCursor: seqs.length ? seqs.at(-1) + 1 : 0,
  droppedBytes: 0, truncated: false, chunks: seqs.map(seq => ({ seq, stream: "stdout", text: `TEST-${seq}` })), ...patch,
})
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness(t) {
  let now = epoch, visible = true, serial = 0
  const requests = [], timers = new Map(), listeners = new Set(), changes = [], mutations = []
  const api = Object.fromEntries(["snapshot", "inventory", "versions", "preview", "execute", "latest", "get", "logs", "cancel"].map(method => [method, (...args) => {
    const pending = deferred()
    requests.push({ method, args, ...pending })
    return pending.promise
  }]))
  const session = createGlobalSession({ api,
    clock: { now: () => now, setTimeout(callback, delay) { const n = ++serial; timers.set(n, { at: now + delay, callback }); return n }, clearTimeout(n) { timers.delete(n) } },
    visibility: { isVisible: () => visible, subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) } },
    onChange: state => changes.push(state), onMutated: value => mutations.push(value.jobId), uuid: () => requestId,
  })
  t.after(() => session.dispose())
  const all = method => requests.filter(r => r.method === method)
  const last = method => all(method).at(-1)
  return { session, requests, timers, listeners, changes, mutations, all, last,
    async init(latest = null) { await session.refresh(snapshot, latest); await flush() },
    async start() { const done = session.inventory(); last("inventory").resolve({ jobId: id, requestId, previewId: null, status: "running" }); await done; await flush() },
    async ready() { session.select(selection); await session.refresh(snapshot, terminal({ kind: "preview", ...selection, previewId, preview })); session.consent({ acknowledged: true, confirmText: preview.confirmText }); await flush() },
    async mutate() { await this.ready(); const done = session.execute(); last("execute").resolve({ jobId: id, requestId, previewId, status: "running" }); await done; await flush() },
    async tick(ms) { now += ms; for (const [n, timer] of [...timers]) if (timer.at <= now) { timers.delete(n); timer.callback() }; await flush() },
    async visible(value) { visible = value; for (const cb of listeners) cb(); await flush() },
    async cycle(status = job(), output = page()) { last("get")?.resolve(status); last("logs")?.resolve(output); await flush() },
  }
}

test("initial state and server seeding perform no implicit activity POST", async t => {
  const initial = initialGlobalState()
  assert.equal(initial.phase, "idle")
  assert.equal(initial.startUnknown, false)
  assert.equal(initial.form.preview, null)
  const h = harness(t)
  await h.init()
  assert.equal(h.requests.length, 0)
  assert.deepEqual(h.session.getSnapshot().snapshot, snapshot)
  await h.session.refresh(snapshot, job())
  assert.equal(h.all("get").length, 1)
  assert.equal(h.all("inventory").length, 0)
})

test("one activity slot; status/log run once per cycle; next timer is 1s after both settle", async t => {
  const h = harness(t)
  await h.init(); await h.start()
  void h.session.inventory(); void h.session.loadVersions(selection); void h.session.preview(selection)
  assert.equal(h.all("inventory").length, 1)
  assert.deepEqual(h.last("inventory").args[0], { requestId })
  assert.equal(h.all("versions").length, 0)
  assert.equal(h.all("preview").length, 0)
  assert.equal(h.all("get").length, 1)
  assert.equal(h.all("logs").length, 1)
  h.last("get").resolve(job()); await flush(); await h.tick(5000)
  assert.equal(h.timers.size, 0)
  h.last("logs").resolve(page([0])); await flush(); await h.tick(999)
  assert.equal(h.all("get").length, 1)
  await h.tick(1)
  assert.equal(h.all("get").length, 2)
  assert.equal(h.last("logs").args[1], 1)
})

test("explicit versions and preview actions carry one UUID and exact selection", async t => {
  for (const method of ["versions", "preview"]) {
    const h = harness(t)
    await h.init()
    const done = method === "versions" ? h.session.loadVersions(selection) : h.session.preview(selection)
    const expected = { requestId, manager: selection.manager, package: selection.package, ...(method === "preview" ? { action: "remove" } : {}) }
    assert.deepEqual(h.last(method).args[0], expected)
    h.last(method).resolve({ jobId: id, requestId, previewId: method === "preview" ? previewId : null, status: "running" })
    await done; await flush()
    const versions = { manager: "npm", package: "@test/tool", versions: ["1.0.0"], tags: { latest: "1.0.0" } }
    await h.cycle(terminal({ kind: method, ...selection, previewId: method === "preview" ? previewId : null, preview: method === "preview" ? preview : null, versions: method === "versions" ? versions : null }))
    if (method === "preview") {
      assert.deepEqual(h.session.getSnapshot().form.preview, preview)
      assert.equal(h.session.getSnapshot().form.acknowledged, false)
    } else assert.deepEqual(h.session.getSnapshot().job.versions, versions)
    assert.equal(h.all("execute").length, 0)
  }
})

test("execute uses displayed preview consent, rejects expiry and sends double click once", async t => {
  const h = harness(t)
  await h.ready()
  const done = h.session.execute(); void h.session.execute()
  assert.equal(h.all("execute").length, 1)
  assert.deepEqual(h.last("execute").args[0], { previewId, requestId, confirm: true, acknowledgedRisks: ["MACHINE_WIDE"], confirmText: preview.confirmText })
  h.last("execute").resolve({ jobId: id, requestId, previewId, status: "running" }); await done
  assert.equal(h.session.getSnapshot().form.preview, null)
  assert.equal(h.session.getSnapshot().form.acknowledged, false)
  const expired = harness(t)
  await expired.ready(); await expired.tick(300000); await expired.session.execute()
  assert.equal(expired.all("execute").length, 0)
  assert.equal(expired.session.getSnapshot().error.code, "PREVIEW_EXPIRED")
})

test("every 409 discards preview/consent and never automatically executes again", async t => {
  for (const reason of ["PREVIEW_CHANGED", "PREVIEW_EXPIRED", "PREVIEW_CONSUMED", "REQUEST_MISMATCH", "RUNNING", "TEST_FUTURE_REASON"]) {
    const h = harness(t)
    await h.ready()
    const done = h.session.execute()
    h.last("execute").reject(new ApiError(409, "TEST", "CONFLICT", { reason })); await done
    assert.equal(h.session.getSnapshot().form.preview, null)
    assert.equal(h.session.getSnapshot().form.acknowledged, false)
    assert.equal(h.session.getSnapshot().error.code, reason === "TEST_FUTURE_REASON" ? "UNKNOWN" : reason)
    await h.tick(10000); await h.session.execute()
    assert.equal(h.all("execute").length, 1)
    assert.equal(h.all("preview").length, 0)
  }
})

test("ambiguous execute recovers only matching requestId AND previewId via latest, never POST", async t => {
  for (const mismatch of [null, "requestId", "previewId", "missing"]) {
    const h = harness(t)
    await h.ready()
    const done = h.session.execute()
    h.last("execute").reject(new ApiError(503, "TEST", "BACKEND_UNAVAILABLE")); await flush()
    assert.equal(h.session.getSnapshot().startUnknown, true)
    if (mismatch === "missing") h.last("latest").resolve(null)
    else h.last("latest").resolve(job({ kind: "mutation", requestId, previewId, ...(mismatch ? { [mismatch]: "TEST-other" } : {}) }))
    await done; await flush()
    assert.equal(h.session.getSnapshot().startUnknown, Boolean(mismatch))
    await h.session.execute(); await h.session.inventory(); await h.tick(5000)
    assert.equal(h.all("execute").length, 1)
    assert.equal(h.all("inventory").length, 0)
    if (!mismatch) assert.equal(h.session.getSnapshot().phase, "tracking")
  }
})

test("ambiguous inventory/versions/preview starts use latest without duplicate POST", async t => {
  for (const method of ["inventory", "versions", "preview"]) {
    const h = harness(t)
    await h.init()
    const done = method === "inventory" ? h.session.inventory() : method === "versions" ? h.session.loadVersions(selection) : h.session.preview(selection)
    h.last(method).reject(new Error("TEST transport")); await flush()
    h.last("latest").resolve(job({ kind: method, previewId: method === "preview" ? previewId : null })); await done; await flush()
    assert.equal(h.session.getSnapshot().startUnknown, false)
    assert.equal(h.session.getSnapshot().jobId, id)
    assert.equal(h.all(method).length, 1)
  }
})

test("hidden aborts reads; ignored aborts settle before resuming from retained cursor", async t => {
  const h = harness(t)
  await h.init(); await h.start(); await h.cycle(job({ endCursor: 1 }), page([0])); await h.tick(1000)
  const oldGet = h.last("get"), oldLogs = h.last("logs")
  await h.visible(false); await h.visible(true)
  assert.equal(oldGet.args[1].aborted, true)
  assert.equal(oldLogs.args[2].aborted, true)
  assert.equal(h.all("get").length, 2)
  oldGet.resolve(terminal()); oldLogs.resolve(page([1])); await flush()
  assert.equal(h.session.getSnapshot().job.status, "running")
  assert.equal(h.all("get").length, 3)
  assert.equal(h.last("logs").args[1], 1)
})

test("all terminal states drain final logs and notify mutation once; no status loop after terminal", async t => {
  for (const status of ["completed", "failed", "cancelled", "timed_out", "termination_failed"]) {
    const h = harness(t)
    await h.mutate()
    await h.cycle(terminal({ kind: "mutation", previewId, status, mutationSpawned: true, mayHaveChanged: true, gateHeld: status === "termination_failed", endCursor: 3 }), page([0], { endCursor: 3 }))
    assert.deepEqual(h.mutations, [id])
    assert.equal(h.session.getSnapshot().snapshot.stale, true)
    assert.equal(h.all("snapshot").length, 1)
    h.last("snapshot").resolve({ ...snapshot, stale: status !== "completed" }); await flush()
    await h.tick(1000)
    assert.equal(h.all("get").length, 1)
    h.last("logs").resolve(page([1, 2])); await flush(); await h.tick(5000)
    assert.equal(h.session.getSnapshot().phase, "idle")
    assert.deepEqual(h.session.getSnapshot().logs.chunks.map(c => c.seq), [0, 1, 2])
    assert.deepEqual(h.mutations, [id])
    assert.equal(h.timers.size, 0)
  }
})

test("a completed mutation still finalizing keeps polling until phase done, then notifies once", async t => {
  const h = harness(t)
  await h.mutate()
  const finalizing = terminal({ kind: "mutation", previewId, mutationSpawned: true, mayHaveChanged: true, phase: "finalizing",
    finishedAt: null, gateHeld: true, auditWritten: false })
  await h.cycle(finalizing, page([0]))
  assert.deepEqual(h.mutations, [])
  assert.equal(h.all("snapshot").length, 0)
  await h.tick(1000)
  assert.equal(h.all("get").length, 2)
  await h.cycle(terminal({ kind: "mutation", previewId, mutationSpawned: true, mayHaveChanged: true }), page([0]))
  assert.deepEqual(h.mutations, [id])
  assert.equal(h.session.getSnapshot().job.gateHeld, false)
  assert.equal(h.all("snapshot").length, 1)
  await h.tick(5000)
  assert.equal(h.all("get").length, 2)
})

test("inventory completion reads snapshot without a new activity; refresh failure keeps stale state", async t => {
  for (const failed of [false, true]) {
    const h = harness(t)
    await h.init(); await h.start(); await h.cycle(terminal(), page())
    assert.equal(h.all("snapshot").length, 1)
    if (failed) h.last("snapshot").reject(new ApiError(503, "TEST", "BACKEND_UNAVAILABLE"))
    else h.last("snapshot").resolve({ ...snapshot, revision: "TEST-new" })
    await flush()
    if (failed) {
      assert.equal(h.session.getSnapshot().snapshot.stale, true)
      assert.equal(h.session.getSnapshot().snapshotError, "BACKEND_UNAVAILABLE")
    } else assert.equal(h.session.getSnapshot().snapshot.revision, "TEST-new")
    assert.equal(h.all("inventory").length, 1)
    assert.deepEqual(h.mutations, [])
  }
})

test("reused M6 log tail is bounded by chunks and UTF8 bytes, preserving drop counters", async t => {
  const h = harness(t)
  await h.init(); await h.start()
  const seqs = Array.from({ length: RUNNER_LOG_MAX_CHUNKS + 10 }, (_, i) => i + 5)
  await h.cycle(terminal({ endCursor: seqs.at(-1) + 1 }), page(seqs, { firstCursor: 5, droppedBytes: 80 }))
  let logs = h.session.getSnapshot().logs
  assert.equal(logs.chunks.length, RUNNER_LOG_MAX_CHUNKS)
  assert.equal(logs.droppedChunks, 15)
  assert.equal(logs.serverDroppedBytes, 80)
  const b = harness(t)
  await b.init(); await b.start()
  const chunks = Array.from({ length: 100 }, (_, seq) => ({ seq, stream: "stderr", text: "😀".repeat(2048) }))
  await b.cycle(terminal({ endCursor: 100 }), page([], { chunks, nextCursor: 100, endCursor: 100 }))
  logs = b.session.getSnapshot().logs
  assert.equal(logs.bytes, RUNNER_LOG_MAX_BYTES)
  assert.equal(logs.localDroppedBytes, 36 * 8192)
})

test("404 becomes lost retaining tail; refresh handles restart without re-POST", async t => {
  const h = harness(t)
  await h.init(); await h.start(); await h.cycle(job(), page([0])); await h.tick(1000)
  h.last("get").reject(new ApiError(404, "TEST", "NOT_FOUND")); h.last("logs").reject(new ApiError(404, "TEST", "NOT_FOUND")); await flush()
  assert.equal(h.session.getSnapshot().phase, "lost")
  assert.equal(h.session.getSnapshot().logs.chunks.length, 1)
  await h.session.inventory(); h.session.retryPoll(); await h.tick(5000)
  assert.equal(h.all("inventory").length, 1)
  const refreshed = h.session.refresh()
  h.last("snapshot").resolve({ ...snapshot, stale: true }); h.last("latest").resolve(null); await refreshed
  assert.equal(h.session.getSnapshot().phase, "lost")
  assert.equal(h.session.getSnapshot().logs.chunks.length, 1)
  assert.equal(h.all("inventory").length, 1)
})

test("cancel sends once, fences late poll and leaves transport outcome unconfirmed until retry", async t => {
  const h = harness(t)
  await h.init(); await h.start()
  const done = h.session.cancel(); void h.session.cancel()
  assert.equal(h.all("cancel").length, 1)
  assert.equal(h.last("get").args[1].aborted, true)
  await h.cycle(terminal(), page([0]))
  h.last("cancel").reject(new Error("TEST dropped")); await done; await h.tick(5000)
  assert.equal(h.session.getSnapshot().cancelUnknown, true)
  assert.equal(h.session.getSnapshot().job, null)
  assert.equal(h.all("get").length, 1)
  h.session.retryPoll(); await h.cycle(terminal({ status: "cancelled" }), page())
  assert.equal(h.session.getSnapshot().cancelUnknown, false)
})

test("gateHeld/termination_failed permit only cleanup cancel; finished drain cannot cancel", async t => {
  for (const patch of [{ status: "termination_failed", gateHeld: true }, { status: "failed", gateHeld: true }]) {
    const h = harness(t)
    await h.init(); await h.start(); await h.cycle(terminal(patch), page())
    await h.session.inventory(); await h.session.preview(selection); await h.session.execute()
    assert.equal(h.all("inventory").length, 1)
    assert.equal(h.all("preview").length, 0)
    assert.equal(h.all("execute").length, 0)
    const done = h.session.cancel()
    assert.equal(h.last("cancel").args[0], id)
    h.last("cancel").resolve(terminal({ status: "cancelled" })); await done
    assert.equal(h.all("inventory").length, 1)
  }
  const h = harness(t)
  await h.init(); await h.start(); await h.cycle(terminal({ endCursor: 2 }), page([0], { endCursor: 2 }))
  await h.session.cancel()
  assert.equal(h.all("cancel").length, 0)
})

test("wrong job/request ids and invalid log cursors pause without corrupting state", async t => {
  for (const patch of [{ jobId: "TEST-other" }, { requestId: "TEST-other" }]) {
    const h = harness(t)
    await h.init(); await h.start(); await h.cycle(job(patch), page())
    assert.equal(h.session.getSnapshot().pollError, "INVALID_RESPONSE")
    assert.equal(h.session.getSnapshot().job, null)
  }
  for (const patch of [{ jobId: "TEST-other" }, { nextCursor: -1 }, { nextCursor: 2, endCursor: 1 }, { nextCursor: 0, endCursor: 2 }]) {
    const h = harness(t)
    await h.init(); await h.start(); await h.cycle(job(), page([], patch))
    assert.equal(h.session.getSnapshot().pollError, "INVALID_RESPONSE")
    assert.equal(h.session.getSnapshot().logs.cursor, 0)
  }
})

test("wrong preview identity never adopts a mutation status or a recovered job", async t => {
  const h = harness(t)
  await h.mutate()
  await h.cycle(job({ kind: "mutation", previewId: "TEST-other" }), page())
  assert.equal(h.session.getSnapshot().pollError, "INVALID_RESPONSE")
  assert.equal(h.session.getSnapshot().job, null)
})

test("poll errors require explicit retry, and hidden mount starts no reads until visible", async t => {
  const h = harness(t)
  await h.visible(false)
  await h.init(job())
  assert.equal(h.all("get").length, 0)
  await h.visible(true)
  assert.equal(h.all("get").length, 1)
  h.last("get").reject(new ApiError(503, "TEST", "BACKEND_UNAVAILABLE"))
  h.last("logs").resolve(page([0])); await flush()
  await h.tick(5000); await h.visible(false); await h.visible(true)
  assert.equal(h.all("get").length, 1)
  assert.equal(h.session.getSnapshot().pollError, "BACKEND_UNAVAILABLE")
  h.session.retryPoll(); h.session.retryPoll()
  assert.equal(h.all("get").length, 2)
  await h.cycle(terminal({ endCursor: 1 }), page([], { nextCursor: 1, endCursor: 1 }))
  assert.equal(h.session.getSnapshot().logs.chunks.length, 1)
})

test("pending execute can recover provisional latest and cancel preflight; late acceptance is fenced", async t => {
  const h = harness(t)
  await h.ready()
  const started = h.session.execute()
  const oldExecute = h.last("execute")
  const refreshed = h.session.refresh()
  h.last("snapshot").resolve(snapshot)
  h.last("latest").resolve(job({ kind: "mutation", previewId, gateHeld: true })); await refreshed; await flush()
  assert.equal(h.session.getSnapshot().jobId, id)
  const cancelled = h.session.cancel()
  assert.equal(h.all("cancel").length, 1)
  h.last("cancel").resolve(terminal({ kind: "mutation", previewId, status: "cancelled" })); await cancelled
  oldExecute.resolve({ jobId: id, requestId, previewId, status: "running" }); await started; await flush()
  assert.equal(h.session.getSnapshot().job.status, "cancelled")
  assert.equal(h.all("execute").length, 1)
})

test("selection edits fence late ready previews; dispose fences pending start/latest/snapshot/cancel", async t => {
  const h = harness(t)
  await h.init()
  const done = h.session.preview(selection)
  h.last("preview").resolve({ jobId: id, requestId, previewId, status: "running" }); await done; await flush()
  h.session.select({ ...selection, package: "TEST-other" })
  await h.cycle(terminal({ kind: "preview", ...selection, previewId, preview }), page())
  assert.equal(h.session.getSnapshot().form.preview, null)
  for (const method of ["inventory", "refresh", "cancel"]) {
    const b = harness(t)
    await b.init()
    if (method === "cancel") { await b.start(); await b.cycle() }
    const pending = method === "refresh" ? b.session.refresh() : method === "cancel" ? b.session.cancel() : b.session.inventory()
    const requests = b.requests.filter(r => r.method === method || (method === "refresh" && ["latest", "snapshot"].includes(r.method)))
    const count = b.changes.length
    b.session.dispose()
    for (const request of requests) {
      assert.equal(request.args.at(-1).aborted, true)
      request.resolve(request.method === "snapshot" ? snapshot : request.method === "inventory" ? { jobId: id, requestId, previewId: null, status: "running" } : terminal())
    }
    await pending; await flush()
    assert.equal(b.changes.length, count)
    assert.equal(b.listeners.size, 0)
    assert.equal(b.timers.size, 0)
  }
})
