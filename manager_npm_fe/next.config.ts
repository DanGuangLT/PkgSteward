import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

// Trỏ next-intl tới i18n/request.ts (đường dẫn mặc định).
const withNextIntl = createNextIntlPlugin()

const nextConfig: NextConfig = {
  /* config options here */
}

export default withNextIntl(nextConfig)
