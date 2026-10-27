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
