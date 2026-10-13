/**
 * Danh sách preset (bộ màu / hình khối) — dùng được ở cả server lẫn client.
 *
 * Preset ≠ chế độ sáng/tối: mỗi preset có đủ 2 bản sáng + tối trong
 * styles/themes/<id>.css; chế độ do next-themes quản lý (class `.dark`).
 *
 * Thêm preset mới:
 *   1. Tạo styles/themes/<id>.css (selector [data-theme="<id>"] và
 *      [data-theme="<id>"].dark), import trong app/globals.css.
 *   2. Thêm <id> vào `themePresets` bên dưới.
 *   3. Thêm tên hiển thị vào messages/*.json → theme.presets.<id>.
 *   4. Chạy `pnpm theme:check`.
 */
export const themePresets = ["pinterest"] as const

export type ThemePreset = (typeof themePresets)[number]

export const defaultThemePreset: ThemePreset = "pinterest"

/** Cookie lưu preset người dùng chọn (đọc ở server để render đúng ngay lần đầu). */
export const THEME_PRESET_COOKIE = "THEME_PRESET"

export function isThemePreset(value: unknown): value is ThemePreset {
  return themePresets.includes(value as ThemePreset)
}

/** Chế độ sáng/tối — giá trị dùng với next-themes. */
export const themeModes = ["light", "dark", "system"] as const

export type ThemeMode = (typeof themeModes)[number]
