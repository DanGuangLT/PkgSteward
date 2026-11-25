import { ApiError } from "../api/response.ts"
import type { Risk, RunFailureCode, RunLogPage, RunStatus, RunWarningCode } from "@/lib/api/types"

export type GlobalManager = "npm" | "pnpm" | "yarn"
export type GlobalAction = "remove" | "change" | "repair"
export type GlobalJobKind = "inventory" | "versions" | "preview" | "mutation"
export type GlobalReasonCode = RunFailureCode
  | "LOCATION_AMBIGUOUS" | "REGISTRY_CONFIG_UNSUPPORTED" | "LINKED_PACKAGE" | "PROTECTED_PACKAGE"
  | "BIN_CONFLICT" | "NO_VERSION_CHANGE" | "PREVIEW_CHANGED" | "PREVIEW_EXPIRED" | "PREVIEW_CONSUMED"
  | "REQUEST_MISMATCH" | "LIMIT_EXCEEDED" | "REGISTRY_UNAVAILABLE" | "REGISTRY_INVALID_RESPONSE"
  | "REGISTRY_NOT_FOUND" | "REGISTRY_RATE_LIMITED" | "REGISTRY_AUTH_REQUIRED" | "INVENTORY_FAILED" | "POSTCONDITION_FAILED"
  | "MANAGER_DISABLED" | "PNPM_GLOBAL_NOT_CONFIGURED" | "YARN_GLOBAL_NOT_CONFIGURED" | "GLOBAL_GROUP_UNSUPPORTED"
  | "NPM_PREFIX_IS_NODE_DIR" | "NPM_OVERLAY_ABSENT" | "NPM_OVERLAY_NOT_BROKEN" | "NPM_DELEGATION_UNVERIFIED"
  | "TARGET_VERSION_UNSUPPORTED" | "ENGINE_UNSUPPORTED" | "FILE_IN_USE" | "ACCESS_DENIED" | "DELETE_FAILED" | "PATH_TOO_LONG"
export type GlobalWarningCode = RunWarningCode | "MAJOR_VERSION_CHANGE" | "VERSION_DOWNGRADE"
  | "PRERELEASE_VERSION" | "GLOBAL_CODE_EXECUTION" | "GLOBAL_CONSUMERS_UNKNOWN" | "PROCESS_ESCAPE_RESIDUAL"
  | "TERMINAL_NPM_SWITCH" | "PNPM_SHARED_GLOBAL_PROJECT" | "YARN_SHARED_GLOBAL_PROJECT"

export interface GlobalActivityRequest { requestId: string }
export interface GlobalVersionsRequest extends GlobalActivityRequest { manager: GlobalManager; package: string }
export interface GlobalPreviewRequest extends GlobalVersionsRequest { action: GlobalAction; targetVersion?: string }
export interface GlobalExecuteRequest extends GlobalActivityRequest {
  previewId: string
  confirm: true
  acknowledgedRisks: string[]
  confirmText: string
}
export interface GlobalBin { name: string; target: string }
export interface GlobalBinDiff {
  before: GlobalBin[]
  after: GlobalBin[]
  added: GlobalBin[]
  removed: GlobalBin[]
  replaced: { before: GlobalBin; after: GlobalBin }[]
}
export interface GlobalPackage {
  name: string
  version: string
  bins: GlobalBin[]
  status: "manageable" | "protected" | "linked" | "invalid"
  reason: GlobalReasonCode | null
}
/** npm only: which npm terminals run (prefix overlay) vs the Node-bundled npm PkgSteward keeps (M9G). */
export type NpmOverlayState = "absent" | "present" | "broken" | "linked" | "unsupported"
export interface GlobalNpmVersion {
  bundledVersion: string
  overlayVersion: string | null
  terminalVersion: string | null
  prefix: string
  overlayState: NpmOverlayState
  delegation: "verified" | "unverified"
  reason: GlobalReasonCode | null
}
export interface GlobalManagerInventory {
  manager: GlobalManager
  version: string | null
  available: boolean
  reason: GlobalReasonCode | null
  globalRoot: string | null
  binDir: string | null
  packages: GlobalPackage[]
  npmVersion?: GlobalNpmVersion
}
export interface GlobalSnapshot { revision: string; asOf: string; stale: boolean; managers: GlobalManagerInventory[] }
export interface GlobalVersions {
  manager: GlobalManager
  package: string
  versions: string[]
  tags: Record<string, string>
  deprecatedVersions?: string[]
}
export interface GlobalNpmPreview {
  appVersion: string
  terminalBefore: string | null
  terminalAfter: string
  prefix: string
  repairTargets: string[]
}
export interface GlobalSharedPackage { name: string; version: string; linked: boolean }
export interface GlobalPreview {
  previewId: string
  createdAt: string
  expiresAt: string
  manager: GlobalManager
  managerVersion: string
  action: GlobalAction
  package: string
  currentVersion: string | null
  requestedVersion: string | null
  targetVersion: string | null
  globalRoot: string
  binDir: string
  bins: GlobalBinDiff
  warningCodes: GlobalWarningCode[]
  risk: Risk
  confirmText: string
  npm?: GlobalNpmPreview
  sharedPackages?: GlobalSharedPackage[]
}

