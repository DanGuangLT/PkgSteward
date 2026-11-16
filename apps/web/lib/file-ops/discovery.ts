import type { FileOpsTarget, FileOpsTargetResult, FileTreeEntry } from "@/lib/api/types"
import type { TreeLevel } from "@/hooks/use-file-tree"
import { createDiscoveryCodec, isEnumArray, isEnumValue } from "../ui/discovery-state.ts"
import { createListTextMatcher } from "../ui/list-discovery.ts"
import { sortCleanupTargets, sortOperationResults } from "./file-ops-list.ts"

export const TREE_KINDS = ["directory", "file", "link", "other"] as const
export const TARGET_KINDS = ["project", "node_modules", "orphan_node_modules", "build_cache", "project_content", "unknown"] as const
export const TARGET_VALIDITIES = ["valid", "invalid"] as const
export const TARGET_RISKS = ["low", "medium", "high"] as const
export const RESULT_STATUSES = ["pending", "running", "success", "failed", "not_started"] as const
export interface TreeDiscovery { query: string; kinds: readonly FileTreeEntry["type"][] }
export const TREE_DISCOVERY: TreeDiscovery = { query: "", kinds: [] }
export const treeDiscoveryCodec = createDiscoveryCodec(TREE_DISCOVERY, raw => isEnumArray(raw.kinds, TREE_KINDS))
export interface CleanupDiscovery { query: string; kinds: readonly (typeof TARGET_KINDS[number])[]; validities: readonly (typeof TARGET_VALIDITIES[number])[]; risks: readonly (typeof TARGET_RISKS[number])[]; sort: "size" | "age" }
export const CLEANUP_DISCOVERY: CleanupDiscovery = { query: "", kinds: [], validities: [], risks: [], sort: "size" }
export const cleanupDiscoveryCodec = createDiscoveryCodec(CLEANUP_DISCOVERY, raw => isEnumArray(raw.kinds, TARGET_KINDS)
  && isEnumArray(raw.validities, TARGET_VALIDITIES) && isEnumArray(raw.risks, TARGET_RISKS) && isEnumValue(raw.sort, ["size", "age"]))
export interface ResultDiscovery { query: string; kinds: readonly (typeof TARGET_KINDS[number])[]; statuses: readonly FileOpsTargetResult["status"][]; sort: "status" | "name" }
export const RESULT_DISCOVERY: ResultDiscovery = { query: "", kinds: [], statuses: [], sort: "status" }
export const resultDiscoveryCodec = createDiscoveryCodec(RESULT_DISCOVERY, raw => isEnumArray(raw.kinds, TARGET_KINDS)
  && isEnumArray(raw.statuses, RESULT_STATUSES) && isEnumValue(raw.sort, ["status", "name"]))
export function hiddenSelectedCount(selected: ReadonlySet<string>, visible: ReadonlySet<string>): number {
  let count = 0
  for (const path of selected) if (!visible.has(path)) count++
  return count
}
export function selectCleanupTargets(rows: readonly FileOpsTarget[], state: CleanupDiscovery, locale: string): FileOpsTarget[] {
  const matches = createListTextMatcher(state.query)
  return sortCleanupTargets(rows.filter(row => matches(row.path, row.owner?.name, row.owner?.path)
    && (!state.kinds.length || state.kinds.includes(row.kind ?? "unknown"))
    && (!state.validities.length || state.validities.includes(row.valid ? "valid" : "invalid"))
    && (!state.risks.length || state.risks.includes(row.risk.level))), state.sort, locale)
}
export function selectResults(rows: readonly FileOpsTargetResult[], state: ResultDiscovery, locale: string): FileOpsTargetResult[] {
  const matches = createListTextMatcher(state.query)
  const filtered = rows.filter(row => matches(row.path) && (!state.kinds.length || state.kinds.includes(row.kind))
    && (!state.statuses.length || state.statuses.includes(row.status)))
  return state.sort === "status" ? sortOperationResults(filtered) : filtered.sort((a, b) => a.path.localeCompare(b.path, locale))
}
export function selectLoadedTree(root: string, levels: ReadonlyMap<string, TreeLevel>, expanded: ReadonlySet<string>, state: TreeDiscovery) {
  const matches = createListTextMatcher(state.query)
  const active = state.query.trim() !== "" || state.kinds.length > 0
  const parents = new Map<string, string>(), matching = new Set<string>(), context = new Set<string>()
  const kindCounts: Record<FileTreeEntry["type"], number> = { directory: 0, file: 0, link: 0, other: 0 }
  let total = 0
  const pending = [root], visited = new Set<string>()
  while (pending.length) {
    const parent = pending.pop()!
    if (visited.has(parent)) continue
    visited.add(parent)
    const level = levels.get(parent)
    if (level?.status !== "ready") continue
    for (const entry of level.entries) {
      total++; kindCounts[entry.type]++
      parents.set(entry.path, parent)
      if (matches(entry.name, entry.path) && (!state.kinds.length || state.kinds.includes(entry.type))) matching.add(entry.path)
      if (entry.type === "directory" && levels.has(entry.path)) pending.push(entry.path)
    }
  }
  for (const path of matching) {
    let current: string | undefined = path
    const seen = new Set<string>()
    while (current && current !== root && !seen.has(current)) {
      context.add(current); seen.add(current); current = parents.get(current)
    }
  }
  const visiblePaths = new Set<string>()
  const visit = (parent: string) => {
    const level = levels.get(parent)
    if (level?.status !== "ready") return
    for (const entry of level.entries) if ((!active || context.has(entry.path)) && !visiblePaths.has(entry.path)) {
      visiblePaths.add(entry.path)
      if (entry.type === "directory" && (active || expanded.has(entry.path))) visit(entry.path)
    }
  }
  visit(root)
  return { visiblePaths, active, count: active ? matching.size : total, total, kindCounts }
}
