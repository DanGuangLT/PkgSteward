export const settingsPaths = {
  root: "/settings",
  preferences: "/settings/preferences",
  preview: "/settings/preview",
  export: "/settings/export",
  importPreview: "/settings/import/preview",
  importExecute: "/settings/import",
  resetPreview: "/settings/reset/preview",
  resetExecute: "/settings/reset",
  plugins: "/settings/plugins",
  pluginsInstallPreview: "/settings/plugins/install/preview",
  pluginsInstallExecute: "/settings/plugins/install",
  pluginsUninstallPreview: "/settings/plugins/uninstall/preview",
  pluginsUninstallExecute: "/settings/plugins/uninstall",
  pluginsRestoreDefaults: "/settings/plugins/restore-defaults",
  pluginsWallpaperMedia: "/settings/plugins/wallpaper-media",
} as const

export function pluginSandboxDocumentPath(pluginId: string): string {
  return `/settings/plugins/${encodeURIComponent(pluginId)}/sandbox-document`
}

export function pluginAssetPath(pluginId: string, assetPath: string): string {
  const clean = assetPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `/settings/plugins/${encodeURIComponent(pluginId)}/assets/${clean}`
}
