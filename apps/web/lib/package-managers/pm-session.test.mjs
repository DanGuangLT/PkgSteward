import { test } from "node:test"
import assert from "node:assert/strict"
import { ApiError } from "../api/response.ts"
import { createPmSession, pmCleanupPending, pmMutationSucceeded, pmReadFailure } from "./pm-session.ts"

// TEST data; not business requirements.
const PATH = "D:\\TEST\\app"
const OTHER = "D:\\TEST\\other"
const T = "2026-11-09T10:00:00.000Z"
const NOW = Date.parse(T)
const flush = () => new Promise(resolve => setImmediate(resolve))
const context = (over = {}) => ({
  path: PATH, projectName: "TEST-app", scanId: "TEST-scan", asOf: T, rawPin: "pnpm@11.21.0", rawPinTruncated: false,
  pinState: "parsed", parsedPin: { manager: "pnpm", version: "11.21.0", hash: null }, pinReason: null,
  installed: [], lockManagers: ["pnpm"], workspace: { kind: "standalone", root: null }, devEnginesPresent: false,
  reason: null, warnings: [], ...over,
})
const previewData = (over = {}) => ({
  previewId: "TEST-preview", createdAt: T, expiresAt: "2026-11-09T10:05:00.000Z", path: PATH, projectName: "TEST-app",
  scanId: "TEST-scan", manager: "pnpm", rawPin: "pnpm@11.21.0", currentVersion: "11.21.0", requestedVersion: "11.22.0",
  targetVersion: "11.22.0", installedRunnerVersion: "11.22.0", method: "manifest-pin",
  edit: { file: "package.json", field: "packageManager", operation: "replace", before: "pnpm@11.21.0", after: "pnpm@11.22.0" },
  warnings: [], limitations: [], risk: { level: "low", reasons: [] }, confirmText: null, ...over,
})
const job = (over = {}) => ({
  jobId: "TEST-job", requestId: "TEST-1", previewId: null, status: "running", kind: "versions", path: PATH, manager: "pnpm",
  phase: "fetching", startedAt: T, finishedAt: null, cancelRequested: false, mutationStarted: false, fileCommitted: false,
  mayHaveChanged: false, gateHeld: false, auditWritten: false, refreshRequired: false, cleanupRequired: false,
  failureCode: null, warnings: [], preview: null, versions: null, ...over,
})
const done = over => job({ status: "completed", phase: "done", finishedAt: T, ...over })
const conflict = reason => new ApiError(409, "TEST", "CONFLICT", { reason })

function harness(overrides = {}, { visible = true } = {}) {
  const calls = []
  const timers = new Map()
  let timerId = 0
  let shown = visible
  const listeners = new Set()
  let ids = 0
  const queue = { get: [] }
  const api = {
    context: async (path) => { calls.push(["context", path]); return context() },
    versions: async input => { calls.push(["versions", input]); return { jobId: "TEST-job", requestId: input.requestId, previewId: null, status: "running" } },
    preview: async input => { calls.push(["preview", input]); return { jobId: "TEST-job", requestId: input.requestId, previewId: null, status: "running" } },
    execute: async input => { calls.push(["execute", input]); return { jobId: "TEST-job", requestId: input.requestId, previewId: input.previewId, status: "running" } },
    latest: async () => { calls.push(["latest"]); return null },
    get: async id => { calls.push(["get", id]); const next = queue.get.shift(); if (!next) throw new Error("TEST no queued job"); return typeof next === "function" ? next() : next },
    cancel: async id => { calls.push(["cancel", id]); return done({ status: "cancelled", cancelRequested: true }) },
    ...overrides,
  }
  const states = []
  const mutated = []
  const session = createPmSession({
    path: PATH, api, onChange: state => states.push(state), onMutated: value => mutated.push(value),
    uuid: () => `TEST-${++ids}`,
    clock: { now: () => NOW, setTimeout(callback) { timers.set(++timerId, callback); return timerId }, clearTimeout(id) { timers.delete(id) } },
    visibility: { isVisible: () => shown, subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) } },
  })
  return {
    session, api, calls, states, mutated, queue, timers,
    state: () => session.getSnapshot(),
    async tick() { const pending = [...timers.values()]; timers.clear(); for (const callback of pending) callback(); await flush(); await flush() },
    setVisible(value) { shown = value; for (const listener of listeners) listener() },
  }
}

test("context loads for the scoped project and errors keep the old context", async () => {
  const h = harness()
  await h.session.loadContext()
  assert.deepEqual(h.calls, [["context", PATH]])
  assert.equal(h.state().context.projectName, "TEST-app")
  assert.equal(h.state().contextLoading, false)
  h.api.context = async () => { throw new ApiError(404, "TEST", "NOT_FOUND", { reason: "PROJECT_NOT_SCANNED" }) }
  await h.session.loadContext()
  assert.equal(h.state().context.projectName, "TEST-app")
  assert.deepEqual(h.state().contextError, { code: "PROJECT_NOT_SCANNED", statusCode: 404 })
})

