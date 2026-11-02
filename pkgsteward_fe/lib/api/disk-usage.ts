import "server-only"

import { apiFetchEnvelope } from "@/lib/api/client"
import { diskUsagePaths } from "@/lib/api/disk-usage-paths"
import type { ApiResponse, DiskUsageJob, DiskUsageStart, StartDiskUsage } from "@/lib/api/types"

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
