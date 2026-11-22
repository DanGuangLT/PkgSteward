import type { PrimitiveConfigValue, SettingsSnapshot } from "@/lib/settings/types"

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

export type BuiltinWallpaperMode = (typeof BUILTIN_WALLPAPER_MODES)[number]

export type ResolvedWallpaper =
  | { active: false }
  | {
      active: true
      sourcePluginId: string
      kind: "builtin-canvas" | "image" | "video" | "sandbox-html"
      builtinPreset?: "aurora" | "particles" | "waves" | "matrix" | "mesh"
      mediaUrl?: string
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

function isAllowedMediaRef(pluginId: string, assetPath: string, externalUrl: string): string | null {
  const trimmedAsset = assetPath.trim()
  if (trimmedAsset) {
    const clean = trimmedAsset.replace(/\\/g, "/").replace(/^\/+/, "")
    if (!clean.includes("..") && !clean.includes(":")) {
      const segments = clean.split("/").map((seg) => encodeURIComponent(seg))
      return `/api/settings/plugins/${encodeURIComponent(pluginId)}/assets/${segments.join("/")}`
    }
  }
  const trimmedUrl = externalUrl.trim()
  if (trimmedUrl) {
    try {
      const parsed = new URL(trimmedUrl)
      if (parsed.protocol === "https:") {
        return parsed.toString()
      }
    } catch {
      return null
    }
  }
  return null
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
    const src = isAllowedMediaRef(builtin.id, asset, url)
    if (!src) return { active: false }
    return {
      active: true,
      sourcePluginId: builtin.id,
      kind: mode,
      mediaUrl: src,
      ...tuning,
      pluginConfig: cfg,
    }
  }

  return { active: false }
}
