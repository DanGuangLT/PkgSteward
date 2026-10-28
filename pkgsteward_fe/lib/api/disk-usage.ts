import "server-only"

import { apiFetchEnvelope } from "./client.ts"
import { diskUsagePaths } from "./disk-usage-paths.ts"
import type { ApiResponse, DiskUsageJob, DiskUsageStart, StartDiskUsage } from "./types.ts"

export function startDiskUsage(input: StartDiskUsage): Promise<ApiResponse<DiskUsageStart>> {
  return apiFetchEnvelope<DiskUsageStart>(diskUsagePaths.start, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export function getDiskUsage(id: string): Promise<ApiResponse<DiskUsageJob>> {
  return apiFetchEnvelope<DiskUsageJob>(diskUsagePaths.job(id), { method: "GET" })
}

export function cancelDiskUsage(id: string): Promise<ApiResponse<DiskUsageJob>> {
  return apiFetchEnvelope<DiskUsageJob>(diskUsagePaths.cancel(id), { method: "POST" })
}
