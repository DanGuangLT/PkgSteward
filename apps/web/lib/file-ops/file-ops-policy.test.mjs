import { test } from "node:test"
import assert from "node:assert/strict"
import { ApiError } from "../api/response.ts"
import {
  fileOpsAbandon, fileOpsAcceptOperation, fileOpsAcceptPreview, fileOpsBeginCancel, fileOpsBeginExecute, fileOpsBeginStart,
  fileOpsBeginSummary, fileOpsCanPoll, fileOpsCloseSummary, fileOpsError, fileOpsExecuteFailure, fileOpsFollowOperation,
  fileOpsInitialState, fileOpsOperationIsTerminal, fileOpsPollFailure, fileOpsReceiveOperation, fileOpsReceivePreview,
  fileOpsReceiveSummary, fileOpsReset, fileOpsResumePreview, fileOpsRetryPoll, fileOpsStartFailure, fileOpsStatusKey, fileOpsSummaryFailure,
  fileOpsTrackOperation, fileOpsTrackPreview,
} from "./file-ops-policy.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const preview = (status = "running") => ({ previewId: "TEST-preview", status, targets: [], operationId: null })
const operation = (status = "running") => ({ operationId: "TEST-operation", previewId: "TEST-preview", status, results: [] })
const summary = { paths: ["D:\\TEST"], risk: { level: "low", reasons: [] }, confirmText: null, totals: {} }
const input = { previewId: "TEST-preview", paths: ["D:\\TEST"], confirm: true }

const measuring = fileOpsTrackPreview(fileOpsBeginStart(fileOpsInitialState), "TEST-preview")
const reviewing = fileOpsReceivePreview(measuring, preview("completed"))
const confirming = fileOpsReceiveSummary(fileOpsBeginSummary(reviewing), summary)
const executing = fileOpsBeginExecute(confirming, input)
const operating = fileOpsTrackOperation(executing, "TEST-operation")

test("preview runs from start to review and keeps partial data while measuring", () => {
  assert.equal(measuring.phase, "measuring")
  const running = fileOpsReceivePreview(measuring, preview("running"))
  assert.equal(running.phase, "measuring")
  assert.equal(running.preview.status, "running")
  for (const status of ["completed", "cancelled", "failed"]) {
    const done = fileOpsReceivePreview(measuring, preview(status))
    assert.equal(done.phase, "reviewing")
    assert.equal(done.preview.status, status)
    assert.equal(done.summary, null)
  }
})

test("polling needs a running job, a visible tab and no paused error", () => {
  assert.equal(fileOpsCanPoll(measuring, true), true)
  assert.equal(fileOpsCanPoll(measuring, false), false)
  assert.equal(fileOpsCanPoll(operating, true), true)
  assert.equal(fileOpsCanPoll(operating, false), false)
  assert.equal(fileOpsCanPoll(fileOpsBeginCancel(measuring), true), false)
  assert.equal(fileOpsCanPoll(fileOpsPollFailure(measuring, "BACKEND_UNAVAILABLE"), true), false)
  for (const state of [fileOpsInitialState, reviewing, confirming, executing]) {
    assert.equal(fileOpsCanPoll(state, true), false)
  }
})

test("poll failure pauses until a manual retry and keeps partial data", () => {
  const running = fileOpsReceivePreview(measuring, preview("running"))
  const failed = fileOpsPollFailure(running, "BACKEND_UNAVAILABLE", 503)
  assert.equal(failed.errorCode, "BACKEND_UNAVAILABLE")
  assert.equal(failed.preview, running.preview)
  const retried = fileOpsRetryPoll(failed)
  assert.equal(retried.errorCode, undefined)
  assert.equal(fileOpsCanPoll(retried, true), true)
})

test("backend restart loses the preview and asks for a new one", () => {
  const lost = fileOpsPollFailure(fileOpsReceivePreview(measuring, preview()), "NOT_FOUND", 404)
  assert.equal(lost.phase, "idle")
  assert.equal(lost.preview, null)
})

test("backend restart during an operation keeps the last results and stops tracking", () => {
  const seen = fileOpsReceiveOperation(operating, operation("running"))
  const lost = fileOpsPollFailure(seen, "NOT_FOUND", 404)
  assert.equal(lost.phase, "lost")
  assert.equal(lost.operation, seen.operation)
  assert.equal(fileOpsStatusKey(lost), "status.untracked")
})

test("an operation lost before its first poll is still lost, not a lost preview", () => {
  const lost = fileOpsPollFailure(operating, "NOT_FOUND", 404)
  assert.equal(lost.phase, "lost")
  assert.equal(lost.operation, null)
  assert.equal(fileOpsStatusKey(lost), "status.untracked")
  assert.equal(fileOpsPollFailure(fileOpsBeginCancel(operating), "NOT_FOUND", 404).phase, "lost")
})

