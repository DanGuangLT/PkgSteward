import { test } from "node:test"
import assert from "node:assert/strict"
import {
  appearanceEquals,
  computeSurfaceGlassCssVars,
  computeTextReadabilityCssVars,
  DEFAULT_APPEARANCE,
  getHtmlAttributesForAppearance,
  normalizeOptionalHexColor,
  parseAppearanceCookie,
  sanitizeAppearance,
  serializeAppearanceCookie,
  SURFACE_STYLE_PRESETS,
  TEXT_SHADOW_PRESETS,
} from "./appearance-prefs.ts"

test("DEFAULT_APPEARANCE disables global breadcrumb strip and sets auto text readability on solid surface", () => {
  assert.equal(DEFAULT_APPEARANCE.showBreadcrumbs, false)
  assert.equal(DEFAULT_APPEARANCE.surfaceStyle, "solid")
  assert.equal(DEFAULT_APPEARANCE.surfaceOpacity, 100)
  assert.equal(DEFAULT_APPEARANCE.surfaceBlurPx, 0)
  assert.equal(DEFAULT_APPEARANCE.surfaceSaturation, 100)
  assert.equal(DEFAULT_APPEARANCE.surfaceSpecularBorder, false)
  assert.equal(DEFAULT_APPEARANCE.textReadabilityMode, "auto")
  assert.equal(DEFAULT_APPEARANCE.textColorMode, "theme")
  assert.equal(DEFAULT_APPEARANCE.textCustomColor, null)
  assert.equal(DEFAULT_APPEARANCE.textShadowStrength, "auto")
  assert.equal(DEFAULT_APPEARANCE.textShadowBlurPx, 8)
  assert.equal(DEFAULT_APPEARANCE.textShadowOpacity, 78)
  assert.equal(DEFAULT_APPEARANCE.textOutlineWidthPx, 0)
  assert.equal(DEFAULT_APPEARANCE.textBoostMuted, true)
  assert.equal(DEFAULT_APPEARANCE.textEffectScope, "wallpaper-only")
})