export function parseGlobalSharedPackages(preview: Pick<GlobalPreview, "manager" | "managerVersion"> & { sharedPackages?: unknown }): GlobalSharedPackage[] | undefined {
  const supportedShared =
    (preview.manager === "pnpm" && /^10\./.test(preview.managerVersion)) ||
    (preview.manager === "yarn" && /^1\./.test(preview.managerVersion))
  if (!supportedShared) return undefined
  const packages = preview.sharedPackages
  if (!Array.isArray(packages) || !packages.every(item => typeof item === "object" && item !== null
    && typeof item.name === "string" && typeof item.version === "string" && typeof item.linked === "boolean")) return undefined
  return packages.map(({ name, version, linked }) => ({ name, version, linked }))
}
export interface GlobalNpmRepairProgress {
  deleted: string[]
  failed: { path: string; code: GlobalReasonCode } | null
  remaining: string[]
}
export interface GlobalJobStart extends GlobalActivityRequest { jobId: string; previewId: string | null; status: RunStatus }
export interface GlobalJob extends GlobalJobStart {
  kind: GlobalJobKind
  manager: GlobalManager | null
  managerVersion: string | null
  action: GlobalAction | null
  package: string | null
  currentVersion: string | null
  targetVersion: string | null
  phase: "preflight" | "executing" | "stopping" | "finalizing" | "done"
  startedAt: string
  finishedAt: string | null
  mutationSpawned: boolean
  mayHaveChanged: boolean
  exitCode: number | null
  signal: string | null
  stopReason: "cancel" | "timeout" | "shutdown" | null
  terminationVerified: boolean
  gateHeld: boolean
  auditWritten: boolean
  refreshRequired: boolean
  failureCode: GlobalReasonCode | null
  warningCodes: GlobalWarningCode[]
  firstCursor: number
  endCursor: number
  droppedBytes: number
  preview: GlobalPreview | null
  versions: GlobalVersions | null
  npmRepair?: GlobalNpmRepairProgress | null
}
export type GlobalLogPage = RunLogPage
export interface GlobalError { code: string; statusCode?: number }

const reasonCodes = new Set<GlobalReasonCode>([
  "PROJECT_NOT_SCANNED", "INPUT_CHANGED", "WORKSPACE_LEAF", "UNSUPPORTED_MANAGER", "LOCKFILE_MISMATCH",
  "TOOL_NOT_FOUND", "TOOL_LAYOUT_UNSUPPORTED", "TOOL_VERSION_MISMATCH", "CONFIG_UNSUPPORTED", "INVALID_PACKAGE_SPEC",
  "SCRIPT_NOT_FOUND", "SCRIPT_NAME_UNSUPPORTED", "READERS_RUNNING", "RUNNING", "SPAWN_FAILED", "COMMAND_FAILED",
  "CANCELLED", "TIMED_OUT", "SHUTDOWN", "TERMINATION_UNCONFIRMED", "AUDIT_WRITE_FAILED", "CACHE_INVALIDATION_FAILED",
  "INTERNAL_SERVER_ERROR", "LOCATION_AMBIGUOUS", "REGISTRY_CONFIG_UNSUPPORTED", "LINKED_PACKAGE", "PROTECTED_PACKAGE",
  "BIN_CONFLICT", "NO_VERSION_CHANGE", "PREVIEW_CHANGED", "PREVIEW_EXPIRED", "PREVIEW_CONSUMED", "REQUEST_MISMATCH",
  "LIMIT_EXCEEDED", "REGISTRY_UNAVAILABLE", "REGISTRY_INVALID_RESPONSE", "REGISTRY_NOT_FOUND", "REGISTRY_RATE_LIMITED",
  "REGISTRY_AUTH_REQUIRED", "INVENTORY_FAILED", "POSTCONDITION_FAILED", "MANAGER_DISABLED",
  "PNPM_GLOBAL_NOT_CONFIGURED", "YARN_GLOBAL_NOT_CONFIGURED", "GLOBAL_GROUP_UNSUPPORTED", "NPM_PREFIX_IS_NODE_DIR", "NPM_OVERLAY_ABSENT",
  "NPM_OVERLAY_NOT_BROKEN", "NPM_DELEGATION_UNVERIFIED", "TARGET_VERSION_UNSUPPORTED", "ENGINE_UNSUPPORTED",
  "FILE_IN_USE", "ACCESS_DENIED", "DELETE_FAILED", "PATH_TOO_LONG",
])
const errorCodes = new Set<string>([...reasonCodes, "VALIDATION_ERROR", "FORBIDDEN", "NOT_FOUND", "CONFLICT",
  "SERVICE_UNAVAILABLE", "RATE_LIMITED", "HTTP_EXCEPTION", "BACKEND_UNAVAILABLE", "INVALID_RESPONSE"])

export function globalError(cause: unknown): GlobalError {
  if (!(cause instanceof ApiError)) return { code: "UNKNOWN" }
  const details = cause.details
  if (typeof details === "object" && details !== null && "reason" in details) {
    const reason = details.reason
    return { code: typeof reason === "string" && reasonCodes.has(reason as GlobalReasonCode) ? reason : "UNKNOWN", statusCode: cause.statusCode }
  }
  return { code: cause.code && errorCodes.has(cause.code) ? cause.code : "UNKNOWN", statusCode: cause.statusCode }
}
