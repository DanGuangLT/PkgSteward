import { cookies } from "next/headers"

import { parseAppearanceCookie, UI_PREFS_COOKIE } from "@/lib/settings/appearance-prefs"
import type { AppearanceSettings } from "@/lib/settings/types"
import { THEME_PRESET_COOKIE } from "@/lib/theme/presets"

/**
 * Đọc cấu hình giao diện từ cookie ở server để SSR đặt data-* + fontSize
 * chính xác ngay lần vẽ đầu tiên mà không phụ thuộc BE khi `next build`.
 */
export async function getInitialAppearance(): Promise<AppearanceSettings> {
  const store = await cookies()
  const uiPrefsRaw = store.get(UI_PREFS_COOKIE)?.value
  const presetFallback = store.get(THEME_PRESET_COOKIE)?.value
  return parseAppearanceCookie(uiPrefsRaw, presetFallback)
}
