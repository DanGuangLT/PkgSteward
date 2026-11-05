import { test } from "node:test"
import assert from "node:assert/strict"
import { ApiError } from "../api/response.ts"
import { createGlobalSession, initialGlobalState, globalActionPending, globalMutationSucceeded } from "./global-session.ts"
import { RUNNER_LOG_MAX_BYTES, RUNNER_LOG_MAX_CHUNKS } from "../npm-runner/runner-log-view.ts"

// TEST data; không phải yêu cầu nghiệp vụ. All IO, timers and visibility are fakes.
const id = "00000000-0000-4000-8000-000000000001"
const requestId = "00000000-0000-4000-8000-000000000002"
const previewId = "00000000-0000-4000-8000-000000000003"
const epoch = Date.parse("2026-01-01T00:00:00Z")
const selection = { manager: "npm", package: "@test/tool", action: "remove" }
const snapshot = { revision: "TEST-revision", asOf: new Date(epoch).toISOString(), stale: false, managers: [] }
const npmInventory = { manager: "npm", version: "11.0.0", available: true, reason: null,
  globalRoot: "D:\\TEST\\npm\\node_modules", binDir: "D:\\TEST\\npm",
  packages: [{ name: "@test/npm-tool", version: "1.0.0", bins: [], status: "manageable", reason: null }] }
const pnpmInventory = { manager: "pnpm", version: "11.22.0", available: true, reason: null,
  globalRoot: "D:\\TEST\\pnpm\\global\\v11", binDir: "D:\\TEST\\pnpm\\bin",
  packages: [{ name: "@test/tool", version: "1.0.0", bins: [], status: "manageable", reason: null }] }
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
    async ready(manager = "npm") {
      const selected = { ...selection, manager }
      const displayed = { ...preview, manager, managerVersion: manager === "pnpm" ? "11.22.0" : preview.managerVersion,
        confirmText: `REMOVE GLOBAL ${manager} @test/tool` }
      session.select(selected)
      await session.refresh(snapshot, terminal({ kind: "preview", ...selected, previewId, preview: displayed }))
      session.consent({ acknowledged: true, confirmText: displayed.confirmText }); await flush()
    },
    async mutate(manager = "npm") { await this.ready(manager); const done = session.execute(); last("execute").resolve({ jobId: id, requestId, previewId, status: "running" }); await done; await flush() },
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

test("versions loading identifies the pressed row before acceptance and keeps choices through preview", async t => {
  const h = harness(t)
  await h.init()
  const selected = { ...selection, manager: "pnpm", action: "change", targetVersion: "2.0.0" }
  h.session.select({ ...selected, targetVersion: "" })
  const done = h.session.loadVersions(selected)
  assert.deepEqual(h.session.getSnapshot().activity, { kind: "versions", manager: "pnpm", package: selection.package, action: null })
  assert.equal(h.session.getSnapshot().phase, "starting")
  assert.equal(globalActionPending(h.session.getSnapshot(), "versions", selected), true)
  assert.equal(globalActionPending(h.session.getSnapshot(), "preview", selected), false)
  assert.equal(globalActionPending(h.session.getSnapshot(), "versions", { ...selected, manager: "npm" }), false)
  assert.equal(globalActionPending(h.session.getSnapshot(), "versions", { ...selected, package: "@test/other" }), false)
  const choices = { manager: "pnpm", package: selection.package, versions: ["2.0.0", "1.0.0"], tags: { latest: "2.0.0" } }
  h.last("versions").resolve({ jobId: id, requestId, previewId: null, status: "running" })
  await done; await h.cycle(terminal({ kind: "versions", manager: "pnpm", package: selection.package,
    versions: { ...choices, versions: ["1.0.0", "2.0.0"] } }), page())
  assert.deepEqual(h.session.getSnapshot().versions, choices)
  assert.equal(globalActionPending(h.session.getSnapshot(), "versions", selected), false)
  const next = h.session.preview(selected)
  assert.deepEqual(h.session.getSnapshot().activity, { kind: "preview", manager: "pnpm", package: selection.package, action: "change" })
  assert.deepEqual(h.session.getSnapshot().versions, choices)
  h.last("preview").reject(new ApiError(409, "TEST", "CONFLICT", { reason: "NO_VERSION_CHANGE" }))
  await next
  assert.deepEqual(h.session.getSnapshot().versions, choices)
  assert.equal(h.all("execute").length, 0)
})

