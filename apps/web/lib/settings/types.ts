export type SettingsThemeMode = "light" | "dark" | "system"
export type SettingsThemePreset = "default" | "ocean" | "emerald" | "slate" | "amber" | "violet"
export type SettingsFontFamily = "inter" | "be-vietnam-pro" | "plus-jakarta-sans" | "roboto" | "system"
export type SettingsMonoFontFamily = "geist-mono" | "jetbrains-mono" | "fira-code" | "system"
export type SettingsFontScale = 85 | 90 | 95 | 100 | 105 | 110 | 115 | 120
export type SettingsLineHeight = "tight" | "normal" | "relaxed"
export type SettingsRadius = "none" | "sharp" | "compact" | "default" | "rounded"
export type SettingsDensity = "compact" | "comfortable" | "spacious"
export type SettingsContentWidth = "narrow" | "standard" | "wide" | "full"
export type SettingsNavigationLayout = "topbar" | "sidebar"
export type SettingsReducedMotion = "system" | "reduce" | "normal"

export type SettingsLocale = "vi" | "en"
export type SettingsConsoleShell = "cmd" | "powershell"
export type SettingsPageSize = 10 | 25 | 50 | 100
export type SettingsDateFormat = "relative" | "absolute" | "iso"

export type PrimitiveConfigValue = string | number | boolean | null

export interface RuntimeSettings {
  scanRootPaths: string
  maxScanDepth: number
  scanTimeoutMs: number | null
  npmCommandTimeoutMs: number | null
}

export interface ServerSettings {
  mode: "development" | "production"
  host: "127.0.0.1" | "localhost" | "::1"
  port: number
  globalPrefix: string
  version: string
  listOriginCors: string
  exportSwaggerApiJson: boolean
}

export interface AppearanceSettings {
  themeMode: SettingsThemeMode
  themePreset: SettingsThemePreset
  fontFamily: SettingsFontFamily
  monoFontFamily: SettingsMonoFontFamily
  fontScale: SettingsFontScale
  lineHeight: SettingsLineHeight
  radius: SettingsRadius
  density: SettingsDensity
  contentWidth: SettingsContentWidth
  navigationLayout: SettingsNavigationLayout
  sidebarCollapsed: boolean
  reducedMotion: SettingsReducedMotion
  highContrastBorders: boolean
  showBreadcrumbs: boolean
}

export interface BehaviorSettings {
  locale: SettingsLocale
  defaultConsoleShell: SettingsConsoleShell
  defaultPageSize: SettingsPageSize
  paginationEnabled: boolean
  showPageSizeSelector: boolean
  scrollToTopOnPageChange: boolean
  autoRefreshOnFocus: boolean
  confirmBeforeNavigation: boolean
  dateFormat: SettingsDateFormat
  showDesignSystemInNav: boolean
  advancedMode: boolean
}

export interface PluginEntrySetting {
  enabled: boolean
  version?: string
  source?: "builtin" | "local" | "npm"
  config: Record<string, PrimitiveConfigValue>
}

export interface PluginsSettings {
  enabled: boolean
  directory: string | null
  allowLocalPlugins: boolean
  trustedRegistries: string[]
  removedPreinstalled: string[]
  entries: Record<string, PluginEntrySetting>
}

export interface SettingsDocument {
  schemaVersion: 1
  runtime: RuntimeSettings
  server: ServerSettings
  appearance: AppearanceSettings
  behavior: BehaviorSettings
  plugins: PluginsSettings
  desktop: Record<string, PrimitiveConfigValue>
}

export type SettingValueSource = "default" | "env" | "settings"

export interface SystemPathsSummary {
  settingsFilePath: string
  dataDir: string
  logsDir: string
  cacheDir: string
  pluginsDir: string
  auditLogFilePath: string
  appInstallDir: string
  sourceCheckoutDir: string | null
  platform: string
  nodeVersion: string
}

export const PLUGIN_ID_REGEX = /^[a-z0-9][a-z0-9._-]{0,63}$/

export type PluginManifestFormat =
  | "manifest.json"
  | "package.json"
  | "project.json"
  | "pkgsteward.plugin.json"

export type PluginEntryKind =
  | "none"
  | "builtin-wallpaper"
  | "web-sandbox"
  | "media-image"
  | "media-video"
  | "css-theme"

export interface PluginEntryPoint {
  kind: PluginEntryKind
  file: string | null
}

