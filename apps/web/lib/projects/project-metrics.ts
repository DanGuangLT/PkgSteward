import type { ProjectAnalysisJob, ProjectDetail, ScannedProject } from "@/lib/api/types"

const DAY_MS = 86_400_000
export const INACTIVE_QUICK_DAYS = 30

export const PROJECT_QUICK_VIEWS = ["all", "has_node_modules", "missing_lockfile", "inactive_30d"] as const
export type ProjectQuickView = typeof PROJECT_QUICK_VIEWS[number]

export interface ProjectListMetrics {
  totalProjects: number
  withNodeModulesCount: number
  measuredNodeModulesCount: number
  knownNodeModulesBytes: number
  maxNodeModulesBytes: number
  orphanCount: number
  missingLockfileCount: number
  inactiveOver30dCount: number
  attentionCount: number
}

export interface ProjectDetailMetrics {
  dependencyCount: number
  scriptCount: number
  outdatedCount: number | null
  advisoryCount: number | null
  criticalOrHighAdvisoryCount: number
}

function isInactiveOverDays(lastActivityAt: string, days: number, now: number): boolean {
  const parsed = Date.parse(lastActivityAt)
  if (Number.isNaN(parsed)) return false
  return now - parsed > days * DAY_MS
}

export function computeProjectListMetrics(
  projects: readonly ScannedProject[],
  orphanCount: number,
  now = Date.now(),
): ProjectListMetrics {
  let withNodeModulesCount = 0
  let measuredNodeModulesCount = 0
  let knownNodeModulesBytes = 0
  let maxNodeModulesBytes = 0
  let missingLockfileCount = 0
  let inactiveOver30dCount = 0
  let attentionCount = 0

  for (const project of projects) {
    if (project.nodeModules.exists) {
      withNodeModulesCount += 1
      if (project.nodeModules.sizeBytes !== null) {
        measuredNodeModulesCount += 1
        knownNodeModulesBytes += project.nodeModules.sizeBytes
        if (project.nodeModules.sizeBytes > maxNodeModulesBytes) {
          maxNodeModulesBytes = project.nodeModules.sizeBytes
        }
      }
    }
    const missingLockfile = !project.hasLockfile
    const stale = isInactiveOverDays(project.lastActivityAt, INACTIVE_QUICK_DAYS, now)
    if (missingLockfile) missingLockfileCount += 1
    if (stale) inactiveOver30dCount += 1
    if (missingLockfile || stale) attentionCount += 1
  }

  return {
    totalProjects: projects.length,
    withNodeModulesCount,
    measuredNodeModulesCount,
    knownNodeModulesBytes,
    maxNodeModulesBytes,
    orphanCount,
    missingLockfileCount,
    inactiveOver30dCount,
    attentionCount,
  }
}

export function filterProjectsByQuickView(
  projects: readonly ScannedProject[],
  quickView: ProjectQuickView,
  now = Date.now(),
): ScannedProject[] {
  switch (quickView) {
    case "all":
      return [...projects]
    case "has_node_modules":
      return projects.filter((project) => project.nodeModules.exists)
    case "missing_lockfile":
      return projects.filter((project) => !project.hasLockfile)
    case "inactive_30d":
      return projects.filter((project) => isInactiveOverDays(project.lastActivityAt, INACTIVE_QUICK_DAYS, now))
  }
}

export function computeProjectDetailMetrics(
  detail: ProjectDetail,
  job: ProjectAnalysisJob | null,
): ProjectDetailMetrics {
  let outdatedCount: number | null = null
  let advisoryCount: number | null = null
  let criticalOrHighAdvisoryCount = 0

  if (job) {
    if (job.outdated.state !== "unavailable" && job.outdated.state !== "pending") {
      outdatedCount = job.outdated.items.filter(
        (item) => item.behindLatest === true || item.behindWanted === true,
      ).length
    }
    if (job.audit.state !== "unavailable" && job.audit.state !== "pending") {
      advisoryCount = job.audit.items.length
      criticalOrHighAdvisoryCount = job.audit.items.filter(
        (item) => item.severity === "critical" || item.severity === "high",
      ).length
    }
  }

  return {
    dependencyCount: detail.dependencies.length,
    scriptCount: detail.scripts.length,
    outdatedCount,
    advisoryCount,
    criticalOrHighAdvisoryCount,
  }
}

export function analysisProgressPercent(
  job: Pick<ProjectAnalysisJob, "status" | "phase"> & {
    outdated: Pick<ProjectAnalysisJob["outdated"], "checkedCount" | "totalCount">
  } | null,
): number | null {
  if (!job || job.status !== "running") return null
  switch (job.phase) {
    case "reading":
      return 15
    case "outdated": {
      const total = job.outdated.totalCount
      if (total !== null && total > 0) {
        const ratio = Math.min(1, Math.max(0, job.outdated.checkedCount / total))
        return Math.round(20 + ratio * 45)
      }
      return 40
    }
    case "audit":
      return 80
    case "validating":
      return 95
    case "done":
      return 100
  }
}
