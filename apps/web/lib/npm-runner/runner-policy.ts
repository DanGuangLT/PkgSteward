import { ApiError } from "../api/response.ts"
import { initialRunnerLogs } from "./runner-log-view.ts"
import type { RunAction, RunJob, RunRequest, RunnerContext } from "@/lib/api/types"
import type { RunnerLogs } from "@/lib/npm-runner/runner-log-view"

export interface RunnerConflict { reason: "RUNNING"; jobId: string; requestPath: string }
export interface RunnerError { code: string; statusCode?: number; conflict?: RunnerConflict }
export interface RunnerSelection { action: RunAction; package?: string; script?: string }
export interface RunnerState {
  phase: "idle" | "starting" | "tracking" | "lost"
  context: RunnerContext | null
  requestPath: string | null
  generation: number
  requestId: string | null
  jobId: string | null
  job: RunJob | null
  logs: RunnerLogs
  error: RunnerError | null
  pollError: string | null
  contextError: string | null
  startUnknown: boolean
  cancelUnknown: boolean
  cancelPending: boolean
  refreshing: boolean
}

export function initialRunnerState(context: RunnerContext | null = null): RunnerState {
  return { phase: "idle", context, requestPath: context?.requestPath ?? null, generation: 0,
    requestId: null, jobId: null, job: null, logs: initialRunnerLogs(), error: null, pollError: null,
    contextError: null, startUnknown: false, cancelUnknown: false, cancelPending: false, refreshing: false }
}
export function isRunActive(job: Pick<RunJob, "status" | "gateHeld">): boolean {
  return job.gateHeld || job.status === "running" || job.status === "stopping" || job.status === "termination_failed"
}
export function isRunSuccessful(job: RunJob): boolean {
  return job.status === "completed" && job.exitCode === 0 && job.failureCode === null
    && job.terminationVerified && job.auditWritten && !job.gateHeld && !job.refreshRequired
}
export function runnerError(cause: unknown): RunnerError {
  if (!(cause instanceof ApiError)) return { code: "UNKNOWN" }
  const error: RunnerError = { code: cause.code ?? "UNKNOWN", statusCode: cause.statusCode }
  const details = cause.details
  if (cause.statusCode === 409 && cause.code === "CONFLICT" && typeof details === "object" && details !== null
    && "reason" in details && typeof details.reason === "string" && details.reason) {
    error.code = details.reason
    if (details.reason === "RUNNING" && "jobId" in details && typeof details.jobId === "string" && details.jobId
      && "requestPath" in details && typeof details.requestPath === "string" && details.requestPath) {
      error.conflict = { reason: "RUNNING", jobId: details.jobId, requestPath: details.requestPath }
    }
  }
  return error
}
export function runnerFollowHref(conflict: RunnerConflict): string {
  return `/projects?${new URLSearchParams({ path: conflict.requestPath })}`
}

const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const exactVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
function validPackage(value: string, versionAllowed: boolean): boolean {
  const separator = value.indexOf("@", value.startsWith("@") ? 1 : 0)
  const name = separator === -1 ? value : value.slice(0, separator)
  if (name.length > 214 || name.includes("..") || !packageName.test(name)) return false
  if (separator === -1) return true
  if (!versionAllowed) return false
  const version = value.slice(separator + 1)
  // Giống semver.valid ở BE: major/minor/patch vượt Number.MAX_SAFE_INTEGER là không hợp lệ.
  const exact = exactVersion.exec(version)
  const safeExact = exact !== null && exact.slice(1, 4).every(part => Number(part) <= Number.MAX_SAFE_INTEGER)
  return version.length <= 128 && (safeExact || /^[a-z][a-z0-9-]{0,63}$/.test(version))
}
function selectionError(context: RunnerContext, selection: RunnerSelection): string | null {
  switch (selection.action) {
    case "install_all": case "update_all": return null
    case "install_one": case "update_one": case "uninstall_one":
      return typeof selection.package === "string" && validPackage(selection.package, selection.action === "install_one") ? null : "INVALID_PACKAGE_SPEC"
    case "script": {
      if (!selection.script || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(selection.script)) return "SCRIPT_NAME_UNSUPPORTED"
      const declared = context.scripts.find(script => script.name === selection.script)
      return !declared ? "SCRIPT_NOT_FOUND" : !declared.eligible || !declared.command.trim() ? "SCRIPT_NAME_UNSUPPORTED" : null
    }
    default: return "VALIDATION_ERROR"
  }
}
export function runnerEligibility(state: RunnerState, selection: RunnerSelection): string | null {
  if (state.startUnknown) return "START_UNKNOWN"
  if (state.phase === "starting" || ((state.phase === "tracking" || state.phase === "lost") && !state.job)
    || state.cancelPending || (state.job && isRunActive(state.job))) return "RUNNING"
  if (state.error?.code === "RUNNING" || state.error?.code === "READERS_RUNNING") return state.error.code
  if (state.refreshing) return "REFRESHING"
  if (!state.context) return state.contextError ?? "PROJECT_NOT_SCANNED"
  if (!state.context.available || state.context.reason) return state.context.reason ?? "UNKNOWN"
  return selectionError(state.context, selection)
}
export function buildRunRequest(context: RunnerContext, selection: RunnerSelection, requestId: string): RunRequest {
  const error = selectionError(context, selection)
  if (error) throw new ApiError(400, "Invalid run selection.", error)
  const input: RunRequest = { path: context.requestPath, action: selection.action, inputHash: context.inputHash, requestId }
  if (["install_one", "update_one", "uninstall_one"].includes(selection.action)) input.package = selection.package
  if (selection.action === "script") input.script = selection.script
  return input
}