test("a resend answered 404 cannot prove the first send never ran", () => {
  const again = fileOpsBeginExecute(fileOpsExecuteFailure(executing, "BACKEND_UNAVAILABLE"))
  assert.equal(fileOpsExecuteFailure(again, "NOT_FOUND").phase, "lost")
  assert.equal(fileOpsExecuteFailure(executing, "NOT_FOUND").phase, "idle")
})

test("a lost outcome can only be left by starting over", () => {
  const lost = fileOpsPollFailure(operating, "NOT_FOUND", 404)
  assert.equal(fileOpsBeginStart(lost), lost)
  assert.equal(fileOpsCanPoll(lost, true), false)
  assert.equal(fileOpsFollowOperation(lost, operation("running")), lost)
  assert.deepEqual(fileOpsReset(lost), fileOpsInitialState)
})

test("cancel blocks stale polls; only the cancel response is accepted", () => {
  const cancelling = fileOpsBeginCancel(measuring)
  assert.equal(cancelling.cancelPending, true)
  assert.equal(fileOpsAcceptPreview(cancelling, preview(), 2, 2, "poll"), false)
  assert.equal(fileOpsAcceptPreview(cancelling, preview("cancelled"), 2, 2, "cancel"), true)
  assert.equal(fileOpsAcceptPreview(measuring, preview(), 2, 2, "poll"), true)
  assert.equal(fileOpsAcceptPreview(measuring, preview(), 3, 2, "poll"), false)
  assert.equal(fileOpsAcceptPreview(measuring, { ...preview(), previewId: "TEST-other" }, 2, 2, "poll"), false)
  assert.equal(fileOpsAcceptPreview(reviewing, preview(), 2, 2, "poll"), false)
})

test("stale operation responses are ignored", () => {
  assert.equal(fileOpsAcceptOperation(operating, operation(), 2, 2, "poll"), true)
  assert.equal(fileOpsAcceptOperation(operating, operation(), 3, 2, "poll"), false)
  assert.equal(fileOpsAcceptOperation(operating, { ...operation(), operationId: "TEST-other" }, 2, 2, "poll"), false)
  assert.equal(fileOpsAcceptOperation(fileOpsBeginCancel(operating), operation(), 2, 2, "poll"), false)
  assert.equal(fileOpsAcceptOperation(fileOpsBeginCancel(operating), operation("stopping"), 2, 2, "cancel"), true)
  assert.equal(fileOpsAcceptOperation(reviewing, operation(), 2, 2, "poll"), false)
})

test("stopping keeps polling, then any terminal status finishes", () => {
  const stopping = fileOpsReceiveOperation(fileOpsBeginCancel(operating), operation("stopping"))
  assert.equal(stopping.phase, "operating")
  assert.equal(stopping.cancelPending, false)
  assert.equal(fileOpsCanPoll(stopping, true), true)
  assert.equal(fileOpsStatusKey(stopping), "status.stopping")
  for (const status of ["completed", "cancelled", "failed"]) {
    const done = fileOpsReceiveOperation(stopping, operation(status))
    assert.equal(done.phase, "finished")
    assert.equal(done.operation.status, status)
    assert.equal(fileOpsStatusKey(done), `status.${status}`)
    assert.equal(fileOpsCanPoll(done, true), false)
  }
})

test("a cancel failure leaves stopping available and polling paused", () => {
  const failed = fileOpsPollFailure(fileOpsBeginCancel(operating), "BACKEND_UNAVAILABLE", 503)
  assert.equal(failed.cancelPending, false)
  assert.equal(failed.errorCode, "BACKEND_UNAVAILABLE")
})

test("summary opens from review and closes without leaving it", () => {
  assert.equal(fileOpsBeginSummary(reviewing).summarizing, true)
  assert.equal(confirming.summary, summary)
  assert.equal(confirming.summarizing, false)
  assert.equal(fileOpsCloseSummary(confirming).summary, null)
  assert.equal(fileOpsCloseSummary(confirming).phase, "reviewing")
})

test("summary failure stays reviewing, a lost preview asks for a new one", () => {
  const busy = fileOpsSummaryFailure(fileOpsBeginSummary(reviewing), "RATE_LIMITED")
  assert.equal(busy.phase, "reviewing")
  assert.equal(busy.summarizing, false)
  assert.equal(busy.preview, reviewing.preview)
  for (const code of ["NOT_FOUND", "CONFLICT"]) {
    assert.equal(fileOpsSummaryFailure(fileOpsBeginSummary(reviewing), code).phase, code === "NOT_FOUND" ? "idle" : "reviewing")
  }
})

test("execute only starts from a confirmed review", () => {
  assert.equal(executing.phase, "executing")
  assert.equal(executing.input, input)
  for (const state of [fileOpsInitialState, measuring, reviewing, operating]) {
    assert.equal(fileOpsBeginExecute(state, input), state)
  }
})

