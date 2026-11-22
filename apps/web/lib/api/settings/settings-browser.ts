import { requestApi } from "../request.ts"
import { unwrapApiData } from "../response.ts"
import { pluginAssetPath, pluginSandboxDocumentPath, settingsPaths } from "./settings-paths.ts"
import type {
  PluginInstallPreviewResponse,
  PluginsCatalog,
  PluginSandboxDocumentResponse,
  PluginUninstallPreviewResponse,
  PreferencesPatch,
  PrivilegedSettingsPatch,
  SettingsExportResponse,
  SettingsPreviewResponse,
  SettingsResetScope,
  SettingsSnapshot,
} from "@/lib/settings/types"

async function mutate<T>(
  path: string,
  method: "POST" | "PATCH",
  input: unknown,
  signal?: AbortSignal,
  timeoutMs: number | null = 15_000
): Promise<T> {
  return unwrapApiData(
    await requestApi<T>(
      `/api${path}`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      },
      timeoutMs
    )
  )
}

export async function getBrowserSettings(signal?: AbortSignal): Promise<SettingsSnapshot> {
  return unwrapApiData(await requestApi<SettingsSnapshot>(`/api${settingsPaths.root}`, { method: "GET", signal }))
}

export async function updateBrowserPreferences(
  input: PreferencesPatch,
  signal?: AbortSignal
): Promise<SettingsSnapshot> {
  return mutate<SettingsSnapshot>(settingsPaths.preferences, "PATCH", input, signal)
}

export async function previewBrowserSettingsUpdate(
  input: PrivilegedSettingsPatch,
  signal?: AbortSignal
): Promise<SettingsPreviewResponse> {
  return mutate<SettingsPreviewResponse>(settingsPaths.preview, "POST", input, signal)
}

export async function executeBrowserSettingsUpdate(
  input: { previewId: string; confirm: boolean; acknowledgedRisks?: string[] },
  signal?: AbortSignal
): Promise<SettingsSnapshot> {
  return mutate<SettingsSnapshot>(settingsPaths.root, "PATCH", input, signal, null)
}

export async function exportBrowserSettings(signal?: AbortSignal): Promise<SettingsExportResponse> {
  return unwrapApiData(
    await requestApi<SettingsExportResponse>(`/api${settingsPaths.export}`, { method: "GET", signal })
  )
}

export async function previewBrowserSettingsImport(
  document: Record<string, unknown>,
  signal?: AbortSignal
): Promise<SettingsPreviewResponse> {
  return mutate<SettingsPreviewResponse>(settingsPaths.importPreview, "POST", { document }, signal)
}

export async function executeBrowserSettingsImport(
  input: { previewId: string; confirm: boolean; acknowledgedRisks?: string[] },
  signal?: AbortSignal
): Promise<SettingsSnapshot> {
  return mutate<SettingsSnapshot>(settingsPaths.importExecute, "POST", input, signal, null)
}

export async function previewBrowserSettingsReset(
  scope: SettingsResetScope,
  signal?: AbortSignal
): Promise<SettingsPreviewResponse> {
  return mutate<SettingsPreviewResponse>(settingsPaths.resetPreview, "POST", { scope }, signal)
}

export async function executeBrowserSettingsReset(
  input: { previewId: string; confirm: boolean; acknowledgedRisks?: string[] },
  signal?: AbortSignal
): Promise<SettingsSnapshot> {
  return mutate<SettingsSnapshot>(settingsPaths.resetExecute, "POST", input, signal, null)
}

export async function getBrowserPluginsCatalog(signal?: AbortSignal): Promise<PluginsCatalog> {
  return unwrapApiData(await requestApi<PluginsCatalog>(`/api${settingsPaths.plugins}`, { method: "GET", signal }))
}

export async function previewBrowserPluginInstallUrl(
  url: string,
  signal?: AbortSignal
): Promise<PluginInstallPreviewResponse> {
  return mutate<PluginInstallPreviewResponse>(settingsPaths.pluginsInstallPreview, "POST", { url }, signal, null)
}

export async function previewBrowserPluginInstallFile(
  file: File,
  signal?: AbortSignal
): Promise<PluginInstallPreviewResponse> {
  return unwrapApiData(
    await requestApi<PluginInstallPreviewResponse>(
      `/api${settingsPaths.pluginsInstallPreview}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-plugin-filename": encodeURIComponent(file.name),
        },
        body: file,
        signal,
      },
      null
    )
  )
}

export async function executeBrowserPluginInstall(
  input: { previewId: string; confirm: boolean; acknowledgedRisks?: string[] },
  signal?: AbortSignal
): Promise<SettingsSnapshot> {
  return mutate<SettingsSnapshot>(settingsPaths.pluginsInstallExecute, "POST", input, signal, null)
}

export async function previewBrowserPluginUninstall(
  pluginId: string,
  signal?: AbortSignal
): Promise<PluginUninstallPreviewResponse> {
  return mutate<PluginUninstallPreviewResponse>(settingsPaths.pluginsUninstallPreview, "POST", { pluginId }, signal)
}

export async function executeBrowserPluginUninstall(
  input: { previewId: string; confirm: boolean },
  signal?: AbortSignal
): Promise<SettingsSnapshot> {
  return mutate<SettingsSnapshot>(settingsPaths.pluginsUninstallExecute, "POST", input, signal, null)
}

export async function restoreBrowserDefaultPlugins(signal?: AbortSignal): Promise<SettingsSnapshot> {
  return mutate<SettingsSnapshot>(settingsPaths.pluginsRestoreDefaults, "POST", {}, signal, null)
}

export async function uploadBrowserWallpaperMedia(
  file: File,
  signal?: AbortSignal
): Promise<SettingsSnapshot> {
  return unwrapApiData(
    await requestApi<SettingsSnapshot>(
      `/api${settingsPaths.pluginsWallpaperMedia}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-plugin-filename": encodeURIComponent(file.name),
        },
        body: file,
        signal,
      },
      null
    )
  )
}

export async function getBrowserPluginSandboxDocument(
  pluginId: string,
  signal?: AbortSignal
): Promise<PluginSandboxDocumentResponse> {
  return unwrapApiData(
    await requestApi<PluginSandboxDocumentResponse>(`/api${pluginSandboxDocumentPath(pluginId)}`, {
      method: "GET",
      signal,
    })
  )
}

export function buildBrowserPluginAssetUrl(pluginId: string, assetPath: string): string {
  return `/api${pluginAssetPath(pluginId, assetPath)}`
}
