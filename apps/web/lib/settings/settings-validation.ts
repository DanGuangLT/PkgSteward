import type { PluginSettingFieldSchema, PrimitiveConfigValue } from "./types.ts"
import { normalizeWallpaperMediaUrl } from "./wallpaper-presets.ts"

export const MAX_TIMEOUT_MS = 86_400_000
export const MAX_BACKUP_JSON_BYTES = 256 * 1024
export const MAX_CONFIG_STRING_LENGTH = 2048
export const MAX_PLUGIN_URL_LENGTH = 2048
export const MAX_TRUSTED_REGISTRIES = 20

export const WALLPAPER_BOUNDS = {
  blurPx: { min: 0, max: 32 },
  dimOpacity: { min: 0, max: 85 },
  surfaceOpacity: { min: 45, max: 100 },
  speed: { min: 25, max: 250 },
} as const

export const SURFACE_GLASS_BOUNDS = {
  surfaceOpacity: { min: 35, max: 100 },
  surfaceBlurPx: { min: 0, max: 40 },
  surfaceSaturation: { min: 100, max: 220 },
} as const

export const TEXT_READABILITY_BOUNDS = {
  textShadowBlurPx: { min: 0, max: 24 },
  textShadowOpacity: { min: 0, max: 100 },
  textOutlineWidthPx: { min: 0, max: 3 },
} as const

export type ScanRootValidationCode =
  | "SCAN_ROOTS_WILDCARD"
  | "SCAN_ROOTS_ABSOLUTE"
  | "SCAN_ROOTS_TRAVERSAL"

export type TimeoutValidationCode = "TIMEOUT_MIN_1000" | "TIMEOUT_MAX_24H"
export type DepthValidationCode = "DEPTH_RANGE"
export type ServerValidationCode =
  | "SERVER_HOST"
  | "SERVER_PORT"
  | "SERVER_PREFIX"
  | "SERVER_VERSION"
  | "SERVER_CORS"

export type WallpaperValidationCode =
  | "WALLPAPER_URL_REQUIRED"
  | "WALLPAPER_URL_HTTPS"
  | "WALLPAPER_URL_TOO_LONG"
  | "WALLPAPER_BLUR_RANGE"
  | "WALLPAPER_DIM_RANGE"
  | "WALLPAPER_SURFACE_RANGE"
  | "WALLPAPER_SPEED_RANGE"

export type SurfaceGlassValidationCode =
  | "SURFACE_OPACITY_RANGE"
  | "SURFACE_BLUR_RANGE"
  | "SURFACE_SATURATION_RANGE"

export type TextReadabilityValidationCode =
  | "TEXT_CUSTOM_COLOR_HEX"
  | "TEXT_SHADOW_BLUR_RANGE"
  | "TEXT_SHADOW_OPACITY_RANGE"
  | "TEXT_OUTLINE_RANGE"

export type PluginValidationCode =
  | "PLUGIN_URL_REQUIRED"
  | "PLUGIN_URL_TOO_LONG"
  | "PLUGIN_NPM_SPEC"
  | "PLUGIN_URL_INVALID"
  | "PLUGIN_DIR_TRAVERSAL"
  | "PLUGIN_DIR_ABSOLUTE"
  | "PLUGIN_REGISTRIES_MAX"
  | "PLUGIN_REGISTRIES_ORIGIN"
  | "PLUGIN_CONFIG_NUMBER"
  | "PLUGIN_CONFIG_STRING_TOO_LONG"

export type BackupValidationCode =
  | "BACKUP_EMPTY"
  | "BACKUP_TOO_LARGE"
  | "BACKUP_INVALID_JSON"
  | "BACKUP_FORBIDDEN_KEY"
  | "BACKUP_DATA_DIR_FORBIDDEN"
  | "BACKUP_SCHEMA_UNSUPPORTED"

export type AnySettingsValidationCode =
  | ScanRootValidationCode
  | TimeoutValidationCode
  | DepthValidationCode
  | ServerValidationCode
  | WallpaperValidationCode
  | SurfaceGlassValidationCode
  | TextReadabilityValidationCode
  | PluginValidationCode
  | BackupValidationCode

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])
const SERVER_BIND_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])
const PREFIX_REGEX = /^[a-zA-Z0-9_-]{1,32}$/
const NPM_SPEC_REGEX = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9._-]+)?$/
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])

