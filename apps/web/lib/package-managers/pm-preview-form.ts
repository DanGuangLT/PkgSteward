import { ApiError } from "../api/response.ts"
import type { PmExecuteRequest, PmPreview, PmWritableManager } from "@/lib/package-managers/pm-types"

export interface PmSelection { manager: PmWritableManager; targetVersion: string }
export interface PmPreviewForm { selection: PmSelection | null; preview: PmPreview | null; acknowledged: string[] }
export type PmConsentError = "NO_PREVIEW" | "PREVIEW_EXPIRED" | "RISK_NOT_ACKNOWLEDGED" | "UNSUPPORTED_CONFIRMATION"

export function initialPmPreviewForm(selection: PmSelection | null = null): PmPreviewForm {
  return { selection: selection ? { ...selection } : null, preview: null, acknowledged: [] }
}
export function changePmSelection(form: PmPreviewForm, selection: PmSelection): PmPreviewForm {
  const previous = form.selection
  return previous?.manager === selection.manager && previous.targetVersion === selection.targetVersion
    ? form : initialPmPreviewForm(selection)
}
export function displayPmPreview(form: PmPreviewForm, preview: PmPreview): PmPreviewForm {
  return { ...form, preview, acknowledged: [] }
}
export function setPmRiskAcknowledged(form: PmPreviewForm, code: string, checked: boolean): PmPreviewForm {
  if (!form.preview?.risk.reasons.some(reason => reason.code === code)) return form
  const others = form.acknowledged.filter(item => item !== code)
  return { ...form, acknowledged: checked ? [...others, code] : others }
}
export function clearPmPreview(form: PmPreviewForm): PmPreviewForm {
  return { ...form, preview: null, acknowledged: [] }
}
// A project pin is low or medium risk; anything needing typed text belongs to another flow and is refused here.
export function pmConsentError(form: PmPreviewForm, now: number): PmConsentError | null {
  const preview = form.preview
  if (!preview) return "NO_PREVIEW"
  const expiresAt = Date.parse(preview.expiresAt)
  if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || now >= expiresAt) return "PREVIEW_EXPIRED"
  if (preview.risk.level === "high" || preview.confirmText !== null) return "UNSUPPORTED_CONFIRMATION"
  if (preview.risk.reasons.some(reason => !form.acknowledged.includes(reason.code))) return "RISK_NOT_ACKNOWLEDGED"
  return null
}
export function buildPmExecuteInput(form: PmPreviewForm, requestId: string, now: number): PmExecuteRequest {
  const error = pmConsentError(form, now)
  if (error || !form.preview) throw new ApiError(400, "Package manager consent is incomplete.", error ?? "NO_PREVIEW")
  return { requestId, previewId: form.preview.previewId, confirm: true,
    acknowledgedRisks: form.preview.risk.reasons.map(reason => reason.code) }
}
