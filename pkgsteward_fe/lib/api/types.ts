export interface ApiResponse<T> {
  statusCode: number
  message: string
  code?: string
  data?: T
  timestamp?: string
  path?: string
  details?: unknown
}

export type ScanStatus = "running" | "completed" | "cancelled" | "timed_out" | "failed"
export type PackageManager = "pnpm" | "yarn" | "npm"

export interface ScanProgress {
  visitedDirs: number
  foundProjects: number
  skippedCount: number
}

export interface ScanStart {
  scanId: string
  status: ScanStatus
}

export interface ScanJob extends ScanStart {
  partial: boolean
  progress: ScanProgress
  startedAt: string
  finishedAt?: string
}

export interface ScannedProject {
  path: string
  name: string | null
  packageManager: PackageManager | null
  hasLockfile: boolean
  lastActivityAt: string
  nodeModules: {
    exists: boolean
    path: string
    sizeBytes: number | null
    sizeMeasuredAt: string | null
  }
}

export interface OrphanNodeModules {
  path: string
  sizeBytes: number | null
  sizeMeasuredAt: string | null
  mtime: string
}

export interface ScanResult extends ScanStart {
  status: "completed" | "timed_out"
  partial: boolean
  roots: string[]
  maxDepth: number
  startedAt: string
  finishedAt: string
  skippedCount: number
  projects: ScannedProject[]
  orphanNodeModules: OrphanNodeModules[]
}

export type DiskStatus = "running" | "completed" | "cancelled" | "timed_out" | "failed"
export type DiskView = "directory" | "packages"
export type DiskStop = "cancelled" | "row_limit" | "identity_limit" | "numeric_limit" | null

export interface StartDiskUsage {
  path: string
  view?: DiskView
  force?: boolean
}

export interface DiskUsageRow {
  path: string
  name: string
  kind: "file" | "directory" | "link" | "package"
  canonicalPath: string | null
  aliases: string[]
  state: "pending" | "measuring" | "complete" | "partial" | "excluded"
  sizeBytes: number | null
  fileCount: number | null
  reason: "protected" | "link_skipped" | "outside_root" | "unreadable" | "unsupported" | "identity_unavailable" | null
}

export interface DiskUsageStart {
  jobId: string
  status: DiskStatus
}

export interface DiskUsageProgress {
  visitedDirs: number
  visitedEntries: number
  skippedCount: number
  skippedLinks: number
}

export interface DiskUsageJob extends DiskUsageStart {
  path: string
  view: DiskView
  metric: "unique-apparent"
  phase: "listing" | "measuring"
  partial: boolean
  stopReason: DiskStop
  sizeBytes: number | null
  fileCount: number | null
  children: DiskUsageRow[]
  progress: DiskUsageProgress
  startedAt: string
  finishedAt?: string
  measuredAt: string | null
  cacheHit: boolean
  failureCode: "NOT_FOUND" | "FORBIDDEN" | "INTERNAL_SERVER_ERROR" | null
}

export type RiskLevel = "low" | "medium" | "high"
export type RiskCode =
  | "ORPHAN_NODE_MODULES"
  | "NO_LOCKFILE"
  | "UNCOMMITTED_GIT_CHANGES"
  | "RECENTLY_ACTIVE"
  | "DEV_PROCESS_RUNNING"
  | "LARGE_BATCH"
  | "DELETE_WHOLE_PROJECT"
  | "MACHINE_WIDE"
  | "UNVERIFIED_CLEANUP_TARGET"
  | "RISK_CHECK_INCOMPLETE"
  | "DELETE_PROJECT_CONTENT"

export interface RiskReason {
  code: RiskCode
  level: RiskLevel
  message: string
}

export interface Risk {
  level: RiskLevel
  reasons: RiskReason[]
}

export type FileOpsKind = "project" | "node_modules" | "orphan_node_modules" | "build_cache" | "project_content"
export type CleanupKind = "node_modules" | "orphan_node_modules" | "build_cache"
export type FileOpsMethod = "permanent" | "recycle"
export type FileOpsPreviewStatus = "running" | "completed" | "cancelled" | "failed"
export type FileOpsOperationStatus = "running" | "stopping" | "completed" | "cancelled" | "failed"

export interface FileOpsOwner {
  path: string
  name: string | null
}

export interface CleanupPreviewInput {
  includeKinds?: CleanupKind[]
  olderThanDays?: number
  minSizeBytes?: number
  projectPaths?: string[]
}

export interface FileOpsPreviewStart {
  previewId: string
  status: FileOpsPreviewStatus
}

export interface FileOpsTargetSize {
  status: "pending" | "measuring" | "done" | "failed" | "cancelled"
  apparentBytes: number | null
  sizeBytes: number | null
  reclaimableBytes: number | null
  sharedBytes: number | null
  fileCount: number | null
}

export interface FileOpsTarget {
  path: string
  kind: FileOpsKind | null
  method: FileOpsMethod | null
  valid: boolean
  failureCode: string | null
  owner: FileOpsOwner | null
  nestedProjects: string[]
  hasLockfile: boolean | null
  lastActivityAt: string | null
  size: FileOpsTargetSize
  risk: Risk
  defaultSelected: boolean
}

