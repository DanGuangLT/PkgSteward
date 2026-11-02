import type { AnalysisSection, AnalysisStatus, ProjectAdvisory, ProjectAnalysisJob } from "@/lib/api/types"
import type { ProjectAnalysisState } from "@/lib/projects/project-analysis-policy"

export function projectDetailHref(path: string): string {
  return `/projects?${new URLSearchParams({ path })}`
}

export function projectValueKnown(value: number | string | boolean | null): boolean {
  return value !== null
}

export function projectSectionIsComplete(section: AnalysisSection<unknown> | null): boolean {
  return section?.state === "complete" && section.failureCode === null
}

export function projectAuditIsClean(job: ProjectAnalysisJob | null): boolean {
  return job !== null && job.status === "completed" && !job.partial && !job.stale
    && job.checkedAt !== null && projectSectionIsComplete(job.audit) && job.audit.items.length === 0
}

export function projectDependencyBadges(name: string, job: ProjectAnalysisJob | null): { outdated: boolean; vulnerable: boolean } {
  const row = job?.outdated.items.find(item => item.name === name)
  return {
    outdated: row?.behindWanted === true || row?.behindLatest === true,
    vulnerable: job?.audit.items.some(item => item.name === name || item.name === row?.registryName) ?? false,
  }
}

const severityOrder: Record<ProjectAdvisory["severity"], number> = {
  critical: 0, high: 1, moderate: 2, low: 3, info: 4, unknown: 5,
}
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0

export function sortProjectAdvisories(items: readonly ProjectAdvisory[]): ProjectAdvisory[] {
  return [...items].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    || compareText(a.name, b.name) || compareText(a.id, b.id))
}

export function projectAnalysisStatusKey(state: ProjectAnalysisState):
  | `status.${AnalysisStatus | "idle" | "starting" | "lost"}`
  | "analysis.cancelling" | "analysis.cancelUnknown" | "analysis.startUnknown" | "analysis.untracked" {
  if (state.phase === "starting") return "status.starting"
  if (state.phase === "lost") return "status.lost"
  if (state.startUnknown) return "analysis.startUnknown"
  if (state.phase === "tracking") {
    if (state.cancelPending) return "analysis.cancelling"
    if (state.cancelUnknown) return "analysis.cancelUnknown"
    return state.pollError ? "analysis.untracked" : "status.running"
  }
  if (state.job?.status === "running") return "analysis.untracked"
  return state.job ? `status.${state.job.status}` : "status.idle"
}
