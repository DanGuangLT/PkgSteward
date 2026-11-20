import type {
  CleanupKind, CleanupPreviewInput, FileOpsOperation, FileOpsPreview, FileOpsTarget, FileOpsTargetResult, RiskLevel,
} from "@/lib/api/types"
import type { FileOpsError, FileOpsUiState } from "@/lib/file-ops/file-ops-policy"
import { MAX_DELETE_PATHS } from "./tree-selection.ts"

export type CleanupSort = "size" | "age" | "risk" | "name"
export type CleanupSortDirection = "asc" | "desc"
export type CleanupQuickSelectionMode = "recommended" | "visible" | "low_risk_visible" | "deselect_visible" | "clear"

export interface CleanupFilterForm {
  kinds: CleanupKind[]
  olderThanDays: string
  minSizeMib: string
  projectPaths?: string[]
}

export interface CleanupKindBreakdown {
  count: number
  bytes: number
}

export interface CleanupMetrics {
  totalTargets: number
  eligibleCount: number
  invalidCount: number
  totalReclaimableBytes: number
  maxTargetBytes: number
  attentionCount: number
  byKind: Record<CleanupKind, CleanupKindBreakdown>
  byRisk: Record<RiskLevel, number>
  selected: {
    count: number
    reclaimableBytes: number
    recycleBytes: number
  }
  selectedHighestRisk: RiskLevel | null
}

export interface CleanupOwnerGroup {
  key: string
  ownerName: string | null
  ownerPath: string | null
  isOrphanGroup: boolean
  targets: FileOpsTarget[]
  totalReclaimableBytes: number
}

const MEBIBYTE = 1024 * 1024
const DAY_MS = 86_400_000

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 }

const DEFAULT_SORT_DIRECTION: Record<CleanupSort, CleanupSortDirection> = {
  size: "desc",
  age: "asc",
  risk: "desc",
  name: "asc",
}

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

export function defaultCleanupSortDirection(sort: CleanupSort): CleanupSortDirection {
  return DEFAULT_SORT_DIRECTION[sort]
}

export function targetFailureKey(code: string | null): `failures.${(typeof TARGET_FAILURES)[number] | "UNKNOWN"}` {
  return `failures.${knownCode(TARGET_FAILURES, code) ?? "UNKNOWN"}`
}

export function resultErrorKey(code: string | null): `results.errors.${(typeof RESULT_ERRORS)[number] | "UNKNOWN"}` {
  return `results.errors.${knownCode(RESULT_ERRORS, code) ?? "UNKNOWN"}`
}

