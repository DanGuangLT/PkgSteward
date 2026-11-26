import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const GLOBALS_CSS_PATH = new URL("../../app/globals.css", import.meta.url)

function readGlobalsCss() {
  return readFileSync(GLOBALS_CSS_PATH, "utf8")
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `Expected marker in globals.css: ${startMarker}`)
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length
  assert.notEqual(end, -1, `Expected end marker after ${startMarker}: ${endMarker}`)
  return source.slice(start, end)
}

test("Liquid Glass primary surface rules cover bordered .bg-background panels scoped away from wallpaper dimmer and theme swatches", () => {
  const css = readGlobalsCss()
  const primarySection = sliceBetween(
    css,
    "/* Apple Liquid Glass & Frosted surface materials",
    "/* Floating overlays retain elevated shadow",
  )

  for (const scope of [
    "main",
    '[data-slot="dialog-content"]',
    '[data-slot="alert-dialog-content"]',
    '[data-slot="sheet-content"]',
  ]) {
    assert.ok(primarySection.includes(scope), `Missing scoped container ${scope} in primary glass rules`)
  }

  assert.match(
    primarySection,
    /\.bg-background:is\(\.border,\s*\.border-x,\s*\.border-t,\s*\.border-b\):not\(\[data-surface-exempt\]\)/,
    "Expected bordered .bg-background selector with :not([data-surface-exempt])",
  )
})

test("Liquid Glass covers select triggers, outline buttons, native selects/textareas, empty icon badge, tabs trigger, dropdown sub-menus, and p.bg-muted", () => {
  const css = readGlobalsCss()
  const primarySection = sliceBetween(
    css,
    "/* Apple Liquid Glass & Frosted surface materials",
    "/* Floating overlays retain elevated shadow",
  )

  for (const required of [
    '[data-slot="select-trigger"]',
    '[data-slot="button"][data-variant="outline"]',
    '[data-slot="empty-icon"][data-variant="icon"]',
    ":is(select, textarea).bg-background",
    '[data-slot="tabs-list"][data-variant="default"] [data-slot="tabs-trigger"]',
    '[data-slot="dropdown-menu-sub-content"]',
    '[data-slot="select-scroll-up-button"]',
    '[data-slot="select-scroll-down-button"]',
    ":is(div, section, pre, ul, dl, article, form, p).bg-muted:not([data-surface-exempt])",
    "select.bg-background option",
  ]) {
    assert.ok(primarySection.includes(required), `Missing ${required} in primary glass rules`)
  }
})

test("Nested glass stacking prevents double backdrop-filter and scales opacity proportionally", () => {
  const css = readGlobalsCss()
  const primarySection = sliceBetween(
    css,
    "/* Apple Liquid Glass & Frosted surface materials",
    "/* Inline glass surfaces use inset-only specular rims",
  )
  const wallpaperFallbackSection = sliceBetween(
    css,
    "/* Fallback translucency when live wallpaper runs",
    "/* Apple Liquid Glass & Frosted surface materials",
  )

  assert.ok(
    primarySection.includes("calc(var(--app-glass-opacity, 84%) * 0.52)"),
    "Expected nested panel opacity scaling (* 0.52)",
  )
  assert.ok(
    primarySection.includes("calc(var(--app-glass-input-opacity, 78%) * 0.62)"),
    "Expected nested control opacity scaling (* 0.62)",
  )
  assert.ok(
    primarySection.includes(':not([data-slot="glass-preview-panel"])'),
    "Expected live glass preview panel exclusion inside nested glass rule",
  )
  assert.ok(
    wallpaperFallbackSection.includes("calc(var(--wallpaper-surface-opacity, 86%) * 0.52)"),
    "Expected nested panel opacity scaling (* 0.52) in wallpaper solid fallback",
  )
})

test("Specular rim and luminous border rules include bordered .bg-background panels and dropdown sub-content while keeping semantic border exemptions", () => {
  const css = readGlobalsCss()
  const specularSection = sliceBetween(
    css,
    "/* Inline glass surfaces use inset-only specular rims",
    "@supports not ((backdrop-filter: blur(1px))",
  )

  assert.match(
    specularSection,
    /:is\(div,\s*section,\s*article,\s*dl,\s*details,\s*form\)\.bg-background:is\(\.border,\s*\.border-x,\s*\.border-t,\s*\.border-b\):not\(\[data-surface-exempt\]\)/,
  )
  assert.ok(specularSection.includes('[data-slot="dropdown-menu-sub-content"]'))
  for (const preserved of [
    ":not(.border-foreground)",
    ":not(.border-primary)",
    ":not(.border-destructive)",
    ":not(.border-warning)",
  ]) {
    assert.ok(specularSection.includes(preserved), `Specular border rule must keep ${preserved}`)
  }
})

test("@supports not and prefers-reduced-transparency fallbacks cover bordered .bg-background panels, p.bg-muted, controls, and sub-menus", () => {
  const css = readGlobalsCss()
  const supportsSection = sliceBetween(
    css,
    "@supports not ((backdrop-filter: blur(1px))",
    "@media (prefers-reduced-transparency: reduce)",
  )
  const reducedSection = sliceBetween(
    css,
    "@media (prefers-reduced-transparency: reduce)",
    "/* Adaptive Text Readability:",
  )

  for (const section of [supportsSection, reducedSection]) {
    assert.match(
      section,
      /\.bg-background:is\(\.border,\s*\.border-x,\s*\.border-t,\s*\.border-b\):not\(\[data-surface-exempt\]\)/,
    )
    assert.ok(section.includes('[data-slot="select-trigger"]'))
    assert.ok(section.includes('[data-slot="button"][data-variant="outline"]'))
    assert.ok(section.includes(":is(select, textarea).bg-background"))
    assert.ok(section.includes('[data-slot="dropdown-menu-sub-content"]'))
  }

  assert.ok(
    reducedSection.includes(":is(div, section, pre, ul, dl, article, form, p).bg-muted:not([data-surface-exempt])"),
  )
  assert.ok(reducedSection.includes('[data-slot="empty-icon"][data-variant="icon"]'))
  assert.ok(reducedSection.includes('[data-slot="tabs-list"][data-variant="default"] [data-slot="tabs-trigger"]'))
})