test("success requires finalized verified execution, never a completed command still settling", () => {
  const completed = terminal({ kind: "mutation", mutationSpawned: true })
  assert.equal(globalMutationSucceeded(completed), true)
  for (const patch of [{ phase: "finalizing" }, { gateHeld: true }, { refreshRequired: true }, { auditWritten: false },
    { terminationVerified: false }, { failureCode: "POSTCONDITION_FAILED" }, { mutationSpawned: false }, { exitCode: 1 }]) {
    assert.equal(globalMutationSucceeded({ ...completed, ...patch }), false)
  }
})

test("successful execute waits for finalization and log drain, refreshes inventory once, retains its outcome", async t => {
  const h = harness(t)
  await h.mutate()
  const completed = terminal({ kind: "mutation", previewId, mutationSpawned: true, endCursor: 2 })
  await h.cycle(completed, page([0], { endCursor: 2 }))
  assert.equal(h.all("inventory").length, 0)
  assert.deepEqual(h.session.getSnapshot().mutationResult, completed)
  await h.tick(1000)
  h.last("logs").resolve(page([1])); await flush()
  assert.equal(h.all("inventory").length, 1)
  assert.equal(h.session.getSnapshot().activity.kind, "inventory")
  assert.deepEqual(h.session.getSnapshot().mutationResult, completed)
  h.last("inventory").resolve({ jobId: "TEST-inventory", requestId, previewId: null, status: "running" }); await flush()
  await h.cycle(terminal({ jobId: "TEST-inventory" }), page([], { jobId: "TEST-inventory" }))
  h.last("snapshot").resolve({ ...snapshot, revision: "TEST-refreshed" }); await flush()
  assert.equal(h.session.getSnapshot().snapshot.revision, "TEST-refreshed")
  assert.deepEqual(h.session.getSnapshot().mutationResult, completed)
  await h.tick(5000)
  assert.equal(h.all("inventory").length, 1)
  assert.equal(h.all("execute").length, 1)
})

test("failed or uncertain mutations keep rows and never trigger automatic inventory or execute", async t => {
  for (const mutationSpawned of [false, true]) {
    const h = harness(t)
    await h.mutate()
    const failed = terminal({ kind: "mutation", previewId, mutationSpawned, status: "failed", failureCode: "SPAWN_FAILED" })
    await h.cycle(failed, page())
    assert.deepEqual(h.session.getSnapshot().mutationResult, failed)
    assert.deepEqual(h.session.getSnapshot().snapshot.managers, snapshot.managers)
    assert.equal(h.session.getSnapshot().snapshot.stale, mutationSpawned)
    assert.equal(h.all("snapshot").length, 0)
    assert.equal(h.all("inventory").length, 0)
    assert.equal(h.all("execute").length, 1)
  }
})

test("automatic inventory failure preserves the successful outcome without retrying either POST", async t => {
  const h = harness(t)
  await h.mutate()
  const completed = terminal({ kind: "mutation", previewId, mutationSpawned: true })
  await h.cycle(completed, page())
  assert.equal(h.all("inventory").length, 1)
  h.last("inventory").reject(new ApiError(409, "TEST", "CONFLICT", { reason: "READERS_RUNNING" }))
  await flush(); await h.tick(5000)
  assert.deepEqual(h.session.getSnapshot().mutationResult, completed)
  assert.equal(h.session.getSnapshot().snapshot.stale, true)
  assert.equal(h.session.getSnapshot().error.code, "READERS_RUNNING")
  assert.equal(h.all("inventory").length, 1)
  assert.equal(h.all("execute").length, 1)
})

test("mounting a retained completed mutation reports its outcome without an implicit inventory POST", async t => {
  const h = harness(t)
  const completed = terminal({ kind: "mutation", previewId, mutationSpawned: true })
  await h.init(completed)
  assert.deepEqual(h.session.getSnapshot().mutationResult, completed)
  assert.equal(h.all("inventory").length, 0)
})

test("a successful cleanup response refreshes once even when no poll is needed", async t => {
  const h = harness(t)
  await h.mutate()
  await h.cycle(terminal({ kind: "mutation", previewId, mutationSpawned: true,
    status: "termination_failed", gateHeld: true, terminationVerified: false }), page())
  const done = h.session.cancel()
  h.last("cancel").resolve(terminal({ kind: "mutation", previewId, mutationSpawned: true }))
  await done; await flush()
  assert.equal(h.all("inventory").length, 1)
  assert.equal(h.all("execute").length, 1)
})

