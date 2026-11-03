/**
 * Cấu hình ngôn ngữ — CHỖ DUY NHẤT phải sửa khi thêm ngôn ngữ mới:
 *   1. Copy messages/en.json thành messages/<mã>.json và dịch
 *      (key nào chưa dịch sẽ tự hiện bằng ngôn ngữ mặc định).
 *   2. Thêm <mã> vào `locales` và tên hiển thị vào `localeLabels`.
 *   3. Chạy `pnpm i18n:check` để xem còn thiếu key nào.
 */
export const locales = ["vi", "en"] as const

export type AppLocale = (typeof locales)[number]

export const defaultLocale: AppLocale = "vi"

/** Tên ngôn ngữ viết bằng chính ngôn ngữ đó (không dịch). */
export const localeLabels: Record<AppLocale, string> = {
  vi: "Tiếng Việt",
  en: "English",
}

/** Cookie lưu ngôn ngữ người dùng chọn. */
export const LOCALE_COOKIE = "NEXT_LOCALE"

export function isLocale(value: unknown): value is AppLocale {
  return locales.includes(value as AppLocale)
}