test("retry states never turn into an execute by themselves", () => {
  const unconfirmed = fileOpsExecuteFailure(executing, "BACKEND_UNAVAILABLE")
  assert.equal(unconfirmed.phase, "unconfirmed")
  assert.equal(fileOpsCanPoll(unconfirmed, true), false)
  assert.equal(fileOpsRetryPoll(unconfirmed), unconfirmed)
  for (const state of [fileOpsPollFailure(measuring, "BACKEND_UNAVAILABLE"), fileOpsPollFailure(operating, "BACKEND_UNAVAILABLE")]) {
    assert.notEqual(fileOpsRetryPoll(state).phase, "executing")
  }
})

test("an unknown execute outcome keeps the same input for a manual resend", () => {
  for (const code of ["BACKEND_UNAVAILABLE", "INVALID_RESPONSE", "UNKNOWN"]) {
    const unconfirmed = fileOpsExecuteFailure(executing, code)
    assert.equal(unconfirmed.phase, "unconfirmed")
    assert.equal(unconfirmed.input, input)
    const again = fileOpsBeginExecute(unconfirmed, { ...input, paths: ["D:\\TEST\\other"] })
    assert.equal(again.phase, "executing")
    assert.equal(again.input, input)
    assert.equal(again.resend, true)
  }
})

test("a resend blocked by a running preflight stays unconfirmed", () => {
  const again = fileOpsBeginExecute(fileOpsExecuteFailure(executing, "BACKEND_UNAVAILABLE"))
  assert.equal(fileOpsExecuteFailure(again, "CONFLICT").phase, "unconfirmed")
})

test("a resend refused for another reason says nothing about the first send", () => {
  const again = () => fileOpsBeginExecute(fileOpsExecuteFailure(executing, "BACKEND_UNAVAILABLE"))
  for (const code of ["RATE_LIMITED", "FORBIDDEN", "INTERNAL_SERVER_ERROR", "HTTP_EXCEPTION"]) {
    assert.equal(fileOpsExecuteFailure(again(), code).phase, "unconfirmed")
  }
  assert.equal(fileOpsExecuteFailure(again(), "VALIDATION_ERROR").phase, "reviewing")
  assert.equal(fileOpsExecuteFailure(again(), "RISK_CHANGED").phase, "idle")
})

test("an unknown outcome follows only the operation of its own preview", () => {
  const unconfirmed = fileOpsExecuteFailure(executing, "BACKEND_UNAVAILABLE")
  assert.equal(fileOpsFollowOperation(unconfirmed, { ...operation("running"), previewId: "TEST-other" }), unconfirmed)
  const followed = fileOpsFollowOperation(unconfirmed, operation("running"))
  assert.equal(followed.phase, "operating")
  assert.equal(followed.operation.status, "running")
})

test("a running preview resumes only from idle", () => {
  const resumed = fileOpsResumePreview(fileOpsInitialState, preview("running"))
  assert.equal(resumed.phase, "measuring")
  assert.equal(resumed.previewId, "TEST-preview")
  assert.equal(resumed.preview.status, "running")
  assert.equal(fileOpsResumePreview(reviewing, preview("running")), reviewing)
})

test("a finished unused preview resumes for review, nothing else does", () => {
  for (const status of ["completed", "cancelled"]) {
    const resumed = fileOpsResumePreview(fileOpsInitialState, preview(status))
    assert.equal(resumed.phase, "reviewing")
    assert.equal(resumed.preview.status, status)
    assert.equal(resumed.summary, null)
  }
  assert.equal(fileOpsResumePreview(fileOpsInitialState, preview("failed")), fileOpsInitialState)
  assert.equal(
    fileOpsResumePreview(fileOpsInitialState, { ...preview("completed"), operationId: "TEST-operation" }),
    fileOpsInitialState
  )
  assert.equal(fileOpsResumePreview(reviewing, preview("completed")), reviewing)
})

test("completed with failed items has its own status", () => {
  const failed = { ...operation("completed"), results: [{ status: "success" }, { status: "failed" }] }
  assert.equal(fileOpsStatusKey(fileOpsReceiveOperation(operating, failed)), "status.completedWithFailures")
  const clean = { ...operation("completed"), results: [{ status: "success" }] }
  assert.equal(fileOpsStatusKey(fileOpsReceiveOperation(operating, clean)), "status.completed")
})

test("a replayed operation is tracked like a new one", () => {
  const again = fileOpsBeginExecute(fileOpsExecuteFailure(executing, "BACKEND_UNAVAILABLE"))
  const tracked = fileOpsTrackOperation(again, "TEST-operation")
  assert.equal(tracked.phase, "operating")
  assert.equal(fileOpsReceiveOperation(tracked, operation("completed")).phase, "finished")
})

