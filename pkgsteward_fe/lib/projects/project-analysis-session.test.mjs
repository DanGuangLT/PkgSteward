import { test } from "node:test"
import assert from "node:assert/strict"
import { ApiError } from "../api/response.ts"
import { createProjectAnalysisSession } from "./project-analysis-session.ts"

// Dữ liệu TEST không phải yêu cầu nghiệp vụ.
const path = "D:\\TEST"
const conflict = { reason: "ANALYSIS_RUNNING", jobId: "TEST-job", path }
const section = { state: "complete", items: [], warningCodes: [], failureCode: null, checkedCount: 0, totalCount: 0 }
const job = (overrides = {}) => ({ jobId: "TEST-job", path, requestPath: path, scanId: "TEST-scan", inputHash: "TEST-hash",
  status: "running", phase: "audit", partial: false, stale: false, startedAt: "TEST-time", finishedAt: null,
  checkedAt: null, outdated: section, audit: section, warningCodes: [], failureCode: null, ...overrides })
const detail = (overrides = {}) => ({ path, requestPath: path, scanId: "TEST-scan", inputHash: "TEST-hash", warnings: [], ...overrides })
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

function harness(t) {
  let now = 0, sequence = 0, visible = true
  const timers = new Map(), listeners = new Set(), requests = [], changes = []
  const api = Object.fromEntries(["start", "get", "cancel"].map(method => [method, (...args) => {
    const pending = deferred()
    requests.push({ method, args, ...pending })
    return pending.promise
  }]))
  const clock = {
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id },
    clearTimeout(id) { timers.delete(id) },
  }
  const visibility = { isVisible: () => visible, subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) } }
  const session = createProjectAnalysisSession({ api, clock, visibility, onChange: state => changes.push(state) })
  t.after(() => session.dispose())
  return { session, requests, changes, timers, listeners,
    get: () => requests.filter(request => request.method === "get"),
    async tick(ms) {
      now += ms
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback() }
      await flush()
    },
    async visible(value) { visible = value; for (const callback of listeners) callback(); await flush() },
  }
}

test("start POST once; one GET in flight; next GET is 1000ms after settle", async t => {
  const h = harness(t)
  h.session.refresh(detail())
  assert.equal(h.requests.length, 0)
  const started = h.session.start(path)
  void h.session.start(path)
  assert.equal(h.requests.length, 1)
  assert.deepEqual(h.requests[0].args[0], { path })
  h.requests[0].resolve({ jobId: "TEST-job", status: "running" })
  await started
  assert.equal(h.get().length, 1)
  await h.tick(6000)
  assert.equal(h.get().length, 1)
  assert.equal(h.timers.size, 0)
  h.get()[0].resolve(job())
  await flush()
  await h.tick(999)
  assert.equal(h.get().length, 1)
  await h.tick(1)
  assert.equal(h.get().length, 2)
  h.get()[1].resolve(job({ status: "completed" }))
  await flush()
  await h.tick(10000)
  assert.equal(h.session.getSnapshot().phase, "idle")
  assert.equal(h.get().length, 2)
})

test("hide aborts GET and timer; show waits for ignored abort to settle before resuming", async t => {
  const h = harness(t)
  h.session.follow(conflict)
  const first = h.get()[0]
  await h.visible(false)
  assert.equal(first.args[1].aborted, true)
  await h.visible(true)
  assert.equal(h.get().length, 1)
  first.resolve(job({ status: "completed" }))
  await flush()
  assert.equal(h.session.getSnapshot().job, null)
  assert.equal(h.get().length, 2)
  h.get()[1].resolve(job())
  await flush()
  assert.equal(h.timers.size, 1)
  await h.visible(false)
  assert.equal(h.timers.size, 0)
  await h.tick(10000)
  assert.equal(h.get().length, 2)
  await h.visible(true)
  assert.equal(h.get().length, 3)
})

