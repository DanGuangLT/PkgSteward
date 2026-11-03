import { diskUsagePaths } from "./disk-usage-paths.ts"
import { requestApi } from "./request.ts"
import { unwrapApiData } from "./response.ts"
import type { DiskUsageJob, DiskUsageStart, StartDiskUsage } from "@/lib/api/types"

export async function startBrowserDiskUsage(input: StartDiskUsage, signal?: AbortSignal): Promise<DiskUsageStart> {
  return unwrapApiData(await requestApi<DiskUsageStart>(`/api${diskUsagePaths.start}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  }))
}

export async function pollBrowserDiskUsage(id: string, signal?: AbortSignal): Promise<DiskUsageJob> {
  return unwrapApiData(await requestApi<DiskUsageJob>(`/api${diskUsagePaths.job(id)}`, { method: "GET", signal }))
}

export async function cancelBrowserDiskUsage(id: string, signal?: AbortSignal): Promise<DiskUsageJob> {
  return unwrapApiData(await requestApi<DiskUsageJob>(`/api${diskUsagePaths.cancel(id)}`, { method: "POST", signal }))
}
