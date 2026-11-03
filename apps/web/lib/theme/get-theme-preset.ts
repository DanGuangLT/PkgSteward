import { cookies } from "next/headers"

import {
  defaultThemePreset,
  isThemePreset,
  THEME_PRESET_COOKIE,
  type ThemePreset,
} from "@/lib/theme/presets"

/**
 * Preset đang dùng — đọc từ cookie ở server để <html data-theme> đúng ngay
 * từ HTML đầu tiên (không nháy). Giá trị lạ / chưa có → preset mặc định.
 * Setter (Server Action ghi cookie) sẽ thêm khi có tính năng đổi theme.
 */
export async function getThemePreset(): Promise<ThemePreset> {
  const value = (await cookies()).get(THEME_PRESET_COOKIE)?.value
  return isThemePreset(value) ? value : defaultThemePreset
}
