import { ApiError } from "../api/response.ts"
import type { GlobalAction, GlobalExecuteRequest, GlobalManager, GlobalPreview } from "@/lib/global-packages/global-types"

export interface GlobalSelection { manager: GlobalManager; package: string; action: GlobalAction; targetVersion?: string }
export interface GlobalConsent { acknowledged: boolean; confirmText: string }
export interface GlobalPreviewForm extends GlobalConsent { selection: GlobalSelection; preview: GlobalPreview | null }
export type GlobalConsentError = "NO_PREVIEW" | "PREVIEW_EXPIRED" | "RISK_NOT_ACKNOWLEDGED" | "CONFIRM_TEXT_MISMATCH"

export function initialGlobalPreviewForm(selection: GlobalSelection = { manager: "npm", package: "", action: "remove" }): GlobalPreviewForm {
  return { selection: { ...selection }, preview: null, acknowledged: false, confirmText: "" }
}
export function changeGlobalSelection(form: GlobalPreviewForm, selection: GlobalSelection): GlobalPreviewForm {
  const previous = form.selection
  return previous.manager === selection.manager && previous.package === selection.package
    && previous.action === selection.action && previous.targetVersion === selection.targetVersion
    ? form : initialGlobalPreviewForm(selection)
}
export function displayGlobalPreview(form: GlobalPreviewForm, preview: GlobalPreview): GlobalPreviewForm {
  return { ...form, preview, acknowledged: false, confirmText: "" }
}
export function setGlobalConsent(form: GlobalPreviewForm, consent: Partial<GlobalConsent>): GlobalPreviewForm {
  return { ...form, acknowledged: consent.acknowledged ?? form.acknowledged, confirmText: consent.confirmText ?? form.confirmText }
}
export function clearGlobalPreview(form: GlobalPreviewForm): GlobalPreviewForm {
  return { ...form, preview: null, acknowledged: false, confirmText: "" }
}
export function globalConsentError(form: GlobalPreviewForm, now: number): GlobalConsentError | null {
  if (!form.preview) return "NO_PREVIEW"
  const expiresAt = Date.parse(form.preview.expiresAt)
  if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || now >= expiresAt) return "PREVIEW_EXPIRED"
  if (form.acknowledged !== true) return "RISK_NOT_ACKNOWLEDGED"
  if (form.confirmText !== form.preview.confirmText) return "CONFIRM_TEXT_MISMATCH"
  return null
}
export function buildGlobalExecuteInput(form: GlobalPreviewForm, requestId: string, now: number): GlobalExecuteRequest {
  const error = globalConsentError(form, now)
  if (error || !form.preview) throw new ApiError(400, "Global package consent is incomplete.", error ?? "NO_PREVIEW")
  return { previewId: form.preview.previewId, requestId, confirm: true,
    acknowledgedRisks: ["MACHINE_WIDE"], confirmText: form.confirmText }
}
