import { ApiError } from "../api/response.ts"
import type { ProjectAnalysisJob, ProjectDetail } from "@/lib/api/types"

export interface AnalysisConflict { reason: "ANALYSIS_RUNNING"; jobId: string; path: string }
export interface ProjectAnalysisError {
  code: string
  statusCode?: number
  conflict?: AnalysisConflict
}

interface AnalysisContext {
  detail: ProjectDetail | null
  job: ProjectAnalysisJob | null
  requestPath: string | null
  generation: number
  error: ProjectAnalysisError | null
  startUnknown: boolean
  cancelUnknown: boolean
}

export type ProjectAnalysisState = AnalysisContext & (
  | { phase: "idle" | "starting" | "lost" }
  | { phase: "tracking"; jobId: string; cancelPending: boolean; pollError: string | null }
)

export function initialAnalysisState(detail: ProjectDetail | null = null): ProjectAnalysisState {
  return { phase: "idle", detail, job: null, requestPath: detail?.requestPath ?? null,
    generation: 0, error: null, startUnknown: false, cancelUnknown: false }
}

export function projectAnalysisError(operation: "start" | "poll" | "cancel", cause: unknown): ProjectAnalysisError {
  if (!(cause instanceof ApiError)) return { code: "UNKNOWN" }
  const failure: ProjectAnalysisError = {
    code: operation !== "start" && cause.statusCode === 404 ? "NOT_FOUND" : cause.code ?? "UNKNOWN",
    statusCode: cause.statusCode,
  }
  const details = cause.details
  if (cause.statusCode === 409 && cause.code === "CONFLICT" && typeof details === "object" && details !== null
    && "reason" in details && details.reason === "ANALYSIS_RUNNING"
    && "jobId" in details && typeof details.jobId === "string" && details.jobId.length > 0
    && "path" in details && typeof details.path === "string" && details.path.length > 0) {
    failure.conflict = { reason: "ANALYSIS_RUNNING", jobId: details.jobId, path: details.path }
  }
  return failure
}

export function trackAnalysis(state: ProjectAnalysisState, jobId: string, requestPath: string): ProjectAnalysisState {
  return { ...state, phase: "tracking", jobId, requestPath, cancelPending: false,
    pollError: null, error: null, startUnknown: false, cancelUnknown: false }
}

export function canPollAnalysis(state: ProjectAnalysisState, visible: boolean): boolean {
  return visible && state.phase === "tracking" && !state.cancelPending && state.pollError === null
    && (state.job?.jobId !== state.jobId || state.job.status === "running")
}

export function acceptAnalysisJob(
  state: ProjectAnalysisState, job: ProjectAnalysisJob, generation: number, operation: "poll" | "cancel" = "poll"
): boolean {
  return state.phase === "tracking" && state.jobId === job.jobId && state.generation === generation
    && (operation === "cancel" || !state.cancelPending)
}

export function receiveAnalysisJob(state: ProjectAnalysisState, job: ProjectAnalysisJob): ProjectAnalysisState {
  if (state.phase !== "tracking" || state.jobId !== job.jobId) return state
  const next = { ...state, job, requestPath: job.requestPath, cancelPending: false,
    cancelUnknown: false, pollError: null, error: null }
  return job.status === "running" ? next : { ...next, phase: "idle" }
}

export function beginAnalysisCancel(state: ProjectAnalysisState): ProjectAnalysisState {
  return state.phase === "tracking"
    ? { ...state, cancelPending: true, cancelUnknown: false, error: null, pollError: null } : state
}

export function failAnalysisRequest(
  state: ProjectAnalysisState, operation: "start" | "poll" | "cancel", cause: unknown
): ProjectAnalysisState {
  const error = projectAnalysisError(operation, cause)
  if (operation === "start") {
    return { ...state, phase: "idle", error,
      startUnknown: error.statusCode === undefined || error.statusCode >= 500 }
  }
  if (state.phase !== "tracking") return state
  const next = { ...state, error, cancelPending: false, pollError: error.code,
    cancelUnknown: operation === "cancel" || state.cancelUnknown }
  return error.statusCode === 404
    ? { ...next, phase: "lost", job: state.job ? { ...state.job, stale: true } : null } : next
}

export function retryAnalysisPoll(state: ProjectAnalysisState): ProjectAnalysisState {
  return state.phase === "tracking" && !state.cancelPending ? { ...state, pollError: null, error: null } : state
}