export function fileOpsErrorKey(error: FileOpsError, state: FileOpsUiState): ErrorKey {
  if (error.code === "NOT_FOUND") {
    if (state.phase === "lost") return "errors.operationLost"
    return error.source === "start" ? "errors.noScan" : "errors.previewLost"
  }
  // Câu "chưa xoá gì" chỉ đúng khi execute bị từ chối, không đúng cho poll lúc đang xoá.
  if (error.code === "INTERNAL_SERVER_ERROR" && state.phase !== "reviewing") return "errors.generic"
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

export function targetDisplayName(target: Pick<FileOpsTarget, "owner" | "path">): string {
  if (target.owner?.name) return target.owner.name
  if (target.owner?.path) {
    const segment = target.owner.path.split(/[\\/]/).filter(Boolean).pop()
    if (segment) return segment
  }
  return target.path.split(/[\\/]/).filter(Boolean).pop() ?? target.path
}

export function sortCleanupTargets(
  targets: readonly FileOpsTarget[],
  sort: CleanupSort,
  locale: string,
  direction: CleanupSortDirection = DEFAULT_SORT_DIRECTION[sort],
): FileOpsTarget[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" })
  const factor = direction === "asc" ? 1 : -1

  const compare = (a: FileOpsTarget, b: FileOpsTarget): number => {
    if (sort === "size") {
      const left = a.size.reclaimableBytes
      const right = b.size.reclaimableBytes
      if (left === null && right === null) return 0
      if (left === null) return 1
      if (right === null) return -1
      return factor * (left - right)
    }
    if (sort === "age") {
      const left = a.lastActivityAt === null ? Number.NaN : Date.parse(a.lastActivityAt)
      const right = b.lastActivityAt === null ? Number.NaN : Date.parse(b.lastActivityAt)
      const leftMissing = Number.isNaN(left)
      const rightMissing = Number.isNaN(right)
      if (leftMissing && rightMissing) return 0
      if (leftMissing) return 1
      if (rightMissing) return -1
      return factor * (left === right ? 0 : left < right ? -1 : 1)
    }
    if (sort === "risk") {
      return factor * (RISK_RANK[a.risk.level] - RISK_RANK[b.risk.level])
    }
    return factor * collator.compare(targetDisplayName(a), targetDisplayName(b))
  }
  return [...targets].sort((a, b) => compare(a, b) || a.path.localeCompare(b.path, locale))
}

export function reviewTotals(targets: readonly FileOpsTarget[], selected: ReadonlySet<string>) {
  let count = 0
  let reclaimableBytes = 0
  let recycleBytes = 0
  for (const { path, method, size } of targets) {
    if (!selected.has(path)) continue
    count += 1
    if (method === "permanent") reclaimableBytes += size.reclaimableBytes ?? 0
    else if (method === "recycle") recycleBytes += size.reclaimableBytes ?? 0
  }
  return { count, reclaimableBytes, recycleBytes }
}

export function computeCleanupMetrics(
  targets: readonly FileOpsTarget[],
  selected: ReadonlySet<string>,
): CleanupMetrics {
  const byKind: Record<CleanupKind, CleanupKindBreakdown> = {
    node_modules: { count: 0, bytes: 0 },
    orphan_node_modules: { count: 0, bytes: 0 },
    build_cache: { count: 0, bytes: 0 },
  }
  const byRisk: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0 }
  let eligibleCount = 0
  let invalidCount = 0
  let totalReclaimableBytes = 0
  let maxTargetBytes = 0
  let attentionCount = 0
  let selectedCount = 0
  let selectedReclaimableBytes = 0
  let selectedRecycleBytes = 0
  let selectedHighestRisk: RiskLevel | null = null

  for (const target of targets) {
    const bytes = target.size.reclaimableBytes ?? 0
    if (!target.valid) invalidCount += 1
    if (isReviewTarget(target)) {
      eligibleCount += 1
      totalReclaimableBytes += bytes
      if (bytes > maxTargetBytes) maxTargetBytes = bytes
      if (target.kind === "node_modules" || target.kind === "orphan_node_modules" || target.kind === "build_cache") {
        byKind[target.kind].count += 1
        byKind[target.kind].bytes += bytes
      }
      byRisk[target.risk.level] += 1
      if (target.risk.level === "medium" || target.risk.level === "high") attentionCount += 1
    }

    if (selected.has(target.path)) {
      selectedCount += 1
      if (target.method === "permanent") selectedReclaimableBytes += bytes
      else if (target.method === "recycle") selectedRecycleBytes += bytes
      if (selectedHighestRisk === null || RISK_RANK[target.risk.level] > RISK_RANK[selectedHighestRisk]) {
        selectedHighestRisk = target.risk.level
      }
    }
  }

  return {
    totalTargets: targets.length,
    eligibleCount,
    invalidCount,
    totalReclaimableBytes,
    maxTargetBytes,
    attentionCount,
    byKind,
    byRisk,
    selected: {
      count: selectedCount,
      reclaimableBytes: selectedReclaimableBytes,
      recycleBytes: selectedRecycleBytes,
    },
    selectedHighestRisk,
  }
}

export function applyQuickSelection(
  targets: readonly FileOpsTarget[],
  visiblePaths: ReadonlySet<string>,
  currentSelected: ReadonlySet<string>,
  mode: CleanupQuickSelectionMode,
): Set<string> {
  if (mode === "clear") return new Set()
  if (mode === "recommended") {
    return new Set(targets.filter((target) => isReviewTarget(target) && target.defaultSelected).map(({ path }) => path))
  }
  if (mode === "low_risk_visible") {
    return new Set(
      targets
        .filter((target) => isReviewTarget(target) && visiblePaths.has(target.path) && target.risk.level === "low")
        .map(({ path }) => path),
    )
  }
  const next = new Set(currentSelected)
  if (mode === "visible") {
    for (const target of targets) {
      if (isReviewTarget(target) && visiblePaths.has(target.path)) next.add(target.path)
    }
    return next
  }
  // deselect_visible
  for (const path of visiblePaths) next.delete(path)
  return next
}

