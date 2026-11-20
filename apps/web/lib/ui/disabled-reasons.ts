export type DisabledReasonKey =
  | "scanStarting"
  | "scanRunning"
  | "scanCancelling"
  | "scanRefreshing"
  | "noNodeModulesProjects"
  | "noAttentionProjects"
  | "diskRunning"
  | "diskCancelling"
  | "diskMissingPath"
  | "fileOpsBusy"
  | "cleanupNeedsScan"
  | "cleanupInvalidCriteria"
  | "noMatchingProjects"
  | "noAttentionItems"
  | "noEligibleItems"
  | "selectionEmpty"
  | "selectionTooMany"
  | "stopping"
  | "submitting"
  | "acknowledgeRisks"
  | "confirmTextMismatch"
  | "previewExpired"
  | "consentIncomplete"
  | "taskRunning"
  | "analysisRunning"
  | "refreshing"
  | "registryUnsupported"
  | "runnerBusy"
  | "cancelUnknown"
  | "runnerStarting"
  | "clearingRecovery"
  | "pmBusy"
  | "pmOtherRunning"
  | "loadingContext"
  | "pmBlocked"
  | "chooseVersionFirst"
  | "globalBusy"
  | "globalStarting"
  | "alreadyCancelled"
  | "autoPolling"
  | "noMatchingVersions"
  | "shellLockedWhileRunning"

export function scanStartDisabledReason(
  phase: "idle" | "starting" | "tracking" | "refreshing",
  cancelPending: boolean,
): DisabledReasonKey | null {
  if (phase === "idle") return null
  if (phase === "starting") return "scanStarting"
  if (phase === "refreshing") return "scanRefreshing"
  if (cancelPending) return "scanCancelling"
  return "scanRunning"
}

export function diskMeasureDisabledReason({
  busy,
  hasPath,
  cancelPending,
}: {
  busy: boolean
  hasPath: boolean
  cancelPending: boolean
}): DisabledReasonKey | null {
  if (cancelPending) return "diskCancelling"
  if (busy) return "diskRunning"
  if (!hasPath) return "diskMissingPath"
  return null
}

export function cleanupRunDisabledReason({
  busy,
  hasScan,
}: {
  busy: boolean
  hasScan: boolean
}): DisabledReasonKey | null {
  if (busy) return "fileOpsBusy"
  if (!hasScan) return "cleanupNeedsScan"
  return null
}

export function fileSelectionActionDisabledReason({
  busy,
  selectedCount,
  tooMany,
}: {
  busy: boolean
  selectedCount: number
  tooMany: boolean
}): DisabledReasonKey | null {
  if (busy) return "fileOpsBusy"
  if (tooMany) return "selectionTooMany"
  if (selectedCount === 0) return "selectionEmpty"
  return null
}

export function deleteConfirmDisabledReason({
  pending,
  missingAcknowledgements,
  confirmTextMismatch,
}: {
  pending: boolean
  missingAcknowledgements: boolean
  confirmTextMismatch: boolean
}): DisabledReasonKey | null {
  if (pending) return "submitting"
  if (missingAcknowledgements) return "acknowledgeRisks"
  if (confirmTextMismatch) return "confirmTextMismatch"
  return null
}

export function projectAnalysisDisabledReason({
  busy,
  refreshing,
  registryBlocked,
  runnerBusy,
}: {
  busy: boolean
  refreshing: boolean
  registryBlocked: boolean
  runnerBusy: boolean
}): DisabledReasonKey | null {
  if (busy) return "analysisRunning"
  if (refreshing) return "refreshing"
  if (registryBlocked) return "registryUnsupported"
  if (runnerBusy) return "runnerBusy"
  return null
}

export function pmActionDisabledReason({
  busy,
  otherRunning,
  loadingContext,
  hasBlocker,
  needsVersion,
  hasTarget,
}: {
  busy: boolean
  otherRunning: boolean
  loadingContext: boolean
  hasBlocker: boolean
  needsVersion: boolean
  hasTarget: boolean
}): DisabledReasonKey | null {
  if (busy) return "pmBusy"
  if (otherRunning) return "pmOtherRunning"
  if (loadingContext) return "loadingContext"
  if (hasBlocker) return "pmBlocked"
  if (needsVersion && !hasTarget) return "chooseVersionFirst"
  return null
}

export function consentConfirmDisabledReason({
  pending,
  blocked,
  consentError,
}: {
  pending: boolean
  blocked: boolean
  consentError: string | null
}): DisabledReasonKey | null {
  if (pending) return "submitting"
  if (blocked) return "taskRunning"
  if (consentError === "PREVIEW_EXPIRED") return "previewExpired"
  if (consentError === "RISK_NOT_ACKNOWLEDGED") return "acknowledgeRisks"
  if (consentError === "CONFIRM_TEXT_MISMATCH") return "confirmTextMismatch"
  if (consentError !== null) return "consentIncomplete"
  return null
}

export function globalActionDisabledReason({
  blocked,
  needsVersion,
  hasVersion,
}: {
  blocked: boolean
  needsVersion: boolean
  hasVersion: boolean
}): DisabledReasonKey | null {
  if (blocked) return "globalBusy"
  if (needsVersion && !hasVersion) return "chooseVersionFirst"
  return null
}
