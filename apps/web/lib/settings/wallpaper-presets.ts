import type { PrimitiveConfigValue, SettingsSnapshot } from "./types.ts"

export const DEFAULT_WALLPAPER_PLUGIN_ID = "wallpaper-engine"

export const BUILTIN_WALLPAPER_MODES = [
  "off",
  "aurora",
  "particles",
  "waves",
  "matrix",
  "mesh",
  "image",
  "video",
] as const

export const BUILTIN_WALLPAPER_ANIMATION_MODES = [
  "off",
  "aurora",
  "particles",
  "waves",
  "matrix",
  "mesh",
] as const

export type BuiltinWallpaperMode = (typeof BUILTIN_WALLPAPER_MODES)[number]
export type WallpaperMediaSource = "local" | "url"

export type ResolvedWallpaper =
  | { active: false }
  | {
      active: true
      sourcePluginId: string
      kind: "builtin-canvas" | "image" | "video" | "sandbox-html"
      builtinPreset?: "aurora" | "particles" | "waves" | "matrix" | "mesh"
      mediaUrl?: string
      mediaSource?: WallpaperMediaSource
      blurPx: number
      dimOpacity: number
      surfaceOpacity: number
      speed: number
      pauseWhenHidden: boolean
      pluginConfig: Record<string, PrimitiveConfigValue>
    }

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const num = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

export function normalizeWallpaperMediaUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (!trimmed) return ""
  try {
    const parsed = new URL(trimmed)
    const isGoogleImgres =
      /(^|\.)google\.[a-z.]+$/i.test(parsed.hostname) && parsed.pathname === "/imgres"
    if (isGoogleImgres) {
      const directImgUrl = parsed.searchParams.get("imgurl")?.trim()
      if (directImgUrl) {
        const directParsed = new URL(directImgUrl)
        if (
          directParsed.protocol === "https:" &&
          directParsed.username === "" &&
          directParsed.password === ""
        ) {
          return directParsed.toString()
        }
      }
    }
  } catch {
    return trimmed
  }
  return trimmed
}

