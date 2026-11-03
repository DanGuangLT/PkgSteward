import { test } from "node:test"
import assert from "node:assert/strict"
import { ApiError } from "../api/response.ts"
import {
  initialAnalysisState, trackAnalysis, canPollAnalysis, acceptAnalysisJob, receiveAnalysisJob,
  beginAnalysisCancel, failAnalysisRequest, retryAnalysisPoll, projectAnalysisError,
} from "./project-analysis-policy.ts"

// Dữ liệu TEST không phải yêu cầu nghiệp vụ.
const base = initialAnalysisState()
const tracking = trackAnalysis({ ...base, generation: 2 }, "TEST-job", "D:\\TEST")
const job = { jobId: "TEST-job", requestPath: "D:\\TEST-alias", status: "running", stale: false }

test("policy polls only visible tracking without cancellation or a paused error", () => {
  assert.equal(canPollAnalysis(tracking, true), true)
  assert.equal(canPollAnalysis(tracking, false), false)
  for (const phase of ["idle", "starting", "lost"]) assert.equal(canPollAnalysis({ ...tracking, phase }, true), false)
  assert.equal(canPollAnalysis(beginAnalysisCancel(tracking), true), false)
  assert.equal(canPollAnalysis(failAnalysisRequest(tracking, "poll", new Error("TEST")), true), false)
  for (const status of ["completed", "cancelled", "timed_out", "failed"]) {
    const next = receiveAnalysisJob(tracking, { ...job, status })
    assert.equal(next.phase, "idle")
    assert.equal(next.job.status, status)
    assert.equal(canPollAnalysis(next, true), false)
  }
})

test("policy rejects stale generations, wrong ids and late GETs during cancel", () => {
  assert.equal(acceptAnalysisJob(tracking, job, 2), true)
  assert.equal(acceptAnalysisJob(tracking, job, 1), false)
  assert.equal(acceptAnalysisJob(tracking, { ...job, jobId: "TEST-old" }, 2), false)
  const cancelling = beginAnalysisCancel(tracking)
  assert.equal(acceptAnalysisJob(cancelling, job, 2), false)
  assert.equal(acceptAnalysisJob(cancelling, job, 2, "cancel"), true)
  assert.equal(receiveAnalysisJob(tracking, job).requestPath, job.requestPath)
})

test("only analysis-running 409 supplies a followable conflict", () => {
  for (const reason of ["PROJECT_NOT_SCANNED", "INPUT_CHANGED", "MUTATION_RUNNING", undefined]) {
    const error = projectAnalysisError("start", new ApiError(409, "TEST", "CONFLICT", { reason, jobId: "TEST", path: "D:\\TEST" }))
    assert.equal(error.conflict, undefined)
  }
  const details = { reason: "ANALYSIS_RUNNING", jobId: "TEST", path: "D:\\TEST" }
  assert.deepEqual(projectAnalysisError("start", new ApiError(409, "TEST", "CONFLICT", details)).conflict, details)
  for (const malformed of [{ ...details, jobId: "" }, { ...details, path: 4 }, { ...details, path: "" }]) {
    assert.equal(projectAnalysisError("start", new ApiError(409, "TEST", "CONFLICT", malformed)).conflict, undefined)
  }
  assert.equal(projectAnalysisError("start", new ApiError(403, "TEST", "CONFLICT", details)).conflict, undefined)
})

test("start/cancel uncertainty stays explicit and poll errors require manual retry", () => {
  const unknown = failAnalysisRequest({ ...base, phase: "starting" }, "start", new ApiError(503, "TEST", "BACKEND_UNAVAILABLE"))
  assert.equal(unknown.phase, "idle")
  assert.equal(unknown.startUnknown, true)
  assert.equal(failAnalysisRequest({ ...base, phase: "starting" }, "start", new ApiError(409, "TEST", "CONFLICT")).startUnknown, false)
  const paused = failAnalysisRequest(beginAnalysisCancel(tracking), "cancel", new Error("TEST"))
  assert.equal(paused.phase, "tracking")
  assert.equal(paused.cancelUnknown, true)
  assert.equal(paused.cancelPending, false)
  assert.equal(canPollAnalysis(paused, true), false)
  assert.equal(canPollAnalysis(retryAnalysisPoll(paused), true), true)
  assert.equal(retryAnalysisPoll(paused).cancelUnknown, true)
  assert.equal(retryAnalysisPoll(beginAnalysisCancel(tracking)).cancelPending, true)
})

test("404 lost preserves rows and marks the snapshot unverified", () => {
  const snapshot = { ...job, outdated: { items: [{ name: "TEST" }] } }
  const lost = failAnalysisRequest({ ...tracking, job: snapshot }, "poll", new ApiError(404, "TEST", "HTTP_EXCEPTION"))
  assert.equal(lost.phase, "lost")
  assert.deepEqual(lost.job.outdated.items, snapshot.outdated.items)
  assert.equal(lost.job.stale, true)
  assert.equal(snapshot.stale, false)
  assert.equal(canPollAnalysis(retryAnalysisPoll(lost), true), false)
})