test("starting another execution clears the prior outcome while retaining package rows", async t => {
  const h = harness(t)
  await h.init(terminal({ kind: "mutation", previewId, mutationSpawned: false, status: "failed", failureCode: "SPAWN_FAILED" }))
  assert.ok(h.session.getSnapshot().mutationResult)
  const preparing = h.session.preview(selection)
  h.last("preview").resolve({ jobId: "TEST-next-preview", requestId, previewId, status: "running" })
  await preparing
  await h.cycle(terminal({ jobId: "TEST-next-preview", kind: "preview", ...selection, previewId, preview }),
    page([], { jobId: "TEST-next-preview" }))
  h.session.consent({ acknowledged: true, confirmText: preview.confirmText })
  const done = h.session.execute()
  assert.equal(h.session.getSnapshot().mutationResult, null)
  assert.deepEqual(h.session.getSnapshot().snapshot, snapshot)
  h.last("execute").reject(new ApiError(409, "TEST", "CONFLICT"))
  await done
})

test("pnpm 11 availability and readonly group rows coexist with manageable npm without implicit activity", async t => {
  const h = harness(t)
  const grouped = { ...pnpmInventory.packages[0], status: "invalid", reason: "GLOBAL_GROUP_UNSUPPORTED" }
  await h.session.refresh({ ...snapshot, managers: [npmInventory,
    { ...pnpmInventory, packages: [...pnpmInventory.packages, { ...grouped, name: "@test/grouped" }] }] }, null)
  const managers = h.session.getSnapshot().snapshot.managers
  assert.equal(managers[0].manager, "npm")
  assert.equal(managers[0].available, true)
  assert.equal(managers[0].packages[0].status, "manageable")
  assert.equal(managers[0].packages[0].reason, null)
  assert.equal(managers[1].manager, "pnpm")
  assert.equal(managers[1].version, "11.22.0")
  assert.equal(managers[1].available, true)
  assert.equal(managers[1].reason, null)
  assert.equal(managers[1].packages[0].status, "manageable")
  assert.equal(managers[1].packages[1].status, "invalid")
  assert.equal(managers[1].packages[1].reason, "GLOBAL_GROUP_UNSUPPORTED")
  assert.equal(h.requests.length, 0)
})

test("pnpm setup and legacy disabled reasons remain per-manager while npm remains available", async t => {
  for (const reason of ["PNPM_GLOBAL_NOT_CONFIGURED", "MANAGER_DISABLED"]) {
    const h = harness(t)
    await h.session.refresh({ ...snapshot, managers: [npmInventory,
      { ...pnpmInventory, available: false, reason, globalRoot: null, binDir: null, packages: [] }] }, null)
    const managers = h.session.getSnapshot().snapshot.managers
    assert.equal(managers[0].available, true)
    assert.equal(managers[0].reason, null)
    assert.equal(managers[0].packages[0].name, "@test/npm-tool")
    assert.equal(managers[1].available, false)
    assert.equal(managers[1].reason, reason)
    assert.equal(managers[1].globalRoot, null)
    assert.equal(managers[1].binDir, null)
    assert.deepEqual(managers[1].packages, [])
    assert.equal(h.requests.length, 0)
  }
})

for (const reason of ["PNPM_GLOBAL_NOT_CONFIGURED", "GLOBAL_GROUP_UNSUPPORTED"]) {
  test(`pnpm failed jobs retain ${reason} without triggering another activity`, async t => {
    const h = harness(t)
    await h.session.refresh({ ...snapshot, managers: [npmInventory, pnpmInventory] },
      terminal({ kind: "preview", manager: "pnpm", package: "@test/tool", status: "failed", exitCode: null, failureCode: reason }))
    assert.equal(h.session.getSnapshot().job.failureCode, reason)
    assert.equal(h.session.getSnapshot().job.manager, "pnpm")
    assert.equal(h.session.getSnapshot().phase, "idle")
    assert.equal(h.session.getSnapshot().form.preview, null)
    assert.equal(h.requests.length, 0)
  })

  for (const method of ["versions", "preview"]) {
    test(`pnpm ${method} rejection exposes ${reason} without automatic retry or mutation`, async t => {
      const h = harness(t)
      await h.init()
      const selected = { ...selection, manager: "pnpm" }
      const done = method === "versions" ? h.session.loadVersions(selected) : h.session.preview(selected)
      assert.equal(h.last(method).args[0].manager, "pnpm")
      h.last(method).reject(new ApiError(409, "TEST unrelated message", "CONFLICT", { reason }))
      await done; await h.tick(10000)
      assert.equal(h.session.getSnapshot().error.code, reason)
      assert.equal(h.session.getSnapshot().startUnknown, false)
      assert.equal(h.session.getSnapshot().form.preview, null)
      assert.equal(h.all(method).length, 1)
      assert.equal(h.all("execute").length, 0)
      assert.equal(h.all("latest").length, 0)
    })
  }

  test(`pnpm execute rejection ${reason} clears displayed consent and requires a new preview`, async t => {
    const h = harness(t)
    await h.ready("pnpm")
    const done = h.session.execute()
    h.last("execute").reject(new ApiError(409, "TEST unrelated message", "CONFLICT", { reason }))
    await done
    const state = h.session.getSnapshot()
    assert.equal(state.form.preview, null)
    assert.equal(state.form.acknowledged, false)
    assert.equal(state.form.confirmText, "")
    assert.equal(state.error.code, reason)
    await h.tick(10000); await h.session.execute()
    assert.equal(h.all("execute").length, 1)
    assert.equal(h.all("preview").length, 0)
  })
}

