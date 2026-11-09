import { test } from "node:test"
import assert from "node:assert/strict"
import {
  initialPmPreviewForm, changePmSelection, displayPmPreview, setPmRiskAcknowledged,
  clearPmPreview, pmConsentError, buildPmExecuteInput,
} from "./pm-preview-form.ts"

// TEST data; not business requirements.
const now = Date.parse("2026-11-09T10:00:00.000Z")
const id = "00000000-0000-4000-8000-000000000001"
const preview = (level = "low", codes = [], expiresAt = "2026-11-09T10:05:00.000Z") => ({
  previewId: id, createdAt: "2026-11-09T10:00:00.000Z", expiresAt, confirmText: null,
  risk: { level, reasons: codes.map(code => ({ code, level, message: "TEST" })) },
})
const selection = { manager: "pnpm", targetVersion: "11.22.0" }

test("selection change resets preview and consent; identical selection keeps the form", () => {
  const form = displayPmPreview(changePmSelection(initialPmPreviewForm(), selection), preview("medium", ["RECENTLY_ACTIVE"]))
  const ticked = setPmRiskAcknowledged(form, "RECENTLY_ACTIVE", true)
  assert.equal(changePmSelection(ticked, { ...selection }), ticked)
  for (const next of [{ ...selection, targetVersion: "11.21.0" }, { ...selection, manager: "npm" }]) {
    const changed = changePmSelection(ticked, next)
    assert.deepEqual(changed, { selection: next, preview: null, acknowledged: [] })
  }
})

test("low risk needs only a live preview; medium needs every reason ticked; expiry blocks", () => {
  assert.equal(pmConsentError(initialPmPreviewForm(selection), now), "NO_PREVIEW")
  const low = displayPmPreview(initialPmPreviewForm(selection), preview())
  assert.equal(pmConsentError(low, now), null)
  assert.deepEqual(buildPmExecuteInput(low, "TEST-request", now),
    { requestId: "TEST-request", previewId: id, confirm: true, acknowledgedRisks: [] })
  assert.equal(pmConsentError(low, Date.parse("2026-11-09T10:05:00.000Z")), "PREVIEW_EXPIRED")
  assert.equal(pmConsentError(displayPmPreview(low, preview("low", [], "TEST-bad-date")), now), "PREVIEW_EXPIRED")
  assert.equal(pmConsentError(low, NaN), "PREVIEW_EXPIRED")
  const medium = displayPmPreview(low, preview("medium", ["RECENTLY_ACTIVE"]))
  assert.equal(pmConsentError(medium, now), "RISK_NOT_ACKNOWLEDGED")
  assert.throws(() => buildPmExecuteInput(medium, "TEST-request", now), { code: "RISK_NOT_ACKNOWLEDGED" })
  const ticked = setPmRiskAcknowledged(medium, "RECENTLY_ACTIVE", true)
  assert.equal(pmConsentError(ticked, now), null)
  assert.deepEqual(buildPmExecuteInput(ticked, "TEST-request", now).acknowledgedRisks, ["RECENTLY_ACTIVE"])
  assert.equal(pmConsentError(setPmRiskAcknowledged(ticked, "RECENTLY_ACTIVE", false), now), "RISK_NOT_ACKNOWLEDGED")
})

test("only codes shown in the preview can be ticked; a new preview clears consent", () => {
  const medium = displayPmPreview(initialPmPreviewForm(selection), preview("medium", ["RECENTLY_ACTIVE"]))
  assert.deepEqual(setPmRiskAcknowledged(medium, "MACHINE_WIDE", true).acknowledged, [])
  assert.deepEqual(setPmRiskAcknowledged(clearPmPreview(medium), "RECENTLY_ACTIVE", true).acknowledged, [])
  const ticked = setPmRiskAcknowledged(medium, "RECENTLY_ACTIVE", true)
  assert.deepEqual(setPmRiskAcknowledged(ticked, "RECENTLY_ACTIVE", true).acknowledged, ["RECENTLY_ACTIVE"])
  assert.deepEqual(displayPmPreview(ticked, preview("medium", ["RECENTLY_ACTIVE"])).acknowledged, [])
  assert.deepEqual(clearPmPreview(ticked), { selection, preview: null, acknowledged: [] })
})

test("high risk or a typed confirmation is unsupported in this panel and never builds input", () => {
  for (const risky of [preview("high", ["MACHINE_WIDE"]), { ...preview(), confirmText: "TEST exact" }]) {
    let form = displayPmPreview(initialPmPreviewForm(selection), risky)
    form = setPmRiskAcknowledged(form, "MACHINE_WIDE", true)
    assert.equal(pmConsentError(form, now), "UNSUPPORTED_CONFIRMATION")
    assert.throws(() => buildPmExecuteInput(form, "TEST-request", now), { code: "UNSUPPORTED_CONFIRMATION" })
  }
})
