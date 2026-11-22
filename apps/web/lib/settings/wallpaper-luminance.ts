export type WallpaperTone = "light" | "dark" | "unknown"

function normalizeChannel(channel255: number): number {
  const srgb = Math.min(Math.max(channel255 / 255, 0), 1)
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

/**
 * Computes WCAG relative luminance in [0, 1] from 8-bit sRGB channels.
 */
export function computeRelativeLuminance(r: number, g: number, b: number): number {
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return 0
  const luminance =
    0.2126 * normalizeChannel(r) + 0.7152 * normalizeChannel(g) + 0.0722 * normalizeChannel(b)
  return Math.min(Math.max(luminance, 0), 1)
}

/**
 * Blends background image/video luminance with the wallpaper dim overlay layer.
 */
export function blendLuminanceWithDim(
  imageLuminance: number,
  dimOpacityPercent: number,
  themeIsDark: boolean
): number {
  const baseLum = Number.isFinite(imageLuminance) ? Math.min(Math.max(imageLuminance, 0), 1) : 0
  const alpha = Number.isFinite(dimOpacityPercent)
    ? Math.min(Math.max(dimOpacityPercent, 0), 100) / 100
    : 0
  const overlayLum = themeIsDark ? 0.015 : 0.98
  return Math.min(Math.max(baseLum * (1 - alpha) + overlayLum * alpha, 0), 1)
}

/**
 * Classifies effective backdrop luminance into a light or dark wallpaper tone.
 */
export function classifyWallpaperTone(effectiveLuminance: number): "light" | "dark" {
  return Number.isFinite(effectiveLuminance) && effectiveLuminance >= 0.42 ? "light" : "dark"
}

/**
 * Samples average perceived luminance from a loaded <img> or <video> without throwing
 * when cross-origin restrictions taint the temporary 2D canvas.
 */
export function sampleElementAverageLuminance(
  source: HTMLImageElement | HTMLVideoElement
): number | null {
  if (typeof document === "undefined") return null

  const width =
    "naturalWidth" in source ? source.naturalWidth : source.videoWidth
  const height =
    "naturalHeight" in source ? source.naturalHeight : source.videoHeight
  if (!width || !height) return null

  try {
    const sampleSize = 24
    const canvas = document.createElement("canvas")
    canvas.width = sampleSize
    canvas.height = sampleSize
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(source, 0, 0, sampleSize, sampleSize)
    const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize)
    if (!data || data.length === 0) return null

    let totalLum = 0
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      const alpha = (data[i + 3] ?? 255) / 255
      if (alpha <= 0.05) continue
      totalLum += computeRelativeLuminance(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
      count += 1
    }
    return count > 0 ? totalLum / count : null
  } catch {
    // Cross-origin image/video without CORS headers taints getImageData; degrade safely.
    return null
  }
}
