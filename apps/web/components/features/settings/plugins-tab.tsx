"use client"

import { CopyIcon, FolderCogIcon, PuzzleIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type {
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
      "label": "Check Interval (sec)",
      "type": "number",
      "defaultValue": 300
    }
  ]
}`

export function PluginsTab({
  snapshot,
  busy,
  onUpdatePreferences,
  onPreviewUpdate,
  onRefresh,
}: {
  snapshot: SettingsSnapshot
  busy: boolean
  onUpdatePreferences: (patch: {
    plugins?: { enabled?: boolean; entries?: Record<string, PluginEntrySetting> }
  }) => Promise<unknown>
  onPreviewUpdate: (patch: PrivilegedSettingsPatch) => Promise<void>
  onRefresh: () => Promise<unknown>
}) {
  const t = useTranslations("settings.plugins")
  const pluginsState = snapshot.document.plugins
  const catalog = snapshot.plugins

  const [allowLocalPlugins, setAllowLocalPlugins] = useState(pluginsState.allowLocalPlugins)
  const [directoryInput, setDirectoryInput] = useState(pluginsState.directory ?? "")
  const [registriesInput, setRegistriesInput] = useState(pluginsState.trustedRegistries.join(", "))
  const [refreshing, setRefreshing] = useState(false)
  const [draftConfigs, setDraftConfigs] = useState<
    Record<string, Record<string, PrimitiveConfigValue>>
  >(() =>
    Object.fromEntries(
      catalog.discovered.map((plugin) => [plugin.id, { ...plugin.config }])
    )
  )

  const handleSaveSecurityPolicy = async (e: React.FormEvent) => {
    e.preventDefault()
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

  const handleTogglePlugin = async (pluginId: string, enabled: boolean, config: Record<string, PrimitiveConfigValue>) => {
    await onUpdatePreferences({
      plugins: {
        entries: {
          [pluginId]: {
            enabled,
            source: "local",
            config,
          },
        },
      },
    })
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
            <div className="flex items-center gap-2">
              <Badge variant="secondary">API v{catalog.apiVersion}</Badge>
              <Badge variant="warning">{t("manifestOnlyBadge")}</Badge>
            </div>
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
        </CardContent>
      </Card>

      {/* Tier B security settings */}
      <form onSubmit={handleSaveSecurityPolicy}>
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
                className="font-mono"
              />
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
                className="font-mono"
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                {t("previewSavePolicyCta")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* Discovered local manifests */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FolderCogIcon className="size-5 text-primary" aria-hidden />
              <CardTitle>{t("discoveredTitle", { count: catalog.discovered.length })}</CardTitle>
            </div>
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
          <CardDescription className="font-mono">{catalog.pluginsDir}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {catalog.discovered.length === 0 ? (
            <p className="rounded-md border border-border bg-background p-4 text-body-sm text-muted-foreground">
              {t("noDiscovered")}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {catalog.discovered.map((plugin) => (
                <li
                  key={plugin.id}
                  className="flex flex-col gap-2 rounded-md border border-border bg-background p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body-md font-semibold text-foreground">{plugin.name}</span>
                      <Badge variant="outline" className="font-mono">
                        {plugin.id}@{plugin.version}
                      </Badge>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-body-sm select-none">
                      <Checkbox
                        checked={snapshot.document.plugins.entries[plugin.id]?.enabled === true}
                        onCheckedChange={(val) =>
                          void handleTogglePlugin(
                            plugin.id,
                            val === true,
                            draftConfigs[plugin.id] ?? plugin.config
                          )
                        }
                      />
                      <span>{t("enableEntry")}</span>
                    </label>
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
                          const currentVal =
                            draftConfigs[plugin.id]?.[field.key] ??
                            plugin.config[field.key] ??
                            field.defaultValue
                          const setField = (val: PrimitiveConfigValue) =>
                            setDraftConfigs((prev) => ({
                              ...prev,
                              [plugin.id]: {
                                ...(prev[plugin.id] ?? plugin.config),
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
                          return (
                            <div key={field.key} className="flex flex-col gap-1">
                              <Label htmlFor={`plg-${plugin.id}-${field.key}`}>{field.label}</Label>
                              <Input
                                id={`plg-${plugin.id}-${field.key}`}
                                type={field.type === "number" ? "number" : "text"}
                                value={currentVal === null ? "" : String(currentVal)}
                                onChange={(e) => {
                                  if (field.type === "number") {
                                    const num = Number(e.target.value)
                                    setField(e.target.value.trim() === "" ? null : Number.isFinite(num) ? num : 0)
                                  } else {
                                    setField(e.target.value)
                                  }
                                }}
                                className="h-9 font-mono text-body-sm"
                              />
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            void handleTogglePlugin(
                              plugin.id,
                              snapshot.document.plugins.entries[plugin.id]?.enabled === true,
                              draftConfigs[plugin.id] ?? plugin.config
                            )
                          }
                        >
                          {t("saveConfigCta")}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {catalog.invalid.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-body-sm text-warning">
              <span className="font-semibold">{t("invalidManifestsTitle")}</span>
              {catalog.invalid.map((bad) => (
                <div key={`${bad.directoryName}-${bad.manifestPath}`} className="font-mono text-caption">
                  {bad.directoryName}: {bad.error}
                </div>
              ))}
            </div>
          )}

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
        </CardContent>
      </Card>
    </div>
  )
}
