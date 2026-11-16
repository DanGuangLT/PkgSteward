import { createDiscoveryCodec, isEnumArray, isEnumValue } from "../ui/discovery-state.ts"
import {
  DEFAULT_DEPENDENCY_FILTERS, DEFAULT_ADVISORY_FILTERS, DEPENDENCY_GROUP_FILTERS, DEPENDENCY_STATUS_FILTERS,
  ADVISORY_SEVERITY_FILTERS, ADVISORY_EXPOSURE_FILTERS,
} from "./detail-filters.ts"
import type { DependencyFilters, DependencySort, AdvisoryFilters, AdvisorySort } from "@/lib/projects/detail-filters"

export const DEPENDENCY_DISCOVERY: DependencyFilters & { query: string; sort: DependencySort } = {
  query: "", sort: "name", ...DEFAULT_DEPENDENCY_FILTERS,
}
export const dependencyDiscoveryCodec = createDiscoveryCodec(DEPENDENCY_DISCOVERY, raw =>
  isEnumArray(raw.groups, DEPENDENCY_GROUP_FILTERS) && isEnumArray(raw.statuses, DEPENDENCY_STATUS_FILTERS)
  && isEnumValue(raw.sort, ["name", "status"]))
export const ADVISORY_DISCOVERY: AdvisoryFilters & { query: string; sort: AdvisorySort } = {
  query: "", sort: "severity", ...DEFAULT_ADVISORY_FILTERS,
}
export const advisoryDiscoveryCodec = createDiscoveryCodec(ADVISORY_DISCOVERY, raw =>
  isEnumArray(raw.severities, ADVISORY_SEVERITY_FILTERS) && isEnumArray(raw.exposures, ADVISORY_EXPOSURE_FILTERS)
  && isEnumValue(raw.sort, ["severity", "name"]))
