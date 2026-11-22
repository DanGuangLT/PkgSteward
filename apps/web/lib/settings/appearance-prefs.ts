import type {
  AppearanceSettings,
  BehaviorSettings,
  SettingsContentWidth,
  SettingsDensity,
  SettingsFontFamily,
  SettingsFontScale,
  SettingsLineHeight,
  SettingsMonoFontFamily,
  SettingsNavigationLayout,
  SettingsRadius,
  SettingsReducedMotion,
  SettingsThemeMode,
  SettingsThemePreset,
} from "./types.ts"

export const UI_PREFS_COOKIE = "PKGSTEWARD_UI_PREFS"

export const THEME_MODES: readonly SettingsThemeMode[] = ["light", "dark", "system"]
export const THEME_PRESET_IDS: readonly SettingsThemePreset[] = [
  "default",
  "ocean",
  "emerald",
  "slate",
  "amber",
  "violet",
]
export const BODY_FONTS: readonly SettingsFontFamily[] = [
  "inter",
  "be-vietnam-pro",
  "plus-jakarta-sans",
  "roboto",
  "system",
]
export const MONO_FONTS: readonly SettingsMonoFontFamily[] = [
  "geist-mono",
  "jetbrains-mono",
  "fira-code",
  "system",
]
export const FONT_SCALES: readonly SettingsFontScale[] = [85, 90, 95, 100, 105, 110, 115, 120]
export const LINE_HEIGHTS: readonly SettingsLineHeight[] = ["tight", "normal", "relaxed"]
export const RADIUS_MODES: readonly SettingsRadius[] = ["none", "sharp", "compact", "default", "rounded"]
export const DENSITY_MODES: readonly SettingsDensity[] = ["compact", "comfortable", "spacious"]
export const CONTENT_WIDTHS: readonly SettingsContentWidth[] = ["narrow", "standard", "wide", "full"]
export const NAV_LAYOUTS: readonly SettingsNavigationLayout[] = ["topbar", "sidebar"]
export const REDUCED_MOTION_MODES: readonly SettingsReducedMotion[] = ["system", "reduce", "normal"]

export const DEFAULT_APPEARANCE: Readonly<AppearanceSettings> = {
  themeMode: "system",
  themePreset: "default",
  fontFamily: "inter",
  monoFontFamily: "geist-mono",
  fontScale: 100,
  lineHeight: "normal",
  radius: "default",
  density: "comfortable",
  contentWidth: "standard",
  navigationLayout: "topbar",
  sidebarCollapsed: false,
  reducedMotion: "system",
  highContrastBorders: false,
  showBreadcrumbs: false,
}

export const DEFAULT_BEHAVIOR: Readonly<BehaviorSettings> = {
  locale: "vi",
  defaultConsoleShell: "cmd",
  defaultPageSize: 25,
  autoRefreshOnFocus: true,
  confirmBeforeNavigation: true,
  dateFormat: "relative",
  showDesignSystemInNav: true,
  advancedMode: false,
}

function pickEnum<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