test("versions job is polled every second until phase done, then the catalog is kept", async () => {
  const h = harness()
  h.queue.get.push(job(), done({ versions: { manager: "pnpm", versions: [{ version: "11.22.0", deprecated: false, supported: true, reason: null }], tags: { latest: "11.22.0" }, asOf: T, stale: false } }))
  await h.session.loadVersions("pnpm")
  await flush()
  assert.deepEqual(h.calls[0], ["versions", { requestId: "TEST-1", path: PATH, manager: "pnpm" }])
  assert.equal(h.state().phase, "tracking")
  await h.tick()
  assert.equal(h.state().versions.tags.latest, "11.22.0")
  assert.equal(h.state().phase, "idle")
  assert.equal(h.timers.size, 0)
})

test("a ready preview is shown only for the unchanged selection; consent then execute; success notifies once", async () => {
  const h = harness()
  h.queue.get.push(done({ kind: "preview", previewId: "TEST-preview", preview: previewData() }))
  await h.session.preview({ manager: "pnpm", targetVersion: "11.22.0" })
  await flush(); await flush()
  assert.deepEqual(h.calls[0], ["preview", { requestId: "TEST-1", path: PATH, manager: "pnpm", targetVersion: "11.22.0" }])
  assert.equal(h.state().form.preview.previewId, "TEST-preview")
  const success = done({ kind: "mutation", requestId: "TEST-2", previewId: "TEST-preview", mutationStarted: true, fileCommitted: true, mayHaveChanged: true, auditWritten: true })
  h.queue.get.push(success, success)
  await h.session.execute()
  await flush(); await flush()
  assert.deepEqual(h.calls.find(([name]) => name === "execute")[1], { requestId: "TEST-2", previewId: "TEST-preview", confirm: true, acknowledgedRisks: [] })
  assert.equal(h.state().form.preview, null)
  assert.equal(h.state().mutationResult.jobId, "TEST-job")
  assert.equal(pmMutationSucceeded(h.state().mutationResult), true)
  assert.equal(h.mutated.length, 1)
  await h.session.retryPoll()
  assert.equal(h.mutated.length, 1)
})

test("selection change during a pending preview drops its result", async () => {
  const h = harness()
  let release
  h.queue.get.push(() => new Promise(resolve => { release = () => resolve(done({ kind: "preview", previewId: "TEST-preview", preview: previewData() })) }))
  await h.session.preview({ manager: "pnpm", targetVersion: "11.22.0" })
  h.session.select({ manager: "pnpm", targetVersion: "11.20.0" })
  release()
  await flush(); await flush()
  assert.equal(h.state().form.preview, null)
  assert.deepEqual(h.state().form.selection, { manager: "pnpm", targetVersion: "11.20.0" })
})

test("execute without consent or preview never calls the API", async () => {
  const h = harness()
  await h.session.execute()
  assert.equal(h.calls.length, 0)
  assert.equal(h.state().error.code, "NO_PREVIEW")
  h.queue.get.push(done({ kind: "preview", previewId: "TEST-preview", preview: previewData({ risk: { level: "medium", reasons: [{ code: "RECENTLY_ACTIVE", level: "medium", message: "TEST" }] } }) }))
  await h.session.preview({ manager: "pnpm", targetVersion: "11.22.0" })
  await flush(); await flush()
  await h.session.execute()
  assert.equal(h.calls.some(([name]) => name === "execute"), false)
  assert.equal(h.state().error.code, "RISK_NOT_ACKNOWLEDGED")
  h.session.acknowledge("RECENTLY_ACTIVE", true)
  h.queue.get.push(done({ kind: "mutation", requestId: "TEST-2", previewId: "TEST-preview" }))
  await h.session.execute()
  assert.deepEqual(h.calls.find(([name]) => name === "execute")[1].acknowledgedRisks, ["RECENTLY_ACTIVE"])
})

test("409 on start keeps the reason code and clears a shown preview", async () => {
  const h = harness()
  h.queue.get.push(done({ kind: "preview", previewId: "TEST-preview", preview: previewData() }))
  await h.session.preview({ manager: "pnpm", targetVersion: "11.22.0" })
  await flush(); await flush()
  h.api.execute = async () => { throw conflict("PREVIEW_CHANGED") }
  await h.session.execute()
  assert.deepEqual(h.state().error, { code: "PREVIEW_CHANGED", statusCode: 409 })
  assert.equal(h.state().form.preview, null)
  assert.equal(h.state().phase, "idle")
  assert.equal(h.state().startUnknown, false)
})

