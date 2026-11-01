import { test } from "node:test"
import assert from "node:assert/strict"
import { ACTIVE_CHECK_INTERVAL_MS, POLL_INTERVAL_MS, createFileOpsSession } from "./file-ops-session.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const PREVIEW = "TEST-preview"
const OPERATION = "TEST-operation"
const TARGET = "D:\\TEST\\node_modules"
const OTHER = "D:\\TEST\\.next"
const EXECUTE = "POST /api/file-ops/delete/execute"
const ACTIVE = "GET /api/file-ops/operations/active"
const CLEANUP = "POST /api/file-ops/cleanup/preview"
const PREVIEW_POLL = `GET /api/file-ops/previews/${PREVIEW}`
const PREVIEW_CANCEL = `POST /api/file-ops/previews/${PREVIEW}/cancel`
const SUMMARY = `POST /api/file-ops/previews/${PREVIEW}/summary`
const OPERATION_POLL = `GET /api/file-ops/operations/${OPERATION}`
const OPERATION_CANCEL = `POST /api/file-ops/operations/${OPERATION}/cancel`

const preview = (status) => ({ previewId: PREVIEW, status, source: "cleanup", targets: [], operationId: null })
const operation = (status) => ({ operationId: OPERATION, previewId: PREVIEW, status, results: [] })
const summaryOf = (paths, level = "low", reasons = []) => ({
  paths, risk: { level, reasons }, confirmText: null, totals: { targetCount: paths.length, reclaimableBytes: 1, recycleBytes: 0 },
})
const noTicks = { acknowledged: new Set(), typedText: "" }

const ok = (data, status = 200) => Response.json({ statusCode: status, message: "OK", code: "SUCCESS", data }, { status })
const fail = (status, code) => Response.json({ statusCode: status, message: "TEST", code }, { status })
const unreachable = () => Promise.reject(new TypeError("TEST connection lost"))

function server(t, routes = {}) {
  const calls = []
  const held = []
  const table = {
    [ACTIVE]: () => ok(null),
    [CLEANUP]: () => ok({ previewId: PREVIEW, status: "running" }, 202),
    [PREVIEW_POLL]: () => ok(preview("completed")),
    [PREVIEW_CANCEL]: () => ok(preview("cancelled")),
    [SUMMARY]: (call) => ok(summaryOf(call.body.paths)),
    [EXECUTE]: () => ok({ operationId: OPERATION, status: "running" }, 202),
    [OPERATION_POLL]: () => ok(operation("completed")),
    [OPERATION_CANCEL]: () => ok(operation("stopping")),
    ...routes,
  }
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const key = `${init.method} ${url}`
    const call = { key, body: init.body ? JSON.parse(init.body) : undefined, signal: init.signal }
    calls.push(call)
    const route = table[key]
    assert.ok(route, `TEST unexpected request ${key}`)
    return route(call)
  })
  return {
    calls,
    routes: table,
    count: (key) => calls.filter((call) => call.key === key).length,
    last: (key) => calls.filter((call) => call.key === key).at(-1),
    // Giữ response lại tới khi test cho phép; request bị huỷ thì reject như fetch thật.
    hold: (key, response) => {
      const previous = table[key]
      table[key] = (call) => new Promise((resolve, reject) => {
        call.signal?.addEventListener("abort", () => reject(new DOMException("TEST aborted", "AbortError")))
        held.push(() => resolve(response ? response(call) : previous(call)))
      })
    },
    release: () => held.splice(0).forEach((resolve) => resolve()),
  }
}

function browser(overrides = {}) {
  const watchers = new Set()
  return {
    visible: true,
    stored: null,
    isVisible() { return this.visible },
    onVisibilityChange(listener) {
      watchers.add(listener)
      return () => watchers.delete(listener)
    },
    recallPreview() { return this.stored },
    rememberPreview(previewId) { this.stored = previewId },
    setVisible(visible) {
      this.visible = visible
      for (const listener of watchers) listener()
    },
    ...overrides,
  }
}

async function flush() {
  for (let index = 0; index < 30; index += 1) await new Promise(setImmediate)
}

function start(t, routes, environment = browser()) {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const api = server(t, routes)
  const session = createFileOpsSession(environment)
  const disconnect = session.connect()
  const phase = () => session.getSnapshot().state.phase
  const tick = async (milliseconds) => {
    t.mock.timers.tick(milliseconds)
    await flush()
  }
  return { api, session, environment, disconnect, phase, tick }
}

async function toReview({ session }) {
  await session.startCleanup({})
  await flush()
}

async function toConfirm(context, paths = [TARGET]) {
  await toReview(context)
  await context.session.summarize(paths)
  await flush()
}

