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
  SettingsSurfaceStyle,
  SettingsTextColorMode,
  SettingsTextEffectScope,
  SettingsTextReadabilityMode,
  SettingsTextShadowStrength,
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
export const SURFACE_STYLES: readonly SettingsSurfaceStyle[] = [
  "solid",
  "frosted",
  "liquid-glass",
  "crystal",
]

export const SURFACE_OPACITY_BOUNDS = { min: 35, max: 100 } as const
export const SURFACE_BLUR_BOUNDS = { min: 0, max: 40 } as const
export const SURFACE_SATURATION_BOUNDS = { min: 100, max: 220 } as const

export const SURFACE_STYLE_PRESETS: Readonly<
  Record<
    SettingsSurfaceStyle,
    Pick<
      AppearanceSettings,
      "surfaceOpacity" | "surfaceBlurPx" | "surfaceSaturation" | "surfaceSpecularBorder"
    >
  >
> = {
  solid: {
    surfaceOpacity: 100,
    surfaceBlurPx: 0,
    surfaceSaturation: 100,
    surfaceSpecularBorder: false,
  },
  frosted: {
    surfaceOpacity: 84,
    surfaceBlurPx: 14,
    surfaceSaturation: 140,
    surfaceSpecularBorder: false,
  },
  "liquid-glass": {
    surfaceOpacity: 68,
    surfaceBlurPx: 24,
    surfaceSaturation: 185,
    surfaceSpecularBorder: true,
  },
  crystal: {
    surfaceOpacity: 52,
    surfaceBlurPx: 28,
    surfaceSaturation: 200,
    surfaceSpecularBorder: true,
  },
}

export const TEXT_READABILITY_MODES: readonly SettingsTextReadabilityMode[] = [
  "auto",
  "off",
  "custom",
]
export const TEXT_COLOR_MODES: readonly SettingsTextColorMode[] = [
  "theme",
  "auto-wallpaper",
  "light",
  "dark",
  "custom",
]
export const TEXT_SHADOW_STRENGTHS: readonly SettingsTextShadowStrength[] = [
  "auto",
  "none",
  "subtle",
  "strong",
  "halo",
]
export const TEXT_EFFECT_SCOPES: readonly SettingsTextEffectScope[] = ["wallpaper-only", "always"]

export const TEXT_SHADOW_BLUR_BOUNDS = { min: 0, max: 24 } as const
export const TEXT_SHADOW_OPACITY_BOUNDS = { min: 0, max: 100 } as const
export const TEXT_OUTLINE_WIDTH_BOUNDS = { min: 0, max: 3 } as const
export const DEFAULT_CUSTOM_TEXT_COLOR = "#f8fafc"
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

export const TEXT_SHADOW_PRESETS: Readonly<
  Record<SettingsTextShadowStrength, { textShadowBlurPx: number; textShadowOpacity: number }>
> = {
  auto: { textShadowBlurPx: 8, textShadowOpacity: 78 },
  none: { textShadowBlurPx: 0, textShadowOpacity: 0 },
  subtle: { textShadowBlurPx: 4, textShadowOpacity: 55 },
  strong: { textShadowBlurPx: 10, textShadowOpacity: 88 },
  halo: { textShadowBlurPx: 16, textShadowOpacity: 96 },
}

export const DEFAULT_TEXT_READABILITY_PRESET: Readonly<
  Pick<
    AppearanceSettings,
    | "textReadabilityMode"
    | "textColorMode"
    | "textCustomColor"
    | "textShadowStrength"
    | "textShadowBlurPx"
    | "textShadowOpacity"
    | "textOutlineWidthPx"
    | "textBoostMuted"
    | "textEffectScope"
  >
> = {
  textReadabilityMode: "auto",
  textColorMode: "theme",
  textCustomColor: null,
  textShadowStrength: "auto",
  textShadowBlurPx: 8,
  textShadowOpacity: 78,
  textOutlineWidthPx: 0,
  textBoostMuted: true,
  textEffectScope: "wallpaper-only",
}

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
  surfaceStyle: "solid",
  surfaceOpacity: 100,
  surfaceBlurPx: 0,
  surfaceSaturation: 100,
  surfaceSpecularBorder: false,
  ...DEFAULT_TEXT_READABILITY_PRESET,
}

export const DEFAULT_BEHAVIOR: Readonly<BehaviorSettings> = {
  locale: "vi",
  defaultConsoleShell: "cmd",
  defaultPageSize: 25,
  paginationEnabled: true,
  showPageSizeSelector: true,
  scrollToTopOnPageChange: true,
  autoRefreshOnFocus: true,
  confirmBeforeNavigation: true,
  dateFormat: "relative",
  showDesignSystemInNav: true,
  advancedMode: false,
}

