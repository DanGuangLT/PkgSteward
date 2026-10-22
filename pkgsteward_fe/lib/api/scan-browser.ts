import { requestApi } from "./request.ts"
import { unwrapApiData } from "./response.ts"
import { scanPaths } from "./scan-paths.ts"
import type { ScanJob, ScanStart } from "./types"

export async function startBrowserScan(signal?: AbortSignal): Promise<ScanStart> {
  return unwrapApiData(await requestApi<ScanStart>(`/api${scanPaths.start}`, { method: "POST", signal }))
}

export async function pollBrowserScan(id: string, signal?: AbortSignal): Promise<ScanJob> {
  return unwrapApiData(await requestApi<ScanJob>(`/api${scanPaths.job(id)}`, { method: "GET", signal }))
}

export async function cancelBrowserScan(id: string, signal?: AbortSignal): Promise<ScanJob> {
  return unwrapApiData(await requestApi<ScanJob>(`/api${scanPaths.cancel(id)}`, { method: "POST", signal }))
}
