import type { DiskView } from "@/lib/api/types"
import {
  DEFAULT_PROJECT_FILTERS,
  PROJECT_ACTIVITY_OPTIONS,
  PROJECT_MANAGER_OPTIONS,
  PROJECT_NODE_MODULES_OPTIONS,
  type ProjectFilters,
  type ProjectSort,
} from "../projects/project-list.ts"

export const RETURN_TO_PARAM = "returnTo"
export const ORIGIN_ENTRY_PARAM = "origin"
export const MAX_QUERY_LENGTH = 512
export const MAX_RETURN_URL_LENGTH = 4096

export const ALLOWED_INTERNAL_ROUTES: readonly string[] = [
  "/",
  "/projects",
  "/disk-usage",
  "/files",
  "/cleanup",
  "/global-packages",
  "/design-system",
]

const ALLOWED_ROUTE_SET = new Set<string>(ALLOWED_INTERNAL_ROUTES)
const ORIGIN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/

export type NavigationResourceKey = string | null | undefined

export interface ViewStateCodec<T> {
  readonly version: number
  encode(value: T): unknown
  decode(raw: unknown): T | null
  equals?(a: T, b: T): boolean
}

export interface ResolvedReturnTarget {
  href: string
  originId: string | null
  isFallback: boolean
}

export interface ProjectListViewState {
  query: string
  sort: ProjectSort
  filters: ProjectFilters
}

export interface DiskUsagePrefsState {
  path: string
  view: DiskView
  hasMeasuredRef: boolean
  ancestorCount: number
}

export const DEFAULT_PROJECT_LIST_VIEW_STATE: ProjectListViewState = {
  query: "",
  sort: "activity",
  filters: DEFAULT_PROJECT_FILTERS,
}

export function normalizeResourceKey(resource?: NavigationResourceKey): string {
  return typeof resource === "string" ? resource.trim() : ""
}

export function makeViewStateKey(screen: string, resource?: NavigationResourceKey): string {
  return `${screen}::${normalizeResourceKey(resource)}`
}

export function clampSearchQuery(value: string, maxLength = MAX_QUERY_LENGTH): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

export function validateOriginEntryId(value: unknown): string | null {
  return typeof value === "string" && ORIGIN_ID_PATTERN.test(value) ? value : null
}

