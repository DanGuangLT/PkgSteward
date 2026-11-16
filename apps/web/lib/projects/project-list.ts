import type { ScannedProject } from "@/lib/api/types"

export type ProjectSort = "activity" | "name"

export const PROJECT_MANAGER_OPTIONS = ["npm", "pnpm", "yarn", "unknown"] as const
export const PROJECT_NODE_MODULES_OPTIONS = ["present", "missing"] as const
export const PROJECT_ACTIVITY_OPTIONS = [
  "within7d", "within30d", "within90d", "olderThan90d", "olderThan180d", "olderThan365d",
] as const

export type ProjectManagerOption = typeof PROJECT_MANAGER_OPTIONS[number]
export type ProjectNodeModulesOption = typeof PROJECT_NODE_MODULES_OPTIONS[number]
export type ProjectActivityOption = typeof PROJECT_ACTIVITY_OPTIONS[number]

export type ProjectFilters = {
  managers: ProjectManagerOption[]
  nodeModules: ProjectNodeModulesOption[]
  activities: ProjectActivityOption[]
}

export type LegacyProjectFilters = {
  manager?: ProjectManagerOption | "all"
  nodeModules?: ProjectNodeModulesOption | "all"
  activity?: ProjectActivityOption | "all"
}

export type ProjectFiltersInput = Partial<ProjectFilters> | LegacyProjectFilters

export const DEFAULT_PROJECT_FILTERS: ProjectFilters = {
  managers: [],
  nodeModules: [],
  activities: [],
}

export type ProjectFilterCounts = {
  managers: Record<ProjectManagerOption, number>
  nodeModules: Record<ProjectNodeModulesOption, number>
  activities: Record<ProjectActivityOption, number>
}

const DAY_MS = 86_400_000

function normalizeOptionList<Option extends string>(
  rawArray: unknown,
  legacyScalar: unknown,
  allowed: readonly Option[],
): Option[] {
  if (Array.isArray(rawArray)) {
    const seen = new Set<Option>()
    for (const item of rawArray) {
      if (typeof item === "string" && allowed.includes(item as Option)) {
        seen.add(item as Option)
      }
    }
    return [...seen]
  }
  if (typeof legacyScalar === "string") {
    if (legacyScalar === "all") return []
    if (allowed.includes(legacyScalar as Option)) return [legacyScalar as Option]
  }
  return []
}

/**
 * Normalizes multi-checkbox project filters and safely migrates legacy scalar shapes.
 */
export function normalizeProjectFilters(input: unknown): ProjectFilters {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { managers: [], nodeModules: [], activities: [] }
  }
  const raw = input as Record<string, unknown>
  return {
    managers: normalizeOptionList(raw.managers, raw.manager, PROJECT_MANAGER_OPTIONS),
    nodeModules: normalizeOptionList(
      raw.nodeModules,
      typeof raw.nodeModules === "string" ? raw.nodeModules : undefined,
      PROJECT_NODE_MODULES_OPTIONS,
    ),
    activities: normalizeOptionList(raw.activities, raw.activity, PROJECT_ACTIVITY_OPTIONS),
  }
}

function matchesActivity(age: number, activity: ProjectActivityOption): boolean {
  switch (activity) {
    case "within7d": return age <= 7 * DAY_MS
    case "within30d": return age <= 30 * DAY_MS
    case "within90d": return age <= 90 * DAY_MS
    case "olderThan90d": return age > 90 * DAY_MS
    case "olderThan180d": return age > 180 * DAY_MS
    case "olderThan365d": return age > 365 * DAY_MS
  }
}

function matchesNormalizedFilters(
  project: ScannedProject,
  filters: ProjectFilters,
  now: number,
): boolean {
  if (filters.managers.length > 0 && !filters.managers.includes(project.packageManager ?? "unknown")) return false
  const nmState: ProjectNodeModulesOption = project.nodeModules.exists ? "present" : "missing"
  if (filters.nodeModules.length > 0 && !filters.nodeModules.includes(nmState)) return false
  if (filters.activities.length > 0) {
    const age = now - Date.parse(project.lastActivityAt)
    if (!filters.activities.some((activity) => matchesActivity(age, activity))) return false
  }
  return true
}

export function matchesProjectFilters(
  project: ScannedProject,
  filters: ProjectFiltersInput = DEFAULT_PROJECT_FILTERS,
  now = Date.now(),
): boolean {
  return matchesNormalizedFilters(project, normalizeProjectFilters(filters), now)
}

export function countProjectFilters(projects: readonly ScannedProject[], now = Date.now()): ProjectFilterCounts {
  const counts: ProjectFilterCounts = {
    managers: { npm: 0, pnpm: 0, yarn: 0, unknown: 0 },
    nodeModules: { present: 0, missing: 0 },
    activities: { within7d: 0, within30d: 0, within90d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
  }

  for (const project of projects) {
    counts.managers[project.packageManager ?? "unknown"]++
    counts.nodeModules[project.nodeModules.exists ? "present" : "missing"]++
    const age = now - Date.parse(project.lastActivityAt)
    for (const activity of PROJECT_ACTIVITY_OPTIONS) {
      if (matchesActivity(age, activity)) counts.activities[activity]++
    }
  }

  return counts
}

export function projectDisplayName(project: ScannedProject): string {
  return project.name ?? project.path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? ""
}

const projectSearchText = (value: string) => value.normalize("NFC").toLowerCase()

function compareActivityNewestFirst(a: string, b: string): number {
  const aTime = Date.parse(a)
  const bTime = Date.parse(b)

  if (Number.isNaN(aTime)) return Number.isNaN(bTime) ? 0 : 1
  if (Number.isNaN(bTime)) return -1
  return bTime - aTime
}

export function selectProjects(
  projects: readonly ScannedProject[],
  query: string,
  sort: ProjectSort,
  locale: string,
  filters: ProjectFiltersInput = DEFAULT_PROJECT_FILTERS,
  now = Date.now()
): ScannedProject[] {
  const search = projectSearchText(query.trim())
  const collator = new Intl.Collator(locale)
  const normalizedFilters = normalizeProjectFilters(filters)

  return projects.filter((project) => matchesNormalizedFilters(project, normalizedFilters, now) && (
    search === "" || projectSearchText(projectDisplayName(project)).includes(search) ||
    projectSearchText(project.path).includes(search)
  )).sort((a, b) => {
    const order = sort === "activity"
      ? compareActivityNewestFirst(a.lastActivityAt, b.lastActivityAt)
      : collator.compare(projectDisplayName(a), projectDisplayName(b))

    return order || collator.compare(a.path, b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  })
}
