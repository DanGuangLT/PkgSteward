import "server-only"

import { apiFetchEnvelope } from "@/lib/api/client"
import { projectsPaths } from "@/lib/api/projects/projects-paths"
import type { ApiResponse, ProjectAnalysisJob, ProjectAnalysisStart, ProjectDetail, StartProjectAnalysis } from "@/lib/api/types"

export function getProjectDetail(path: string): Promise<ApiResponse<ProjectDetail>> {
  return apiFetchEnvelope<ProjectDetail>(projectsPaths.detail(path), { method: "GET" })
}

export function startProjectAnalysis(input: StartProjectAnalysis): Promise<ApiResponse<ProjectAnalysisStart>> {
  return apiFetchEnvelope<ProjectAnalysisStart>(projectsPaths.start, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  })
}

export function getProjectAnalysis(id: string): Promise<ApiResponse<ProjectAnalysisJob>> {
  return apiFetchEnvelope<ProjectAnalysisJob>(projectsPaths.job(id), { method: "GET" })
}

export function cancelProjectAnalysis(id: string): Promise<ApiResponse<ProjectAnalysisJob>> {
  return apiFetchEnvelope<ProjectAnalysisJob>(projectsPaths.cancel(id), { method: "POST" })
}