function validateReturnTargetAtDepth(raw: unknown, depth: number): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RETURN_URL_LENGTH) return null
  if (CONTROL_CHAR_PATTERN.test(raw)) return null
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null

  const pathPart = raw.split(/[?#]/, 1)[0]
  if (pathPart.includes("\\")) return null

  let url: URL
  try {
    url = new URL(raw, "http://127.0.0.1")
  } catch {
    return null
  }

  if (url.origin !== "http://127.0.0.1" || url.username !== "" || url.password !== "") return null
  if (!ALLOWED_ROUTE_SET.has(url.pathname)) return null

  url.hash = ""
  if (url.searchParams.has(RETURN_TO_PARAM)) {
    if (depth >= 1) {
      url.searchParams.delete(RETURN_TO_PARAM)
      url.searchParams.delete(ORIGIN_ENTRY_PARAM)
    } else {
      const nested = validateReturnTargetAtDepth(url.searchParams.get(RETURN_TO_PARAM), depth + 1)
      if (nested === null) {
        url.searchParams.delete(RETURN_TO_PARAM)
        url.searchParams.delete(ORIGIN_ENTRY_PARAM)
      } else {
        url.searchParams.set(RETURN_TO_PARAM, nested)
        const nestedOrigin = validateOriginEntryId(url.searchParams.get(ORIGIN_ENTRY_PARAM))
        if (nestedOrigin === null) url.searchParams.delete(ORIGIN_ENTRY_PARAM)
        else url.searchParams.set(ORIGIN_ENTRY_PARAM, nestedOrigin)
      }
    }
  }

  let normalized = `${url.pathname}${url.search}`
  if (normalized.length > MAX_RETURN_URL_LENGTH) {
    url.searchParams.delete(RETURN_TO_PARAM)
    url.searchParams.delete(ORIGIN_ENTRY_PARAM)
    normalized = `${url.pathname}${url.search}`
  }

  return normalized.length <= MAX_RETURN_URL_LENGTH ? normalized : null
}

export function validateReturnTarget(raw: unknown): string | null {
  return validateReturnTargetAtDepth(raw, 0)
}

export function appendReturnContext(
  href: string,
  context: { returnTo?: string | null; originId?: string | null },
): string {
  const baseHref = validateReturnTarget(href)
  if (baseHref === null) return "/"

  const url = new URL(baseHref, "http://127.0.0.1")
  const safeReturnTo = validateReturnTarget(context.returnTo)
  const safeOrigin = validateOriginEntryId(context.originId)

  if (safeReturnTo !== null && safeReturnTo !== baseHref) {
    url.searchParams.set(RETURN_TO_PARAM, safeReturnTo)
    if (safeOrigin !== null) url.searchParams.set(ORIGIN_ENTRY_PARAM, safeOrigin)
  }

  let result = `${url.pathname}${url.search}`
  if (result.length > MAX_RETURN_URL_LENGTH && safeReturnTo !== null) {
    const innerUrl = new URL(safeReturnTo, "http://127.0.0.1")
    innerUrl.searchParams.delete(RETURN_TO_PARAM)
    innerUrl.searchParams.delete(ORIGIN_ENTRY_PARAM)
    const trimmedReturnTo = `${innerUrl.pathname}${innerUrl.search}`
    if (trimmedReturnTo !== baseHref) {
      url.searchParams.set(RETURN_TO_PARAM, trimmedReturnTo)
      result = `${url.pathname}${url.search}`
    }
    if (result.length > MAX_RETURN_URL_LENGTH) {
      url.searchParams.delete(RETURN_TO_PARAM)
      url.searchParams.delete(ORIGIN_ENTRY_PARAM)
      result = `${url.pathname}${url.search}`
    }
  }

  return result
}

type SearchInput =
  | string
  | URLSearchParams
  | { returnTo?: string | string[]; origin?: string | string[] }
  | null
  | undefined

function readSingleParam(input: SearchInput, key: string): string | null {
  if (!input) return null
  if (typeof input === "string") {
    return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input).get(key)
  }
  if (input instanceof URLSearchParams) return input.get(key)
  const raw = key === RETURN_TO_PARAM ? input.returnTo : input.origin
  return typeof raw === "string" ? raw : null
}

