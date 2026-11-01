import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

// Trỏ next-intl tới i18n/request.ts (đường dẫn mặc định).
const withNextIntl = createNextIntlPlugin()

const nextConfig: NextConfig = {
  // Không trang nào được nhúng iframe: chặn lừa click vào nút xác nhận xoá (clickjacking).
  // Click trong iframe mang Origin hợp lệ nên proxy không phân biệt được.
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }]
  },
}

export default withNextIntl(nextConfig)
