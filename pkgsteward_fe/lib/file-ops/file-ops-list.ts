import type {
  CleanupKind, CleanupPreviewInput, FileOpsOperation, FileOpsPreview, FileOpsTarget, FileOpsTargetResult,
} from "../api/types.ts"
import { fileOpsOperationIsTerminal, type FileOpsError, type FileOpsUiState } from "./file-ops-policy.ts"

export type CleanupSort = "size" | "age"

export interface CleanupFilterForm {
  kinds: CleanupKind[]
  olderThanDays: string
  minSizeMib: string
}

const MEBIBYTE = 1024 * 1024

const TARGET_FAILURES = [
  "INVALID_PATH", "NOT_FOUND", "DENYLISTED", "OUTSIDE_ALLOWLIST", "IS_LINK", "OUTSIDE_SCANNED_PROJECT",
  "PROJECT_CHANGED", "NOT_ORPHAN", "UNSUPPORTED_TYPE", "STAT_FAILED",
] as const

const RESULT_ERRORS = [
  "FILE_IN_USE", "ACCESS_DENIED", "TARGET_GONE", "TARGET_CHANGED", "PATH_TOO_LONG", "DELETE_FAILED",
  "RECYCLE_BIN_DISABLED", "RECYCLE_BIN_TOO_SMALL", "RECYCLE_FAILED", "RECYCLE_UNAVAILABLE", "AUDIT_WRITE_FAILED",
] as const

const ERROR_KEYS = {
  CONFLICT: "errors.conflict",
  SCAN_CHANGED: "errors.scanChanged",
  RISK_CHANGED: "errors.riskChanged",
  TARGET_CHANGED: "errors.targetChanged",
  VALIDATION_ERROR: "errors.validation",
  PAYLOAD_TOO_LARGE: "errors.tooLarge",
  RATE_LIMITED: "errors.rateLimited",
  FORBIDDEN: "errors.forbidden",
  BACKEND_UNAVAILABLE: "errors.backendUnavailable",
  INVALID_RESPONSE: "errors.invalidResponse",
  INTERNAL_SERVER_ERROR: "errors.internal",
} as const

type ErrorKey = (typeof ERROR_KEYS)[keyof typeof ERROR_KEYS]
  | "errors.noScan" | "errors.previewLost" | "errors.operationLost" | "errors.generic"

function knownCode<T extends string>(codes: readonly T[], code: string | null): T | null {
  return codes.find((known) => known === code) ?? null
}

export function targetFailureKey(code: string | null): `failures.${(typeof TARGET_FAILURES)[number] | "UNKNOWN"}` {
  return `failures.${knownCode(TARGET_FAILURES, code) ?? "UNKNOWN"}`
}

export function resultErrorKey(code: string | null): `results.errors.${(typeof RESULT_ERRORS)[number] | "UNKNOWN"}` {
  return `results.errors.${knownCode(RESULT_ERRORS, code) ?? "UNKNOWN"}`
}

export function fileOpsErrorKey(error: FileOpsError, state: FileOpsUiState): ErrorKey {
  if (error.code === "NOT_FOUND") {
    if (error.source === "start") return "errors.noScan"
    return state.operation && !fileOpsOperationIsTerminal(state.operation.status)
      ? "errors.operationLost"
      : "errors.previewLost"
  }
  return error.code in ERROR_KEYS ? ERROR_KEYS[error.code as keyof typeof ERROR_KEYS] : "errors.generic"
}

export function isReviewTarget(target: FileOpsTarget): boolean {
  return target.valid && target.size.status === "done"
}

// Cleanup theo gợi ý của backend; delete là các mục người dùng vừa tự chọn.
export function initialReviewSelection(preview: Pick<FileOpsPreview, "source" | "targets">): Set<string> {
  return new Set(preview.targets
    .filter((target) => isReviewTarget(target) && (preview.source === "delete" || target.defaultSelected))
    .map(({ path }) => path))
}

export function sortCleanupTargets(targets: readonly FileOpsTarget[], sort: CleanupSort, locale: string): FileOpsTarget[] {
  const activity = (target: FileOpsTarget): number => (
    target.lastActivityAt === null ? Number.POSITIVE_INFINITY : Date.parse(target.lastActivityAt)
  )
  const compare = (a: FileOpsTarget, b: FileOpsTarget): number => {
    if (sort === "size") return (b.size.reclaimableBytes ?? -1) - (a.size.reclaimableBytes ?? -1)
    const [left, right] = [activity(a), activity(b)]
    return left === right ? 0 : left < right ? -1 : 1
  }
  return [...targets].sort((a, b) => compare(a, b) || a.path.localeCompare(b.path, locale))
}

export function reviewTotals(targets: readonly FileOpsTarget[], selected: ReadonlySet<string>) {
  const chosen = targets.filter(({ path }) => selected.has(path))
  return {
    count: chosen.length,
    reclaimableBytes: chosen.reduce(
      (total, { method, size }) => total + (method === "permanent" ? size.reclaimableBytes ?? 0 : 0), 0
    ),
    recycleBytes: chosen.reduce(
      (total, { method, size }) => total + (method === "recycle" ? size.sizeBytes ?? 0 : 0), 0
    ),
  }
}

function parseWholeNumber(text: string): number | null | undefined {
  const value = text.trim()
  if (value === "") return undefined
  const number = /^\d+$/.test(value) ? Number(value) : Number.NaN
  return Number.isSafeInteger(number) ? number : null
}

export function cleanupPreviewInput(form: CleanupFilterForm): CleanupPreviewInput | null {
  const olderThanDays = parseWholeNumber(form.olderThanDays)
  const minSizeMib = parseWholeNumber(form.minSizeMib)
  if (form.kinds.length === 0 || olderThanDays === null || minSizeMib === null) return null
  const minSizeBytes = minSizeMib === undefined ? undefined : minSizeMib * MEBIBYTE
  if (minSizeBytes !== undefined && !Number.isSafeInteger(minSizeBytes)) return null
  return {
    includeKinds: form.kinds,
    ...(olderThanDays === undefined ? {} : { olderThanDays }),
    ...(minSizeBytes === undefined ? {} : { minSizeBytes }),
  }
}

export function operationCounts({ results }: Pick<FileOpsOperation, "results">) {
  const count = (test: (result: FileOpsTargetResult) => boolean): number => results.filter(test).length
  return {
    success: count(({ status }) => status === "success"),
    failed: count(({ status }) => status === "failed"),
    notStarted: count(({ status }) => status === "not_started"),
    remaining: count(({ status }) => status === "pending" || status === "running"),
    recycled: count(({ status, method }) => status === "success" && method === "recycle"),
    partial: count(({ mayBePartial }) => mayBePartial),
    // Chỉ là ước tính từ preview: Thùng rác chưa trả lại dung lượng.
    reclaimedBytes: results.reduce((total, { status, method, reclaimableBytes }) => (
      total + (status === "success" && method === "permanent" ? reclaimableBytes ?? 0 : 0)
    ), 0),
  }
}

export function sortOperationResults(results: readonly FileOpsTargetResult[]): FileOpsTargetResult[] {
  const rank = ({ status }: FileOpsTargetResult): number => status === "failed" ? 0 : status === "not_started" ? 1 : 2
  return [...results].sort((a, b) => rank(a) - rank(b))
}

export function fileManagerHref(path: string): string {
  return `/files?${new URLSearchParams({ path })}`
}