test("sanitizeAppearance rejects unknown/XSS values and preserves valid enum and hex choices", () => {
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
      textReadabilityMode: "custom",
      textColorMode: "custom",
      textCustomColor: "#FDE68A",
      textShadowStrength: "halo",
      textShadowBlurPx: 14,
      textShadowOpacity: 92,
      textOutlineWidthPx: 2,
      textBoostMuted: false,
      textEffectScope: "always",
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
  assert.equal(sanitized.textReadabilityMode, "custom")
  assert.equal(sanitized.textColorMode, "custom")
  assert.equal(sanitized.textCustomColor, "#fde68a")
  assert.equal(sanitized.textShadowStrength, "halo")
  assert.equal(sanitized.textShadowBlurPx, 14)
  assert.equal(sanitized.textShadowOpacity, 92)
  assert.equal(sanitized.textOutlineWidthPx, 2)
  assert.equal(sanitized.textBoostMuted, false)
  assert.equal(sanitized.textEffectScope, "always")
  assert.equal("extraInjection" in sanitized, false)

  const invalid = sanitizeAppearance(
    {
      themePreset: "evil\" onerror=1",
      fontScale: 999,
      surfaceStyle: "glass-bad",
      surfaceOpacity: 10,
      surfaceBlurPx: 99,
      surfaceSaturation: 500,
      textReadabilityMode: "bad",
      textColorMode: "bad",
      textCustomColor: "expression(alert(1))",
      textShadowStrength: "bad",
      textShadowBlurPx: 99,
      textShadowOpacity: 200,
      textOutlineWidthPx: 8,
      textEffectScope: "bad",
    },
    "emerald"
  )
  assert.equal(invalid.themePreset, "emerald")
  assert.equal(invalid.fontScale, DEFAULT_APPEARANCE.fontScale)
  assert.equal(invalid.surfaceStyle, "solid")
  assert.equal(invalid.surfaceOpacity, 100)
  assert.equal(invalid.surfaceBlurPx, 0)
  assert.equal(invalid.surfaceSaturation, 100)
  assert.equal(invalid.textReadabilityMode, "auto")
  assert.equal(invalid.textColorMode, "theme")
  assert.equal(invalid.textCustomColor, null)
  assert.equal(invalid.textShadowStrength, "auto")
  assert.equal(invalid.textShadowBlurPx, 8)
  assert.equal(invalid.textShadowOpacity, 78)
  assert.equal(invalid.textOutlineWidthPx, 0)
  assert.equal(invalid.textEffectScope, "wallpaper-only")

  assert.equal(normalizeOptionalHexColor("#AABBCC"), "#aabbcc")
  assert.equal(normalizeOptionalHexColor("#fff"), null)

  const partialGlass = sanitizeAppearance({ surfaceStyle: "crystal", textShadowStrength: "strong" })
  assert.deepEqual(
    {
      surfaceOpacity: partialGlass.surfaceOpacity,
      surfaceBlurPx: partialGlass.surfaceBlurPx,
      surfaceSaturation: partialGlass.surfaceSaturation,
      surfaceSpecularBorder: partialGlass.surfaceSpecularBorder,
    },
    SURFACE_STYLE_PRESETS.crystal
  )
  assert.equal(partialGlass.textShadowBlurPx, TEXT_SHADOW_PRESETS.strong.textShadowBlurPx)
  assert.equal(partialGlass.textShadowOpacity, TEXT_SHADOW_PRESETS.strong.textShadowOpacity)
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
    textReadabilityMode: "custom",
    textColorMode: "custom",
    textCustomColor: "#93c5fd",
    textShadowStrength: "strong",
    textOutlineWidthPx: 1,
    textBoostMuted: true,
    textEffectScope: "always",
  })
  const raw = serializeAppearanceCookie(custom)
  assert.equal(appearanceEquals(parseAppearanceCookie(raw), custom), true)
  assert.deepEqual(parseAppearanceCookie("{bad json", "amber").themePreset, "amber")
  assert.deepEqual(parseAppearanceCookie(undefined).themePreset, "default")
})

test("getHtmlAttributesForAppearance produces expected attributes, root font-size, and glass+text cssVars", () => {
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
    textReadabilityMode: "custom",
    textColorMode: "custom",
    textCustomColor: "#fef08a",
    textShadowStrength: "halo",
    textShadowBlurPx: 16,
    textShadowOpacity: 96,
    textOutlineWidthPx: 2,
    textBoostMuted: true,
    textEffectScope: "always",
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
    "data-text-readability": "custom",
    "data-text-color-mode": "custom",
    "data-text-shadow": "halo",
    "data-text-outline": "on",
    "data-text-boost-muted": "on",
    "data-text-scope": "always",
  })
  assert.deepEqual(cssVars, {
    "--app-glass-opacity": "68%",
    "--app-glass-chrome-opacity": "74%",
    "--app-glass-popover-opacity": "78%",
    "--app-glass-muted-opacity": "58%",
    "--app-glass-input-opacity": "72%",
    "--app-glass-blur": "24px",
    "--app-glass-saturation": "185%",
    "--app-text-shadow-blur": "16px",
    "--app-text-shadow-opacity": "96%",
    "--app-text-outline-width": "2px",
    "--app-text-custom-color": "#fef08a",
  })
  assert.equal(
    computeSurfaceGlassCssVars({ surfaceOpacity: 94, surfaceBlurPx: 20, surfaceSaturation: 160 })[
      "--app-glass-popover-opacity"
    ],
    "96%"
  )
  assert.equal(
    computeTextReadabilityCssVars({
      textShadowBlurPx: 6,
      textShadowOpacity: 50,
      textOutlineWidthPx: 1,
      textCustomColor: null,
    })["--app-text-custom-color"],
    "currentColor"
  )
})
