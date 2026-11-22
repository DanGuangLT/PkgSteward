import { test } from "node:test"
import assert from "node:assert/strict"
import {
  appearanceEquals,
  computeSurfaceGlassCssVars,
  DEFAULT_APPEARANCE,
  getHtmlAttributesForAppearance,
  parseAppearanceCookie,
  sanitizeAppearance,
  serializeAppearanceCookie,
  SURFACE_STYLE_PRESETS,
} from "./appearance-prefs.ts"

test("DEFAULT_APPEARANCE disables global breadcrumb strip and uses solid surface by default", () => {
  assert.equal(DEFAULT_APPEARANCE.showBreadcrumbs, false)
  assert.equal(DEFAULT_APPEARANCE.surfaceStyle, "solid")
  assert.equal(DEFAULT_APPEARANCE.surfaceOpacity, 100)
  assert.equal(DEFAULT_APPEARANCE.surfaceBlurPx, 0)
  assert.equal(DEFAULT_APPEARANCE.surfaceSaturation, 100)
  assert.equal(DEFAULT_APPEARANCE.surfaceSpecularBorder, false)
})

test("sanitizeAppearance rejects unknown/XSS values and preserves valid enum choices", () => {
  const sanitized = sanitizeAppearance(
    {
      themePreset: "ocean",
      fontFamily: "be-vietnam-pro",
      monoFontFamily: "jetbrains-mono",
      fontScale: 110,
      navigationLayout: "sidebar",
      radius: "sharp",
      highContrastBorders: true,
      surfaceStyle: "liquid-glass",
      surfaceOpacity: 64,
      surfaceBlurPx: 26,
      surfaceSaturation: 190,
      surfaceSpecularBorder: true,
      extraInjection: "<script>alert(1)</script>",
    },
    "emerald"
  )

  assert.equal(sanitized.themePreset, "ocean")
  assert.equal(sanitized.fontFamily, "be-vietnam-pro")
  assert.equal(sanitized.monoFontFamily, "jetbrains-mono")
  assert.equal(sanitized.fontScale, 110)
  assert.equal(sanitized.navigationLayout, "sidebar")
  assert.equal(sanitized.radius, "sharp")
  assert.equal(sanitized.highContrastBorders, true)
  assert.equal(sanitized.surfaceStyle, "liquid-glass")
  assert.equal(sanitized.surfaceOpacity, 64)
  assert.equal(sanitized.surfaceBlurPx, 26)
  assert.equal(sanitized.surfaceSaturation, 190)
  assert.equal(sanitized.surfaceSpecularBorder, true)
  assert.equal("extraInjection" in sanitized, false)

  const invalid = sanitizeAppearance(
    {
      themePreset: "evil\" onerror=1",
      fontScale: 999,
      surfaceStyle: "glass-bad",
      surfaceOpacity: 10,
      surfaceBlurPx: 99,
      surfaceSaturation: 500,
    },
    "emerald"
  )
  assert.equal(invalid.themePreset, "emerald")
  assert.equal(invalid.fontScale, DEFAULT_APPEARANCE.fontScale)
  assert.equal(invalid.surfaceStyle, "solid")
  assert.equal(invalid.surfaceOpacity, 100)
  assert.equal(invalid.surfaceBlurPx, 0)
  assert.equal(invalid.surfaceSaturation, 100)

  const partialGlass = sanitizeAppearance({ surfaceStyle: "crystal" })
  assert.deepEqual(
    {
      surfaceOpacity: partialGlass.surfaceOpacity,
      surfaceBlurPx: partialGlass.surfaceBlurPx,
      surfaceSaturation: partialGlass.surfaceSaturation,
      surfaceSpecularBorder: partialGlass.surfaceSpecularBorder,
    },
    SURFACE_STYLE_PRESETS.crystal
  )
})

test("parseAppearanceCookie round-trips cleanly and falls back safely on malformed JSON", () => {
  const custom = sanitizeAppearance({
    themePreset: "violet",
    density: "compact",
    sidebarCollapsed: true,
    surfaceStyle: "liquid-glass",
    surfaceOpacity: 70,
    surfaceBlurPx: 24,
    surfaceSaturation: 185,
    surfaceSpecularBorder: true,
  })
  const raw = serializeAppearanceCookie(custom)
  assert.equal(appearanceEquals(parseAppearanceCookie(raw), custom), true)
  assert.deepEqual(parseAppearanceCookie("{bad json", "amber").themePreset, "amber")
  assert.deepEqual(parseAppearanceCookie(undefined).themePreset, "default")
})

test("getHtmlAttributesForAppearance produces expected attributes, root font-size, and glass cssVars", () => {
  const prefs = sanitizeAppearance({
    themePreset: "slate",
    fontFamily: "plus-jakarta-sans",
    monoFontFamily: "fira-code",
    fontScale: 115,
    lineHeight: "relaxed",
    radius: "none",
    density: "spacious",
    contentWidth: "wide",
    reducedMotion: "reduce",
    highContrastBorders: true,
    surfaceStyle: "liquid-glass",
    surfaceOpacity: 68,
    surfaceBlurPx: 24,
    surfaceSaturation: 185,
    surfaceSpecularBorder: true,
  })
  const { attributes, fontSizePercent, cssVars } = getHtmlAttributesForAppearance(prefs)
  assert.equal(fontSizePercent, "115%")
  assert.deepEqual(attributes, {
    "data-theme": "slate",
    "data-font": "plus-jakarta-sans",
    "data-mono-font": "fira-code",
    "data-line-height": "relaxed",
    "data-radius": "none",
    "data-density": "spacious",
    "data-width": "wide",
    "data-motion": "reduce",
    "data-contrast": "high",
    "data-surface-style": "liquid-glass",
    "data-surface-specular": "on",
  })
  assert.deepEqual(cssVars, {
    "--app-glass-opacity": "68%",
    "--app-glass-chrome-opacity": "74%",
    "--app-glass-popover-opacity": "78%",
    "--app-glass-blur": "24px",
    "--app-glass-saturation": "185%",
  })
  assert.equal(
    computeSurfaceGlassCssVars({ surfaceOpacity: 94, surfaceBlurPx: 20, surfaceSaturation: 160 })[
      "--app-glass-popover-opacity"
    ],
    "96%"
  )
})
