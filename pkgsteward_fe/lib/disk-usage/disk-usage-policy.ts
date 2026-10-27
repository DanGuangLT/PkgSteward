import type { DiskStatus, DiskUsageJob } from "../api/types.ts"

export type DiskUiState =
  | { phase: "idle"; job: DiskUsageJob | null }
  | { phase: "starting"; job: DiskUsageJob | null }
  | { phase: "tracking"; jobId: string; job: DiskUsageJob | null; cancelPending: boolean; errorCode?: string }

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

export function diskTrackJob(state: DiskUiState, jobId: string): DiskUiState {
  return { phase: "tracking", jobId, job: state.job, cancelPending: false }
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
  if (code === "NOT_FOUND" || statusCode === 404) return { phase: "idle", job: state.job }
  return { ...state, cancelPending: false, errorCode: code }
}

export function diskRetryPoll(state: DiskUiState): DiskUiState {
  return state.phase === "tracking" && !state.cancelPending ? { ...state, errorCode: undefined } : state
}