test("pnpm execute requires its displayed consent and recovers a lost response without resubmitting", async t => {
  const h = harness(t)
  await h.ready("pnpm")
  h.session.consent({ acknowledged: false })
  await h.session.execute()
  assert.equal(h.session.getSnapshot().error.code, "RISK_NOT_ACKNOWLEDGED")
  h.session.consent({ acknowledged: true, confirmText: preview.confirmText })
  await h.session.execute()
  assert.equal(h.session.getSnapshot().error.code, "CONFIRM_TEXT_MISMATCH")
  assert.equal(h.all("execute").length, 0)
  h.session.consent({ confirmText: "REMOVE GLOBAL pnpm @test/tool" })
  const done = h.session.execute(); void h.session.execute()
  assert.deepEqual(h.last("execute").args[0], { previewId, requestId, confirm: true,
    acknowledgedRisks: ["MACHINE_WIDE"], confirmText: "REMOVE GLOBAL pnpm @test/tool" })
  h.last("execute").reject(new ApiError(503, "TEST lost response", "BACKEND_UNAVAILABLE")); await flush()
  assert.equal(h.session.getSnapshot().startUnknown, true)
  assert.equal(h.session.getSnapshot().form.preview.manager, "pnpm")
  h.last("latest").resolve(job({ kind: "mutation", manager: "pnpm", previewId, gateHeld: true }))
  await done; await flush()
  assert.equal(h.session.getSnapshot().startUnknown, false)
  assert.equal(h.session.getSnapshot().phase, "tracking")
  assert.equal(h.session.getSnapshot().form.preview, null)
  assert.equal(h.session.getSnapshot().form.acknowledged, false)
  await h.session.execute(); await h.tick(5000)
  assert.equal(h.all("execute").length, 1)
})

test("pnpm completed commands remain active until finalizing, audit and gate release finish", async t => {
  const h = harness(t)
  await h.mutate("pnpm")
  await h.cycle(terminal({ kind: "mutation", manager: "pnpm", previewId, mutationSpawned: true,
    mayHaveChanged: true, phase: "finalizing", finishedAt: null, gateHeld: true, auditWritten: false }))
  assert.equal(h.session.getSnapshot().phase, "tracking")
  assert.deepEqual(h.mutations, [])
  assert.equal(h.all("snapshot").length, 0)
  await h.session.inventory(); await h.session.preview({ ...selection, manager: "pnpm" })
  assert.equal(h.all("inventory").length, 0)
  assert.equal(h.all("preview").length, 0)
  await h.tick(1000)
  await h.cycle(terminal({ kind: "mutation", manager: "pnpm", previewId, mutationSpawned: true, mayHaveChanged: true }))
  assert.equal(h.session.getSnapshot().mutationResult.gateHeld, false)
  assert.equal(h.session.getSnapshot().mutationResult.auditWritten, true)
  assert.deepEqual(h.mutations, [id])
  assert.equal(h.all("inventory").length, 1)
  h.last("inventory").resolve({ jobId: "TEST-inventory", requestId, previewId: null, status: "running" }); await flush()
  await h.cycle(terminal({ jobId: "TEST-inventory" }), page([], { jobId: "TEST-inventory" }))
  h.last("snapshot").resolve({ ...snapshot, managers: [npmInventory, pnpmInventory] }); await flush()
  assert.equal(h.session.getSnapshot().phase, "idle")
  assert.equal(h.session.getSnapshot().snapshot.stale, false)
  assert.equal(h.all("execute").length, 1)
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
    assert.equal(h.all("snapshot").length, 0)
    await h.tick(1000)
    assert.equal(h.all("get").length, 1)
    h.last("logs").resolve(page([1, 2])); await flush(); await h.tick(5000)
    assert.equal(h.session.getSnapshot().phase, status === "completed" ? "starting" : "idle")
    assert.equal(h.all("inventory").length, status === "completed" ? 1 : 0)
    if (status !== "completed") assert.deepEqual(h.session.getSnapshot().logs.chunks.map(c => c.seq), [0, 1, 2])
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
  assert.equal(h.session.getSnapshot().mutationResult.gateHeld, false)
  assert.equal(h.all("snapshot").length, 0)
  assert.equal(h.all("inventory").length, 1)
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
