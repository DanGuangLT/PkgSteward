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
    sizeBytes: null
  }
}

export interface OrphanNodeModules {
  path: string
  sizeBytes: null
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
