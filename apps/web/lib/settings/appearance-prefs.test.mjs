import { test } from "node:test"
import assert from "node:assert/strict"
import {
  appearanceEquals,
  DEFAULT_APPEARANCE,
  getHtmlAttributesForAppearance,
  parseAppearanceCookie,
  sanitizeAppearance,
  serializeAppearanceCookie,
} from "./appearance-prefs.ts"

test("DEFAULT_APPEARANCE disables global breadcrumb strip by default", () => {
  assert.equal(DEFAULT_APPEARANCE.showBreadcrumbs, false)
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
  assert.equal("extraInjection" in sanitized, false)

  const invalid = sanitizeAppearance({ themePreset: "evil\" onerror=1", fontScale: 999 }, "emerald")
  assert.equal(invalid.themePreset, "emerald")
  assert.equal(invalid.fontScale, DEFAULT_APPEARANCE.fontScale)
})

test("parseAppearanceCookie round-trips cleanly and falls back safely on malformed JSON", () => {
  const custom = sanitizeAppearance({ themePreset: "violet", density: "compact", sidebarCollapsed: true })
  const raw = serializeAppearanceCookie(custom)
  assert.equal(appearanceEquals(parseAppearanceCookie(raw), custom), true)
  assert.deepEqual(parseAppearanceCookie("{bad json", "amber").themePreset, "amber")
  assert.deepEqual(parseAppearanceCookie(undefined).themePreset, "default")
})

test("getHtmlAttributesForAppearance produces expected attributes and root font-size", () => {
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
  })
  const { attributes, fontSizePercent } = getHtmlAttributesForAppearance(prefs)
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
  })
})
