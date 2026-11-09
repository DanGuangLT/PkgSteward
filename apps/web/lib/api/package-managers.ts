import "server-only"

import { apiFetchEnvelope } from "./client.ts"
import { packageManagersPaths } from "./package-managers-paths.ts"
import type { ApiResponse } from "@/lib/api/types"
import type {
  PmContext, PmExecuteRequest, PmJob, PmJobStart, PmPreviewRequest, PmVersionsRequest,
} from "@/lib/package-managers/pm-types"

const json = (input: unknown): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
})

export async function getPmContext(path: string, signal?: AbortSignal): Promise<ApiResponse<PmContext>> {
  return apiFetchEnvelope<PmContext>(packageManagersPaths.project(path), { method: "GET", signal })
}
export async function startPmVersions(input: PmVersionsRequest): Promise<ApiResponse<PmJobStart>> {
  return apiFetchEnvelope<PmJobStart>(packageManagersPaths.versions, json(input), null)
}
export async function startPmPreview(input: PmPreviewRequest): Promise<ApiResponse<PmJobStart>> {
  return apiFetchEnvelope<PmJobStart>(packageManagersPaths.preview, json(input), null)
}
export async function executePmPin(input: PmExecuteRequest): Promise<ApiResponse<PmJobStart>> {
  return apiFetchEnvelope<PmJobStart>(packageManagersPaths.execute, json(input), null)
}
export async function getLatestPmJob(signal?: AbortSignal): Promise<ApiResponse<PmJob | null>> {
  return apiFetchEnvelope<PmJob | null>(packageManagersPaths.latest, { method: "GET", signal })
}
export async function getPmJob(id: string, signal?: AbortSignal): Promise<ApiResponse<PmJob>> {
  return apiFetchEnvelope<PmJob>(packageManagersPaths.job(id), { method: "GET", signal })
}
export async function cancelPmJob(id: string): Promise<ApiResponse<PmJob>> {
  return apiFetchEnvelope<PmJob>(packageManagersPaths.cancel(id), { method: "POST" }, null)
}
