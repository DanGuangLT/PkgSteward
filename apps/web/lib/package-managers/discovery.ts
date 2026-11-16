import type { PmVersion } from "@/lib/package-managers/pm-types"
import { createDiscoveryCodec, isEnumArray } from "../ui/discovery-state.ts"
import { selectVersionOptions } from "../global-packages/discovery.ts"

export const VERSION_SUPPORT = ["supported", "unsupported"] as const
export const VERSION_DEPRECATION = ["deprecated", "active"] as const
export interface VersionDiscovery { query: string; support: readonly (typeof VERSION_SUPPORT[number])[]; deprecation: readonly (typeof VERSION_DEPRECATION[number])[] }
export const VERSION_DISCOVERY: VersionDiscovery = { query: "", support: ["supported"], deprecation: [] }
export const versionDiscoveryCodec = createDiscoveryCodec(VERSION_DISCOVERY, raw =>
  isEnumArray(raw.support, VERSION_SUPPORT) && isEnumArray(raw.deprecation, VERSION_DEPRECATION))
export function selectManagerVersions(rows: readonly PmVersion[], state: VersionDiscovery, tags: Record<string, string>, selected: string) {
  const filtered = rows.filter(row => (!state.support.length || state.support.includes(row.supported ? "supported" : "unsupported"))
    && (!state.deprecation.length || state.deprecation.includes(row.deprecated ? "deprecated" : "active")))
  const result = selectVersionOptions(filtered, state.query, tags, "")
  const selectedRow = rows.find(row => row.version === selected)
  const selectedHidden = !!selectedRow && !result.matches.includes(selectedRow)
  return { matches: result.matches, options: selectedHidden ? rows.filter(row => row === selectedRow || result.matches.includes(row)) : result.matches, selectedHidden }
}
