"use client"

import {
  CopyIcon,
  FolderCogIcon,
  GlobeIcon,
  PuzzleIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"

import { UnitNumberInput } from "@/components/features/settings/unit-number-input"
import { useSettings } from "@/components/settings/settings-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  resolvePluginFieldUnit,
  validatePluginConfigDraft,
  validatePluginDirectoryInput,
  validatePluginInstallUrlInput,
  validateTrustedRegistriesInput,
} from "@/lib/settings/settings-validation"
import type {
  DiscoveredPlugin,
  PluginEntrySetting,
  PrimitiveConfigValue,
  PrivilegedSettingsPatch,
  SettingsSnapshot,
} from "@/lib/settings/types"

const SAMPLE_MANIFEST = `{
  "id": "vendor.my-extension",
  "name": "My PkgSteward Extension",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Metadata-only plugin descriptor",
  "capabilities": ["project-analyzer", "dashboard-widget"],
  "settingsSchema": [
    {
      "key": "intervalSeconds",
      "label": "Check Interval",
      "type": "number",
      "defaultValue": 300,
      "unit": "s"
    }
  ]
}`

type RawPluginDraft = Record<string, string | boolean>

function buildInitialPluginDraft(plugin: DiscoveredPlugin): RawPluginDraft {
  const out: RawPluginDraft = {}
  for (const field of plugin.settingsSchema) {
    const val = plugin.config[field.key] ?? field.defaultValue
    out[field.key] = field.type === "boolean" ? val === true : val === null ? "" : String(val)
  }
  return out
}

function parseDraftToConfig(
  plugin: DiscoveredPlugin,
  draft: RawPluginDraft
): Record<string, PrimitiveConfigValue> {
  const out: Record<string, PrimitiveConfigValue> = { ...plugin.config }
  for (const field of plugin.settingsSchema) {
    const raw = draft[field.key]
    if (field.type === "boolean") {
      out[field.key] = raw === true
    } else if (field.type === "number") {
      const trimmed = typeof raw === "string" ? raw.trim() : ""
      out[field.key] = trimmed === "" ? null : Number(trimmed)
    } else {
      out[field.key] = typeof raw === "string" ? raw : ""
    }
  }
  return out
}

