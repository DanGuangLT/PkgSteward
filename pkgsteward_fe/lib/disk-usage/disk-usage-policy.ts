import { ApiError } from "../api/response.ts"
import type { DiskStatus, DiskUsageJob, DiskUsageRow, DiskView, StartDiskUsage } from "../api/types.ts"

export interface DiskRequestTarget { path: string; view: DiskView }
export interface DiskSnapshot { job: DiskUsageJob; requestTarget: DiskRequestTarget }
export interface DiskError {
  code: string
  lost: boolean
  conflict?: { jobId: string; path: string }
}
// A followed job supplies its view with the first accepted snapshot.
type DiskTrackingTarget = { path: string; view: DiskView | null }

interface DiskContext {
  job: DiskUsageJob | null
  requestTarget: DiskRequestTarget | null
  form: DiskRequestTarget
}

export type DiskUiState = DiskContext & (
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "tracking"; jobId: string; target: DiskTrackingTarget; cancelPending: boolean; errorCode?: string }
)

export function diskStatusKey(state: DiskUiState): `status.${DiskStatus | "idle" | "starting" | "cancelling" | "untracked"}` {
  if (state.phase === "starting") return "status.starting"
  if (state.phase === "tracking") return state.cancelPending ? "status.cancelling" : "status.running"
  if (state.job?.status === "running") return "status.untracked"
  return state.job ? `status.${state.job.status}` : "status.idle"
}

export function diskMeasurementInput(state: DiskUiState, force: boolean): StartDiskUsage {
  const target = force && state.requestTarget ? state.requestTarget : state.form
  return { ...target, force }
}

export function diskEditTarget(state: DiskUiState, form: DiskRequestTarget): DiskUiState {
  return state.phase === "idle" ? { ...state, form } : state
}

export function diskExpandTarget(row: DiskUsageRow): DiskRequestTarget {
  return { path: row.canonicalPath ?? row.path, view: "directory" }
}

export function diskSaveSnapshot(state: DiskUiState): DiskSnapshot | null {
  return state.job && state.requestTarget ? { job: state.job, requestTarget: state.requestTarget } : null
}

export function diskRestoreSnapshot(snapshot: DiskSnapshot): DiskUiState {
  return { phase: "idle", ...snapshot, form: snapshot.requestTarget }
}

export function diskReceiveJob(state: DiskUiState, job: DiskUsageJob): DiskUiState {
  if (state.phase !== "tracking" || state.jobId !== job.jobId) return state
  const requestTarget = { path: state.target.path, view: state.target.view ?? job.view }
  const form = state.target.view === null ? requestTarget : state.form
  const context = { job, requestTarget, form }
  return job.status === "running"
    ? { ...context, phase: "tracking", jobId: job.jobId, target: requestTarget, cancelPending: false }
    : { ...context, phase: "idle" }
}

export function diskRequestError(state: DiskUiState, operation: "start" | "poll" | "cancel", error: unknown): DiskError {
  if (!(error instanceof ApiError)) return { code: "UNKNOWN", lost: false }
  const code = operation !== "start" && error.statusCode === 404
    ? "NOT_FOUND" : error.code ?? (error.statusCode === 404 ? "NOT_FOUND" : "UNKNOWN")
  const failure: DiskError = {
    code,
    lost: code === "NOT_FOUND" && operation !== "start" && state.phase === "tracking",
  }
  const details = error.details
  if (code === "CONFLICT" && typeof details === "object" && details !== null
    && "jobId" in details && typeof details.jobId === "string"
    && "path" in details && typeof details.path === "string") {
    failure.conflict = { jobId: details.jobId, path: details.path }
  }
  return failure
}

export function diskShouldPoll(status: DiskStatus, visible: boolean): boolean {
  return status === "running" && visible
}

export function acceptDiskJob(
  state: DiskUiState,
  job: DiskUsageJob,
  expectedGeneration: number,
  responseGeneration: number
): boolean {
  return state.phase === "tracking" && state.jobId === job.jobId && expectedGeneration === responseGeneration
}

export function diskCanPoll(state: DiskUiState, visible: boolean): boolean {
  return state.phase === "tracking" && !state.cancelPending && state.errorCode === undefined
    && diskShouldPoll(state.job?.jobId === state.jobId ? state.job.status : "running", visible)
}

export function diskTrackJob(state: DiskUiState, jobId: string, target: DiskTrackingTarget = state.form): DiskUiState {
  return { phase: "tracking", jobId, job: state.job, requestTarget: state.requestTarget, form: state.form, target, cancelPending: false }
}

export function diskAcceptPoll(
  state: DiskUiState, job: DiskUsageJob, expectedGeneration: number, responseGeneration: number
): boolean {
  return state.phase === "tracking" && !state.cancelPending
    && acceptDiskJob(state, job, expectedGeneration, responseGeneration)
}

export function diskBeginCancel(state: DiskUiState): DiskUiState {
  return state.phase === "tracking" ? { ...state, cancelPending: true, errorCode: undefined } : state
}

export function diskPollFailure(state: DiskUiState, code: string, statusCode?: number): DiskUiState {
  if (state.phase !== "tracking") return state
  if (code === "NOT_FOUND" || statusCode === 404) {
    return { phase: "idle", job: state.job, requestTarget: state.requestTarget, form: state.form }
  }
  return { ...state, cancelPending: false, errorCode: code }
}

export function diskRetryPoll(state: DiskUiState): DiskUiState {
  return state.phase === "tracking" && !state.cancelPending ? { ...state, errorCode: undefined } : state
}
