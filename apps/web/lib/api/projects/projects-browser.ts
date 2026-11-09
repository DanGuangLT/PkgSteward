import { projectsPaths } from "./projects-paths.ts"
import { requestApi } from "../request.ts"
import { unwrapApiData } from "../response.ts"
import type { ProjectAnalysisJob, ProjectAnalysisStart, ProjectDetail, StartProjectAnalysis } from "@/lib/api/types"

export async function getBrowserProject(path: string, signal?: AbortSignal): Promise<ProjectDetail> {
  return unwrapApiData(await requestApi<ProjectDetail>(`/api${projectsPaths.detail(path)}`, { method: "GET", signal }))
}

export async function startBrowserProjectAnalysis(input: StartProjectAnalysis, signal?: AbortSignal): Promise<ProjectAnalysisStart> {
  return unwrapApiData(await requestApi<ProjectAnalysisStart>(`/api${projectsPaths.start}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
  }))
}

export async function pollBrowserProjectAnalysis(id: string, signal?: AbortSignal): Promise<ProjectAnalysisJob> {
  return unwrapApiData(await requestApi<ProjectAnalysisJob>(`/api${projectsPaths.job(id)}`, { method: "GET", signal }))
}

export async function cancelBrowserProjectAnalysis(id: string, signal?: AbortSignal): Promise<ProjectAnalysisJob> {
  return unwrapApiData(await requestApi<ProjectAnalysisJob>(`/api${projectsPaths.cancel(id)}`, { method: "POST", signal }))
}