test("stale execute errors require a new preview", () => {
  for (const code of ["NOT_FOUND", "SCAN_CHANGED", "RISK_CHANGED", "TARGET_CHANGED"]) {
    const stale = fileOpsExecuteFailure(executing, code)
    assert.equal(stale.phase, "idle")
    assert.equal(stale.preview, null)
  }
})

test("refused execute returns to the dialog with the summary", () => {
  for (const code of ["VALIDATION_ERROR", "CONFLICT", "RATE_LIMITED", "INTERNAL_SERVER_ERROR", "PAYLOAD_TOO_LARGE"]) {
    const refused = fileOpsExecuteFailure(executing, code)
    assert.equal(refused.phase, "reviewing")
    assert.equal(refused.preview, reviewing.preview)
    assert.equal(refused.summary, summary)
  }
})

test("following restores only from idle, never over other work", () => {
  const followed = fileOpsFollowOperation(fileOpsInitialState, operation("running"))
  assert.equal(followed.phase, "operating")
  assert.equal(followed.operationId, "TEST-operation")
  assert.equal(followed.operation.status, "running")
  for (const state of [measuring, reviewing, executing, operating]) {
    assert.equal(fileOpsFollowOperation(state, operation()), state)
  }
})

test("start failure returns to idle with no leftovers", () => {
  const failed = fileOpsStartFailure(fileOpsBeginStart(reviewing))
  assert.equal(failed.phase, "idle")
  assert.equal(failed.preview, null)
})

test("reset clears finished work but cannot interrupt a running job", () => {
  const finished = fileOpsReceiveOperation(operating, operation("completed"))
  assert.deepEqual(fileOpsReset(finished), fileOpsInitialState)
  assert.deepEqual(fileOpsReset(reviewing), fileOpsInitialState)
  for (const state of [measuring, executing, operating, fileOpsExecuteFailure(executing, "BACKEND_UNAVAILABLE")]) {
    assert.equal(fileOpsReset(state), state)
  }
})

test("only an unknown execute outcome can be abandoned", () => {
  const unconfirmed = fileOpsExecuteFailure(executing, "BACKEND_UNAVAILABLE")
  assert.deepEqual(fileOpsAbandon(unconfirmed), fileOpsInitialState)
  for (const state of [measuring, reviewing, executing, operating]) assert.equal(fileOpsAbandon(state), state)
})

test("status keys follow the phase", () => {
  assert.equal(fileOpsStatusKey(fileOpsInitialState), "status.idle")
  assert.equal(fileOpsStatusKey(fileOpsBeginStart(fileOpsInitialState)), "status.starting")
  assert.equal(fileOpsStatusKey(measuring), "status.measuring")
  assert.equal(fileOpsStatusKey(fileOpsBeginCancel(measuring)), "status.cancellingPreview")
  assert.equal(fileOpsStatusKey(reviewing), "status.previewCompleted")
  assert.equal(fileOpsStatusKey(fileOpsReceivePreview(measuring, preview("cancelled"))), "status.previewCancelled")
  assert.equal(fileOpsStatusKey(fileOpsReceivePreview(measuring, preview("failed"))), "status.previewFailed")
  assert.equal(fileOpsStatusKey(executing), "status.executing")
  assert.equal(fileOpsStatusKey(fileOpsExecuteFailure(executing, "UNKNOWN")), "status.unconfirmed")
  assert.equal(fileOpsStatusKey(operating), "status.deleting")
  assert.equal(fileOpsStatusKey(fileOpsBeginCancel(operating)), "status.stopping")
})

test("terminal operation statuses", () => {
  assert.equal(fileOpsOperationIsTerminal("running"), false)
  assert.equal(fileOpsOperationIsTerminal("stopping"), false)
  for (const status of ["completed", "cancelled", "failed"]) assert.equal(fileOpsOperationIsTerminal(status), true)
})

test("errors keep the code and the affected paths from details", () => {
  const changed = new ApiError(409, "TEST", "TARGET_CHANGED", { paths: ["D:\\TEST", 1] })
  assert.deepEqual(fileOpsError(changed), { code: "TARGET_CHANGED", paths: ["D:\\TEST"] })
  assert.deepEqual(fileOpsError(new ApiError(404, "TEST")), { code: "NOT_FOUND", paths: [] })
  assert.deepEqual(fileOpsError(new ApiError(500, "TEST")), { code: "UNKNOWN", paths: [] })
  assert.deepEqual(fileOpsError(new Error("TEST-private")), { code: "UNKNOWN", paths: [] })
  assert.deepEqual(fileOpsError(new ApiError(404, "TEST", "NOT_FOUND"), "start"), { code: "NOT_FOUND", paths: [], source: "start" })
})
