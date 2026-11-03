import { test } from "node:test"
import assert from "node:assert/strict"
import { ApiError } from "../api/response.ts"
import * as policy from "./disk-usage-policy.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const lexical = { path: "D:\\TEST\\node_modules", view: "packages" }
const initial = { phase: "idle", job: null, requestTarget: null, form: lexical }
const completed = { jobId: "TEST-parent", path: "D:\\TEST\\store", view: "packages", status: "completed" }

test("force and restored history preserve the lexical package request target", () => {
  const tracking = policy.diskTrackJob(initial, completed.jobId, lexical)
  assert.deepEqual(tracking.target, lexical)
  const measured = policy.diskReceiveJob(tracking, completed)
  assert.deepEqual(policy.diskMeasurementInput(measured, true), { ...lexical, force: true })
  assert.equal(measured.job.path, "D:\\TEST\\store")

  const parent = policy.diskSaveSnapshot(measured)
  const childTarget = policy.diskExpandTarget({ path: "D:\\TEST\\alias", canonicalPath: "D:\\TEST\\store\\pkg" })
  assert.deepEqual(childTarget, { path: "D:\\TEST\\store\\pkg", view: "directory" })
  assert.deepEqual(policy.diskExpandTarget({ path: "D:\\TEST\\folder", canonicalPath: null }), {
    path: "D:\\TEST\\folder", view: "directory",
  })
  const child = policy.diskReceiveJob(policy.diskTrackJob(measured, "TEST-child", childTarget), {
    ...completed, jobId: "TEST-child", path: childTarget.path, view: "directory",
  })
  assert.deepEqual(policy.diskSaveSnapshot(child).requestTarget, childTarget)
  const restored = policy.diskRestoreSnapshot(parent)
  assert.deepEqual(restored.form, lexical)
  assert.deepEqual(policy.diskMeasurementInput(restored, true), { ...lexical, force: true })

  // A failed replacement must not associate its target with the preserved parent.
  const replacement = policy.diskTrackJob(restored, "TEST-replacement", childTarget)
  assert.equal(policy.diskReceiveJob(replacement, completed), replacement)
  const lost = policy.diskPollFailure(replacement, "NOT_FOUND", 404)
  assert.deepEqual(policy.diskSaveSnapshot(lost), parent)
  assert.deepEqual(policy.diskMeasurementInput(lost, true), { ...lexical, force: true })
})

test("follow synchronizes the form from its first snapshot only, including an immediate cancel", () => {
  for (const status of ["running", "completed", "cancelled"]) {
    const tracking = policy.diskTrackJob(initial, "TEST-followed", { path: "D:\\TEST\\followed", view: null })
    const job = { ...completed, jobId: "TEST-followed", path: "D:\\TEST\\canonical", view: "directory", status }
    const first = policy.diskReceiveJob(tracking, job)
    const target = { path: "D:\\TEST\\followed", view: "directory" }
    assert.deepEqual(first.form, target)
    assert.deepEqual(policy.diskSaveSnapshot(first).requestTarget, target)
    assert.deepEqual(policy.diskMeasurementInput(first, true), { ...target, force: true })

    const terminal = status === "running" ? policy.diskReceiveJob(first, { ...job, status: "completed" }) : first
    assert.equal(terminal.form, first.form)
    const edited = policy.diskEditTarget(terminal, lexical)
    assert.equal(policy.diskReceiveJob(edited, job), edited)
    assert.deepEqual(policy.diskMeasurementInput(edited, false), { ...lexical, force: false })
  }
})

test("a start 404 with a previous snapshot is not a lost tracked job", () => {
  const saved = policy.diskRestoreSnapshot({ job: completed, requestTarget: lexical })
  const missing = new ApiError(404, "TEST missing", "NOT_FOUND")
  const starting = { ...saved, phase: "starting" }
  assert.equal(policy.diskRequestError(starting, "start", missing).lost, false)
  assert.equal(policy.diskSaveSnapshot(starting).job, completed)

  for (const operation of ["poll", "cancel"]) {
    for (const code of ["NOT_FOUND", "HTTP_EXCEPTION"]) {
      const tracking = policy.diskTrackJob(saved, "TEST-current", lexical)
      const failure = policy.diskRequestError(tracking, operation, new ApiError(404, "TEST missing", code))
      assert.equal(failure.code, "NOT_FOUND")
      assert.equal(failure.lost, true)
      assert.equal(policy.diskRequestError(saved, operation, missing).lost, false)
      assert.equal(policy.diskRequestError(tracking, operation, new ApiError(503, "TEST offline", "BACKEND_UNAVAILABLE")).lost, false)
    }
  }
})

test("retry after a backend restart announces untracked while preserving the running snapshot", () => {
  const running = { ...completed, status: "running" }
  const tracking = policy.diskReceiveJob(policy.diskTrackJob(initial, running.jobId, lexical), running)
  const offline = policy.diskPollFailure(tracking, "BACKEND_UNAVAILABLE", 503)
  const retried = policy.diskRetryPoll(offline)
  const lost = policy.diskPollFailure(retried, "NOT_FOUND", 404)
  assert.equal(lost.phase, "idle")
  assert.equal(lost.job, running)
  assert.equal(policy.diskStatusKey(lost), "status.untracked")
})

test("status keys preserve idle, starting, tracking, cancelling and terminal announcements", () => {
  assert.equal(policy.diskStatusKey(initial), "status.idle")
  assert.equal(policy.diskStatusKey({ ...initial, phase: "starting", job: completed }), "status.starting")
  const tracking = policy.diskTrackJob({ ...initial, job: completed }, "TEST-next", lexical)
  assert.equal(policy.diskStatusKey(tracking), "status.running")
  assert.equal(policy.diskStatusKey(policy.diskBeginCancel(tracking)), "status.cancelling")
  assert.equal(policy.diskStatusKey(policy.diskPollFailure(tracking, "BACKEND_UNAVAILABLE", 503)), "status.running")
  for (const status of ["completed", "cancelled", "timed_out", "failed"]) {
    assert.equal(policy.diskStatusKey({ ...initial, job: { ...completed, status } }), `status.${status}`)
  }
})