test("full flow sends one execute with the confirmed summary", async (t) => {
  const context = start(t)
  await flush()
  await toConfirm(context)
  assert.equal(context.phase(), "reviewing")
  await context.session.execute(noTicks)
  await flush()
  assert.equal(context.phase(), "finished")
  assert.equal(context.api.count(EXECUTE), 1)
  assert.deepEqual(context.api.last(EXECUTE).body, { previewId: PREVIEW, paths: [TARGET], confirm: true })
})

test("repeated confirm clicks send one execute", async (t) => {
  const context = start(t)
  await toConfirm(context)
  context.api.hold(EXECUTE)
  await Promise.all([context.session.execute(noTicks), context.session.execute(noTicks), context.session.execute(noTicks)].map(() => flush()))
  context.api.release()
  await flush()
  assert.equal(context.api.count(EXECUTE), 1)
})

test("execute needs a summary and a complete confirmation", async (t) => {
  const reasons = [{ code: "NO_LOCKFILE", level: "medium", message: "TEST" }]
  const context = start(t, { [SUMMARY]: (call) => ok(summaryOf(call.body.paths, "medium", reasons)) })
  await context.session.execute(noTicks)
  await toReview(context)
  await context.session.execute(noTicks)
  await context.session.summarize([TARGET])
  await context.session.execute(noTicks)
  await flush()
  assert.equal(context.api.count(EXECUTE), 0)
  await context.session.execute({ acknowledged: new Set(["NO_LOCKFILE"]), typedText: "" })
  await flush()
  assert.equal(context.api.count(EXECUTE), 1)
  assert.deepEqual(context.api.last(EXECUTE).body.acknowledgedRisks, ["NO_LOCKFILE"])
})

test("the newest summary request wins", async (t) => {
  const context = start(t)
  await toReview(context)
  context.api.hold(SUMMARY)
  void context.session.summarize([TARGET, OTHER])
  await flush()
  void context.session.summarize([TARGET])
  await flush()
  assert.equal(context.api.count(SUMMARY), 2)
  assert.equal(context.api.calls.filter(({ key }) => key === SUMMARY)[0].signal.aborted, true)
  context.api.release()
  await flush()
  assert.deepEqual(context.session.getSnapshot().state.summary.paths, [TARGET])
})

test("closing the dialog drops a summary still on its way", async (t) => {
  const context = start(t)
  await toReview(context)
  context.api.hold(SUMMARY)
  void context.session.summarize([TARGET])
  await flush()
  context.session.closeSummary()
  context.api.release()
  await flush()
  assert.equal(context.session.getSnapshot().state.summary, null)
  await context.session.execute(noTicks)
  assert.equal(context.api.count(EXECUTE), 0)
})

test("closing the dialog while executing does not abort the execute", async (t) => {
  const context = start(t)
  await toConfirm(context)
  context.api.hold(EXECUTE)
  void context.session.execute(noTicks)
  await flush()
  context.session.closeSummary()
  assert.equal(context.api.last(EXECUTE).signal.aborted, false)
  assert.equal(context.phase(), "executing")
})

test("a lost execute response waits for the user and resends the same body", async (t) => {
  const context = start(t, { [EXECUTE]: unreachable })
  await toConfirm(context)
  await context.session.execute(noTicks)
  await flush()
  assert.equal(context.phase(), "unconfirmed")
  await context.tick(POLL_INTERVAL_MS * 30)
  assert.equal(context.api.count(EXECUTE), 1)
  context.api.routes[EXECUTE] = () => ok({ operationId: OPERATION, status: "running" }, 202)
  await context.session.resendExecute()
  await flush()
  assert.equal(context.api.count(EXECUTE), 2)
  assert.deepEqual(context.api.calls.filter(({ key }) => key === EXECUTE)[1].body, context.api.calls.filter(({ key }) => key === EXECUTE)[0].body)
  assert.equal(context.phase(), "finished")
})

test("an unknown outcome resolves by itself when the operation appears, without another execute", async (t) => {
  const context = start(t, { [EXECUTE]: unreachable })
  await toConfirm(context)
  await context.session.execute(noTicks)
  await flush()
  context.api.routes[ACTIVE] = () => ok(operation("running"))
  await context.tick(ACTIVE_CHECK_INTERVAL_MS)
  assert.equal(context.phase(), "finished")
  assert.equal(context.api.count(EXECUTE), 1)
})

