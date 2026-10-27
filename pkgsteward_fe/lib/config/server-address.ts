export const DEFAULT_FRONTEND_PORT = 24680
export const DEFAULT_FRONTEND_HOST = "127.0.0.1"

type Result<T> = { ok: true; value: T } | { ok: false; message: string }
type FrontendHost = "127.0.0.1" | "localhost" | "::1"

export function parseFrontendPort(value: string | undefined): Result<number> {
  const normalized = value?.trim()
  if (!normalized) return { ok: true, value: DEFAULT_FRONTEND_PORT }
  const port = Number(normalized)
  if (!/^\d+$/.test(normalized) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      ok: false,
      message: `PORT must be an integer from 1 to 65535 (got ${JSON.stringify(value)})`,
    }
  }
  return { ok: true, value: port }
}

export function parseFrontendHost(value: string | undefined): Result<FrontendHost> {
  const host = value?.trim().toLowerCase()
  if (!host) return { ok: true, value: DEFAULT_FRONTEND_HOST }
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    return {
      ok: false,
      message: `HOST must be 127.0.0.1, localhost or ::1 (got ${JSON.stringify(value)})`,
    }
  }
  return { ok: true, value: host }
}

export function resolveServerAddress(
  sources: ReadonlyArray<Readonly<Record<string, string | undefined>>>
): { ok: true; port: number; host: FrontendHost } | { ok: false; message: string } {
  const firstNonEmpty = (key: "PORT" | "HOST") =>
    sources.find((source) => source[key]?.trim())?.[key]
  const port = parseFrontendPort(firstNonEmpty("PORT"))
  if (!port.ok) return port
  const host = parseFrontendHost(firstNonEmpty("HOST"))
  if (!host.ok) return host
  return { ok: true, port: port.value, host: host.value }
}
