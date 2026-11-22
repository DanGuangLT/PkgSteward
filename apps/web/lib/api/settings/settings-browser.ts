import { requestApi } from "../request.ts"
import { unwrapApiData } from "../response.ts"
import { settingsPaths } from "./settings-paths.ts"
import type {
  PluginsCatalog,
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