test("a lost execute response recovers the job by requestId through latest, never by resending", async () => {
  const h = harness()
  h.queue.get.push(done({ kind: "preview", previewId: "TEST-preview", preview: previewData() }))
  await h.session.preview({ manager: "pnpm", targetVersion: "11.22.0" })
  await flush(); await flush()
  h.api.execute = async input => { h.calls.push(["execute", input]); throw new ApiError(503, "TEST", "BACKEND_UNAVAILABLE") }
  h.api.latest = async () => { h.calls.push(["latest"]); return job({ kind: "mutation", requestId: "TEST-2", previewId: "TEST-preview", phase: "writing" }) }
  h.queue.get.push(done({ kind: "mutation", requestId: "TEST-2", previewId: "TEST-preview", fileCommitted: true, mayHaveChanged: true, auditWritten: true }))
  await h.session.execute()
  await flush(); await flush()
  assert.equal(h.calls.filter(([name]) => name === "execute").length, 1)
  assert.ok(h.calls.some(([name]) => name === "latest"))
  assert.equal(h.state().mutationResult.requestId, "TEST-2")
  assert.equal(h.mutated.length, 1)
})

test("a running job of another project blocks actions and is exposed for a follow link", async () => {
  const h = harness({ latest: async () => job({ path: OTHER, kind: "mutation" }) })
  await h.session.refresh()
  assert.equal(h.state().otherJob.path, OTHER)
  await h.session.loadVersions("pnpm")
  assert.equal(h.calls.some(([name]) => name === "versions"), false)
})

test("a running job of this project found on refresh is tracked", async () => {
  const h = harness({ latest: async () => job({ path: PATH.toLowerCase() + "\\", kind: "versions" }) })
  h.queue.get.push(done({ versions: { manager: "pnpm", versions: [], tags: {}, asOf: T, stale: false } }))
  await h.session.refresh()
  await flush()
  assert.equal(h.state().otherJob, null)
  assert.equal(h.state().jobId, "TEST-job")
  await h.tick()
  assert.equal(h.state().phase, "idle")
})

test("hidden tab pauses polling and visible resumes it", async () => {
  const h = harness()
  h.queue.get.push(job(), done())
  await h.session.loadVersions("pnpm")
  await flush()
  h.setVisible(false)
  assert.equal(h.timers.size, 0)
  const before = h.calls.filter(([name]) => name === "get").length
  h.setVisible(true)
  await flush(); await flush()
  assert.equal(h.calls.filter(([name]) => name === "get").length, before + 1)
  assert.equal(h.state().phase, "idle")
})

test("poll 404 marks the job lost; other poll errors allow retry", async () => {
  const h = harness()
  h.queue.get.push(() => { throw new ApiError(503, "TEST", "BACKEND_UNAVAILABLE") })
  await h.session.loadVersions("pnpm")
  await flush(); await flush()
  assert.equal(h.state().pollError, "BACKEND_UNAVAILABLE")
  assert.equal(h.timers.size, 0)
  h.queue.get.push(() => { throw new ApiError(404, "TEST", "NOT_FOUND") })
  h.session.retryPoll()
  await flush(); await flush()
  assert.equal(h.state().phase, "lost")
})

test("stopPreview cancels a pending preview and never shows it, even when it completed first", async () => {
  const h = harness()
  h.api.cancel = async id => { h.calls.push(["cancel", id]); return done({ kind: "preview", previewId: "TEST-preview", preview: previewData() }) }
  h.queue.get.push(job({ kind: "preview" }))
  await h.session.preview({ manager: "pnpm", targetVersion: "11.22.0" })
  await flush()
  assert.equal(h.session.stopPreview(), true)
  await flush(); await flush()
  assert.ok(h.calls.some(([name]) => name === "cancel"))
  assert.equal(h.state().form.preview, null)
  assert.equal(h.state().phase, "idle")
  assert.equal(h.session.stopPreview(), false)
})

test("cancel of a running mutation keeps the server outcome and its flags", async () => {
  const h = harness()
  h.queue.get.push(done({ kind: "preview", previewId: "TEST-preview", preview: previewData() }))
  await h.session.preview({ manager: "pnpm", targetVersion: "11.22.0" })
  await flush(); await flush()
  h.queue.get.push(job({ kind: "mutation", requestId: "TEST-2", previewId: "TEST-preview", phase: "writing", mutationStarted: true }))
  await h.session.execute()
  await flush()
  h.api.cancel = async id => { h.calls.push(["cancel", id]); return done({ kind: "mutation", requestId: "TEST-2", previewId: "TEST-preview", status: "cancelled", cancelRequested: true, mutationStarted: true, mayHaveChanged: true }) }
  await h.session.cancel()
  assert.equal(h.state().mutationResult.status, "cancelled")
  assert.equal(h.state().mutationResult.mayHaveChanged, true)
  assert.equal(h.mutated.length, 1)
  assert.equal(h.state().cancelPending, false)
})

