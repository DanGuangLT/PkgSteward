import { test } from "node:test"
import assert from "node:assert/strict"
import {
  acceptDiskJob, diskShouldPoll, diskCanPoll, diskAcceptPoll,
  diskBeginCancel, diskPollFailure, diskRetryPoll, diskTrackJob,
} from "./disk-usage-policy.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const job = { jobId: "TEST-job", status: "running" }
const state = { phase: "tracking", jobId: job.jobId, job: null, cancelPending: false }

test("running visible polls", () => {
  assert.equal(diskShouldPoll("running", true), true)
})

test("terminal/hidden stops", () => {
  for (const status of ["completed", "cancelled", "timed_out", "failed"]) {
    assert.equal(diskShouldPoll(status, true), false)
    assert.equal(diskShouldPoll(status, false), false)
  }
  assert.equal(diskShouldPoll("running", false), false)
})

test("different job rejected", () => {
  assert.equal(acceptDiskJob(state, job, 2, 2), true)
  assert.equal(acceptDiskJob(state, { ...job, jobId: "TEST-other" }, 2, 2), false)
  for (const phase of ["idle", "starting"]) {
    assert.equal(acceptDiskJob({ phase, job: null }, job, 2, 2), false)
  }
})

test("stale generation ignored", () => {
  assert.equal(acceptDiskJob(state, job, 2, 1), false)
  assert.equal(acceptDiskJob(state, job, 2, 3), false)
})

test("cancel prevents GET overwrite", () => {
  const cancelling = diskBeginCancel(state)
  assert.equal(cancelling.cancelPending, true)
  assert.equal(diskCanPoll(cancelling, true), false)
  assert.equal(diskAcceptPoll(cancelling, job, 2, 2), false)
  assert.equal(acceptDiskJob(cancelling, { ...job, status: "cancelled" }, 2, 2), true)
  assert.equal(diskAcceptPoll(state, job, 3, 2), false)
  assert.equal(diskAcceptPoll(state, { ...job, jobId: "TEST-other" }, 2, 2), false)
})

test("poll failure waits for manual retry", () => {
  const snapshot = { ...job, sizeBytes: 0 }
  const failed = diskPollFailure({ ...state, job: snapshot }, "BACKEND_UNAVAILABLE")
  assert.equal(failed.job, snapshot)
  assert.equal(failed.errorCode, "BACKEND_UNAVAILABLE")
  assert.equal(diskCanPoll(failed, true), false)
  const retried = diskRetryPoll(failed)
  assert.equal(retried.errorCode, undefined)
  assert.equal(diskCanPoll(retried, true), true)
  assert.equal(diskCanPoll(diskRetryPoll(diskBeginCancel(state)), true), false)
})

test("404 stops tracking and keeps the last snapshot", () => {
  const snapshot = { ...job, sizeBytes: 42 }
  for (const [code, status] of [["NOT_FOUND", 404], ["HTTP_EXCEPTION", 404]]) {
    const lost = diskPollFailure({ ...state, job: snapshot }, code, status)
    assert.deepEqual(lost, { phase: "idle", job: snapshot })
    assert.equal(diskCanPoll(lost, true), false)
    assert.equal(diskCanPoll(diskRetryPoll(lost), true), false)
  }
})

test("new job polls while the previous terminal snapshot is preserved", () => {
  const snapshot = { ...job, jobId: "TEST-previous", status: "completed", sizeBytes: 0 }
  const tracking = diskTrackJob({ phase: "starting", job: snapshot }, job.jobId)
  assert.equal(tracking.job, snapshot)
  assert.equal(diskCanPoll(tracking, true), true)
  assert.equal(diskAcceptPoll(tracking, snapshot, 2, 2), false)
  assert.equal(diskPollFailure(tracking, "NOT_FOUND").job, snapshot)
})

test("hidden resume preserves poll errors and terminal snapshots", () => {
  assert.equal(diskCanPoll(state, false), false)
  assert.equal(diskCanPoll(state, true), true)
  assert.equal(diskCanPoll(diskPollFailure(state, "RATE_LIMITED"), true), false)
  for (const status of ["completed", "cancelled", "timed_out", "failed"]) {
    assert.equal(diskCanPoll({ ...state, job: { ...job, status } }, true), false)
  }
})
