import { packageManagersPaths } from "./package-managers-paths.ts"
import { requestApi } from "./request.ts"
import { unwrapApiData } from "./response.ts"
import type {
  PmContext, PmExecuteRequest, PmJob, PmJobStart, PmPreviewRequest, PmVersionsRequest,
} from "@/lib/package-managers/pm-types"

// POST starts have no client timeout: execute outcome is recovered via latest, never by a resend.
async function post<T>(path: string, input: unknown, signal?: AbortSignal): Promise<T> {
  return unwrapApiData(await requestApi<T>(`/api${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
  }, null))
}

export async function getBrowserPmContext(path: string, signal?: AbortSignal): Promise<PmContext> {
  return unwrapApiData(await requestApi<PmContext>(`/api${packageManagersPaths.project(path)}`, { method: "GET", signal }))
}
export async function startBrowserPmVersions(input: PmVersionsRequest, signal?: AbortSignal): Promise<PmJobStart> {
  return post<PmJobStart>(packageManagersPaths.versions, input, signal)
}
export async function startBrowserPmPreview(input: PmPreviewRequest, signal?: AbortSignal): Promise<PmJobStart> {
  return post<PmJobStart>(packageManagersPaths.preview, input, signal)
}
export async function executeBrowserPmPin(input: PmExecuteRequest, signal?: AbortSignal): Promise<PmJobStart> {
  return post<PmJobStart>(packageManagersPaths.execute, input, signal)
}
export async function getBrowserLatestPmJob(signal?: AbortSignal): Promise<PmJob | null> {
  return unwrapApiData(await requestApi<PmJob | null>(`/api${packageManagersPaths.latest}`, { method: "GET", signal }))
}
export async function pollBrowserPmJob(id: string, signal?: AbortSignal): Promise<PmJob> {
  return unwrapApiData(await requestApi<PmJob>(`/api${packageManagersPaths.job(id)}`, { method: "GET", signal }))
}
export async function cancelBrowserPmJob(id: string, signal?: AbortSignal): Promise<PmJob> {
  return unwrapApiData(await requestApi<PmJob>(`/api${packageManagersPaths.cancel(id)}`, { method: "POST", signal }, null))
}