test("a finished mutation that still holds the gate offers a cleanup-only retry through cancel", async () => {
  const h = harness()
  h.queue.get.push(done({ kind: "preview", previewId: "TEST-preview", preview: previewData() }))
  await h.session.preview({ manager: "pnpm", targetVersion: "11.22.0" })
  await flush(); await flush()
  const held = done({ kind: "mutation", requestId: "TEST-2", previewId: "TEST-preview", fileCommitted: true, mayHaveChanged: true, gateHeld: true, cleanupRequired: true })
  h.queue.get.push(held)
  await h.session.execute()
  await flush(); await flush()
  assert.equal(pmCleanupPending(h.state().job), true)
  h.api.cancel = async id => { h.calls.push(["cancel", id]); return { ...held, gateHeld: false, cleanupRequired: false, auditWritten: true } }
  await h.session.cancel()
  assert.ok(h.calls.some(([name]) => name === "cancel"))
  assert.equal(pmCleanupPending(h.state().job), false)
  assert.equal(pmMutationSucceeded(h.state().mutationResult), true)
})

test("failed read jobs keep a displayable failure code", async () => {
  const h = harness()
  h.queue.get.push(done({ status: "failed", failureCode: "REGISTRY_UNAVAILABLE" }))
  await h.session.loadVersions("pnpm")
  await flush(); await flush()
  assert.equal(pmReadFailure(h.state()), "REGISTRY_UNAVAILABLE")
  h.queue.get.push(done({ requestId: "TEST-2", status: "timed_out" }))
  await h.session.loadVersions("pnpm")
  await flush(); await flush()
  assert.equal(pmReadFailure(h.state()), "TIMED_OUT")
  h.queue.get.push(done({ requestId: "TEST-3", versions: { manager: "pnpm", versions: [], tags: {}, asOf: T, stale: false } }))
  await h.session.loadVersions("pnpm")
  await flush(); await flush()
  assert.equal(pmReadFailure(h.state()), null)
})

test("while execute waits for preflight, the admitted job is found through latest and can be cancelled", async () => {
  const h = harness()
  h.queue.get.push(done({ kind: "preview", previewId: "TEST-preview", preview: previewData() }))
  await h.session.preview({ manager: "pnpm", targetVersion: "11.22.0" })
  await flush(); await flush()
  h.api.execute = input => { h.calls.push(["execute", input]); return new Promise(() => {}) }
  const pending = job({ kind: "mutation", requestId: "TEST-2", previewId: "TEST-preview", phase: "fetching" })
  h.api.latest = async () => { h.calls.push(["latest"]); return pending }
  void h.session.execute()
  await flush()
  assert.equal(h.state().jobId, null)
  h.queue.get.push(pending)
  await h.tick()
  assert.equal(h.state().jobId, "TEST-job")
  assert.equal(h.state().form.preview, null)
  h.api.cancel = async id => { h.calls.push(["cancel", id]); return done({ kind: "mutation", requestId: "TEST-2", previewId: "TEST-preview", status: "cancelled", cancelRequested: true }) }
  await h.session.cancel()
  assert.ok(h.calls.some(([name]) => name === "cancel"))
  assert.equal(h.state().mutationResult.status, "cancelled")
  assert.equal(h.calls.filter(([name]) => name === "execute").length, 1)
})

test("refresh reconciles a lost job: a retained result is shown, otherwise actions unblock with the unknown notice", async () => {
  const h = harness()
  h.queue.get.push(() => { throw new ApiError(404, "TEST", "NOT_FOUND") })
  await h.session.loadVersions("pnpm")
  await flush(); await flush()
  assert.equal(h.state().phase, "lost")
  h.api.latest = async () => done({ versions: { manager: "pnpm", versions: [], tags: { latest: "11.22.0" }, asOf: T, stale: false } })
  await h.session.refresh()
  assert.equal(h.state().phase, "idle")
  assert.equal(h.state().versions.tags.latest, "11.22.0")
  const second = harness()
  second.queue.get.push(() => { throw new ApiError(404, "TEST", "NOT_FOUND") })
  await second.session.loadVersions("pnpm")
  await flush(); await flush()
  second.api.latest = async () => null
  await second.session.refresh()
  assert.equal(second.state().phase, "idle")
  assert.equal(second.state().lostJobId, "TEST-job")
  second.queue.get.push(done())
  await second.session.loadVersions("pnpm")
  assert.ok(second.calls.filter(([name]) => name === "versions").length === 2)
})

test("dispose clears timers and ignores late responses", async () => {
  const h = harness()
  h.queue.get.push(job())
  await h.session.loadVersions("pnpm")
  await flush()
  const count = h.states.length
  h.session.dispose()
  assert.equal(h.timers.size, 0)
  await h.session.loadContext()
  assert.equal(h.states.length, count)
})
