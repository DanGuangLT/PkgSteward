import type { ScannedProject } from "@/lib/api/types"

export type ProjectSort = "activity" | "name"

export const PROJECT_MANAGER_FILTERS = ["all", "npm", "pnpm", "yarn", "unknown"] as const
export const PROJECT_NODE_MODULES_FILTERS = ["all", "present", "missing"] as const
export const PROJECT_ACTIVITY_FILTERS = [
  "all", "within7d", "within30d", "within90d", "olderThan90d", "olderThan180d", "olderThan365d",
] as const

export type ProjectFilters = {
  manager: typeof PROJECT_MANAGER_FILTERS[number]
  nodeModules: typeof PROJECT_NODE_MODULES_FILTERS[number]
  activity: typeof PROJECT_ACTIVITY_FILTERS[number]
}

export const DEFAULT_PROJECT_FILTERS: ProjectFilters = {
  manager: "all",
  nodeModules: "all",
  activity: "all",
}

export type ProjectFilterCounts = {
  [Filter in keyof ProjectFilters]: Record<ProjectFilters[Filter], number>
}

const DAY_MS = 86_400_000

function matchesActivity(age: number, activity: ProjectFilters["activity"]): boolean {
  switch (activity) {
    case "all": return true
    case "within7d": return age <= 7 * DAY_MS
    case "within30d": return age <= 30 * DAY_MS
    case "within90d": return age <= 90 * DAY_MS
    case "olderThan90d": return age > 90 * DAY_MS
    case "olderThan180d": return age > 180 * DAY_MS
    case "olderThan365d": return age > 365 * DAY_MS
  }
}

export function matchesProjectFilters(
  project: ScannedProject,
  filters: ProjectFilters = DEFAULT_PROJECT_FILTERS,
  now = Date.now()
): boolean {
  if (filters.manager !== "all" && filters.manager !== (project.packageManager ?? "unknown")) return false
  if (filters.nodeModules !== "all" && project.nodeModules.exists !== (filters.nodeModules === "present")) return false
  return matchesActivity(now - Date.parse(project.lastActivityAt), filters.activity)
}

export function countProjectFilters(projects: readonly ScannedProject[], now = Date.now()): ProjectFilterCounts {
  const counts: ProjectFilterCounts = {
    manager: { all: projects.length, npm: 0, pnpm: 0, yarn: 0, unknown: 0 },
    nodeModules: { all: projects.length, present: 0, missing: 0 },
    activity: { all: 0, within7d: 0, within30d: 0, within90d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
  }

  for (const project of projects) {
    counts.manager[project.packageManager ?? "unknown"]++
    counts.nodeModules[project.nodeModules.exists ? "present" : "missing"]++
    const age = now - Date.parse(project.lastActivityAt)
    for (const activity of PROJECT_ACTIVITY_FILTERS) {
      if (matchesActivity(age, activity)) counts.activity[activity]++
    }
  }

  return counts
}

export function projectDisplayName(project: ScannedProject): string {
  return project.name ?? project.path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? ""
}

export function selectProjects(
  projects: readonly ScannedProject[],
  query: string,
  sort: ProjectSort,
  locale: string,
  filters: ProjectFilters = DEFAULT_PROJECT_FILTERS,
  now = Date.now()
): ScannedProject[] {
  const search = query.trim().toLowerCase()
  const collator = new Intl.Collator(locale)

  return projects.filter((project) => matchesProjectFilters(project, filters, now) && (
    projectDisplayName(project).toLowerCase().includes(search) ||
    project.path.toLowerCase().includes(search)
  )).sort((a, b) => {
    const order = sort === "activity"
      ? Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)
      : collator.compare(projectDisplayName(a), projectDisplayName(b))

    return order || collator.compare(a.path, b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  })
}