export interface PluginOrigin {
  kind: "preinstalled" | "file" | "url" | "local"
  sourceUrl: string | null
  installedAt: string | null
}

export type PluginCapability =
  | "theme-preset"
  | "live-wallpaper"
  | "project-analyzer"
  | "cleanup-rule"
  | "dashboard-widget"
  | "desktop-bridge"

export interface PluginSettingFieldSchema {
  key: string
  label: string
  type: "string" | "number" | "boolean"
  defaultValue: PrimitiveConfigValue
  unit?: string
  description?: string
}

export interface DiscoveredPlugin {
  id: string
  name: string
  version: string
  apiVersion: 1
  format: PluginManifestFormat
  entry: PluginEntryPoint
  description: string | null
  author: string | null
  homepage: string | null
  capabilities: PluginCapability[]
  minAppVersion: string | null
  manifestPath: string
  source: "local"
  preinstalled: boolean
  removable: boolean
  origin: PluginOrigin
  enabled: boolean
  config: Record<string, PrimitiveConfigValue>
  settingsSchema: PluginSettingFieldSchema[]
}

export interface InvalidPluginManifest {
  directoryName: string
  manifestPath: string
  error: string
}

export interface PluginExtensionPoint {
  capability: PluginCapability
  apiVersion: 1
  status: "planned" | "schema-ready"
}

export interface PluginsCatalog {
  apiVersion: 1
  runtimeMode: "sandboxed-web" | "manifest-only"
  pluginsEnabled: boolean
  allowLocalPlugins: boolean
  preinstalledAvailable: boolean
  pluginsDir: string
  extensionPoints: PluginExtensionPoint[]
  discovered: DiscoveredPlugin[]
  invalid: InvalidPluginManifest[]
}

export interface SettingsSnapshot {
  document: SettingsDocument
  sources: {
    runtime: Record<keyof RuntimeSettings, SettingValueSource>
    server: Record<keyof ServerSettings, SettingValueSource>
  }
  restartRequiredFields: (keyof ServerSettings)[]
  availableDrives: string[]
  systemPaths: SystemPathsSummary
  plugins: PluginsCatalog
}

export interface PluginInstallPreviewResponse {
  previewId: string
  action: "install"
  expiresAt: string
  sourceKind: "file" | "url"
  sourceLabel: string
  pluginId: string
  pluginName: string
  version: string
  format: PluginManifestFormat
  entryKind: string
  fileCount: number
  totalBytes: number
  willOverwrite: boolean
  risk: SettingsRisk
}

export interface PluginUninstallPreviewResponse {
  previewId: string
  action: "uninstall"
  expiresAt: string
  pluginId: string
  pluginName: string
  preinstalled: boolean
  targetDir: string
  risk: SettingsRisk
}

export interface PluginSandboxDocumentResponse {
  pluginId: string
  entryFile: string
  html: string
}

export interface SettingDiffItem {
  path: string
  before: unknown
  after: unknown
  effect: "instant" | "hot-reload" | "restart-required"
}

export interface SettingsRiskReason {
  code: string
  level: "low" | "medium" | "high"
  message: string
}

export interface SettingsRisk {
  level: "low" | "medium" | "high"
  reasons: SettingsRiskReason[]
}

export interface SettingsPreviewResponse {
  previewId: string
  action: "update" | "import" | "reset"
  expiresAt: string
  changes: SettingDiffItem[]
  hotReloadFields: string[]
  restartRequiredFields: string[]
  clearsScanCache: boolean
  risk: SettingsRisk
  targetDocument: SettingsDocument
}

export interface SettingsExportResponse {
  exportedAt: string
  document: SettingsDocument
}

export type SettingsResetScope =
  | "appearance"
  | "behavior"
  | "runtime"
  | "server"
  | "plugins"
  | "all"

export interface PreferencesPatch {
  appearance?: Partial<AppearanceSettings>
  behavior?: Partial<BehaviorSettings>
  plugins?: {
    enabled?: boolean
    entries?: Record<string, PluginEntrySetting>
  }
  desktop?: Record<string, PrimitiveConfigValue>
}

export interface PrivilegedSettingsPatch {
  runtime?: Partial<RuntimeSettings>
  server?: Partial<ServerSettings>
  appearance?: Partial<AppearanceSettings>
  behavior?: Partial<BehaviorSettings>
  plugins?: Partial<PluginsSettings>
  desktop?: Record<string, PrimitiveConfigValue>
}