function isAbsolutePathInput(token: string): boolean {
  return /^([A-Za-z]:[\\/]|\/)/.test(token)
}

function hasPathTraversal(token: string): boolean {
  return token.includes("\0") || token.split(/[\\/]+/).includes("..")
}

export function validateScanRootInput(value: string): ScanRootValidationCode | null {
  const tokens = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  if (tokens.length === 0) return null
  if (tokens.some(hasPathTraversal)) return "SCAN_ROOTS_TRAVERSAL"
  if (tokens.some((token) => token.includes("*"))) {
    return tokens.length === 1 && tokens[0] === "*" ? null : "SCAN_ROOTS_WILDCARD"
  }
  return tokens.every(isAbsolutePathInput) ? null : "SCAN_ROOTS_ABSOLUTE"
}

export function validateTimeoutInput(enabled: boolean, rawMs: string): TimeoutValidationCode | null {
  if (!enabled) return null
  const trimmed = rawMs.trim()
  if (trimmed === "") return "TIMEOUT_MIN_1000"
  const num = Number(trimmed)
  if (!Number.isSafeInteger(num) || num < 1000) return "TIMEOUT_MIN_1000"
  if (num > MAX_TIMEOUT_MS) return "TIMEOUT_MAX_24H"
  return null
}

export function validateMaxDepthInput(rawDepth: string): DepthValidationCode | null {
  const trimmed = rawDepth.trim()
  if (trimmed === "") return "DEPTH_RANGE"
  const num = Number(trimmed)
  if (!Number.isSafeInteger(num) || num < 0 || num > 20) return "DEPTH_RANGE"
  return null
}

export function validateServerDraftFields(input: {
  host: string
  port: string
  globalPrefix: string
  version: string
  listOriginCors: string
}): Partial<Record<"host" | "port" | "globalPrefix" | "version" | "listOriginCors", ServerValidationCode>> {
  const errors: Partial<
    Record<"host" | "port" | "globalPrefix" | "version" | "listOriginCors", ServerValidationCode>
  > = {}

  if (!SERVER_BIND_HOSTS.has(input.host.trim().toLowerCase())) {
    errors.host = "SERVER_HOST"
  }

  const portTrimmed = input.port.trim()
  const port = Number(portTrimmed)
  if (portTrimmed === "" || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    errors.port = "SERVER_PORT"
  }

  if (!PREFIX_REGEX.test(input.globalPrefix.trim())) {
    errors.globalPrefix = "SERVER_PREFIX"
  }

  if (!PREFIX_REGEX.test(input.version.trim())) {
    errors.version = "SERVER_VERSION"
  }

  const tokens = input.listOriginCors
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
  for (const token of tokens) {
    if (token === "*" || token.toLowerCase() === "null") {
      errors.listOriginCors = "SERVER_CORS"
      break
    }
    try {
      const url = new URL(token)
      if (
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        url.username !== "" ||
        url.password !== "" ||
        url.search !== "" ||
        url.hash !== "" ||
        (url.pathname !== "/" && url.pathname !== "")
      ) {
        errors.listOriginCors = "SERVER_CORS"
        break
      }
    } catch {
      errors.listOriginCors = "SERVER_CORS"
      break
    }
  }

  return errors
}

export function validateServerDraft(input: {
  host: string
  port: string
  globalPrefix: string
  version: string
  listOriginCors: string
}): ServerValidationCode | null {
  const errors = validateServerDraftFields(input)
  const first = Object.values(errors)[0]
  return first ?? null
}

export function validateWallpaperMediaUrl(
  rawUrl: string,
  options?: { required?: boolean }
): WallpaperValidationCode | null {
  const clean = normalizeWallpaperMediaUrl(rawUrl)
  if (clean === "") return options?.required ? "WALLPAPER_URL_REQUIRED" : null
  if (clean.length > MAX_CONFIG_STRING_LENGTH) return "WALLPAPER_URL_TOO_LONG"
  try {
    const parsed = new URL(clean)
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
      return "WALLPAPER_URL_HTTPS"
    }
    return null
  } catch {
    return "WALLPAPER_URL_HTTPS"
  }
}

