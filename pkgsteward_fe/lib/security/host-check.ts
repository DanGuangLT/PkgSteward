// Cổng FE cố định — phải trùng `-p 24680` trong script dev/start của package.json.
export const FRONTEND_PORT = 24680

const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"]

// Chặn DNS rebinding: chỉ nhận Host loopback đúng cổng FE, không phân biệt hoa thường.
export function isAllowedHost(
  host: string | null | undefined,
  port: number = FRONTEND_PORT
): boolean {
  if (!host) return false
  const value = host.trim().toLowerCase()
  return LOOPBACK_HOSTNAMES.some((name) => value === `${name}:${port}`)
}