export function PluginsTab({
  snapshot,
  busy,
  onUpdatePreferences,
  onPreviewUpdate,
  onPreviewInstallUrl,
  onPreviewInstallFile,
  onPreviewUninstall,
  onRestoreDefaults,
  onRefresh,
}: {
  snapshot: SettingsSnapshot
  busy: boolean
  onUpdatePreferences: (patch: {
    plugins?: { enabled?: boolean; entries?: Record<string, PluginEntrySetting> }
  }) => Promise<unknown>
  onPreviewUpdate: (patch: PrivilegedSettingsPatch) => Promise<void>
  onPreviewInstallUrl: (url: string) => Promise<void>
  onPreviewInstallFile: (file: File) => Promise<void>
  onPreviewUninstall: (pluginId: string) => Promise<void>
  onRestoreDefaults: () => Promise<void>
  onRefresh: () => Promise<unknown>
}) {
  const t = useTranslations("settings.plugins")
  const tVal = useTranslations("settings.validation")
  const { behavior } = useSettings()
  const pluginsState = snapshot.document.plugins
  const catalog = snapshot.plugins

  const [allowLocalPlugins, setAllowLocalPlugins] = useState(pluginsState.allowLocalPlugins)
  const [directoryInput, setDirectoryInput] = useState(pluginsState.directory ?? "")
  const [registriesInput, setRegistriesInput] = useState(pluginsState.trustedRegistries.join(", "))
  const [installUrlInput, setInstallUrlInput] = useState("")
  const [installUrlSubmitted, setInstallUrlSubmitted] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [draftConfigs, setDraftConfigs] = useState<Record<string, RawPluginDraft>>(() =>
    Object.fromEntries(catalog.discovered.map((plugin) => [plugin.id, buildInitialPluginDraft(plugin)]))
  )

  const urlInputError =
    installUrlInput.trim() !== "" || installUrlSubmitted
      ? validatePluginInstallUrlInput(installUrlInput)
      : null
  const directoryError = validatePluginDirectoryInput(directoryInput)
  const registriesError = validateTrustedRegistriesInput(registriesInput)
  const hasPolicyErrors = Boolean(directoryError || registriesError)

  const handleSaveSecurityPolicy = async (e: React.FormEvent) => {
    e.preventDefault()
    if (hasPolicyErrors) return
    const registries = registriesInput
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)

    await onPreviewUpdate({
      plugins: {
        allowLocalPlugins,
        directory: directoryInput.trim() === "" ? null : directoryInput.trim(),
        trustedRegistries: registries,
      },
    })
  }

  const handleTogglePlugin = async (
    plugin: DiscoveredPlugin,
    enabled: boolean,
    draft: RawPluginDraft
  ) => {
    const errors = validatePluginConfigDraft(plugin.settingsSchema, draft, plugin.id)
    const config =
      Object.keys(errors).length === 0 ? parseDraftToConfig(plugin, draft) : plugin.config
    await onUpdatePreferences({
      plugins: {
        entries: {
          [plugin.id]: {
            enabled,
            source: plugin.preinstalled ? "builtin" : "local",
            config,
          },
        },
      },
    })
  }

  const handleSavePluginConfig = async (
    plugin: DiscoveredPlugin,
    enabled: boolean,
    draft: RawPluginDraft
  ) => {
    const errors = validatePluginConfigDraft(plugin.settingsSchema, draft, plugin.id)
    if (Object.keys(errors).length > 0) return
    await onUpdatePreferences({
      plugins: {
        entries: {
          [plugin.id]: {
            enabled,
            source: plugin.preinstalled ? "builtin" : "local",
            config: parseDraftToConfig(plugin, draft),
          },
        },
      },
    })
  }

  const handleInstallUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setInstallUrlSubmitted(true)
    const err = validatePluginInstallUrlInput(installUrlInput)
    if (err) return
    await onPreviewInstallUrl(installUrlInput.trim())
    setInstallUrlInput("")
    setInstallUrlSubmitted(false)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Architecture notice */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <PuzzleIcon className="size-5 text-primary" aria-hidden />
              <CardTitle>{t("foundationTitle")}</CardTitle>
            </div>
            <Badge variant="success">
              {catalog.runtimeMode === "sandboxed-web"
                ? t("sandboxedRuntimeBadge")
                : t("manifestOnlyBadge")}
            </Badge>
          </div>
          <CardDescription>{t("foundationDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background p-3 select-none">
            <Checkbox
              checked={pluginsState.enabled}
              onCheckedChange={(val) => {
                void onUpdatePreferences({ plugins: { enabled: val === true } })
              }}
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-body-sm font-semibold text-foreground">{t("masterEnableLabel")}</span>
              <span className="text-caption text-muted-foreground">{t("masterEnableDesc")}</span>
            </div>
          </label>

          {behavior.advancedMode && (
            <div className="flex flex-col gap-2">
              <span className="text-body-sm font-semibold text-foreground">{t("extensionPointsTitle")}</span>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {catalog.extensionPoints.map((ep) => (
                  <div
                    key={ep.capability}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2"
                  >
                    <span className="font-mono text-caption text-foreground">{ep.capability}</span>
                    <Badge variant="outline">{t("schemaReady")}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 1-step Plugin Installer */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <UploadIcon className="size-5 text-primary" aria-hidden />
            <CardTitle>{t("quickInstallTitle")}</CardTitle>
          </div>
          <CardDescription>{t("quickInstallDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div
            role="region"
            aria-label={t("dropzoneLabel")}
            onDragOver={(e) => {
              e.preventDefault()
              if (!dragging) setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              const dropped = e.dataTransfer.files?.[0]
              if (dropped && !busy) {
                void onPreviewInstallFile(dropped)
              }
            }}
            className={
              dragging
                ? "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary bg-primary/10 p-6 text-center transition-colors"
                : "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-background p-6 text-center transition-colors hover:border-primary/60"
            }
          >
            <UploadIcon className="size-6 text-primary" aria-hidden />
            <p className="text-body-sm font-medium text-foreground">{t("dropzoneHint")}</p>
            <p className="text-caption text-muted-foreground">{t("supportedFormatsHint")}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.tgz,.gz,.json,.html,.htm,.png,.jpg,.jpeg,.webp,.gif,.avif,.mp4,.webm"
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0]
                if (picked) {
                  void onPreviewInstallFile(picked)
                }
                e.target.value = ""
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {t("choosePackageFileCta")}
            </Button>
          </div>

          <form noValidate onSubmit={handleInstallUrlSubmit} className="flex flex-col gap-2">
            <Label htmlFor="install-plugin-url">{t("installUrlLabel")}</Label>
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-64 flex-1">
                <GlobeIcon
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="install-plugin-url"
                  value={installUrlInput}
                  onChange={(e) => {
                    setInstallUrlInput(e.target.value)
                    if (installUrlSubmitted) setInstallUrlSubmitted(false)
                  }}
                  placeholder="https://github.com/user/wallpaper-repo | npm:pkg | https://..."
                  aria-invalid={urlInputError ? true : undefined}
                  className="pl-9 font-mono"
                />
              </div>
              <Button type="submit" disabled={busy || Boolean(urlInputError)}>
                {t("installFromUrlCta")}
              </Button>
            </div>
            {urlInputError && (
              <p role="alert" className="text-caption text-destructive">
                {tVal(urlInputError)}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Tier B security settings (Advanced only) */}
      {behavior.advancedMode && (
        <form noValidate onSubmit={handleSaveSecurityPolicy}>
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheckIcon className="size-5 text-primary" aria-hidden />
                <CardTitle>{t("securityTitle")}</CardTitle>
              </div>
              <CardDescription>{t("securityDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background p-3 select-none">
                <Checkbox
                  checked={allowLocalPlugins}
                  onCheckedChange={(val) => setAllowLocalPlugins(val === true)}
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-body-sm font-medium text-foreground">
                    {t("allowLocalPluginsLabel")}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {t("allowLocalPluginsDesc")}
                  </span>
                </div>
              </label>

              <div className="flex flex-col gap-2">
                <Label htmlFor="plugins-dir">{t("directoryLabel")}</Label>
                <Input
                  id="plugins-dir"
                  value={directoryInput}
                  onChange={(e) => setDirectoryInput(e.target.value)}
                  placeholder={snapshot.systemPaths.pluginsDir}
                  aria-invalid={directoryError ? true : undefined}
                  className="font-mono"
                />
                {directoryError && (
                  <p role="alert" className="text-caption text-destructive">
                    {tVal(directoryError)}
                  </p>
                )}
                <p className="text-caption text-muted-foreground">
                  {t("directoryHint", { defaultDir: snapshot.systemPaths.pluginsDir })}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="plugins-registries">{t("registriesLabel")}</Label>
                <Input
                  id="plugins-registries"
                  value={registriesInput}
                  onChange={(e) => setRegistriesInput(e.target.value)}
                  placeholder="https://registry.npmjs.org"
                  aria-invalid={registriesError ? true : undefined}
                  className="font-mono"
                />
                {registriesError && (
                  <p role="alert" className="text-caption text-destructive">
                    {tVal(registriesError)}
                  </p>
                )}
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={busy || hasPolicyErrors}>
                  {t("previewSavePolicyCta")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}

      {/* Discovered local manifests */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FolderCogIcon className="size-5 text-primary" aria-hidden />
              <CardTitle>{t("discoveredTitle", { count: catalog.discovered.length })}</CardTitle>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {catalog.preinstalledAvailable && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void onRestoreDefaults()}
                >
                  <RotateCcwIcon className="size-4" aria-hidden />
                  {t("restoreDefaultsCta")}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true)
                  await onRefresh()
                  setRefreshing(false)
                }}
              >
                <RefreshCwIcon className="size-4" aria-hidden />
                {t("refreshCta")}
              </Button>
            </div>
          </div>
          {behavior.advancedMode && (
            <CardDescription className="font-mono">{catalog.pluginsDir}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {catalog.discovered.length === 0 ? (
            <p className="rounded-md border border-border bg-background p-4 text-body-sm text-muted-foreground">
              {t("noDiscovered")}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {catalog.discovered.map((plugin) => {
                const draft = draftConfigs[plugin.id] ?? buildInitialPluginDraft(plugin)
                const configErrors = validatePluginConfigDraft(
                  plugin.settingsSchema,
                  draft,
                  plugin.id
                )
                const hasConfigErrors = Object.keys(configErrors).length > 0
                const isPluginEnabled =
                  pluginsState.enabled &&
                  pluginsState.allowLocalPlugins &&
                  (snapshot.document.plugins.entries[plugin.id]?.enabled ?? plugin.enabled)

                return (
                  <li
                    key={plugin.id}
                    className="flex flex-col gap-2 rounded-md border border-border bg-background p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-body-md font-semibold text-foreground">{plugin.name}</span>
                        <Badge variant="outline" className="font-mono">
                          {plugin.id}
                        </Badge>
                        {plugin.preinstalled && (
                          <Badge variant="secondary">{t("preinstalledBadge")}</Badge>
                        )}
                        {behavior.advancedMode && (
                          <Badge variant="outline" className="font-mono">
                            {plugin.format} · {plugin.entry.kind}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex cursor-pointer items-center gap-2 text-body-sm select-none">
                          <Checkbox
                            checked={isPluginEnabled}
                            onCheckedChange={(val) =>
                              void handleTogglePlugin(plugin, val === true, draft)
                            }
                          />
                          <span>{t("enableEntry")}</span>
                        </label>
                        {plugin.removable && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void onPreviewUninstall(plugin.id)}
                            aria-label={t("uninstallAria", { name: plugin.name })}
                          >
                            <Trash2Icon className="size-4 text-destructive" aria-hidden />
                            {t("uninstallCta")}
                          </Button>
                        )}
                      </div>
                    </div>
                    {plugin.description && (
                      <p className="text-body-sm text-muted-foreground">{plugin.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {plugin.capabilities.map((cap) => (
                        <Badge key={cap} variant="secondary" className="font-mono">
                          {cap}
                        </Badge>
                      ))}
                    </div>
                    {plugin.settingsSchema.length > 0 && (
                      <div className="mt-2 flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          {plugin.settingsSchema.map((field) => {
                            const currentVal = draft[field.key]
                            const fieldError = configErrors[field.key]
                            const setField = (val: string | boolean) =>
                              setDraftConfigs((prev) => ({
                                ...prev,
                                [plugin.id]: {
                                  ...(prev[plugin.id] ?? buildInitialPluginDraft(plugin)),
                                  [field.key]: val,
                                },
                              }))

                            if (field.type === "boolean") {
                              return (
                                <label
                                  key={field.key}
                                  className="flex cursor-pointer items-center gap-2.5 text-body-sm select-none"
                                >
                                  <Checkbox
                                    checked={currentVal === true}
                                    onCheckedChange={(checked) => setField(checked === true)}
                                  />
                                  <span>{field.label}</span>
                                </label>
                              )
                            }

                            if (field.type === "number") {
                              const resolvedUnit = resolvePluginFieldUnit(field)
                              return (
                                <div key={field.key} className="flex flex-col gap-1">
                                  <Label htmlFor={`plg-${plugin.id}-${field.key}`}>{field.label}</Label>
                                  <UnitNumberInput
                                    id={`plg-${plugin.id}-${field.key}`}
                                    type="number"
                                    compact
                                    unit={resolvedUnit}
                                    value={typeof currentVal === "string" ? currentVal : ""}
                                    onChange={(e) => setField(e.target.value)}
                                    error={fieldError ? tVal(fieldError) : null}
                                  />
                                </div>
                              )
                            }

                            return (
                              <div key={field.key} className="flex flex-col gap-1">
                                <Label htmlFor={`plg-${plugin.id}-${field.key}`}>{field.label}</Label>
                                <Input
                                  id={`plg-${plugin.id}-${field.key}`}
                                  type="text"
                                  value={typeof currentVal === "string" ? currentVal : ""}
                                  onChange={(e) => setField(e.target.value)}
                                  aria-invalid={fieldError ? true : undefined}
                                  className="h-9 font-mono text-body-sm"
                                />
                                {fieldError && (
                                  <p role="alert" className="text-caption text-destructive">
                                    {tVal(fieldError)}
                                  </p>
                                )}
                              </div>
                            )
                          })}
                        </div>
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={hasConfigErrors}
                            onClick={() =>
                              void handleSavePluginConfig(
                                plugin,
                                snapshot.document.plugins.entries[plugin.id]?.enabled ??
                                  plugin.enabled,
                                draft
                              )
                            }
                          >
                            {t("saveConfigCta")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {behavior.advancedMode && catalog.invalid.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-body-sm text-warning">
              <span className="font-semibold">{t("invalidManifestsTitle")}</span>
              {catalog.invalid.map((bad) => (
                <div key={`${bad.directoryName}-${bad.manifestPath}`} className="font-mono text-caption">
                  {bad.directoryName}: {bad.error}
                </div>
              ))}
            </div>
          )}

          {behavior.advancedMode && (
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-body-sm font-semibold text-foreground">{t("sampleManifestTitle")}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(SAMPLE_MANIFEST)
                      toast.success(t("sampleCopied"))
                    } catch {
                      toast.error(t("sampleCopyFailed"))
                    }
                  }}
                >
                  <CopyIcon className="size-4" aria-hidden />
                  {t("copySample")}
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-caption text-foreground">
                {SAMPLE_MANIFEST}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