export interface FileOpsPreview extends FileOpsPreviewStart {
  source: "cleanup" | "delete"
  scanId: string
  progress: { measuredTargets: number; totalTargets: number }
  targets: FileOpsTarget[]
  risk: Risk
  confirmText: string | null
  operationId: string | null
  startedAt: string
  finishedAt?: string
  failureCode: string | null
}

export interface FileOpsSummary {
  paths: string[]
  risk: Risk
  confirmText: string | null
  totals: {
    targetCount: number
    reclaimableBytes: number
    recycleBytes: number
  }
}

export interface FileOpsExecuteInput {
  previewId: string
  paths: string[]
  confirm: true
  acknowledgedRisks?: RiskCode[]
  confirmText?: string
}

export interface FileOpsOperationStart {
  operationId: string
  status: FileOpsOperationStatus
}

export interface FileOpsTargetResult {
  path: string
  kind: FileOpsKind
  method: FileOpsMethod
  status: "pending" | "running" | "success" | "failed" | "not_started"
  errorCode: string | null
  mayBePartial: boolean
  reclaimableBytes: number | null
}

export interface FileOpsOperation extends FileOpsOperationStart {
  previewId: string
  currentPath: string | null
  results: FileOpsTargetResult[]
  startedAt: string
  finishedAt?: string
}

export type FileTreeEntryType = "directory" | "file" | "link" | "other"

export interface FileTreeEntry {
  name: string
  path: string
  type: FileTreeEntryType
  sizeBytes: number | null
  selectable: boolean
}

export interface FileTreeLevel {
  path: string
  owner: { path: string; name: string | null }
  entries: FileTreeEntry[]
  truncated: boolean
}

export type ProjectManager = "npm" | "pnpm" | "yarn" | "unknown" | "ambiguous"
export type AnalysisStatus = "running" | "completed" | "cancelled" | "timed_out" | "failed"
export type AnalysisSectionState = "pending" | "running" | "complete" | "partial" | "unavailable"
export type AnalysisPhase = "reading" | "outdated" | "audit" | "validating" | "done"
export type DependencyGroup = "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies"
export type ProjectAnalysisCode =
  | "INPUT_CHANGED" | "PROJECT_NOT_SCANNED" | "CANCELLED" | "TIMED_OUT"
  | "UNREADABLE_INPUT" | "INVALID_LOCKFILE" | "NO_LOCKFILE" | "UNSUPPORTED_LOCKFILE"
  | "LOCKFILE_MISMATCH" | "UNSUPPORTED_MANAGER" | "UNSUPPORTED_SPEC"
  | "REGISTRY_CONFIG_UNSUPPORTED" | "LIMIT_EXCEEDED" | "REGISTRY_AUTH_REQUIRED"
  | "REGISTRY_RATE_LIMITED" | "REGISTRY_UNAVAILABLE" | "PACKAGE_NOT_FOUND"
  | "DEPRECATED_VERSION" | "INVALID_REGISTRY_RESPONSE" | "INTERNAL_SERVER_ERROR"

export interface DependencyDeclaration {
  group: DependencyGroup
  spec: string
}

export interface ManifestDependency {
  name: string
  declarations: DependencyDeclaration[]
}

export interface ProjectDependency extends ManifestDependency {
  lockedVersions: string[]
}

export interface ProjectScript {
  name: string
  command: string
}

export interface ProjectDetail {
  path: string
  requestPath: string
  name: string | null
  version: string | null
  manager: ProjectManager
  packageManager: string | null
  lockfile: string | null
  scanId: string
  inputHash: string
  readAt: string
  dependencies: ProjectDependency[]
  scripts: ProjectScript[]
  warnings: ProjectAnalysisCode[]
  diskUsage: { sizeBytes: number; measuredAt: string } | null
}

export interface ProjectOutdated {
  name: string
  registryName: string
  lockedVersions: string[]
  wanted: string | null
  latest: string | null
  behindWanted: boolean | null
  behindLatest: boolean | null
  warning: ProjectAnalysisCode | null
}

export interface ProjectAdvisory {
  id: string
  name: string
  title: string
  url: string | null
  severity: "info" | "low" | "moderate" | "high" | "critical" | "unknown"
  range: string
  affectedVersions: string[]
  direct: boolean
}

export interface AnalysisSection<T> {
  state: AnalysisSectionState
  items: T[]
  warningCodes: ProjectAnalysisCode[]
  failureCode: ProjectAnalysisCode | null
  checkedCount: number
  totalCount: number | null
}

export interface StartProjectAnalysis { path: string }

export interface ProjectAnalysisStart {
  jobId: string
  status: AnalysisStatus
}

export interface ProjectAnalysisJob extends ProjectAnalysisStart {
  path: string
  requestPath: string
  scanId: string
  inputHash: string
  phase: AnalysisPhase
  partial: boolean
  stale: boolean
  startedAt: string
  finishedAt: string | null
  checkedAt: string | null
  outdated: AnalysisSection<ProjectOutdated>
  audit: AnalysisSection<ProjectAdvisory>
  warningCodes: ProjectAnalysisCode[]
  failureCode: ProjectAnalysisCode | null
}
