import "server-only"

import { apiFetch, apiFetchEnvelope } from "@/lib/api/client"
import { ApiError } from "./response.ts"
import { scanPaths } from "./scan-paths.ts"
import type { ApiResponse, ScanJob, ScanResult, ScanStart } from "@/lib/api/types"

export function startScan(): Promise<ApiResponse<ScanStart>> {
  return apiFetchEnvelope<ScanStart>(scanPaths.start, { method: "POST" })
}

export function getScan(id: string): Promise<ApiResponse<ScanJob>> {
  return apiFetchEnvelope<ScanJob>(scanPaths.job(id), { method: "GET" })
}

export function cancelScan(id: string): Promise<ApiResponse<ScanJob>> {
  return apiFetchEnvelope<ScanJob>(scanPaths.cancel(id), { method: "POST" })
}

export async function getLatestScan(): Promise<ScanResult | null> {
  try {
    return await apiFetch<ScanResult>(scanPaths.latest, { method: "GET" })
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404 && error.code === "NOT_FOUND") {
      return null
    }
    throw error
  }
}