export function applyRangeSelection(
  orderedPaths: readonly string[],
  eligiblePaths: ReadonlySet<string>,
  currentSelected: ReadonlySet<string>,
  anchorPath: string | null,
  targetPath: string,
): Set<string> {
  const next = new Set(currentSelected)
  if (!eligiblePaths.has(targetPath)) return next
  const targetIndex = orderedPaths.indexOf(targetPath)
  const anchorIndex = anchorPath === null ? -1 : orderedPaths.indexOf(anchorPath)
  const shouldSelect = !currentSelected.has(targetPath)
  if (targetIndex === -1 || anchorIndex === -1) {
    if (shouldSelect) next.add(targetPath)
    else next.delete(targetPath)
    return next
  }
  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  for (let i = start; i <= end; i += 1) {
    const path = orderedPaths[i]
    if (!eligiblePaths.has(path)) continue
    if (shouldSelect) next.add(path)
    else next.delete(path)
  }
  return next
}

const ORPHAN_GROUP_KEY = "__orphan__"

export function groupTargetsByOwner(targets: readonly FileOpsTarget[], locale: string): CleanupOwnerGroup[] {
  const map = new Map<string, CleanupOwnerGroup>()
  for (const target of targets) {
    const isOrphanGroup = target.owner === null
    const key = isOrphanGroup ? ORPHAN_GROUP_KEY : target.owner!.path
    let group = map.get(key)
    if (!group) {
      group = {
        key,
        ownerName: isOrphanGroup ? null : (target.owner!.name ?? targetDisplayName(target)),
        ownerPath: isOrphanGroup ? null : target.owner!.path,
        isOrphanGroup,
        targets: [],
        totalReclaimableBytes: 0,
      }
      map.set(key, group)
    }
    group.targets.push(target)
    if (isReviewTarget(target)) group.totalReclaimableBytes += target.size.reclaimableBytes ?? 0
  }
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" })
  return [...map.values()].sort((a, b) => {
    if (a.isOrphanGroup !== b.isOrphanGroup) return a.isOrphanGroup ? 1 : -1
    if (b.totalReclaimableBytes !== a.totalReclaimableBytes) return b.totalReclaimableBytes - a.totalReclaimableBytes
    return collator.compare(a.ownerName ?? "", b.ownerName ?? "")
  })
}

export function formatRelativeDays(isoDate: string | null, nowMs: number = Date.now()): number | null {
  if (!isoDate) return null
  const parsed = Date.parse(isoDate)
  if (Number.isNaN(parsed)) return null
  return Math.max(0, Math.floor((nowMs - parsed) / DAY_MS))
}

function parseWholeNumber(text: string): number | null | undefined {
  const value = text.trim()
  if (value === "") return undefined
  const number = /^\d+$/.test(value) ? Number(value) : Number.NaN
  return Number.isSafeInteger(number) ? number : null
}

function normalizeProjectPaths(paths: readonly string[] | undefined): string[] | null {
  if (!paths || paths.length === 0) return []
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const raw of paths) {
    if (typeof raw !== "string") return null
    const trimmed = raw.trim()
    if (!trimmed) return null
    if (!seen.has(trimmed)) {
      seen.add(trimmed)
      deduped.push(trimmed)
    }
  }
  if (deduped.length > MAX_DELETE_PATHS) return null
  return deduped
}

export function cleanupPreviewInput(form: CleanupFilterForm): CleanupPreviewInput | null {
  const olderThanDays = parseWholeNumber(form.olderThanDays)
  const minSizeMib = parseWholeNumber(form.minSizeMib)
  const projectPaths = normalizeProjectPaths(form.projectPaths)
  if (form.kinds.length === 0 || olderThanDays === null || minSizeMib === null || projectPaths === null) return null
  const minSizeBytes = minSizeMib === undefined ? undefined : minSizeMib * MEBIBYTE
  if (minSizeBytes !== undefined && !Number.isSafeInteger(minSizeBytes)) return null
  return {
    includeKinds: form.kinds,
    ...(olderThanDays === undefined ? {} : { olderThanDays }),
    ...(minSizeBytes === undefined ? {} : { minSizeBytes }),
    ...(projectPaths.length === 0 ? {} : { projectPaths }),
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

export function projectInspectHref(path: string, returnTo?: string): string {
  const params = new URLSearchParams({ path })
  if (returnTo) params.set("returnTo", returnTo)
  return `/projects?${params}`
}
