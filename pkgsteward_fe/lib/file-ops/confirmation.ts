import type { FileOpsExecuteInput, FileOpsSummary, RiskCode } from "@/lib/api/types"

export interface ConfirmationInput {
  acknowledged: ReadonlySet<RiskCode>
  typedText: string
}

export function requiredAcknowledgements(summary: FileOpsSummary): RiskCode[] {
  return summary.risk.level === "low" ? [] : summary.risk.reasons.map(({ code }) => code)
}

export function requiresTypedText(summary: FileOpsSummary): boolean {
  return summary.risk.level === "high"
}

export function canConfirm(summary: FileOpsSummary, input: ConfirmationInput): boolean {
  if (!requiredAcknowledgements(summary).every((code) => input.acknowledged.has(code))) return false
  if (!requiresTypedText(summary)) return true
  // So khớp tuyệt đối như backend: không trim, không bỏ hoa thường.
  return summary.confirmText !== null && input.typedText === summary.confirmText
}

export function buildExecuteInput(
  previewId: string,
  summary: FileOpsSummary,
  input: ConfirmationInput
): FileOpsExecuteInput | null {
  if (!canConfirm(summary, input)) return null
  const acknowledgedRisks = requiredAcknowledgements(summary)
  return {
    previewId,
    paths: summary.paths,
    confirm: true,
    ...(acknowledgedRisks.length > 0 ? { acknowledgedRisks } : {}),
    ...(requiresTypedText(summary) ? { confirmText: input.typedText } : {}),
  }
}

// Đổi khoá khi summary đổi: dialog remount nên mọi tick và chữ đã gõ về rỗng.
export function confirmationKey(previewId: string, summary: FileOpsSummary): string {
  return JSON.stringify([previewId, summary.paths, summary.risk.reasons.map(({ code }) => code), summary.confirmText])
}
