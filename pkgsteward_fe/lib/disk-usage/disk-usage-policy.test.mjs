import { test } from "node:test"
import assert from "node:assert/strict"
import { acceptDiskJob, diskShouldPoll } from "./disk-usage-policy.ts"

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
