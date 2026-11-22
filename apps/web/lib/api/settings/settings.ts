import "server-only"

import { apiFetchEnvelope } from "../client.ts"
import { pluginSandboxDocumentPath, settingsPaths } from "./settings-paths.ts"
import type { ApiResponse } from "@/lib/api/types"
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

const jsonInit = (method: "POST" | "PATCH", body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

export function getSettings(signal?: AbortSignal): Promise<ApiResponse<SettingsSnapshot>> {
  return apiFetchEnvelope<SettingsSnapshot>(settingsPaths.root, { method: "GET", signal })
}

export function updatePreferences(input: PreferencesPatch): Promise<ApiResponse<SettingsSnapshot>> {
  return apiFetchEnvelope<SettingsSnapshot>(settingsPaths.preferences, jsonInit("PATCH", input))
}

export function previewSettingsUpdate(input: PrivilegedSettingsPatch): Promise<ApiResponse<SettingsPreviewResponse>> {
  return apiFetchEnvelope<SettingsPreviewResponse>(settingsPaths.preview, jsonInit("POST", input))
}

export function executeSettingsUpdate(input: {
  previewId: string
  confirm: boolean
  acknowledgedRisks?: string[]
}): Promise<ApiResponse<SettingsSnapshot>> {
  return apiFetchEnvelope<SettingsSnapshot>(settingsPaths.root, jsonInit("PATCH", input), null)
}

export function exportSettings(signal?: AbortSignal): Promise<ApiResponse<SettingsExportResponse>> {
  return apiFetchEnvelope<SettingsExportResponse>(settingsPaths.export, { method: "GET", signal })
}

export function previewSettingsImport(document: Record<string, unknown>): Promise<ApiResponse<SettingsPreviewResponse>> {
  return apiFetchEnvelope<SettingsPreviewResponse>(settingsPaths.importPreview, jsonInit("POST", { document }))
}

export function executeSettingsImport(input: {
  previewId: string
  confirm: boolean
  acknowledgedRisks?: string[]
}): Promise<ApiResponse<SettingsSnapshot>> {
  return apiFetchEnvelope<SettingsSnapshot>(settingsPaths.importExecute, jsonInit("POST", input), null)
}

export function previewSettingsReset(scope: SettingsResetScope): Promise<ApiResponse<SettingsPreviewResponse>> {
  return apiFetchEnvelope<SettingsPreviewResponse>(settingsPaths.resetPreview, jsonInit("POST", { scope }))
}

export function executeSettingsReset(input: {
  previewId: string
  confirm: boolean
  acknowledgedRisks?: string[]
}): Promise<ApiResponse<SettingsSnapshot>> {
  return apiFetchEnvelope<SettingsSnapshot>(settingsPaths.resetExecute, jsonInit("POST", input), null)
}

export function getPluginsCatalog(signal?: AbortSignal): Promise<ApiResponse<PluginsCatalog>> {
  return apiFetchEnvelope<PluginsCatalog>(settingsPaths.plugins, { method: "GET", signal })
}

export function previewPluginInstallJson(input: {
  url?: string
  fileName?: string
  contentBase64?: string
}): Promise<ApiResponse<PluginInstallPreviewResponse>> {
  return apiFetchEnvelope<PluginInstallPreviewResponse>(
    settingsPaths.pluginsInstallPreview,
    jsonInit("POST", input),
    null
  )
}

export function previewPluginInstallBinary(
  fileNameHeader: string,
  bytes: ArrayBuffer
): Promise<ApiResponse<PluginInstallPreviewResponse>> {
  return apiFetchEnvelope<PluginInstallPreviewResponse>(
    settingsPaths.pluginsInstallPreview,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-plugin-filename": fileNameHeader,
      },
      body: bytes,
    },
    null
  )
}

export function executePluginInstall(input: {
  previewId: string
  confirm: boolean
  acknowledgedRisks?: string[]
}): Promise<ApiResponse<SettingsSnapshot>> {
  return apiFetchEnvelope<SettingsSnapshot>(settingsPaths.pluginsInstallExecute, jsonInit("POST", input), null)
}

export function previewPluginUninstall(input: { pluginId: string }): Promise<ApiResponse<PluginUninstallPreviewResponse>> {
  return apiFetchEnvelope<PluginUninstallPreviewResponse>(settingsPaths.pluginsUninstallPreview, jsonInit("POST", input))
}

export function executePluginUninstall(input: {
  previewId: string
  confirm: boolean
}): Promise<ApiResponse<SettingsSnapshot>> {
  return apiFetchEnvelope<SettingsSnapshot>(settingsPaths.pluginsUninstallExecute, jsonInit("POST", input), null)
}

export function restoreDefaultPlugins(): Promise<ApiResponse<SettingsSnapshot>> {
  return apiFetchEnvelope<SettingsSnapshot>(settingsPaths.pluginsRestoreDefaults, jsonInit("POST", {}), null)
}

export function uploadWallpaperMediaJson(input: {
  fileName: string
  contentBase64: string
}): Promise<ApiResponse<SettingsSnapshot>> {
  return apiFetchEnvelope<SettingsSnapshot>(
    settingsPaths.pluginsWallpaperMedia,
    jsonInit("POST", input),
    null
  )
}

export function uploadWallpaperMediaBinary(
  fileNameHeader: string,
  bytes: ArrayBuffer
): Promise<ApiResponse<SettingsSnapshot>> {
  return apiFetchEnvelope<SettingsSnapshot>(
    settingsPaths.pluginsWallpaperMedia,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-plugin-filename": fileNameHeader,
      },
      body: bytes,
    },
    null
  )
}

export function getPluginSandboxDocument(
  pluginId: string,
  signal?: AbortSignal
): Promise<ApiResponse<PluginSandboxDocumentResponse>> {
  return apiFetchEnvelope<PluginSandboxDocumentResponse>(pluginSandboxDocumentPath(pluginId), { method: "GET", signal })
}
