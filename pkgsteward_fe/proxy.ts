import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { isAllowedHost } from "@/lib/security/host-check"

// Không khai báo matcher → chạy cho MỌI request (kể cả _next/static và Route Handler),
// để trang web lạ trỏ domain về 127.0.0.1 (DNS rebinding) không đọc hay gọi được app.
export function proxy(request: NextRequest) {
  if (isAllowedHost(request.headers.get("host"))) return NextResponse.next()
  return NextResponse.json(
    {
      statusCode: 403,
      message: "Host not allowed",
      code: "FORBIDDEN",
      timestamp: new Date().toISOString(),
      path: request.nextUrl.pathname,
    },
    { status: 403 }
  )
}
