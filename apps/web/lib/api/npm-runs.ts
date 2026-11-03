import "server-only"

import { apiFetchEnvelope } from "@/lib/api/client"
import { npmRunsPaths } from "@/lib/api/npm-runs-paths"
import type { ApiResponse, RunnerContext, RunRequest, RunStart, RunJob, RunLogPage } from "@/lib/api/types"

export function getRunnerContext(path: string, signal?: AbortSignal): Promise<ApiResponse<RunnerContext>> {
  return apiFetchEnvelope<RunnerContext>(npmRunsPaths.context(path), { method: "GET", signal })
}
export function startNpmRun(input: RunRequest): Promise<ApiResponse<RunStart>> {
  return apiFetchEnvelope<RunStart>(npmRunsPaths.start, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }, null)
}
export function getLatestNpmRun(signal?: AbortSignal): Promise<ApiResponse<RunJob>> {
  return apiFetchEnvelope<RunJob>(npmRunsPaths.latest, { method: "GET", signal })
}
export function getNpmRun(id: string, signal?: AbortSignal): Promise<ApiResponse<RunJob>> {
  return apiFetchEnvelope<RunJob>(npmRunsPaths.job(id), { method: "GET", signal })
}
export function getNpmRunLogs(id: string, cursor = 0, signal?: AbortSignal): Promise<ApiResponse<RunLogPage>> {
  return apiFetchEnvelope<RunLogPage>(npmRunsPaths.logs(id, cursor), { method: "GET", signal })
}
export function cancelNpmRun(id: string): Promise<ApiResponse<RunJob>> {
  return apiFetchEnvelope<RunJob>(npmRunsPaths.cancel(id), { method: "POST" }, null)
}