function validateSafeIntegerRange(
  raw: string,
  min: number,
  max: number,
  code: WallpaperValidationCode
): WallpaperValidationCode | null {
  const trimmed = raw.trim()
  if (trimmed === "") return code
  const num = Number(trimmed)
  if (!Number.isSafeInteger(num) || num < min || num > max) return code
  return null
}

export function validateWallpaperTuningDraft(input: {
  mediaUrl?: string
  blurPx: string
  dimOpacity: string
  surfaceOpacity: string
  speed: string
}): Partial<
  Record<"mediaUrl" | "blurPx" | "dimOpacity" | "surfaceOpacity" | "speed", WallpaperValidationCode>
> {
  const errors: Partial<
    Record<"mediaUrl" | "blurPx" | "dimOpacity" | "surfaceOpacity" | "speed", WallpaperValidationCode>
  > = {}

  if (input.mediaUrl !== undefined) {
    const urlErr = validateWallpaperMediaUrl(input.mediaUrl)
    if (urlErr) errors.mediaUrl = urlErr
  }

  const blurErr = validateSafeIntegerRange(
    input.blurPx,
    WALLPAPER_BOUNDS.blurPx.min,
    WALLPAPER_BOUNDS.blurPx.max,
    "WALLPAPER_BLUR_RANGE"
  )
  if (blurErr) errors.blurPx = blurErr

  const dimErr = validateSafeIntegerRange(
    input.dimOpacity,
    WALLPAPER_BOUNDS.dimOpacity.min,
    WALLPAPER_BOUNDS.dimOpacity.max,
    "WALLPAPER_DIM_RANGE"
  )
  if (dimErr) errors.dimOpacity = dimErr

  const surfaceErr = validateSafeIntegerRange(
    input.surfaceOpacity,
    WALLPAPER_BOUNDS.surfaceOpacity.min,
    WALLPAPER_BOUNDS.surfaceOpacity.max,
    "WALLPAPER_SURFACE_RANGE"
  )
  if (surfaceErr) errors.surfaceOpacity = surfaceErr

  const speedErr = validateSafeIntegerRange(
    input.speed,
    WALLPAPER_BOUNDS.speed.min,
    WALLPAPER_BOUNDS.speed.max,
    "WALLPAPER_SPEED_RANGE"
  )
  if (speedErr) errors.speed = speedErr

  return errors
}

export function validateSurfaceGlassDraft(input: {
  surfaceOpacity: string
  surfaceBlurPx: string
  surfaceSaturation: string
}): Partial<
  Record<"surfaceOpacity" | "surfaceBlurPx" | "surfaceSaturation", SurfaceGlassValidationCode>
> {
  const errors: Partial<
    Record<"surfaceOpacity" | "surfaceBlurPx" | "surfaceSaturation", SurfaceGlassValidationCode>
  > = {}

  const opacityTrimmed = input.surfaceOpacity.trim()
  const opacityNum = Number(opacityTrimmed)
  if (
    opacityTrimmed === "" ||
    !Number.isSafeInteger(opacityNum) ||
    opacityNum < SURFACE_GLASS_BOUNDS.surfaceOpacity.min ||
    opacityNum > SURFACE_GLASS_BOUNDS.surfaceOpacity.max
  ) {
    errors.surfaceOpacity = "SURFACE_OPACITY_RANGE"
  }

  const blurTrimmed = input.surfaceBlurPx.trim()
  const blurNum = Number(blurTrimmed)
  if (
    blurTrimmed === "" ||
    !Number.isSafeInteger(blurNum) ||
    blurNum < SURFACE_GLASS_BOUNDS.surfaceBlurPx.min ||
    blurNum > SURFACE_GLASS_BOUNDS.surfaceBlurPx.max
  ) {
    errors.surfaceBlurPx = "SURFACE_BLUR_RANGE"
  }

  const satTrimmed = input.surfaceSaturation.trim()
  const satNum = Number(satTrimmed)
  if (
    satTrimmed === "" ||
    !Number.isSafeInteger(satNum) ||
    satNum < SURFACE_GLASS_BOUNDS.surfaceSaturation.min ||
    satNum > SURFACE_GLASS_BOUNDS.surfaceSaturation.max
  ) {
    errors.surfaceSaturation = "SURFACE_SATURATION_RANGE"
  }

  return errors
}

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/