test("poll errors pause across visibility changes and retry only by manual action; 404 keeps rows", async t => {
  const h = harness(t)
  h.session.follow(conflict)
  h.get()[0].resolve(job({ audit: { ...section, items: [{ id: "TEST-advisory" }] } }))
  await flush()
  await h.tick(1000)
  h.get()[1].reject(new ApiError(503, "TEST", "BACKEND_UNAVAILABLE"))
  await flush()
  await h.tick(5000)
  await h.visible(false)
  await h.visible(true)
  assert.equal(h.get().length, 2)
  assert.equal(h.session.getSnapshot().pollError, "BACKEND_UNAVAILABLE")
  h.session.retryPoll()
  h.session.retryPoll()
  assert.equal(h.get().length, 3)
  h.get()[2].reject(new ApiError(404, "TEST", "NOT_FOUND"))
  await flush()
  assert.equal(h.session.getSnapshot().phase, "lost")
  assert.equal(h.session.getSnapshot().job.audit.items[0].id, "TEST-advisory")
  assert.equal(h.session.getSnapshot().job.stale, true)
  h.session.retryPoll()
  await h.tick(5000)
  assert.equal(h.get().length, 3)
})

test("cancel fences late poll; failed POST never claims stopped and status check is manual", async t => {
  const h = harness(t)
  h.session.follow(conflict)
  const poll = h.get()[0]
  const cancelled = h.session.cancel()
  void h.session.cancel()
  assert.equal(poll.args[1].aborted, true)
  assert.equal(h.requests.filter(request => request.method === "cancel").length, 1)
  assert.equal(h.session.getSnapshot().cancelPending, true)
  poll.resolve(job({ status: "completed" }))
  await flush()
  assert.equal(h.session.getSnapshot().job, null)
  h.requests.find(request => request.method === "cancel").reject(new Error("TEST lost response"))
  await cancelled
  assert.equal(h.session.getSnapshot().phase, "tracking")
  assert.equal(h.session.getSnapshot().cancelUnknown, true)
  await h.tick(5000)
  assert.equal(h.get().length, 1)
  h.session.retryPoll()
  h.get()[1].resolve(job({ status: "cancelled" }))
  await flush()
  assert.equal(h.session.getSnapshot().job.status, "cancelled")
  assert.equal(h.session.getSnapshot().cancelUnknown, false)
})

test("cancel success stops polling even when old GET rejects later", async t => {
  const h = harness(t)
  h.session.follow(conflict)
  const cancel = h.session.cancel()
  h.requests.find(request => request.method === "cancel").resolve(job({ status: "cancelled" }))
  await cancel
  h.get()[0].reject(new Error("TEST late rejection"))
  await flush()
  await h.tick(5000)
  assert.equal(h.session.getSnapshot().job.status, "cancelled")
  assert.equal(h.session.getSnapshot().error, null)
  assert.equal(h.get().length, 1)
})

test("start transport failure is unknown without auto POST retry; conflict follow uses server lexical path", async t => {
  const h = harness(t)
  const first = h.session.start(path)
  h.requests[0].reject(new ApiError(503, "TEST", "BACKEND_UNAVAILABLE"))
  await first
  await h.tick(5000)
  assert.equal(h.requests.length, 1)
  assert.equal(h.session.getSnapshot().startUnknown, true)
  const second = h.session.start(path)
  const serverConflict = { ...conflict, path: "D:\\TEST-lexical\\alias" }
  h.requests[1].reject(new ApiError(409, "TEST", "CONFLICT", serverConflict))
  await second
  const state = h.session.getSnapshot()
  assert.equal(state.startUnknown, false)
  h.session.follow({ ...serverConflict, reason: "INPUT_CHANGED" })
  assert.equal(h.get().length, 0)
  h.session.follow(state.error.conflict)
  assert.equal(h.session.getSnapshot().requestPath, serverConflict.path)
  assert.equal(h.get()[0].args[0], serverConflict.jobId)
})

test("path switch aborts start; late success/dispose publish nothing and never cancel BE implicitly", async t => {
  const h = harness(t)
  h.session.refresh(detail())
  const started = h.session.start(path)
  const request = h.requests[0]
  h.session.refresh(detail({ path: "D:\\TEST-other", requestPath: "D:\\TEST-other", inputHash: "TEST-other" }))
  assert.equal(request.args[1].aborted, true)
  request.resolve({ jobId: "TEST-job", status: "running" })
  await started
  assert.equal(h.session.getSnapshot().phase, "idle")
  assert.equal(h.session.getSnapshot().requestPath, "D:\\TEST-other")
  h.session.follow(conflict)
  const count = h.changes.length
  h.session.dispose()
  assert.equal(h.get()[0].args[1].aborted, true)
  assert.equal(h.listeners.size, 0)
  h.get()[0].resolve(job())
  await flush()
  await h.tick(5000)
  void h.session.start(path)
  h.session.refresh(detail())
  assert.equal(h.changes.length, count)
  assert.equal(h.requests.some(request => request.method === "cancel"), false)
})