export function resolveReturnTarget(
  input: SearchInput,
  fallback: string,
  currentUrl?: string | null,
): ResolvedReturnTarget {
  const safeFallback = validateReturnTarget(fallback) ?? "/"
  const rawReturnTo = readSingleParam(input, RETURN_TO_PARAM)
  const safeReturnTo = validateReturnTarget(rawReturnTo)
  const safeCurrent = currentUrl ? validateReturnTarget(currentUrl) : null

  if (safeReturnTo === null || (safeCurrent !== null && safeReturnTo === safeCurrent)) {
    return { href: safeFallback, originId: null, isFallback: true }
  }

  return {
    href: safeReturnTo,
    originId: validateOriginEntryId(readSingleParam(input, ORIGIN_ENTRY_PARAM)),
    isFallback: false,
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function matchEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : null
}

export function createEnumCodec<T extends string>(version: number, allowed: readonly T[]): ViewStateCodec<T> {
  return {
    version,
    encode: (value) => value,
    decode: (raw) => matchEnum(raw, allowed),
  }
}

export function createTextCodec(version: number, maxLength = MAX_QUERY_LENGTH): ViewStateCodec<string> {
  return {
    version,
    encode: (value) => clampSearchQuery(value, maxLength),
    decode: (raw) => (typeof raw === "string" ? clampSearchQuery(raw, maxLength) : null),
  }
}

function decodeOptionArray<T extends string>(raw: unknown, allowed: readonly T[]): T[] | null {
  if (!Array.isArray(raw)) return null
  const seen = new Set<T>()
  for (const item of raw) {
    const matched = matchEnum(item, allowed)
    if (matched === null) return null
    seen.add(matched)
  }
  return [...seen]
}

function decodeLegacyScalarOption<T extends string>(raw: unknown, allowed: readonly T[]): T[] | null {
  if (typeof raw !== "string") return null
  if (raw === "all") return []
  const matched = matchEnum(raw, allowed)
  return matched !== null ? [matched] : []
}

export const projectListViewCodec: ViewStateCodec<ProjectListViewState> = {
  version: 1,
  encode(value) {
    return {
      query: clampSearchQuery(value.query),
      sort: value.sort,
      filters: {
        managers: decodeOptionArray(value.filters.managers, PROJECT_MANAGER_OPTIONS) ?? [],
        nodeModules: decodeOptionArray(value.filters.nodeModules, PROJECT_NODE_MODULES_OPTIONS) ?? [],
        activities: decodeOptionArray(value.filters.activities, PROJECT_ACTIVITY_OPTIONS) ?? [],
      },
    }
  },
  decode(raw) {
    if (!isPlainRecord(raw)) return null
    if (typeof raw.query !== "string") return null
    const sort = matchEnum(raw.sort, ["activity", "name"] as const)
    if (sort === null || !isPlainRecord(raw.filters)) return null

    const rawFilters = raw.filters
    const usesArrayShape = "managers" in rawFilters
      || "activities" in rawFilters
      || Array.isArray(rawFilters.nodeModules)

    const managers = usesArrayShape
      ? decodeOptionArray(rawFilters.managers, PROJECT_MANAGER_OPTIONS)
      : decodeLegacyScalarOption(rawFilters.manager, PROJECT_MANAGER_OPTIONS)
    const nodeModules = usesArrayShape
      ? decodeOptionArray(rawFilters.nodeModules, PROJECT_NODE_MODULES_OPTIONS)
      : decodeLegacyScalarOption(rawFilters.nodeModules, PROJECT_NODE_MODULES_OPTIONS)
    const activities = usesArrayShape
      ? decodeOptionArray(rawFilters.activities, PROJECT_ACTIVITY_OPTIONS)
      : decodeLegacyScalarOption(rawFilters.activity, PROJECT_ACTIVITY_OPTIONS)

    if (managers === null || nodeModules === null || activities === null) return null

    return {
      query: clampSearchQuery(raw.query),
      sort,
      filters: { managers, nodeModules, activities },
    }
  },
}

export type ProjectListUrlOverrides = {
  query?: string
  sort?: ProjectSort
  filters?: Partial<ProjectFilters>
}

export type ProjectListSearchInput =
  | string
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined

function toSearchParams(input: ProjectListSearchInput): URLSearchParams {
  if (!input) return new URLSearchParams()
  if (input instanceof URLSearchParams) return new URLSearchParams(input)
  if (typeof input === "string") {
    return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input)
  }
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") params.append(key, value)
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") params.append(key, item)
      }
    }
  }
  return params
}

function readFilterParam<T extends string>(
  params: URLSearchParams,
  keys: readonly string[],
  allowed: readonly T[],
): T[] | undefined {
  const key = keys.find((candidate) => params.has(candidate))
  if (!key) return undefined
  const tokens = params
    .getAll(key)
    .flatMap((entry) => entry.split(","))
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
  if (tokens.length === 0) return undefined
  if (tokens.length === 1 && tokens[0] === "all") return []

  const seen = new Set<T>()
  for (const token of tokens) {
    const matched = matchEnum(token, allowed)
    if (matched !== null) seen.add(matched)
  }
  return seen.size > 0 ? [...seen] : undefined
}

