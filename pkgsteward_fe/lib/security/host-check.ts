// Cổng FE cố định — phải trùng `-p 24680` trong script dev/start của package.json.
export const FRONTEND_PORT = 24680

const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"]

// Chặn DNS rebinding: chỉ nhận Host loopback đúng cổng FE, không phân biệt hoa thường.
export function isAllowedHost(
  host: string | null | undefined,
  port: number = FRONTEND_PORT
): boolean {
  if (!host) return false
  const value = host.replace(/^[ \t]+|[ \t]+$/g, "").toLowerCase()
  return LOOPBACK_HOSTNAMES.some((name) => value === `${name}:${port}`)
}

const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"]

export const FRONTEND_ORIGINS: readonly string[] = LOOPBACK_HOSTNAMES.map(
  (name) => `http://${name}:${FRONTEND_PORT}`
)

export interface IApiWriteRequest {
  method: string
  pathname: string
  origin: string | null
  secFetchSite: string | null
}

const isApiPath = (pathname: string) => pathname === "/api" || pathname.startsWith("/api/")

// Chặn CSRF vào Route Handler /api/*: request ghi bị từ chối khi (a) có Origin không phải FE,
// hoặc (b) trình duyệt đánh dấu Sec-Fetch-Site: cross-site. Không có Origin (curl) thì cho qua.
export function isAllowedApiWrite({ method, pathname, origin, secFetchSite }: IApiWriteRequest): boolean {
  if (!WRITE_METHODS.includes(method.toUpperCase()) || !isApiPath(pathname)) return true
  if (secFetchSite !== null && secFetchSite.trim().toLowerCase() === "cross-site") return false
  if (origin === null) return true
  return FRONTEND_ORIGINS.includes(origin.trim().toLowerCase())
}
