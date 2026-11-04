import { test } from "node:test"
import assert from "node:assert/strict"
import {
  initialGlobalPreviewForm, changeGlobalSelection, displayGlobalPreview,
  setGlobalConsent, globalConsentError, buildGlobalExecuteInput, clearGlobalPreview,
} from "./global-preview-form.ts"

// TEST data; not business requirements.
const now = Date.parse("2026-01-01T00:00:00Z")
const selection = { manager: "npm", package: "@test/tool", action: "change", targetVersion: "latest" }
const preview = {
  previewId: "TEST-preview", createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 300000).toISOString(),
  manager: "npm", managerVersion: "11.0.0", action: "change", package: "@test/tool", currentVersion: "1.0.0",
  requestedVersion: "latest", targetVersion: "2.0.0", globalRoot: "D:\\TEST\\node_modules", binDir: "D:\\TEST",
  bins: { before: [], after: [], added: [], removed: [], replaced: [] }, warningCodes: ["GLOBAL_CODE_EXECUTION"],
  risk: { level: "high", reasons: [{ code: "MACHINE_WIDE", level: "high", message: "TEST" }] },
  confirmText: "CHANGE GLOBAL npm @test/tool TO 2.0.0",
}
const ready = () => setGlobalConsent(displayGlobalPreview(initialGlobalPreviewForm(selection), preview), { acknowledged: true, confirmText: preview.confirmText })

test("consent is absent initially and requires checkbox plus exact displayed server text", () => {
  const empty = initialGlobalPreviewForm(selection)
  assert.equal(globalConsentError(empty, now), "NO_PREVIEW")
  const displayed = displayGlobalPreview(empty, preview)
  assert.equal(globalConsentError(displayed, now), "RISK_NOT_ACKNOWLEDGED")
  for (const text of ["", preview.confirmText.toLowerCase(), ` ${preview.confirmText}`, `${preview.confirmText} `, `${preview.confirmText}\n`]) {
    const form = setGlobalConsent(displayed, { acknowledged: true, confirmText: text })
    assert.equal(globalConsentError(form, now), "CONFIRM_TEXT_MISMATCH")
    assert.throws(() => buildGlobalExecuteInput(form, "TEST-request", now))
  }
  assert.equal(globalConsentError(ready(), now), null)
  assert.equal(displayed.acknowledged, false)
})

test("execute payload contains only consent and identifiers from the displayed preview", () => {
  const form = ready()
  assert.deepEqual(buildGlobalExecuteInput(form, "TEST-request", now), {
    previewId: preview.previewId, requestId: "TEST-request", confirm: true,
    acknowledgedRisks: ["MACHINE_WIDE"], confirmText: preview.confirmText,
  })
  assert.equal(form.selection.targetVersion, "latest")
  assert.equal(form.preview.targetVersion, "2.0.0")
})

test("manager/package/action/target edits and every new preview clear consent", () => {
  for (const patch of [{ manager: "pnpm" }, { package: "other" }, { action: "remove", targetVersion: undefined }, { targetVersion: "2.0.1" }]) {
    const previous = ready()
    const next = changeGlobalSelection(previous, { ...selection, ...patch })
    assert.equal(next.preview, null)
    assert.equal(next.acknowledged, false)
    assert.equal(next.confirmText, "")
    assert.equal(previous.acknowledged, true)
  }
  assert.deepEqual(changeGlobalSelection(ready(), { ...selection }), ready())
  for (const nextPreview of [preview, { ...preview, previewId: "TEST-new" }]) {
    const next = displayGlobalPreview(ready(), nextPreview)
    assert.equal(next.acknowledged, false)
    assert.equal(next.confirmText, "")
  }
  const cleared = clearGlobalPreview(ready())
  assert.equal(cleared.preview, null)
  assert.equal(cleared.acknowledged, false)
  assert.equal(cleared.confirmText, "")
})

test("expiry disables at the exact boundary; invalid dates fail closed and never create payload", () => {
  assert.equal(globalConsentError(ready(), now + 299999), null)
  for (const time of [now + 300000, now + 300001]) {
    assert.equal(globalConsentError(ready(), time), "PREVIEW_EXPIRED")
    assert.throws(() => buildGlobalExecuteInput(ready(), "TEST-request", time))
  }
  const invalid = setGlobalConsent(displayGlobalPreview(initialGlobalPreviewForm(selection), { ...preview, expiresAt: "TEST invalid" }), { acknowledged: true, confirmText: preview.confirmText })
  assert.equal(globalConsentError(invalid, now), "PREVIEW_EXPIRED")
})
