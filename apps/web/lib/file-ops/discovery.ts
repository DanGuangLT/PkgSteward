import type { FileOpsTarget, FileOpsTargetResult, FileTreeEntry } from "@/lib/api/types"
import type { TreeLevel } from "@/hooks/use-file-tree"
import type { ViewStateCodec } from "@/lib/ui/navigation-targets"
import { createDiscoveryCodec, isEnumArray, isEnumValue } from "../ui/discovery-state.ts"
import { createListTextMatcher } from "../ui/list-discovery.ts"
import {
  defaultCleanupSortDirection, sortCleanupTargets, sortOperationResults,
  type CleanupSort, type CleanupSortDirection,
} from "./file-ops-list.ts"

export const TREE_KINDS = ["directory", "file", "link", "other"] as const
export const TARGET_KINDS = ["project", "node_modules", "orphan_node_modules", "build_cache", "project_content", "unknown"] as const
export const TARGET_VALIDITIES = ["valid", "invalid"] as const
export const TARGET_RISKS = ["low", "medium", "high"] as const
export const TARGET_LOCKFILES = ["with", "without"] as const
export const CLEANUP_SORTS = ["size", "age", "risk", "name"] as const
export const CLEANUP_SORT_DIRS = ["asc", "desc"] as const
export const CLEANUP_VIEW_MODES = ["list", "grouped"] as const
export const RESULT_STATUSES = ["pending", "running", "success", "failed", "not_started"] as const

export interface TreeDiscovery { query: string; kinds: readonly FileTreeEntry["type"][] }
export const TREE_DISCOVERY: TreeDiscovery = { query: "", kinds: [] }
export const treeDiscoveryCodec = createDiscoveryCodec(TREE_DISCOVERY, raw => isEnumArray(raw.kinds, TREE_KINDS))

export interface CleanupDiscovery {
  query: string
  kinds: readonly (typeof TARGET_KINDS[number])[]
  validities: readonly (typeof TARGET_VALIDITIES[number])[]
  risks: readonly (typeof TARGET_RISKS[number])[]
  lockfiles: readonly (typeof TARGET_LOCKFILES[number])[]
  selectedOnly: boolean
  sort: CleanupSort
  sortDir: CleanupSortDirection
  viewMode: (typeof CLEANUP_VIEW_MODES)[number]
}

export const CLEANUP_DISCOVERY: CleanupDiscovery = {
  query: "",
  kinds: [],
  validities: [],
  risks: [],
  lockfiles: [],
  selectedOnly: false,
  sort: "size",
  sortDir: "desc",
  viewMode: "list",
}

const ALLOWED_CLEANUP_KEYS = new Set(Object.keys(CLEANUP_DISCOVERY))

function decodeCleanupDiscovery(value: unknown): CleanupDiscovery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).some((key) => !ALLOWED_CLEANUP_KEYS.has(key))) return null
  if (typeof raw.query !== "string" || raw.query.length > 512) return null
  if (!isEnumArray(raw.kinds, TARGET_KINDS)) return null
  if (!isEnumArray(raw.validities, TARGET_VALIDITIES)) return null
  if (!isEnumArray(raw.risks, TARGET_RISKS)) return null
  if (!isEnumValue(raw.sort, CLEANUP_SORTS)) return null

  const lockfiles = raw.lockfiles === undefined ? [] : raw.lockfiles
  if (!isEnumArray(lockfiles, TARGET_LOCKFILES)) return null

  const selectedOnly = raw.selectedOnly === undefined ? false : raw.selectedOnly
  if (typeof selectedOnly !== "boolean") return null

  const sortDir = raw.sortDir === undefined ? defaultCleanupSortDirection(raw.sort) : raw.sortDir
  if (!isEnumValue(sortDir, CLEANUP_SORT_DIRS)) return null

  const viewMode = raw.viewMode === undefined ? "list" : raw.viewMode
  if (!isEnumValue(viewMode, CLEANUP_VIEW_MODES)) return null

  return {
    query: raw.query,
    kinds: [...raw.kinds],
    validities: [...raw.validities],
    risks: [...raw.risks],
    lockfiles: [...lockfiles],
    selectedOnly,
    sort: raw.sort,
    sortDir,
    viewMode,
  }
}

export const cleanupDiscoveryCodec: ViewStateCodec<CleanupDiscovery> = {
  version: 2,
  decode: decodeCleanupDiscovery,
  encode: (value) => decodeCleanupDiscovery(value) ?? structuredClone(CLEANUP_DISCOVERY),
}

export interface ResultDiscovery { query: string; kinds: readonly (typeof TARGET_KINDS[number])[]; statuses: readonly FileOpsTargetResult["status"][]; sort: "status" | "name" }
export const RESULT_DISCOVERY: ResultDiscovery = { query: "", kinds: [], statuses: [], sort: "status" }
export const resultDiscoveryCodec = createDiscoveryCodec(RESULT_DISCOVERY, raw => isEnumArray(raw.kinds, TARGET_KINDS)
  && isEnumArray(raw.statuses, RESULT_STATUSES) && isEnumValue(raw.sort, ["status", "name"]))

export function hiddenSelectedCount(selected: ReadonlySet<string>, visible: ReadonlySet<string>): number {
  let count = 0
  for (const path of selected) if (!visible.has(path)) count++
  return count
}

export function selectCleanupTargets(
  rows: readonly FileOpsTarget[],
  state: CleanupDiscovery,
  locale: string,
  selected?: ReadonlySet<string>,
): FileOpsTarget[] {
  const matches = createListTextMatcher(state.query)
  const lockfiles = state.lockfiles ?? []
  const sortDir = state.sortDir ?? defaultCleanupSortDirection(state.sort)
  const filtered = rows.filter((row) => {
    if (!matches(row.path, row.owner?.name, row.owner?.path)) return false
    if (state.kinds.length && !state.kinds.includes(row.kind ?? "unknown")) return false
    if (state.validities.length && !state.validities.includes(row.valid ? "valid" : "invalid")) return false
    if (state.risks.length && !state.risks.includes(row.risk.level)) return false
    if (lockfiles.length) {
      const lockState = row.hasLockfile === true ? "with" : row.hasLockfile === false ? "without" : null
      if (lockState === null || !lockfiles.includes(lockState)) return false
    }
    if (state.selectedOnly && selected && !selected.has(row.path)) return false
    return true
  })
  return sortCleanupTargets(filtered, state.sort, locale, sortDir)
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
