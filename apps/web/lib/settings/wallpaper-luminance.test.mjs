import { test } from "node:test"
import assert from "node:assert/strict"
import {
  blendLuminanceWithDim,
  classifyWallpaperTone,
  computeRelativeLuminance,
  sampleElementAverageLuminance,
} from "./wallpaper-luminance.ts"

test("computeRelativeLuminance computes WCAG sRGB relative luminance across black, white, and gray", () => {
  assert.equal(computeRelativeLuminance(0, 0, 0), 0)
  assert.ok(Math.abs(computeRelativeLuminance(255, 255, 255) - 1) < 1e-6)
  assert.ok(computeRelativeLuminance(128, 128, 128) > 0.2)
  assert.ok(computeRelativeLuminance(128, 128, 128) < 0.25)
  assert.equal(computeRelativeLuminance(Number.NaN, 100, 100), 0)
})

test("blendLuminanceWithDim and classifyWallpaperTone account for dim overlay polarity", () => {
  const brightWallpaper = 0.85
  assert.equal(classifyWallpaperTone(blendLuminanceWithDim(brightWallpaper, 20, true)), "light")
  assert.equal(classifyWallpaperTone(blendLuminanceWithDim(brightWallpaper, 80, true)), "dark")

  const darkWallpaper = 0.1
  assert.equal(classifyWallpaperTone(blendLuminanceWithDim(darkWallpaper, 20, false)), "dark")
  assert.equal(classifyWallpaperTone(blendLuminanceWithDim(darkWallpaper, 75, false)), "light")

  assert.equal(classifyWallpaperTone(0.42), "light")
  assert.equal(classifyWallpaperTone(0.419), "dark")
})

test("sampleElementAverageLuminance returns null safely outside DOM without throwing", () => {
  assert.equal(sampleElementAverageLuminance({}), null)
})