test("generation fences poll after route switch/new job; mismatched id is a paused response error", async t => {
  const h = harness(t)
  h.session.refresh(detail())
  h.session.follow(conflict)
  const old = h.get()[0]
  h.session.refresh(detail({ path: "D:\\TEST-other", requestPath: "D:\\TEST-other" }))
  h.session.follow({ ...conflict, jobId: "TEST-new", path: "D:\\TEST-other" })
  assert.equal(h.get().length, 1)
  old.resolve(job())
  await flush()
  assert.equal(h.session.getSnapshot().job, null)
  assert.equal(h.get().length, 2)
  h.get()[1].resolve(job({ jobId: "TEST-wrong" }))
  await flush()
  assert.equal(h.session.getSnapshot().job, null)
  assert.equal(h.session.getSnapshot().pollError, "INVALID_RESPONSE")
  await h.tick(5000)
  assert.equal(h.get().length, 2)
})

test("refresh same project keeps terminal rows; changed hash or scan marks stale without mutating input", async t => {
  const h = harness(t)
  h.session.refresh(detail())
  h.session.follow(conflict)
  h.session.refresh(detail({ inputHash: "TEST-ignore-while-running" }))
  assert.equal(h.session.getSnapshot().detail.inputHash, "TEST-hash")
  const terminal = job({ status: "completed" })
  h.get()[0].resolve(terminal)
  await flush()
  h.session.refresh(detail())
  assert.equal(h.session.getSnapshot().job.stale, false)
  h.session.refresh(detail({ inputHash: "TEST-changed" }))
  assert.equal(h.session.getSnapshot().job.stale, true)
  assert.equal(terminal.stale, false)
  assert.equal(h.requests.length, 1)
})

test("hidden start/follow waits for visibility; terminal statuses never schedule", async t => {
  for (const status of ["completed", "cancelled", "timed_out", "failed"]) {
    const h = harness(t)
    await h.visible(false)
    h.session.follow(conflict)
    assert.equal(h.get().length, 0)
    await h.visible(true)
    h.get()[0].resolve(job({ status }))
    await flush()
    await h.visible(false)
    await h.visible(true)
    await h.tick(5000)
    assert.equal(h.get().length, 1)
  }
})

test("hidden start can settle but cannot GET until visible; config warning blocks online start", async t => {
  const h = harness(t)
  h.session.refresh(detail({ warnings: ["REGISTRY_CONFIG_UNSUPPORTED"] }))
  await h.session.start(path)
  assert.equal(h.requests.length, 0)
  h.session.refresh(detail())
  await h.visible(false)
  const started = h.session.start(path)
  h.requests[0].resolve({ jobId: "TEST-job", status: "running" })
  await started
  assert.equal(h.get().length, 0)
  assert.equal(h.session.getSnapshot().phase, "tracking")
  await h.visible(true)
  assert.equal(h.get().length, 1)
})

test("route switch fences late cancel and allows a new start without waiting for the old command", async t => {
  const h = harness(t)
  h.session.refresh(detail())
  h.session.follow(conflict)
  h.get()[0].resolve(job())
  await flush()
  const cancelled = h.session.cancel()
  const oldCancel = h.requests.find(request => request.method === "cancel")
  h.session.refresh(detail({ path: "D:\\TEST-next", requestPath: "D:\\TEST-next" }))
  assert.equal(oldCancel.args[1].aborted, true)
  const started = h.session.start("D:\\TEST-next")
  oldCancel.resolve(job({ status: "cancelled" }))
  await cancelled
  assert.equal(h.session.getSnapshot().phase, "starting")
  assert.equal(h.session.getSnapshot().job, null)
  h.requests.find(request => request.method === "start").resolve({ jobId: "TEST-next-job", status: "running" })
  await started
  assert.equal(h.session.getSnapshot().jobId, "TEST-next-job")
  assert.equal(h.get().at(-1).args[0], "TEST-next-job")
})

test("refresh with replaced scan marks terminal snapshot stale even when hash is unchanged", async t => {
  const h = harness(t)
  h.session.refresh(detail())
  h.session.follow(conflict)
  h.get()[0].resolve(job({ status: "completed" }))
  await flush()
  h.session.refresh(detail({ scanId: "TEST-replaced-scan" }))
  assert.equal(h.session.getSnapshot().job.stale, true)
  assert.equal(h.session.getSnapshot().detail.scanId, "TEST-replaced-scan")
  assert.equal(h.get().length, 1)
})
