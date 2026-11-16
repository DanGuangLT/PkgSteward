import type { DiskUsageRow } from "@/lib/api/types"
import { createDiscoveryCodec, isEnumArray, isEnumValue } from "../ui/discovery-state.ts"
import { createListTextMatcher } from "../ui/list-discovery.ts"
import { sortDiskRows } from "./disk-usage-list.ts"

export const DISK_KINDS = ["file", "directory", "link", "package"] as const
export const DISK_STATES = ["pending", "measuring", "complete", "partial", "excluded"] as const
export interface DiskDiscovery { query: string; kinds: readonly DiskUsageRow["kind"][]; states: readonly DiskUsageRow["state"][]; minSize: string; sort: "size" | "name" }
export const DISK_DISCOVERY: DiskDiscovery = { query: "", kinds: [], states: [], minSize: "", sort: "size" }
export const diskDiscoveryCodec = createDiscoveryCodec(DISK_DISCOVERY, raw =>
  isEnumArray(raw.kinds, DISK_KINDS) && isEnumArray(raw.states, DISK_STATES) && isEnumValue(raw.sort, ["size", "name"])
  && typeof raw.minSize === "string" && (raw.minSize === "" || (/^\d{1,15}$/.test(raw.minSize) && Number.isSafeInteger(Number(raw.minSize)))))
export function selectDiskRows(rows: readonly DiskUsageRow[], state: DiskDiscovery, locale: string): DiskUsageRow[] {
  const matches = createListTextMatcher(state.query)
  const selected = rows.filter(row => matches(row.name, row.path, ...row.aliases)
    && (!state.kinds.length || state.kinds.includes(row.kind)) && (!state.states.length || state.states.includes(row.state))
    && (state.minSize === "" || (row.sizeBytes !== null && row.sizeBytes >= Number(state.minSize))))
  return state.sort === "size" ? sortDiskRows(selected, locale)
    : selected.sort((a, b) => a.name.localeCompare(b.name, locale) || a.path.localeCompare(b.path, locale))
}
