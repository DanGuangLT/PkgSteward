import "server-only"

import { apiFetchEnvelope } from "../client.ts"
import { settingsPaths } from "./settings-paths.ts"
import type { ApiResponse } from "@/lib/api/types"
import type {
  PluginsCatalog,
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
