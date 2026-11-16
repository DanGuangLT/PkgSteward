import type {
  DependencyGroup, ProjectAdvisory, ProjectAnalysisJob, ProjectDependency, ProjectScript, RunnerContext,
} from "@/lib/api/types"
import { createListTextMatcher, selectListItems } from "../ui/list-discovery.ts"
import {
  createProjectDependencyBadgeReader, createProjectDependencyRowsReader, projectSectionIsComplete,
} from "./project-detail-list.ts"

export const DEPENDENCY_GROUP_FILTERS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const
export const DEPENDENCY_STATUS_FILTERS = ["outdated", "vulnerable", "unchecked"] as const
export const ADVISORY_SEVERITY_FILTERS = ["critical", "high", "moderate", "low", "info", "unknown"] as const
export const ADVISORY_EXPOSURE_FILTERS = ["direct", "transitive"] as const
export const SCRIPT_ELIGIBILITY_FILTERS = ["eligible", "ineligible"] as const

export type DependencySort = "name" | "status"
export type DependencyStatus = Record<typeof DEPENDENCY_STATUS_FILTERS[number], boolean>
export interface DependencyFilters {
  groups: readonly DependencyGroup[]
  statuses: readonly (typeof DEPENDENCY_STATUS_FILTERS[number])[]
}
export type AdvisorySort = "severity" | "name"
export interface AdvisoryFilters {
  severities: readonly ProjectAdvisory["severity"][]
  exposures: readonly (typeof ADVISORY_EXPOSURE_FILTERS[number])[]
}
export interface ScriptFilters {
  eligibilities: readonly (typeof SCRIPT_ELIGIBILITY_FILTERS[number])[]
}

export const DEFAULT_DEPENDENCY_FILTERS: Readonly<DependencyFilters> = Object.freeze({
  groups: Object.freeze([]), statuses: Object.freeze([]),
})
export const DEFAULT_ADVISORY_FILTERS: Readonly<AdvisoryFilters> = Object.freeze({
  severities: Object.freeze([]), exposures: Object.freeze([]),
})
export const DEFAULT_SCRIPT_FILTERS: Readonly<ScriptFilters> = Object.freeze({ eligibilities: Object.freeze([]) })

export function createDependencyStatusReader(job: ProjectAnalysisJob | null) {
  const readBadges = createProjectDependencyBadgeReader(job)
  const readRows = createProjectDependencyRowsReader(job?.outdated.items ?? [])
  const incomplete = !job || job.status !== "completed" || job.partial || job.stale || job.checkedAt === null
    || !projectSectionIsComplete(job.outdated) || !projectSectionIsComplete(job.audit)
    || [job.outdated, job.audit].some(section => section.totalCount === null || section.checkedCount < section.totalCount)

  return (dependency: ProjectDependency): DependencyStatus => {
    const rows = readRows(dependency)
    return { ...readBadges(dependency.name), unchecked: incomplete || rows.length === 0 || rows.some(({ result }) =>
      !result || result.behindWanted === null || result.behindLatest === null) }
  }
}

function compareNames(locale: string) {
  const collator = new Intl.Collator(locale)
  return (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}

function statusRank(status: DependencyStatus): number {
  return status.vulnerable ? 0 : status.outdated ? 1 : status.unchecked ? 2 : 3
}

export function selectDependencies(
  dependencies: readonly ProjectDependency[], job: ProjectAnalysisJob | null, query: string,
  sort: DependencySort, locale: string, filters: Readonly<DependencyFilters> = DEFAULT_DEPENDENCY_FILTERS
): ProjectDependency[] {
  const matchesText = createListTextMatcher(query)
  const readRows = createProjectDependencyRowsReader(job?.outdated.items ?? [])
  const readStatus = createDependencyStatusReader(job)
  const statuses = new Map<ProjectDependency, DependencyStatus>()
  const compareName = compareNames(locale)
  const selected = selectListItems(dependencies, dependency => {
    if (filters.groups.length && !dependency.declarations.some(row => filters.groups.includes(row.group))) return false
    const status = readStatus(dependency)
    if (filters.statuses.length && !filters.statuses.some(value => status[value])) return false
    statuses.set(dependency, status)
    // Group matching is package-level: keep every declaration and its associated versions.
    return matchesText(dependency.name, ...dependency.lockedVersions, ...readRows(dependency).flatMap(row => [
      row.spec, ...row.lockedVersions, row.result?.wanted, row.result?.latest,
    ]))
  })
  return selected.sort((a, b) => (sort === "status" ? statusRank(statuses.get(a)!) - statusRank(statuses.get(b)!) : 0)
    || compareName(a.name, b.name))
}

const severityOrder: Record<ProjectAdvisory["severity"], number> = {
  critical: 0, high: 1, moderate: 2, low: 3, info: 4, unknown: 5,
}

export function selectAdvisories(
  advisories: readonly ProjectAdvisory[], query: string, sort: AdvisorySort, locale: string,
  filters: Readonly<AdvisoryFilters> = DEFAULT_ADVISORY_FILTERS
): ProjectAdvisory[] {
  const matchesText = createListTextMatcher(query)
  const compareName = compareNames(locale)
  return selectListItems(advisories, advisory => (
    (!filters.severities.length || filters.severities.includes(advisory.severity))
    && (!filters.exposures.length || filters.exposures.includes(advisory.direct ? "direct" : "transitive"))
    && matchesText(advisory.name, advisory.title, advisory.range, advisory.id, ...advisory.affectedVersions)
  ), (a, b) => (sort === "severity" ? severityOrder[a.severity] - severityOrder[b.severity] : 0)
    || compareName(a.name, b.name) || compareName(a.id, b.id))
}

export function selectScripts<T extends ProjectScript>(
  scripts: readonly T[], query: string, locale: string, filters: Readonly<ScriptFilters> = DEFAULT_SCRIPT_FILTERS,
  context: RunnerContext | null = null
): T[] {
  const matchesText = createListTextMatcher(query)
  const compareName = compareNames(locale)
  const eligibility = new Map(context?.scripts.map(script => [script.name, script]) ?? [])
  return selectListItems(scripts, script => {
    if (!matchesText(script.name, script.command)) return false
    if (!filters.eligibilities.length) return true
    const evidence = eligibility.get(script.name)
    return evidence?.command === script.command
      && filters.eligibilities.includes(evidence.eligible ? "eligible" : "ineligible")
  }, (a, b) => compareName(a.name, b.name))
}
