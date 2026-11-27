import { createListTextMatcher } from "../ui/list-discovery.ts"
import type {
  ManagerCommandSuggestion,
  NodeCompatibilityStatus,
  NodeManagerId,
  NodeProjectSort,
  NodeRuntimeSummaryCounts,
  ProjectNodeCompatibility,
} from "./node-runtime-types.ts"

export const NODE_STATUS_ORDER: readonly NodeCompatibilityStatus[] = [
  "mismatch",
  "unknown",
  "compatible",
  "undeclared",
]

const STATUS_PRIORITY: Record<NodeCompatibilityStatus, number> = {
  mismatch: 0,
  unknown: 1,
  compatible: 2,
  undeclared: 3,
}

const MANAGER_PRIORITY: readonly NodeManagerId[] = [
  "nvm-windows",
  "fnm",
  "volta",
]

export function countNodeProjectsByStatus(
  projects: readonly ProjectNodeCompatibility[],
): NodeRuntimeSummaryCounts {
  const counts: NodeRuntimeSummaryCounts = {
    total: projects.length,
    compatible: 0,
    mismatch: 0,
    unknown: 0,
    undeclared: 0,
  }
  for (const project of projects) {
    counts[project.status] += 1
  }
  return counts
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" })
}

export function filterAndSortNodeProjects(
  projects: readonly ProjectNodeCompatibility[],
  options: {
    query: string
    statuses: readonly NodeCompatibilityStatus[]
    sort: NodeProjectSort
  },
): ProjectNodeCompatibility[] {
  const matchesText = createListTextMatcher(options.query)
  const statusSet =
    options.statuses.length > 0 ? new Set(options.statuses) : null

  const filtered = projects.filter((project) => {
    if (statusSet && !statusSet.has(project.status)) return false
    return matchesText(project.name, project.path) ||
      project.requirements.some((requirement) => matchesText(requirement.raw, requirement.source))
  })

  return filtered.sort((a, b) => {
    if (options.sort === "priority") {
      const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
      if (diff !== 0) return diff
    }

    const labelA = a.name ?? a.path
    const labelB = b.name ?? b.path
    const labelDiff = compareText(labelA, labelB)
    if (labelDiff !== 0) return labelDiff

    return compareText(a.path, b.path)
  })
}

export function pickPrimaryCommand(
  commands: readonly ManagerCommandSuggestion[],
): ManagerCommandSuggestion | null {
  for (const preferred of MANAGER_PRIORITY) {
    const found = commands.find((cmd) => cmd.managerId === preferred)
    if (found) return found
  }
  return commands[0] ?? null
}