test("an operation of another preview does not resolve an unknown outcome", async (t) => {
  const context = start(t, { [EXECUTE]: unreachable })
  await toConfirm(context)
  await context.session.execute(noTicks)
  await flush()
  context.api.routes[ACTIVE] = () => ok({ ...operation("running"), previewId: "TEST-other" })
  await context.tick(ACTIVE_CHECK_INTERVAL_MS)
  assert.equal(context.phase(), "unconfirmed")
})

test("an operation that starts after dismissing is still followed", async (t) => {
  const context = start(t, { [EXECUTE]: unreachable })
  await toConfirm(context)
  await context.session.execute(noTicks)
  await flush()
  context.session.abandon()
  assert.equal(context.phase(), "idle")
  context.api.routes[ACTIVE] = () => ok(operation("running"))
  context.api.routes[OPERATION_POLL] = () => ok(operation("running"))
  await context.tick(ACTIVE_CHECK_INTERVAL_MS)
  assert.equal(context.phase(), "operating")
  assert.equal(context.api.count(EXECUTE), 1)
})

test("leaving the page does not abort an execute, and coming back follows the operation", async (t) => {
  const context = start(t)
  await toConfirm(context)
  context.api.hold(EXECUTE)
  void context.session.execute(noTicks)
  await flush()
  context.disconnect()
  assert.equal(context.api.last(EXECUTE).signal.aborted, false)

  context.api.routes[ACTIVE] = () => ok(operation("running"))
  context.api.routes[OPERATION_POLL] = () => ok(operation("running"))
  const reloaded = createFileOpsSession(browser())
  reloaded.connect()
  await flush()
  assert.equal(reloaded.getSnapshot().state.phase, "operating")
  assert.equal(context.api.count(EXECUTE), 1)
})

test("reload restores a running operation and never sends execute", async (t) => {
  const context = start(t, { [ACTIVE]: () => ok(operation("stopping")), [OPERATION_POLL]: () => ok(operation("stopping")) })
  await flush()
  assert.equal(context.phase(), "operating")
  context.api.routes[OPERATION_POLL] = () => ok(operation("completed"))
  await context.tick(POLL_INTERVAL_MS)
  assert.equal(context.phase(), "finished")
  assert.equal(context.api.count(EXECUTE), 0)
})

test("the preview id survives a reload so measuring can still be stopped", async (t) => {
  const context = start(t, { [PREVIEW_POLL]: () => ok(preview("running")) })
  await context.session.startCleanup({})
  await flush()
  assert.equal(context.environment.stored, PREVIEW)
  context.disconnect()

  const reloaded = createFileOpsSession(context.environment)
  reloaded.connect()
  await flush()
  assert.equal(reloaded.getSnapshot().state.phase, "measuring")
  await reloaded.cancelPreview()
  await flush()
  assert.equal(context.api.count(PREVIEW_CANCEL), 1)
  assert.equal(reloaded.getSnapshot().state.phase, "reviewing")
})

test("a preview is forgotten once it ends, so the next page load asks for nothing", async (t) => {
  const context = start(t, { [PREVIEW_POLL]: () => ok(preview("running")) })
  await context.session.startCleanup({})
  await flush()
  assert.equal(context.environment.stored, PREVIEW)
  context.api.routes[PREVIEW_POLL] = () => ok(preview("completed"))
  await context.tick(POLL_INTERVAL_MS)
  assert.equal(context.phase(), "reviewing")
  assert.equal(context.environment.stored, null)
  context.disconnect()
  t.mock.timers.reset()

  const stopped = start(t, { [PREVIEW_POLL]: () => ok(preview("running")) })
  await stopped.session.startCleanup({})
  await flush()
  await stopped.session.cancelPreview()
  await flush()
  assert.equal(stopped.environment.stored, null)
  stopped.disconnect()
  t.mock.timers.reset()

  const lost = start(t, { [PREVIEW_POLL]: () => fail(404, "NOT_FOUND") })
  await lost.session.startCleanup({})
  await flush()
  assert.equal(lost.phase(), "idle")
  assert.equal(lost.environment.stored, null)
})

test("a remembered preview that ended or vanished is forgotten and starts nothing", async (t) => {
  for (const route of [() => ok(preview("completed")), () => fail(404, "NOT_FOUND")]) {
    const context = start(t, { [PREVIEW_POLL]: route }, browser({ stored: PREVIEW }))
    await flush()
    assert.equal(context.phase(), "idle")
    assert.equal(context.environment.stored, null)
    context.disconnect()
    t.mock.timers.reset()
  }
})