export function validateTextReadabilityDraft(input: {
  textColorMode: string
  textCustomColor: string
  textShadowBlurPx: string
  textShadowOpacity: string
  textOutlineWidthPx: string
}): Partial<
  Record<
    "textCustomColor" | "textShadowBlurPx" | "textShadowOpacity" | "textOutlineWidthPx",
    TextReadabilityValidationCode
  >
> {
  const errors: Partial<
    Record<
      "textCustomColor" | "textShadowBlurPx" | "textShadowOpacity" | "textOutlineWidthPx",
      TextReadabilityValidationCode
    >
  > = {}

  const colorTrimmed = input.textCustomColor.trim()
  if (input.textColorMode === "custom") {
    if (!HEX_COLOR_REGEX.test(colorTrimmed)) {
      errors.textCustomColor = "TEXT_CUSTOM_COLOR_HEX"
    }
  } else if (colorTrimmed !== "" && !HEX_COLOR_REGEX.test(colorTrimmed)) {
    errors.textCustomColor = "TEXT_CUSTOM_COLOR_HEX"
  }

  const blurTrimmed = input.textShadowBlurPx.trim()
  const blurNum = Number(blurTrimmed)
  if (
    blurTrimmed === "" ||
    !Number.isSafeInteger(blurNum) ||
    blurNum < TEXT_READABILITY_BOUNDS.textShadowBlurPx.min ||
    blurNum > TEXT_READABILITY_BOUNDS.textShadowBlurPx.max
  ) {
    errors.textShadowBlurPx = "TEXT_SHADOW_BLUR_RANGE"
  }

  const opacityTrimmed = input.textShadowOpacity.trim()
  const opacityNum = Number(opacityTrimmed)
  if (
    opacityTrimmed === "" ||
    !Number.isSafeInteger(opacityNum) ||
    opacityNum < TEXT_READABILITY_BOUNDS.textShadowOpacity.min ||
    opacityNum > TEXT_READABILITY_BOUNDS.textShadowOpacity.max
  ) {
    errors.textShadowOpacity = "TEXT_SHADOW_OPACITY_RANGE"
  }

  const outlineTrimmed = input.textOutlineWidthPx.trim()
  const outlineNum = Number(outlineTrimmed)
  if (
    outlineTrimmed === "" ||
    !Number.isSafeInteger(outlineNum) ||
    outlineNum < TEXT_READABILITY_BOUNDS.textOutlineWidthPx.min ||
    outlineNum > TEXT_READABILITY_BOUNDS.textOutlineWidthPx.max
  ) {
    errors.textOutlineWidthPx = "TEXT_OUTLINE_RANGE"
  }

  return errors
}

function isTrustedOriginUrl(url: URL): boolean {
  const isLoopbackHttp = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
  return (
    (url.protocol === "https:" || isLoopbackHttp) &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "" &&
    (url.pathname === "/" || url.pathname === "")
  )
}

export function validatePluginInstallUrlInput(raw: string): PluginValidationCode | null {
  const trimmed = raw.trim()
  if (!trimmed) return "PLUGIN_URL_REQUIRED"
  if (trimmed.length > MAX_PLUGIN_URL_LENGTH) return "PLUGIN_URL_TOO_LONG"
  if (trimmed.startsWith("npm:")) {
    const spec = trimmed.slice(4).trim()
    return NPM_SPEC_REGEX.test(spec) ? null : "PLUGIN_NPM_SPEC"
  }
  try {
    const parsed = new URL(trimmed)
    const isLoopbackHttp =
      parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
    if (
      (parsed.protocol !== "https:" && !isLoopbackHttp) ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return "PLUGIN_URL_INVALID"
    }
    return null
  } catch {
    return "PLUGIN_URL_INVALID"
  }
}

export function validatePluginDirectoryInput(raw: string): PluginValidationCode | null {
  const trimmed = raw.trim()
  if (trimmed === "") return null
  if (hasPathTraversal(trimmed)) return "PLUGIN_DIR_TRAVERSAL"
  return isAbsolutePathInput(trimmed) ? null : "PLUGIN_DIR_ABSOLUTE"
}

