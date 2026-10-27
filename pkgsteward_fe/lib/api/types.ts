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