export function sanitizeAppearance(
  raw: Partial<AppearanceSettings> | Record<string, unknown> | null | undefined,
  fallbackPreset?: string | null
): AppearanceSettings {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  const presetFallback = pickEnum(fallbackPreset, THEME_PRESET_IDS, DEFAULT_APPEARANCE.themePreset)

  return {
    themeMode: pickEnum(input.themeMode, THEME_MODES, DEFAULT_APPEARANCE.themeMode),
    themePreset: pickEnum(input.themePreset, THEME_PRESET_IDS, presetFallback),
    fontFamily: pickEnum(input.fontFamily, BODY_FONTS, DEFAULT_APPEARANCE.fontFamily),
    monoFontFamily: pickEnum(input.monoFontFamily, MONO_FONTS, DEFAULT_APPEARANCE.monoFontFamily),
    fontScale: pickEnum(input.fontScale, FONT_SCALES, DEFAULT_APPEARANCE.fontScale),
    lineHeight: pickEnum(input.lineHeight, LINE_HEIGHTS, DEFAULT_APPEARANCE.lineHeight),
    radius: pickEnum(input.radius, RADIUS_MODES, DEFAULT_APPEARANCE.radius),
    density: pickEnum(input.density, DENSITY_MODES, DEFAULT_APPEARANCE.density),
    contentWidth: pickEnum(input.contentWidth, CONTENT_WIDTHS, DEFAULT_APPEARANCE.contentWidth),
    navigationLayout: pickEnum(input.navigationLayout, NAV_LAYOUTS, DEFAULT_APPEARANCE.navigationLayout),
    sidebarCollapsed:
      typeof input.sidebarCollapsed === "boolean" ? input.sidebarCollapsed : DEFAULT_APPEARANCE.sidebarCollapsed,
    reducedMotion: pickEnum(input.reducedMotion, REDUCED_MOTION_MODES, DEFAULT_APPEARANCE.reducedMotion),
    highContrastBorders:
      typeof input.highContrastBorders === "boolean"
        ? input.highContrastBorders
        : DEFAULT_APPEARANCE.highContrastBorders,
    showBreadcrumbs:
      typeof input.showBreadcrumbs === "boolean" ? input.showBreadcrumbs : DEFAULT_APPEARANCE.showBreadcrumbs,
  }
}

export function serializeAppearanceCookie(prefs: AppearanceSettings): string {
  return JSON.stringify({
    themeMode: prefs.themeMode,
    themePreset: prefs.themePreset,
    fontFamily: prefs.fontFamily,
    monoFontFamily: prefs.monoFontFamily,
    fontScale: prefs.fontScale,
    lineHeight: prefs.lineHeight,
    radius: prefs.radius,
    density: prefs.density,
    contentWidth: prefs.contentWidth,
    navigationLayout: prefs.navigationLayout,
    sidebarCollapsed: prefs.sidebarCollapsed,
    reducedMotion: prefs.reducedMotion,
    highContrastBorders: prefs.highContrastBorders,
    showBreadcrumbs: prefs.showBreadcrumbs,
  })
}

export function parseAppearanceCookie(
  rawValue: string | undefined | null,
  fallbackThemePreset?: string | null
): AppearanceSettings {
  if (!rawValue) return sanitizeAppearance(null, fallbackThemePreset)
  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return sanitizeAppearance(null, fallbackThemePreset)
    }
    return sanitizeAppearance(parsed as Record<string, unknown>, fallbackThemePreset)
  } catch {
    return sanitizeAppearance(null, fallbackThemePreset)
  }
}

export function appearanceEquals(a: AppearanceSettings, b: AppearanceSettings): boolean {
  return serializeAppearanceCookie(a) === serializeAppearanceCookie(b)
}

export function getHtmlAttributesForAppearance(prefs: AppearanceSettings): {
  attributes: Record<string, string>
  fontSizePercent: string
} {
  return {
    attributes: {
      "data-theme": prefs.themePreset,
      "data-font": prefs.fontFamily,
      "data-mono-font": prefs.monoFontFamily,
      "data-line-height": prefs.lineHeight,
      "data-radius": prefs.radius,
      "data-density": prefs.density,
      "data-width": prefs.contentWidth,
      "data-motion": prefs.reducedMotion,
      "data-contrast": prefs.highContrastBorders ? "high" : "normal",
    },
    fontSizePercent: `${prefs.fontScale}%`,
  }
}

export function applyAppearanceToDocument(doc: Document, prefs: AppearanceSettings): void {
  const root = doc.documentElement
  const { attributes, fontSizePercent } = getHtmlAttributesForAppearance(prefs)
  for (const [attr, value] of Object.entries(attributes)) {
    root.setAttribute(attr, value)
  }
  root.style.fontSize = fontSizePercent
}
