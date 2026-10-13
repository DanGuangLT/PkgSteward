import type { AppLocale } from "@/i18n/config"
import type messages from "@/messages/vi.json"

// Kiểu cho next-intl: gõ sai key dịch hoặc mã ngôn ngữ → `pnpm build` báo lỗi.
// Ngôn ngữ mặc định (vi) là bản chuẩn về cấu trúc key.
declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale
    Messages: typeof messages
  }
}
