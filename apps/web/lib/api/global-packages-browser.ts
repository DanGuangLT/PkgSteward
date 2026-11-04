import { globalPackagesPaths } from "./global-packages-paths.ts"
import { requestApi } from "./request.ts"
import { unwrapApiData } from "./response.ts"
import type {
  GlobalActivityRequest, GlobalExecuteRequest, GlobalJob, GlobalJobStart, GlobalLogPage,
  GlobalPreviewRequest, GlobalSnapshot, GlobalVersionsRequest,
} from "@/lib/global-packages/global-types"

export async function getBrowserGlobalSnapshot(signal?: AbortSignal): Promise<GlobalSnapshot | null> {
  return unwrapApiData(await requestApi<GlobalSnapshot | null>(`/api${globalPackagesPaths.snapshot}`, { method: "GET", signal }))
}
export async function startBrowserGlobalInventory(input: GlobalActivityRequest, signal?: AbortSignal): Promise<GlobalJobStart> {
  return unwrapApiData(await requestApi<GlobalJobStart>(`/api${globalPackagesPaths.inventory}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
  }, null))
}
export async function startBrowserGlobalVersions(input: GlobalVersionsRequest, signal?: AbortSignal): Promise<GlobalJobStart> {
  return unwrapApiData(await requestApi<GlobalJobStart>(`/api${globalPackagesPaths.versions}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
  }, null))
}
export async function startBrowserGlobalPreview(input: GlobalPreviewRequest, signal?: AbortSignal): Promise<GlobalJobStart> {
  return unwrapApiData(await requestApi<GlobalJobStart>(`/api${globalPackagesPaths.preview}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
  }, null))
}
export async function executeBrowserGlobalPackage(input: GlobalExecuteRequest, signal?: AbortSignal): Promise<GlobalJobStart> {
  return unwrapApiData(await requestApi<GlobalJobStart>(`/api${globalPackagesPaths.execute}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
  }, null))
}
export async function getBrowserLatestGlobalJob(signal?: AbortSignal): Promise<GlobalJob | null> {
  return unwrapApiData(await requestApi<GlobalJob | null>(`/api${globalPackagesPaths.latest}`, { method: "GET", signal }))
}
export async function pollBrowserGlobalJob(id: string, signal?: AbortSignal): Promise<GlobalJob> {
  return unwrapApiData(await requestApi<GlobalJob>(`/api${globalPackagesPaths.job(id)}`, { method: "GET", signal }))
}
export async function getBrowserGlobalLogs(id: string, cursor = 0, signal?: AbortSignal): Promise<GlobalLogPage> {
  return unwrapApiData(await requestApi<GlobalLogPage>(`/api${globalPackagesPaths.logs(id, cursor)}`, { method: "GET", signal }))
}
export async function cancelBrowserGlobalJob(id: string, signal?: AbortSignal): Promise<GlobalJob> {
  return unwrapApiData(await requestApi<GlobalJob>(`/api${globalPackagesPaths.cancel(id)}`, { method: "POST", signal }, null))
}