export function readProjectListUrlOverrides(input: ProjectListSearchInput): ProjectListUrlOverrides {
  const params = toSearchParams(input)
  const overrides: ProjectListUrlOverrides = {}

  if (params.has("q")) {
    overrides.query = clampSearchQuery(params.get("q") ?? "")
  }
  const sort = matchEnum(params.get("sort"), ["activity", "name"] as const)
  if (sort !== null) overrides.sort = sort

  const filters: Partial<ProjectFilters> = {}
  const managers = readFilterParam(params, ["managers", "manager"], PROJECT_MANAGER_OPTIONS)
  const nodeModules = readFilterParam(params, ["nodeModules"], PROJECT_NODE_MODULES_OPTIONS)
  const activities = readFilterParam(params, ["activities", "activity"], PROJECT_ACTIVITY_OPTIONS)
  if (managers !== undefined) filters.managers = managers
  if (nodeModules !== undefined) filters.nodeModules = nodeModules
  if (activities !== undefined) filters.activities = activities

  if (Object.keys(filters).length > 0) overrides.filters = filters
  return overrides
}

export function mergeProjectListUrlOverrides(
  stored: ProjectListViewState,
  overrides: ProjectListUrlOverrides,
): ProjectListViewState {
  const merged = {
    ...stored.filters,
    ...(overrides.filters ?? {}),
  }
  return {
    query: overrides.query ?? stored.query,
    sort: overrides.sort ?? stored.sort,
    filters: {
      managers: [...merged.managers],
      nodeModules: [...merged.nodeModules],
      activities: [...merged.activities],
    },
  }
}

export function formatProjectListUrl(
  pathname: string,
  state: ProjectListViewState,
  existingSearch?: string,
): string {
  const params = toSearchParams(existingSearch)
  const query = clampSearchQuery(state.query)
  if (query === "") params.delete("q")
  else params.set("q", query)

  if (state.sort === DEFAULT_PROJECT_LIST_VIEW_STATE.sort) params.delete("sort")
  else params.set("sort", state.sort)

  params.delete("manager")
  const managers = decodeOptionArray(state.filters.managers, PROJECT_MANAGER_OPTIONS) ?? []
  if (managers.length === 0) params.delete("managers")
  else params.set("managers", managers.join(","))

  const nodeModules = decodeOptionArray(state.filters.nodeModules, PROJECT_NODE_MODULES_OPTIONS) ?? []
  if (nodeModules.length === 0) params.delete("nodeModules")
  else params.set("nodeModules", nodeModules.join(","))

  params.delete("activity")
  const activities = decodeOptionArray(state.filters.activities, PROJECT_ACTIVITY_OPTIONS) ?? []
  if (activities.length === 0) params.delete("activities")
  else params.set("activities", activities.join(","))

  const serialized = params.toString()
  return serialized ? `${pathname}?${serialized}` : pathname
}

export const PROJECT_DETAIL_TABS = ["overview", "files", "disk"] as const
export type ProjectDetailTab = typeof PROJECT_DETAIL_TABS[number]
export const projectDetailTabCodec = createEnumCodec<ProjectDetailTab>(1, PROJECT_DETAIL_TABS)

export const diskUsagePrefsCodec: ViewStateCodec<DiskUsagePrefsState> = {
  version: 1,
  encode(value) {
    return {
      path: value.path.slice(0, 32768),
      view: value.view,
      hasMeasuredRef: Boolean(value.hasMeasuredRef),
      ancestorCount: Math.max(0, Math.min(16, Math.trunc(value.ancestorCount))),
    }
  },
  decode(raw) {
    if (!isPlainRecord(raw)) return null
    if (typeof raw.path !== "string" || raw.path.length > 32768) return null
    const view = matchEnum(raw.view, ["directory", "packages"] as const)
    if (view === null) return null
    const hasMeasuredRef = typeof raw.hasMeasuredRef === "boolean" ? raw.hasMeasuredRef : false
    const ancestorCount = typeof raw.ancestorCount === "number" && Number.isFinite(raw.ancestorCount)
      ? Math.max(0, Math.min(16, Math.trunc(raw.ancestorCount)))
      : 0
    return { path: raw.path, view, hasMeasuredRef, ancestorCount }
  },
}
