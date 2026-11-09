import type { Risk } from "@/lib/api/types"

// Mirrors BE apps/api/src/package-managers/interfaces/pm.types.ts. No process fields: M9 starts no child.
export type PmManager = "npm" | "pnpm" | "yarn"
export type PmWritableManager = "npm" | "pnpm"
export type PmJobKind = "versions" | "preview" | "mutation"
export type PmJobStatus = "running" | "completed" | "failed" | "cancelled" | "timed_out"
export type PmJobPhase = "preflight" | "fetching" | "writing" | "finalizing" | "done"
export type PmWarningCode = "PIN_HASH_REMOVED" | "PIN_DOES_NOT_SWITCH_RUNNER" | "DEV_ENGINES_NOT_MANAGED"
export type PmLimitation = "EXTERNAL_EDIT_RACE" | "PARENT_JUNCTION_RACE" | "CRASH_TEMP_RESIDUAL"

export interface PmVersionsRequest { requestId: string; path: string; manager: PmManager }
export interface PmPreviewRequest extends PmVersionsRequest { manager: PmWritableManager; targetVersion: string }
export interface PmExecuteRequest {
  requestId: string
  previewId: string
  confirm: true
  acknowledgedRisks: string[]
  confirmText?: string
}

export interface PmParsedPin { manager: PmManager; version: string; hash: string | null }
export interface PmInstalledTool {
  manager: PmManager
  version: string | null
  toolPath: string | null
  status: "available" | "unavailable" | "unsupported"
  reason: string | null
}
export interface PmContext {
  path: string
  projectName: string
  scanId: string
  asOf: string
  rawPin: string | null
  rawPinTruncated: boolean
  pinState: "missing" | "parsed" | "unsupported"
  parsedPin: PmParsedPin | null
  pinReason: "PIN_UNSUPPORTED" | null
  installed: PmInstalledTool[]
  lockManagers: PmManager[]
  workspace: { kind: "standalone" | "root" | "leaf"; root: string | null }
  devEnginesPresent: boolean
  reason: string | null
  warnings: PmWarningCode[]
}
export interface PmVersion { version: string; deprecated: boolean; supported: boolean; reason: string | null }
export interface PmVersions { manager: PmManager; versions: PmVersion[]; tags: Record<string, string>; asOf: string; stale: boolean }
export interface PmFileEdit {
  file: "package.json"
  field: "packageManager"
  operation: "insert" | "replace"
  before: string | null
  after: string
}
export interface PmPreview {
  previewId: string
  createdAt: string
  expiresAt: string
  path: string
  projectName: string
  scanId: string
  manager: PmWritableManager
  rawPin: string | null
  currentVersion: string | null
  requestedVersion: string
  targetVersion: string
  installedRunnerVersion: string
  method: "manifest-pin"
  edit: PmFileEdit
  warnings: PmWarningCode[]
  limitations: PmLimitation[]
  risk: Risk
  confirmText: string | null
}
export interface PmJobStart { jobId: string; requestId: string; previewId: string | null; status: PmJobStatus }
export interface PmJob extends PmJobStart {
  kind: PmJobKind
  path: string
  manager: PmManager
  phase: PmJobPhase
  startedAt: string
  finishedAt: string | null
  cancelRequested: boolean
  mutationStarted: boolean
  fileCommitted: boolean
  mayHaveChanged: boolean
  gateHeld: boolean
  auditWritten: boolean
  refreshRequired: boolean
  cleanupRequired: boolean
  failureCode: string | null
  warnings: PmWarningCode[]
  preview: PmPreview | null
  versions: PmVersions | null
}