export function inferMediaKindFromUrl(url: string): "image" | "video" {
  try {
    const parsed = new URL(normalizeWallpaperMediaUrl(url))
    return /\.(mp4|webm|ogg)$/i.test(parsed.pathname) ? "video" : "image"
  } catch {
    return /\.(mp4|webm|ogg)(?:[?#].*)?$/i.test(url.trim()) ? "video" : "image"
  }
}

export function inferMediaKindFromAsset(assetPath: string): "image" | "video" {
  return /\.(mp4|webm|ogg)$/i.test(assetPath.trim()) ? "video" : "image"
}

export function resolveWallpaperMediaSource(
  config: Record<string, PrimitiveConfigValue>
): WallpaperMediaSource {
  if (config.mediaSource === "url") return "url"
  if (config.mediaSource === "local") return "local"
  const asset = typeof config.mediaAsset === "string" ? config.mediaAsset.trim() : ""
  if (asset) return "local"
  const url = typeof config.mediaUrl === "string" ? config.mediaUrl.trim() : ""
  if (url) return "url"
  return "local"
}

export function buildPluginAssetUrl(pluginId: string, assetPath: string): string | null {
  const trimmedAsset = assetPath.trim()
  if (!trimmedAsset) return null
  const clean = trimmedAsset.replace(/\\/g, "/").replace(/^\/+/, "")
  if (clean.includes("..") || clean.includes(":")) return null
  const segments = clean.split("/").map((seg) => encodeURIComponent(seg))
  return `/api/settings/plugins/${encodeURIComponent(pluginId)}/assets/${segments.join("/")}`
}

function isAllowedMediaRef(
  pluginId: string,
  assetPath: string,
  externalUrl: string,
  preferredSource?: WallpaperMediaSource
): string | null {
  const resolveLocal = () => buildPluginAssetUrl(pluginId, assetPath)
  const resolveUrl = () => {
    const normalizedUrl = normalizeWallpaperMediaUrl(externalUrl)
    if (!normalizedUrl) return null
    try {
      const parsed = new URL(normalizedUrl)
      if (parsed.protocol === "https:" && parsed.username === "" && parsed.password === "") {
        return parsed.toString()
      }
    } catch {
      return null
    }
    return null
  }

  if (preferredSource === "url") return resolveUrl()
  if (preferredSource === "local") return resolveLocal()
  return resolveLocal() ?? resolveUrl()
}

function resolveVisualTuning(config: Record<string, PrimitiveConfigValue>) {
  return {
    blurPx: clampNumber(config.blurPx, 0, 32, 8),
    dimOpacity: clampNumber(config.dimOpacity, 0, 85, 30),
    surfaceOpacity: clampNumber(config.surfaceOpacity, 45, 100, 86),
    speed: clampNumber(config.speed, 25, 250, 100),
    pauseWhenHidden: config.pauseWhenHidden !== false,
  }
}

export function resolveActiveWallpaper(snapshot: SettingsSnapshot | null): ResolvedWallpaper {
  if (
    !snapshot ||
    !snapshot.document.plugins.enabled ||
    !snapshot.document.plugins.allowLocalPlugins
  ) {
    return { active: false }
  }

  const discovered = snapshot.plugins.discovered
  const entries = snapshot.document.plugins.entries

  // 1. Prefer enabled external live-wallpaper plugins (web-sandbox, media-image, media-video)
  for (const plugin of discovered) {
    if (plugin.id === DEFAULT_WALLPAPER_PLUGIN_ID) continue
    const isEnabled = entries[plugin.id]?.enabled ?? plugin.enabled
    if (!isEnabled || !plugin.capabilities.includes("live-wallpaper")) continue

    const mergedConfig: Record<string, PrimitiveConfigValue> = {
      ...plugin.config,
      ...(entries[plugin.id]?.config ?? {}),
    }
    const tuning = resolveVisualTuning(mergedConfig)

    if (plugin.entry.kind === "web-sandbox" && plugin.entry.file) {
      return {
        active: true,
        sourcePluginId: plugin.id,
        kind: "sandbox-html",
        ...tuning,
        pluginConfig: mergedConfig,
      }
    }
    if ((plugin.entry.kind === "media-image" || plugin.entry.kind === "media-video") && plugin.entry.file) {
      const src = isAllowedMediaRef(plugin.id, plugin.entry.file, "")
      if (src) {
        return {
          active: true,
          sourcePluginId: plugin.id,
          kind: plugin.entry.kind === "media-video" ? "video" : "image",
          mediaUrl: src,
          ...tuning,
          pluginConfig: mergedConfig,
        }
      }
    }
  }

  // 2. Fall back to pre-installed Live Wallpaper Engine plugin when installed & enabled
  const builtin = discovered.find((plugin) => plugin.id === DEFAULT_WALLPAPER_PLUGIN_ID)
  if (!builtin) {
    return { active: false }
  }
  const builtinEnabled = entries[DEFAULT_WALLPAPER_PLUGIN_ID]?.enabled ?? builtin.enabled
  if (!builtinEnabled) {
    return { active: false }
  }

  const cfg: Record<string, PrimitiveConfigValue> = {
    ...builtin.config,
    ...(entries[DEFAULT_WALLPAPER_PLUGIN_ID]?.config ?? {}),
  }
  const mode = typeof cfg.mode === "string" ? cfg.mode.trim().toLowerCase() : "off"
  if (mode === "off" || mode === "") {
    return { active: false }
  }

  const tuning = resolveVisualTuning(cfg)
  if (mode === "aurora" || mode === "particles" || mode === "waves" || mode === "matrix" || mode === "mesh") {
    return {
      active: true,
      sourcePluginId: builtin.id,
      kind: "builtin-canvas",
      builtinPreset: mode,
      ...tuning,
      pluginConfig: cfg,
    }
  }

  if (mode === "image" || mode === "video") {
    const asset = typeof cfg.mediaAsset === "string" ? cfg.mediaAsset : ""
    const url = typeof cfg.mediaUrl === "string" ? cfg.mediaUrl : ""
    const preferredSource = resolveWallpaperMediaSource(cfg)
    const src = isAllowedMediaRef(builtin.id, asset, url, preferredSource)
    if (!src) return { active: false }
    const kind =
      preferredSource === "url" ? inferMediaKindFromUrl(src) : inferMediaKindFromAsset(asset)
    return {
      active: true,
      sourcePluginId: builtin.id,
      kind,
      mediaUrl: src,
      mediaSource: preferredSource,
      ...tuning,
      pluginConfig: cfg,
    }
  }

  return { active: false }
}
