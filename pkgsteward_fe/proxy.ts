import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { parseFrontendPort } from "@/lib/config/server-address"
import { isAllowedApiWrite, isAllowedHost } from "@/lib/security/host-check"

const forbidden = (request: NextRequest, message: string) =>
  NextResponse.json(
    {
      statusCode: 403,
      message,
      code: "FORBIDDEN",
      timestamp: new Date().toISOString(),
      path: request.nextUrl.pathname,
    },
    { status: 403 }
  )

// Không khai báo matcher → chạy cho MỌI request (kể cả _next/static và Route Handler),
// để trang web lạ trỏ domain về 127.0.0.1 (DNS rebinding) không đọc hay gọi được app.
export function proxy(request: NextRequest) {
  const address = parseFrontendPort(process.env.PORT)
  if (!address.ok || !isAllowedHost(request.headers.get("host"), address.value)) {
    return forbidden(request, "Host not allowed")
  }
  const allowedWrite = isAllowedApiWrite({
    method: request.method,
    pathname: request.nextUrl.pathname,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
  }, address.value)
  if (!allowedWrite) return forbidden(request, "Cross-site request not allowed")
  return NextResponse.next()
}
