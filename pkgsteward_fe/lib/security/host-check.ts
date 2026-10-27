// Cổng FE không cố định: proxy truyền vào cổng đang chạy (PORT đã cấu hình).
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"]

// Chặn DNS rebinding: chỉ nhận Host loopback đúng cổng FE, không phân biệt hoa thường.
export function isAllowedHost(
  host: string | null | undefined,
  port: number
): boolean {
  if (!host) return false
  const value = host.replace(/^[ \t]+|[ \t]+$/g, "").toLowerCase()
  return LOOPBACK_HOSTNAMES.some((name) => value === `${name}:${port}`)
}

const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"]

export function frontendOrigins(port: number): string[] {
  return LOOPBACK_HOSTNAMES.map((name) => `http://${name}:${port}`)
}

export interface IApiWriteRequest {
  method: string
  pathname: string
  origin: string | null
  secFetchSite: string | null
}

const isApiPath = (pathname: string) => pathname === "/api" || pathname.startsWith("/api/")

// Chặn CSRF vào Route Handler /api/*: request ghi bị từ chối khi (a) có Origin không phải FE,
// hoặc (b) trình duyệt đánh dấu Sec-Fetch-Site: cross-site. Không có Origin (curl) thì cho qua.
export function isAllowedApiWrite(
  { method, pathname, origin, secFetchSite }: IApiWriteRequest,
  port: number
): boolean {
  if (!WRITE_METHODS.includes(method.toUpperCase()) || !isApiPath(pathname)) return true
  if (secFetchSite !== null && secFetchSite.trim().toLowerCase() === "cross-site") return false
  if (origin === null) return true
  return frontendOrigins(port).includes(origin.trim().toLowerCase())
}
