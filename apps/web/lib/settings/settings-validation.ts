export type ScanRootValidationCode = "SCAN_ROOTS_WILDCARD" | "SCAN_ROOTS_ABSOLUTE"
export type TimeoutValidationCode = "TIMEOUT_MIN_1000"
export type DepthValidationCode = "DEPTH_RANGE"
export type ServerValidationCode =
  | "SERVER_HOST"
  | "SERVER_PORT"
  | "SERVER_PREFIX"
  | "SERVER_VERSION"
  | "SERVER_CORS"

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])
const PREFIX_REGEX = /^[a-zA-Z0-9_-]{1,32}$/

export function validateScanRootInput(value: string): ScanRootValidationCode | null {
  const tokens = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  if (tokens.length === 0) return null
  if (tokens.some((token) => token.includes("*"))) {
    return tokens.length === 1 && tokens[0] === "*" ? null : "SCAN_ROOTS_WILDCARD"
  }
  return tokens.every((token) => /^([A-Za-z]:[\\/]|\/)/.test(token))
    ? null
    : "SCAN_ROOTS_ABSOLUTE"
}

export function validateTimeoutInput(enabled: boolean, rawMs: string): TimeoutValidationCode | null {
  if (!enabled) return null
  const num = Number(rawMs.trim())
  if (!Number.isSafeInteger(num) || num < 1000) return "TIMEOUT_MIN_1000"
  return null
}

export function validateMaxDepthInput(rawDepth: string): DepthValidationCode | null {
  const num = Number(rawDepth.trim())
  if (!Number.isSafeInteger(num) || num < 0 || num > 20) return "DEPTH_RANGE"
  return null
}

export function validateServerDraft(input: {
  host: string
  port: string
  globalPrefix: string
  version: string
  listOriginCors: string
}): ServerValidationCode | null {
  if (!LOOPBACK_HOSTS.has(input.host.trim().toLowerCase())) return "SERVER_HOST"
  const port = Number(input.port.trim())
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return "SERVER_PORT"
  if (!PREFIX_REGEX.test(input.globalPrefix.trim())) return "SERVER_PREFIX"
  if (!PREFIX_REGEX.test(input.version.trim())) return "SERVER_VERSION"
  const tokens = input.listOriginCors
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
  for (const token of tokens) {
    if (token === "*" || token.toLowerCase() === "null") return "SERVER_CORS"
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
        return "SERVER_CORS"
      }
    } catch {
      return "SERVER_CORS"
    }
  }
  return null
}

export function parseImportSettingsJson(rawText: string): { ok: true; value: Record<string, unknown> } | { ok: false } {
  try {
    const parsed = JSON.parse(rawText.replace(/^\uFEFF/, "")) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch {
    return { ok: false }
  }
}
