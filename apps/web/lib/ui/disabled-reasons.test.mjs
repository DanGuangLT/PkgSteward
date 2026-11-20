// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
import assert from "node:assert/strict"
import test from "node:test"

import {
  cleanupRunDisabledReason,
  consentConfirmDisabledReason,
  deleteConfirmDisabledReason,
  diskMeasureDisabledReason,
  fileSelectionActionDisabledReason,
  globalActionDisabledReason,
  pmActionDisabledReason,
  projectAnalysisDisabledReason,
  scanStartDisabledReason,
} from "./disabled-reasons.ts"

test("TEST scanStartDisabledReason prioritizes starting, refreshing, cancelling, running", () => {
  assert.equal(scanStartDisabledReason("idle", false), null)
  assert.equal(scanStartDisabledReason("starting", false), "scanStarting")
  assert.equal(scanStartDisabledReason("refreshing", false), "scanRefreshing")
  assert.equal(scanStartDisabledReason("tracking", true), "scanCancelling")
  assert.equal(scanStartDisabledReason("tracking", false), "scanRunning")
})

test("TEST diskMeasureDisabledReason prioritizes cancelling, running, then missing path", () => {
  assert.equal(diskMeasureDisabledReason({ busy: false, hasPath: true, cancelPending: false }), null)
  assert.equal(diskMeasureDisabledReason({ busy: true, hasPath: false, cancelPending: true }), "diskCancelling")
  assert.equal(diskMeasureDisabledReason({ busy: true, hasPath: false, cancelPending: false }), "diskRunning")
  assert.equal(diskMeasureDisabledReason({ busy: false, hasPath: false, cancelPending: false }), "diskMissingPath")
})

test("TEST cleanupRunDisabledReason prioritizes busy over missing scan", () => {
  assert.equal(cleanupRunDisabledReason({ busy: false, hasScan: true }), null)
  assert.equal(cleanupRunDisabledReason({ busy: true, hasScan: false }), "fileOpsBusy")
  assert.equal(cleanupRunDisabledReason({ busy: false, hasScan: false }), "cleanupNeedsScan")
})

test("TEST fileSelectionActionDisabledReason prioritizes busy, tooMany, then empty", () => {
  assert.equal(fileSelectionActionDisabledReason({ busy: false, selectedCount: 2, tooMany: false }), null)
  assert.equal(fileSelectionActionDisabledReason({ busy: true, selectedCount: 0, tooMany: true }), "fileOpsBusy")
  assert.equal(fileSelectionActionDisabledReason({ busy: false, selectedCount: 999, tooMany: true }), "selectionTooMany")
  assert.equal(fileSelectionActionDisabledReason({ busy: false, selectedCount: 0, tooMany: false }), "selectionEmpty")
})

test("TEST deleteConfirmDisabledReason prioritizes pending, risk acknowledgements, then confirm text", () => {
  assert.equal(deleteConfirmDisabledReason({ pending: false, missingAcknowledgements: false, confirmTextMismatch: false }), null)
  assert.equal(deleteConfirmDisabledReason({ pending: true, missingAcknowledgements: true, confirmTextMismatch: true }), "submitting")
  assert.equal(deleteConfirmDisabledReason({ pending: false, missingAcknowledgements: true, confirmTextMismatch: true }), "acknowledgeRisks")
  assert.equal(deleteConfirmDisabledReason({ pending: false, missingAcknowledgements: false, confirmTextMismatch: true }), "confirmTextMismatch")
})

test("TEST projectAnalysisDisabledReason prioritizes busy, refreshing, registry block, then runnerBusy", () => {
  assert.equal(projectAnalysisDisabledReason({ busy: false, refreshing: false, registryBlocked: false, runnerBusy: false }), null)
  assert.equal(projectAnalysisDisabledReason({ busy: true, refreshing: true, registryBlocked: true, runnerBusy: true }), "analysisRunning")
  assert.equal(projectAnalysisDisabledReason({ busy: false, refreshing: true, registryBlocked: true, runnerBusy: true }), "refreshing")
  assert.equal(projectAnalysisDisabledReason({ busy: false, refreshing: false, registryBlocked: true, runnerBusy: true }), "registryUnsupported")
  assert.equal(projectAnalysisDisabledReason({ busy: false, refreshing: false, registryBlocked: false, runnerBusy: true }), "runnerBusy")
})

test("TEST pmActionDisabledReason prioritizes busy, otherRunning, context, blocker, then version", () => {
  assert.equal(pmActionDisabledReason({ busy: false, otherRunning: false, loadingContext: false, hasBlocker: false, needsVersion: true, hasTarget: true }), null)
  assert.equal(pmActionDisabledReason({ busy: true, otherRunning: true, loadingContext: true, hasBlocker: true, needsVersion: true, hasTarget: false }), "pmBusy")
  assert.equal(pmActionDisabledReason({ busy: false, otherRunning: true, loadingContext: true, hasBlocker: true, needsVersion: true, hasTarget: false }), "pmOtherRunning")
  assert.equal(pmActionDisabledReason({ busy: false, otherRunning: false, loadingContext: true, hasBlocker: true, needsVersion: true, hasTarget: false }), "loadingContext")
  assert.equal(pmActionDisabledReason({ busy: false, otherRunning: false, loadingContext: false, hasBlocker: true, needsVersion: true, hasTarget: false }), "pmBlocked")
  assert.equal(pmActionDisabledReason({ busy: false, otherRunning: false, loadingContext: false, hasBlocker: false, needsVersion: true, hasTarget: false }), "chooseVersionFirst")
  assert.equal(pmActionDisabledReason({ busy: false, otherRunning: false, loadingContext: false, hasBlocker: false, needsVersion: false, hasTarget: false }), null)
})

test("TEST consentConfirmDisabledReason maps pending, blocked, and consent errors", () => {
  assert.equal(consentConfirmDisabledReason({ pending: false, blocked: false, consentError: null }), null)
  assert.equal(consentConfirmDisabledReason({ pending: true, blocked: true, consentError: "PREVIEW_EXPIRED" }), "submitting")
  assert.equal(consentConfirmDisabledReason({ pending: false, blocked: true, consentError: "PREVIEW_EXPIRED" }), "taskRunning")
  assert.equal(consentConfirmDisabledReason({ pending: false, blocked: false, consentError: "PREVIEW_EXPIRED" }), "previewExpired")
  assert.equal(consentConfirmDisabledReason({ pending: false, blocked: false, consentError: "RISK_NOT_ACKNOWLEDGED" }), "acknowledgeRisks")
  assert.equal(consentConfirmDisabledReason({ pending: false, blocked: false, consentError: "CONFIRM_TEXT_MISMATCH" }), "confirmTextMismatch")
  assert.equal(consentConfirmDisabledReason({ pending: false, blocked: false, consentError: "UNSUPPORTED_CONFIRMATION" }), "consentIncomplete")
})

test("TEST globalActionDisabledReason prioritizes blocked over missing version", () => {
  assert.equal(globalActionDisabledReason({ blocked: false, needsVersion: true, hasVersion: true }), null)
  assert.equal(globalActionDisabledReason({ blocked: true, needsVersion: true, hasVersion: false }), "globalBusy")
  assert.equal(globalActionDisabledReason({ blocked: false, needsVersion: true, hasVersion: false }), "chooseVersionFirst")
  assert.equal(globalActionDisabledReason({ blocked: false, needsVersion: false, hasVersion: false }), null)
})
