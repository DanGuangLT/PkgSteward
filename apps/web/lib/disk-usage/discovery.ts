import type { DiskUsageRow } from "@/lib/api/types"
import { createDiscoveryCodec, isEnumArray, isEnumValue } from "../ui/discovery-state.ts"
import { createListTextMatcher } from "../ui/list-discovery.ts"
import { sortDiskRows } from "./disk-usage-list.ts"

export const DISK_KINDS = ["file", "directory", "link", "package"] as const
export const DISK_STATES = ["pending", "measuring", "complete", "partial", "excluded"] as const
export const DISK_SORTS = ["size", "name", "files"] as const
export const DISK_SORT_DIRS = ["asc", "desc"] as const

export type DiskSort = typeof DISK_SORTS[number]
export type DiskSortDirection = typeof DISK_SORT_DIRS[number]

export interface DiskDiscovery {
  query: string
  kinds: readonly DiskUsageRow["kind"][]
  states: readonly DiskUsageRow["state"][]
  minSize: string
  sort: DiskSort
  sortDir: DiskSortDirection
}

export function defaultDiskSortDirection(sort: DiskSort): DiskSortDirection {
  return sort === "name" ? "asc" : "desc"
}

export const DISK_DISCOVERY: DiskDiscovery = {
  query: "",
  kinds: [],
  states: [],
  minSize: "",
  sort: "size",
  sortDir: "desc",
}

export const diskDiscoveryCodec = createDiscoveryCodec(DISK_DISCOVERY, raw =>
  isEnumArray(raw.kinds, DISK_KINDS)
  && isEnumArray(raw.states, DISK_STATES)
  && isEnumValue(raw.sort, DISK_SORTS)
  && isEnumValue(raw.sortDir, DISK_SORT_DIRS)
  && typeof raw.minSize === "string"
  && (raw.minSize === "" || (/^\d{1,15}$/.test(raw.minSize) && Number.isSafeInteger(Number(raw.minSize)))))

function compareNullableNumber(a: number | null, b: number | null, dir: DiskSortDirection): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return dir === "desc" ? b - a : a - b
}

export function selectDiskRows(rows: readonly DiskUsageRow[], state: DiskDiscovery, locale: string): DiskUsageRow[] {
  const matches = createListTextMatcher(state.query)
  const selected = rows.filter(row => matches(row.name, row.path, ...row.aliases)
    && (!state.kinds.length || state.kinds.includes(row.kind))
    && (!state.states.length || state.states.includes(row.state))
    && (state.minSize === "" || (row.sizeBytes !== null && row.sizeBytes >= Number(state.minSize))))
  const dir = state.sortDir ?? defaultDiskSortDirection(state.sort)

  if (state.sort === "size" && dir === "desc") {
    return sortDiskRows(selected, locale)
  }

  return [...selected].sort((a, b) => {
    let order = 0
    if (state.sort === "size") {
      order = compareNullableNumber(a.sizeBytes, b.sizeBytes, dir)
    } else if (state.sort === "files") {
      order = compareNullableNumber(a.fileCount, b.fileCount, dir)
    } else {
      const cmp = a.name.localeCompare(b.name, locale)
      order = dir === "asc" ? cmp : -cmp
    }
    return order || a.name.localeCompare(b.name, locale) || a.path.localeCompare(b.path, locale)
  })
}