test("no active checks while reviewing or hidden, and none after leaving", async (t) => {
  const context = start(t)
  await flush()
  const afterConnect = context.api.count(ACTIVE)
  context.environment.visible = false
  await context.tick(ACTIVE_CHECK_INTERVAL_MS)
  assert.equal(context.api.count(ACTIVE), afterConnect)
  context.environment.visible = true
  await context.tick(ACTIVE_CHECK_INTERVAL_MS)
  assert.equal(context.api.count(ACTIVE), afterConnect + 1)

  await toReview(context)
  const inReview = context.api.count(ACTIVE)
  await context.tick(ACTIVE_CHECK_INTERVAL_MS * 3)
  assert.equal(context.api.count(ACTIVE), inReview)

  context.session.reset()
  context.disconnect()
  await context.tick(ACTIVE_CHECK_INTERVAL_MS * 3)
  assert.equal(context.api.count(ACTIVE), inReview)
})

test("hiding the tab stops polling, showing it resumes, execute is untouched", async (t) => {
  const context = start(t, { [PREVIEW_POLL]: () => ok(preview("running")) })
  await context.session.startCleanup({})
  await flush()
  const polls = context.api.count(PREVIEW_POLL)
  context.environment.setVisible(false)
  await context.tick(POLL_INTERVAL_MS * 5)
  assert.equal(context.api.count(PREVIEW_POLL), polls)
  context.environment.setVisible(true)
  await flush()
  assert.equal(context.api.count(PREVIEW_POLL), polls + 1)
  await context.session.cancelPreview()
  await flush()

  await context.session.summarize([TARGET])
  await flush()
  context.api.hold(EXECUTE)
  void context.session.execute(noTicks)
  await flush()
  context.environment.setVisible(false)
  assert.equal(context.api.last(EXECUTE).signal.aborted, false)
})

test("a poll failure pauses until the manual retry, which never sends execute", async (t) => {
  const context = start(t, { [PREVIEW_POLL]: unreachable })
  await context.session.startCleanup({})
  await flush()
  assert.equal(context.session.getSnapshot().state.errorCode, "BACKEND_UNAVAILABLE")
  const polls = context.api.count(PREVIEW_POLL)
  await context.tick(POLL_INTERVAL_MS * 5)
  assert.equal(context.api.count(PREVIEW_POLL), polls)
  context.api.routes[PREVIEW_POLL] = () => ok(preview("completed"))
  context.session.retryPoll()
  await flush()
  assert.equal(context.phase(), "reviewing")
  assert.equal(context.api.count(EXECUTE), 0)
})

test("a late poll after cancel cannot overwrite the cancel result", async (t) => {
  const context = start(t, { [PREVIEW_POLL]: () => ok(preview("running")) })
  await context.session.startCleanup({})
  await flush()
  context.api.hold(PREVIEW_POLL)
  await context.tick(POLL_INTERVAL_MS)
  await context.session.cancelPreview()
  await flush()
  context.api.release()
  await flush()
  assert.equal(context.phase(), "reviewing")
  assert.equal(context.session.getSnapshot().state.preview.status, "cancelled")
})

test("stopping an operation keeps polling to the end", async (t) => {
  const context = start(t, { [OPERATION_POLL]: () => ok(operation("running")) })
  await toConfirm(context)
  await context.session.execute(noTicks)
  await flush()
  context.api.routes[OPERATION_POLL] = () => ok(operation("stopping"))
  await context.session.cancelOperation()
  await flush()
  assert.equal(context.session.getSnapshot().state.operation.status, "stopping")
  context.api.routes[OPERATION_POLL] = () => ok(operation("cancelled"))
  await context.tick(POLL_INTERVAL_MS)
  assert.equal(context.phase(), "finished")
})

test("a start failure is reported as such", async (t) => {
  const context = start(t, { [CLEANUP]: () => fail(404, "NOT_FOUND") })
  await context.session.startCleanup({})
  await flush()
  assert.equal(context.phase(), "idle")
  assert.deepEqual(context.session.getSnapshot().error, { code: "NOT_FOUND", paths: [], source: "start" })
})

test("nothing runs after disconnecting", async (t) => {
  const context = start(t, { [PREVIEW_POLL]: () => ok(preview("running")) })
  await context.session.startCleanup({})
  await flush()
  context.disconnect()
  const calls = context.api.calls.length
  await context.tick(POLL_INTERVAL_MS * 10)
  assert.equal(context.api.calls.length, calls)
})

test("subscribers hear every change and the snapshot stays stable between changes", async (t) => {
  const context = start(t)
  let heard = 0
  const stop = context.session.subscribe(() => { heard += 1 })
  const before = context.session.getSnapshot()
  assert.equal(context.session.getSnapshot(), before)
  await toReview(context)
  assert.ok(heard > 0)
  assert.notEqual(context.session.getSnapshot(), before)
  stop()
  const silent = heard
  context.session.reset()
  assert.equal(heard, silent)
})