function pickEnum<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function pickIntInRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

export function normalizeOptionalHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return HEX_COLOR_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null
}

export function sanitizeAppearance(
  raw: Partial<AppearanceSettings> | Record<string, unknown> | null | undefined,
  fallbackPreset?: string | null
): AppearanceSettings {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  const presetFallback = pickEnum(fallbackPreset, THEME_PRESET_IDS, DEFAULT_APPEARANCE.themePreset)
  const surfaceStyle = pickEnum(input.surfaceStyle, SURFACE_STYLES, DEFAULT_APPEARANCE.surfaceStyle)
  const surfacePreset = SURFACE_STYLE_PRESETS[surfaceStyle]
  const textShadowStrength = pickEnum(
    input.textShadowStrength,
    TEXT_SHADOW_STRENGTHS,
    DEFAULT_APPEARANCE.textShadowStrength
  )
  const textShadowPreset = TEXT_SHADOW_PRESETS[textShadowStrength]

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
    surfaceStyle,
    surfaceOpacity: pickIntInRange(
      input.surfaceOpacity,
      SURFACE_OPACITY_BOUNDS.min,
      SURFACE_OPACITY_BOUNDS.max,
      surfacePreset.surfaceOpacity
    ),
    surfaceBlurPx: pickIntInRange(
      input.surfaceBlurPx,
      SURFACE_BLUR_BOUNDS.min,
      SURFACE_BLUR_BOUNDS.max,
      surfacePreset.surfaceBlurPx
    ),
    surfaceSaturation: pickIntInRange(
      input.surfaceSaturation,
      SURFACE_SATURATION_BOUNDS.min,
      SURFACE_SATURATION_BOUNDS.max,
      surfacePreset.surfaceSaturation
    ),
    surfaceSpecularBorder:
      typeof input.surfaceSpecularBorder === "boolean"
        ? input.surfaceSpecularBorder
        : surfacePreset.surfaceSpecularBorder,
    textReadabilityMode: pickEnum(
      input.textReadabilityMode,
      TEXT_READABILITY_MODES,
      DEFAULT_APPEARANCE.textReadabilityMode
    ),
    textColorMode: pickEnum(
      input.textColorMode,
      TEXT_COLOR_MODES,
      DEFAULT_APPEARANCE.textColorMode
    ),
    textCustomColor: normalizeOptionalHexColor(input.textCustomColor),
    textShadowStrength,
    textShadowBlurPx: pickIntInRange(
      input.textShadowBlurPx,
      TEXT_SHADOW_BLUR_BOUNDS.min,
      TEXT_SHADOW_BLUR_BOUNDS.max,
      textShadowPreset.textShadowBlurPx
    ),
    textShadowOpacity: pickIntInRange(
      input.textShadowOpacity,
      TEXT_SHADOW_OPACITY_BOUNDS.min,
      TEXT_SHADOW_OPACITY_BOUNDS.max,
      textShadowPreset.textShadowOpacity
    ),
    textOutlineWidthPx: pickIntInRange(
      input.textOutlineWidthPx,
      TEXT_OUTLINE_WIDTH_BOUNDS.min,
      TEXT_OUTLINE_WIDTH_BOUNDS.max,
      DEFAULT_APPEARANCE.textOutlineWidthPx
    ),
    textBoostMuted:
      typeof input.textBoostMuted === "boolean"
        ? input.textBoostMuted
        : DEFAULT_APPEARANCE.textBoostMuted,
    textEffectScope: pickEnum(
      input.textEffectScope,
      TEXT_EFFECT_SCOPES,
      DEFAULT_APPEARANCE.textEffectScope
    ),
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
    surfaceStyle: prefs.surfaceStyle,
    surfaceOpacity: prefs.surfaceOpacity,
    surfaceBlurPx: prefs.surfaceBlurPx,
    surfaceSaturation: prefs.surfaceSaturation,
    surfaceSpecularBorder: prefs.surfaceSpecularBorder,
    textReadabilityMode: prefs.textReadabilityMode,
    textColorMode: prefs.textColorMode,
    textCustomColor: prefs.textCustomColor,
    textShadowStrength: prefs.textShadowStrength,
    textShadowBlurPx: prefs.textShadowBlurPx,
    textShadowOpacity: prefs.textShadowOpacity,
    textOutlineWidthPx: prefs.textOutlineWidthPx,
    textBoostMuted: prefs.textBoostMuted,
    textEffectScope: prefs.textEffectScope,
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

export function computeSurfaceGlassCssVars(
  prefs: Pick<AppearanceSettings, "surfaceOpacity" | "surfaceBlurPx" | "surfaceSaturation">
): Record<string, string> {
  const opacity = pickIntInRange(
    prefs.surfaceOpacity,
    SURFACE_OPACITY_BOUNDS.min,
    SURFACE_OPACITY_BOUNDS.max,
    DEFAULT_APPEARANCE.surfaceOpacity
  )
  const blurPx = pickIntInRange(
    prefs.surfaceBlurPx,
    SURFACE_BLUR_BOUNDS.min,
    SURFACE_BLUR_BOUNDS.max,
    DEFAULT_APPEARANCE.surfaceBlurPx
  )
  const saturation = pickIntInRange(
    prefs.surfaceSaturation,
    SURFACE_SATURATION_BOUNDS.min,
    SURFACE_SATURATION_BOUNDS.max,
    DEFAULT_APPEARANCE.surfaceSaturation
  )
  return {
    "--app-glass-opacity": `${opacity}%`,
    "--app-glass-chrome-opacity": `${Math.min(opacity + 6, 96)}%`,
    "--app-glass-popover-opacity": `${Math.min(opacity + 10, 96)}%`,
    "--app-glass-muted-opacity": `${Math.max(opacity - 10, 28)}%`,
    "--app-glass-input-opacity": `${Math.min(opacity + 4, 92)}%`,
    "--app-glass-blur": `${blurPx}px`,
    "--app-glass-saturation": `${saturation}%`,
  }
}

export function computeTextReadabilityCssVars(
  prefs: Pick<
    AppearanceSettings,
    "textShadowBlurPx" | "textShadowOpacity" | "textOutlineWidthPx" | "textCustomColor"
  >
): Record<string, string> {
  const blurPx = pickIntInRange(
    prefs.textShadowBlurPx,
    TEXT_SHADOW_BLUR_BOUNDS.min,
    TEXT_SHADOW_BLUR_BOUNDS.max,
    DEFAULT_APPEARANCE.textShadowBlurPx
  )
  const opacity = pickIntInRange(
    prefs.textShadowOpacity,
    TEXT_SHADOW_OPACITY_BOUNDS.min,
    TEXT_SHADOW_OPACITY_BOUNDS.max,
    DEFAULT_APPEARANCE.textShadowOpacity
  )
  const outlinePx = pickIntInRange(
    prefs.textOutlineWidthPx,
    TEXT_OUTLINE_WIDTH_BOUNDS.min,
    TEXT_OUTLINE_WIDTH_BOUNDS.max,
    DEFAULT_APPEARANCE.textOutlineWidthPx
  )
  const customColor = normalizeOptionalHexColor(prefs.textCustomColor) ?? "currentColor"

  return {
    "--app-text-shadow-blur": `${blurPx}px`,
    "--app-text-shadow-opacity": `${opacity}%`,
    "--app-text-outline-width": `${outlinePx}px`,
    "--app-text-custom-color": customColor,
  }
}

export function getHtmlAttributesForAppearance(prefs: AppearanceSettings): {
  attributes: Record<string, string>
  fontSizePercent: string
  cssVars: Record<string, string>
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
      "data-surface-style": prefs.surfaceStyle,
      "data-surface-specular":
        prefs.surfaceStyle !== "solid" && prefs.surfaceSpecularBorder ? "on" : "off",
      "data-text-readability": prefs.textReadabilityMode,
      "data-text-color-mode": prefs.textColorMode,
      "data-text-shadow": prefs.textShadowStrength,
      "data-text-outline": prefs.textOutlineWidthPx > 0 ? "on" : "off",
      "data-text-boost-muted": prefs.textBoostMuted ? "on" : "off",
      "data-text-scope": prefs.textEffectScope,
    },
    fontSizePercent: `${prefs.fontScale}%`,
    cssVars: {
      ...computeSurfaceGlassCssVars(prefs),
      ...computeTextReadabilityCssVars(prefs),
    },
  }
}

export function applyAppearanceToDocument(doc: Document, prefs: AppearanceSettings): void {
  const root = doc.documentElement
  const { attributes, fontSizePercent, cssVars } = getHtmlAttributesForAppearance(prefs)
  for (const [attr, value] of Object.entries(attributes)) {
    root.setAttribute(attr, value)
  }
  root.style.fontSize = fontSizePercent
  for (const [cssVar, value] of Object.entries(cssVars)) {
    root.style.setProperty(cssVar, value)
  }
}
