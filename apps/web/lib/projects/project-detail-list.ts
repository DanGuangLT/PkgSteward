import type { AnalysisSection, AnalysisStatus, DependencyGroup, ProjectAdvisory, ProjectAnalysisJob, ProjectDependency, ProjectOutdated } from "@/lib/api/types"
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

export function createProjectDependencyBadgeReader(job: ProjectAnalysisJob | null) {
  const outdated = new Set<string>()
  const vulnerable = new Set<string>()
  const vulnerableAliases = new Set<string>()
  for (const row of job?.audit.items ?? []) vulnerable.add(row.name)
  for (const row of job?.outdated.items ?? []) {
    if (vulnerable.has(row.registryName)) vulnerableAliases.add(row.name)
    if (row.behindWanted === true || row.behindLatest === true) outdated.add(row.name)
  }
  return (name: string): { outdated: boolean; vulnerable: boolean } => ({
    outdated: outdated.has(name),
    vulnerable: vulnerable.has(name) || vulnerableAliases.has(name),
  })
}

type ProjectDependencySpec = { groups: DependencyGroup[]; lockedVersions?: string[] }

export function createProjectDependencyRowsReader(items: readonly ProjectOutdated[]) {
  const byName = new Map<string, ProjectOutdated[]>()
  for (const item of items) {
    const rows = byName.get(item.name) ?? []
    rows.push(item)
    byName.set(item.name, rows)
  }

  return (dependency: ProjectDependency) => {
    const declarations = new Map<string, ProjectDependencySpec>()
    for (const declaration of dependency.declarations) {
      const row: ProjectDependencySpec = declarations.get(declaration.spec) ?? { groups: [] }
      row.groups.push(declaration.group)
      row.lockedVersions ??= declaration.lockedVersions
      declarations.set(declaration.spec, row)
    }

    const results = byName.get(dependency.name) ?? []
    const resultsBySpec = new Map(results.map(row => [row.declaredSpec, row]))
    const singleSpec = declarations.size === 1
    // An older API's name-only result can be matched only when both sides are unambiguous.
    const legacyResult = singleSpec && results.length === 1 ? resultsBySpec.get(undefined) : undefined
    return [...declarations].map(([spec, declaration]) => {
      const result = resultsBySpec.get(spec) ?? legacyResult
      const lockedVersions = result?.lockedVersions ?? declaration.lockedVersions
        ?? (singleSpec ? dependency.lockedVersions : [])
      return { spec, groups: declaration.groups, lockedVersions, result }
    })
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
