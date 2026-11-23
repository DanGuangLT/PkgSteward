import type { GlobalPackage } from "@/lib/global-packages/global-types"
import { createDiscoveryCodec, isEnumArray, isEnumValue } from "../ui/discovery-state.ts"
import { createListTextMatcher } from "../ui/list-discovery.ts"
import { newestGlobalVersions } from "./global-version-options.ts"

export const GLOBAL_STATUSES = ["manageable", "protected", "linked", "invalid"] as const
export interface GlobalDiscovery { query: string; statuses: readonly GlobalPackage["status"][]; sort: "name" | "version" }
export const GLOBAL_DISCOVERY: GlobalDiscovery = { query: "", statuses: [], sort: "name" }
export const globalDiscoveryCodec = createDiscoveryCodec(GLOBAL_DISCOVERY, raw =>
  isEnumArray(raw.statuses, GLOBAL_STATUSES) && isEnumValue(raw.sort, ["name", "version"]))
export function selectGlobalPackages(rows: readonly GlobalPackage[], state: GlobalDiscovery, locale: string): GlobalPackage[] {
  const matches = createListTextMatcher(state.query)
  const knownVersions = [...new Set(rows.map(row => row.version))].filter(version => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))
  const ranks = new Map(newestGlobalVersions(knownVersions).map((version, index) => [version, index]))
  return rows.filter(row => matches(row.name, row.version, ...row.bins.flatMap(bin => [bin.name, bin.target]))
    && (!state.statuses.length || state.statuses.includes(row.status)))
    .sort((a, b) => (state.sort === "version" ? (ranks.get(a.version) ?? ranks.size) - (ranks.get(b.version) ?? ranks.size) : 0)
      || a.name.localeCompare(b.name, locale) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
export function selectVersionOptions<T extends { version: string }>(
  rows: readonly T[], query: string, tags: Readonly<Record<string, string>>, selected: string
): { matches: T[]; options: T[]; selectedHidden: boolean } {
  const matchesText = createListTextMatcher(query)
  const tagsByVersion = new Map<string, string[]>()
  for (const [tag, version] of Object.entries(tags)) {
    const versionTags = tagsByVersion.get(version)
    if (versionTags) versionTags.push(tag)
    else tagsByVersion.set(version, [tag])
  }

  const matches = rows.filter(row => matchesText(row.version, ...(tagsByVersion.get(row.version) ?? [])))
  const selectedHidden = selected !== "" && !matches.some(row => row.version === selected) && rows.some(row => row.version === selected)
  if (!selectedHidden) return { matches, options: matches, selectedHidden }

  const matchedRows = new Set(matches)
  const options = rows.filter(row => row.version === selected || matchedRows.has(row))
  return { matches, options, selectedHidden }
}
