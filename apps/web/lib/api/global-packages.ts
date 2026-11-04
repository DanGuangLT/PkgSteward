import "server-only"

import { apiFetchEnvelope } from "./client.ts"
import { globalPackagesPaths } from "./global-packages-paths.ts"
import type { ApiResponse } from "@/lib/api/types"
import type {
  GlobalActivityRequest, GlobalExecuteRequest, GlobalJob, GlobalJobStart, GlobalLogPage,
  GlobalPreviewRequest, GlobalSnapshot, GlobalVersionsRequest,
} from "@/lib/global-packages/global-types"

export async function getGlobalSnapshot(signal?: AbortSignal): Promise<ApiResponse<GlobalSnapshot | null>> {
  return apiFetchEnvelope<GlobalSnapshot | null>(globalPackagesPaths.snapshot, { method: "GET", signal })
}
export async function startGlobalInventory(input: GlobalActivityRequest): Promise<ApiResponse<GlobalJobStart>> {
  return apiFetchEnvelope<GlobalJobStart>(globalPackagesPaths.inventory, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }, null)
}
export async function startGlobalVersions(input: GlobalVersionsRequest): Promise<ApiResponse<GlobalJobStart>> {
  return apiFetchEnvelope<GlobalJobStart>(globalPackagesPaths.versions, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }, null)
}
export async function startGlobalPreview(input: GlobalPreviewRequest): Promise<ApiResponse<GlobalJobStart>> {
  return apiFetchEnvelope<GlobalJobStart>(globalPackagesPaths.preview, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }, null)
}
export async function executeGlobalPackage(input: GlobalExecuteRequest): Promise<ApiResponse<GlobalJobStart>> {
  return apiFetchEnvelope<GlobalJobStart>(globalPackagesPaths.execute, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }, null)
}
export async function getLatestGlobalJob(signal?: AbortSignal): Promise<ApiResponse<GlobalJob | null>> {
  return apiFetchEnvelope<GlobalJob | null>(globalPackagesPaths.latest, { method: "GET", signal })
}
export async function getGlobalJob(id: string, signal?: AbortSignal): Promise<ApiResponse<GlobalJob>> {
  return apiFetchEnvelope<GlobalJob>(globalPackagesPaths.job(id), { method: "GET", signal })
}
export async function getGlobalLogs(id: string, cursor = 0, signal?: AbortSignal): Promise<ApiResponse<GlobalLogPage>> {
  return apiFetchEnvelope<GlobalLogPage>(globalPackagesPaths.logs(id, cursor), { method: "GET", signal })
}
export async function cancelGlobalJob(id: string): Promise<ApiResponse<GlobalJob>> {
  return apiFetchEnvelope<GlobalJob>(globalPackagesPaths.cancel(id), { method: "POST" }, null)
}