export function validateTrustedRegistriesInput(raw: string): PluginValidationCode | null {
  const tokens = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  if (tokens.length === 0) return null
  if (tokens.length > MAX_TRUSTED_REGISTRIES) return "PLUGIN_REGISTRIES_MAX"
  for (const token of tokens) {
    try {
      const parsed = new URL(token)
      if (!isTrustedOriginUrl(parsed)) return "PLUGIN_REGISTRIES_ORIGIN"
    } catch {
      return "PLUGIN_REGISTRIES_ORIGIN"
    }
  }
  return null
}

export function validatePluginConfigField(
  field: PluginSettingFieldSchema,
  rawValue: string | boolean | PrimitiveConfigValue | undefined,
  pluginId?: string
): PluginValidationCode | WallpaperValidationCode | null {
  if (field.type === "boolean") return null
  if (field.type === "number") {
    const rawText = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim()
    if (rawText === "") {
      return field.defaultValue === null ? null : "PLUGIN_CONFIG_NUMBER"
    }
    const num = Number(rawText)
    if (!Number.isFinite(num)) return "PLUGIN_CONFIG_NUMBER"
    if (pluginId === "wallpaper-engine") {
      if (field.key === "blurPx") {
        return validateSafeIntegerRange(
          rawText,
          WALLPAPER_BOUNDS.blurPx.min,
          WALLPAPER_BOUNDS.blurPx.max,
          "WALLPAPER_BLUR_RANGE"
        )
      }
      if (field.key === "dimOpacity") {
        return validateSafeIntegerRange(
          rawText,
          WALLPAPER_BOUNDS.dimOpacity.min,
          WALLPAPER_BOUNDS.dimOpacity.max,
          "WALLPAPER_DIM_RANGE"
        )
      }
      if (field.key === "surfaceOpacity") {
        return validateSafeIntegerRange(
          rawText,
          WALLPAPER_BOUNDS.surfaceOpacity.min,
          WALLPAPER_BOUNDS.surfaceOpacity.max,
          "WALLPAPER_SURFACE_RANGE"
        )
      }
      if (field.key === "speed") {
        return validateSafeIntegerRange(
          rawText,
          WALLPAPER_BOUNDS.speed.min,
          WALLPAPER_BOUNDS.speed.max,
          "WALLPAPER_SPEED_RANGE"
        )
      }
    }
    return null
  }

  const textVal = rawValue === null || rawValue === undefined ? "" : String(rawValue)
  if (textVal.length > MAX_CONFIG_STRING_LENGTH) return "PLUGIN_CONFIG_STRING_TOO_LONG"
  if (pluginId === "wallpaper-engine" && field.key === "mediaUrl") {
    return validateWallpaperMediaUrl(textVal)
  }
  return null
}

export function validatePluginConfigDraft(
  schema: readonly PluginSettingFieldSchema[],
  draft: Record<string, string | boolean | PrimitiveConfigValue | undefined>,
  pluginId?: string
): Record<string, PluginValidationCode | WallpaperValidationCode> {
  const errors: Record<string, PluginValidationCode | WallpaperValidationCode> = {}
  for (const field of schema) {
    const err = validatePluginConfigField(field, draft[field.key], pluginId)
    if (err) errors[field.key] = err
  }
  return errors
}

function hasForbiddenKeysDeep(value: unknown, depth = 0): boolean {
  if (depth > 12 || value === null || typeof value !== "object") return false
  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenKeysDeep(item, depth + 1))
  }
  const obj = value as Record<string, unknown>
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (FORBIDDEN_KEYS.has(key) || hasForbiddenKeysDeep(obj[key], depth + 1)) {
      return true
    }
  }
  return false
}

export function validateBackupImportText(
  rawText: string
): { ok: true; value: Record<string, unknown> } | { ok: false; code: BackupValidationCode } {
  if (rawText.trim() === "") {
    return { ok: false, code: "BACKUP_EMPTY" }
  }
  if (new TextEncoder().encode(rawText).byteLength > MAX_BACKUP_JSON_BYTES) {
    return { ok: false, code: "BACKUP_TOO_LARGE" }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText.replace(/^\uFEFF/, "")) as unknown
  } catch {
    return { ok: false, code: "BACKUP_INVALID_JSON" }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, code: "BACKUP_INVALID_JSON" }
  }
  if (hasForbiddenKeysDeep(parsed)) {
    return { ok: false, code: "BACKUP_FORBIDDEN_KEY" }
  }
  const record = parsed as Record<string, unknown>
  if ("PKGSTEWARD_DATA_DIR" in record) {
    return { ok: false, code: "BACKUP_DATA_DIR_FORBIDDEN" }
  }
  if ("schemaVersion" in record && record.schemaVersion !== 1) {
    return { ok: false, code: "BACKUP_SCHEMA_UNSUPPORTED" }
  }
  return { ok: true, value: record }
}

