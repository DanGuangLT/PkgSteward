import { npmRunsPaths } from "./npm-runs-paths.ts"
import { requestApi } from "./request.ts"
import { unwrapApiData } from "./response.ts"
import type { RunnerContext, RunRequest, RunStart, RunJob, RunLogPage } from "@/lib/api/types"

export async function getBrowserRunnerContext(path: string, signal?: AbortSignal): Promise<RunnerContext> {
  return unwrapApiData(await requestApi<RunnerContext>(`/api${npmRunsPaths.context(path)}`, { method: "GET", signal }))
}
export async function startBrowserNpmRun(input: RunRequest, signal?: AbortSignal): Promise<RunStart> {
  return unwrapApiData(await requestApi<RunStart>(`/api${npmRunsPaths.start}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
  }, null))
}
export async function getBrowserLatestNpmRun(signal?: AbortSignal): Promise<RunJob> {
  return unwrapApiData(await requestApi<RunJob>(`/api${npmRunsPaths.latest}`, { method: "GET", signal }))
}
export async function pollBrowserNpmRun(id: string, signal?: AbortSignal): Promise<RunJob> {
  return unwrapApiData(await requestApi<RunJob>(`/api${npmRunsPaths.job(id)}`, { method: "GET", signal }))
}
export async function getBrowserNpmRunLogs(id: string, cursor = 0, signal?: AbortSignal): Promise<RunLogPage> {
  return unwrapApiData(await requestApi<RunLogPage>(`/api${npmRunsPaths.logs(id, cursor)}`, { method: "GET", signal }))
}
export async function cancelBrowserNpmRun(id: string, signal?: AbortSignal): Promise<RunJob> {
  return unwrapApiData(await requestApi<RunJob>(`/api${npmRunsPaths.cancel(id)}`, { method: "POST", signal }, null))
}