export function parseImportSettingsJson(
  rawText: string
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  const res = validateBackupImportText(rawText)
  return res.ok ? { ok: true, value: res.value } : { ok: false }
}

export function formatDurationHintMs(rawMs: string, locale: "vi" | "en"): string | null {
  const num = Number(rawMs.trim())
  if (!Number.isSafeInteger(num) || num < 1000 || num > MAX_TIMEOUT_MS) {
    return null
  }
  const totalSeconds = Math.round(num / 100) / 10
  if (totalSeconds < 60) {
    return locale === "vi" ? `≈ ${totalSeconds} giây` : `≈ ${totalSeconds} s`
  }
  const totalMinutes = Math.floor(totalSeconds / 60)
  const remSeconds = Math.round(totalSeconds % 60)
  if (totalMinutes < 60) {
    if (remSeconds === 0) {
      return locale === "vi" ? `≈ ${totalMinutes} phút` : `≈ ${totalMinutes} min`
    }
    return locale === "vi"
      ? `≈ ${totalMinutes} phút ${remSeconds} giây`
      : `≈ ${totalMinutes}m ${remSeconds}s`
  }
  const hours = Math.floor(totalMinutes / 60)
  const remMinutes = totalMinutes % 60
  if (remMinutes === 0) {
    return locale === "vi" ? `≈ ${hours} giờ` : `≈ ${hours}h`
  }
  return locale === "vi" ? `≈ ${hours} giờ ${remMinutes} phút` : `≈ ${hours}h ${remMinutes}m`
}

export function resolvePluginFieldUnit(field: PluginSettingFieldSchema): string | null {
  if (field.unit && field.unit.trim() !== "") return field.unit.trim()
  if (field.type !== "number") return null
  switch (field.key) {
    case "blurPx":
      return "px"
    case "dimOpacity":
    case "surfaceOpacity":
    case "speed":
      return "%"
    default:
      if (/Ms$/i.test(field.key)) return "ms"
      if (/(Seconds?|Sec)$/i.test(field.key)) return "s"
      return null
  }
}

export function normalizeDrivePath(rawDrive: string): string {
  const trimmed = rawDrive.trim()
  if (/^[A-Za-z]:(?:[\\/])?$/.test(trimmed)) {
    return `${trimmed[0].toUpperCase()}:\\`
  }
  return trimmed
}

export function inferScanRootMode(
  scanRootPaths: string,
  availableDrives: readonly string[]
): {
  mode: "all" | "drives" | "custom"
  selectedDrives: string[]
  customPaths: string[]
} {
  const trimmed = scanRootPaths.trim()
  if (trimmed === "*") {
    return { mode: "all", selectedDrives: [], customPaths: [] }
  }

  const tokens = trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  if (tokens.length === 0) {
    return { mode: "all", selectedDrives: [], customPaths: [] }
  }

  const canonicalAvailable = new Map<string, string>()
  for (const drive of availableDrives) {
    canonicalAvailable.set(normalizeDrivePath(drive).toLowerCase(), drive)
  }

  const normalizedTokens = tokens.map((token) => normalizeDrivePath(token))
  const everyTokenIsDrive =
    canonicalAvailable.size > 0 &&
    normalizedTokens.every(
      (token) => /^[A-Za-z]:\\$/.test(token) || canonicalAvailable.has(token.toLowerCase())
    )

  if (everyTokenIsDrive) {
    const matched = normalizedTokens.map(
      (token) => canonicalAvailable.get(token.toLowerCase()) ?? token
    )
    return {
      mode: "drives",
      selectedDrives: [...new Set(matched)],
      customPaths: [],
    }
  }

  return {
    mode: "custom",
    selectedDrives: [],
    customPaths: tokens,
  }
}
