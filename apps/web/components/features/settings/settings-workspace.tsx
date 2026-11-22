"use client"

import { RefreshCwIcon, Settings2Icon, SlidersHorizontalIcon, WrenchIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"

import { AppearanceTab } from "@/components/features/settings/appearance-tab"
import { BackupTab } from "@/components/features/settings/backup-tab"
import { BehaviorTab } from "@/components/features/settings/behavior-tab"
import {
  PluginConfirmDialog,
  type PendingPluginAction,
} from "@/components/features/settings/plugin-confirm-dialog"
import { PluginsTab } from "@/components/features/settings/plugins-tab"
import { RuntimeTab } from "@/components/features/settings/runtime-tab"
import { ServerTab } from "@/components/features/settings/server-tab"
import { SettingsConfirmDialog } from "@/components/features/settings/settings-confirm-dialog"
import { Container } from "@/components/layout/container"
import { useSettings } from "@/components/settings/settings-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  executeBrowserPluginInstall,
  executeBrowserPluginUninstall,
  executeBrowserSettingsImport,
  executeBrowserSettingsReset,
  executeBrowserSettingsUpdate,
  previewBrowserPluginInstallFile,
  previewBrowserPluginInstallUrl,
  previewBrowserPluginUninstall,
  previewBrowserSettingsImport,
  previewBrowserSettingsReset,
  previewBrowserSettingsUpdate,
  restoreBrowserDefaultPlugins,
} from "@/lib/api/settings/settings-browser"
import type {
  PrivilegedSettingsPatch,
  SettingsPreviewResponse,
  SettingsResetScope,
  SettingsSnapshot,
} from "@/lib/settings/types"

export function SettingsWorkspace({
  initialSnapshot,
}: {
  initialSnapshot: SettingsSnapshot | null
}) {
  const t = useTranslations("settings")
  const {
    snapshot: ctxSnapshot,
    behavior,
    restartRequiredFields,
    loading,
    updatePreferences,
    applySnapshot,
    refreshSettings,
  } = useSettings()

  const activeSnapshot = ctxSnapshot ?? initialSnapshot
  const advancedMode = activeSnapshot?.document.behavior.advancedMode ?? behavior.advancedMode
  const [activeTab, setActiveTab] = useState("appearance")
  const resolvedTab =
    !advancedMode && (activeTab === "server" || activeTab === "backup")
      ? "appearance"
      : activeTab

  const [preview, setPreview] = useState<SettingsPreviewResponse | null>(null)
  const [pendingPlugin, setPendingPlugin] = useState<PendingPluginAction | null>(null)
  const [busy, setBusy] = useState(false)

  const runPreview = async (factory: () => Promise<SettingsPreviewResponse>) => {
    setBusy(true)
    try {
      const next = await factory()
      setPreview(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("messages.previewFailed"))
    } finally {
      setBusy(false)
    }
  }

  const runPluginPreview = async (factory: () => Promise<PendingPluginAction>) => {
    setBusy(true)
    try {
      const next = await factory()
      setPendingPlugin(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("messages.previewFailed"))
    } finally {
      setBusy(false)
    }
  }

  const handleConfirm = async (acknowledgedRisks: string[]) => {
    if (!preview) return
    setBusy(true)
    try {
      const body = {
        previewId: preview.previewId,
        confirm: true,
        acknowledgedRisks,
      }
      const nextSnapshot =
        preview.action === "import"
          ? await executeBrowserSettingsImport(body)
          : preview.action === "reset"
            ? await executeBrowserSettingsReset(body)
            : await executeBrowserSettingsUpdate(body)
      applySnapshot(nextSnapshot)
      setPreview(null)
      toast.success(t("messages.appliedSuccess"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("messages.applyFailed"))
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmPlugin = async (acknowledgedRisks: string[]) => {
    if (!pendingPlugin) return
    setBusy(true)
    try {
      const nextSnapshot =
        pendingPlugin.kind === "install"
          ? await executeBrowserPluginInstall({
              previewId: pendingPlugin.data.previewId,
              confirm: true,
              acknowledgedRisks,
            })
          : await executeBrowserPluginUninstall({
              previewId: pendingPlugin.data.previewId,
              confirm: true,
            })
      applySnapshot(nextSnapshot)
      setPendingPlugin(null)
      toast.success(t("messages.appliedSuccess"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("messages.applyFailed"))
    } finally {
      setBusy(false)
    }
  }

  const handleRestoreDefaults = async () => {
    setBusy(true)
    try {
      const nextSnapshot = await restoreBrowserDefaultPlugins()
      applySnapshot(nextSnapshot)
      toast.success(t("messages.appliedSuccess"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("messages.applyFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Container className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <Settings2Icon className="size-6 text-primary" aria-hidden />
            <h1 className="text-heading-xl">{t("title")}</h1>
            {activeSnapshot && (
              <Badge variant="outline" className="font-mono">
                schema v{activeSnapshot.document.schemaVersion}
              </Badge>
            )}
          </div>
          <p className="max-w-prose text-body-md text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <ToggleGroup
            type="single"
            value={advancedMode ? "advanced" : "basic"}
            onValueChange={(val) => {
              if (val === "basic" || val === "advanced") {
                void updatePreferences({ behavior: { advancedMode: val === "advanced" } })
              }
            }}
            aria-label={t("experienceLevelLabel")}
          >
            <ToggleGroupItem value="basic">
              <SlidersHorizontalIcon className="size-4" aria-hidden />
              {t("experienceBasic")}
            </ToggleGroupItem>
            <ToggleGroupItem value="advanced">
              <WrenchIcon className="size-4" aria-hidden />
              {t("experienceAdvanced")}
            </ToggleGroupItem>
          </ToggleGroup>
          <Button type="button" variant="secondary" onClick={() => void refreshSettings()}>
            <RefreshCwIcon className="size-4" aria-hidden />
            {t("refreshCta")}
          </Button>
        </div>
      </div>

      {restartRequiredFields.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning-soft p-3.5 text-body-sm text-warning"
        >
          <RefreshCwIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t("restartRequiredGlobalBanner", {
              fields: restartRequiredFields.join(", "),
            })}
          </span>
        </div>
      )}

      <Tabs value={resolvedTab} onValueChange={setActiveTab} className="flex flex-col gap-6">
        <TabsList className="flex h-auto flex-wrap justify-start gap-2 border-b border-border pb-1">
          <TabsTrigger value="appearance">{t("tabs.appearance")}</TabsTrigger>
          <TabsTrigger value="behavior">{t("tabs.behavior")}</TabsTrigger>
          <TabsTrigger value="runtime">{t("tabs.runtime")}</TabsTrigger>
          <TabsTrigger value="plugins">{t("tabs.plugins")}</TabsTrigger>
          {advancedMode && <TabsTrigger value="server">{t("tabs.server")}</TabsTrigger>}
          {advancedMode && <TabsTrigger value="backup">{t("tabs.backup")}</TabsTrigger>}
        </TabsList>

        <TabsContent value="appearance">
          <AppearanceTab />
        </TabsContent>

        <TabsContent value="behavior">
          <BehaviorTab />
        </TabsContent>

        <TabsContent value="runtime">
          {activeSnapshot ? (
            <RuntimeTab
              key={JSON.stringify([activeSnapshot.document.runtime, activeSnapshot.availableDrives])}
              snapshot={activeSnapshot}
              busy={busy}
              onPreviewUpdate={(patch: PrivilegedSettingsPatch) =>
                runPreview(() => previewBrowserSettingsUpdate(patch))
              }
            />
          ) : loading ? (
            <Skeleton className="h-64 w-full rounded-md" />
          ) : (
            <p className="rounded-md border border-border bg-card p-6 text-body-sm text-muted-foreground">
              {t("apiUnavailableHint")}
            </p>
          )}
        </TabsContent>

        <TabsContent value="server">
          {activeSnapshot ? (
            <ServerTab
              key={JSON.stringify(activeSnapshot.document.server)}
              snapshot={activeSnapshot}
              busy={busy}
              onPreviewUpdate={(patch: PrivilegedSettingsPatch) =>
                runPreview(() => previewBrowserSettingsUpdate(patch))
              }
            />
          ) : loading ? (
            <Skeleton className="h-64 w-full rounded-md" />
          ) : (
            <p className="rounded-md border border-border bg-card p-6 text-body-sm text-muted-foreground">
              {t("apiUnavailableHint")}
            </p>
          )}
        </TabsContent>

        <TabsContent value="plugins">
          {activeSnapshot ? (
            <PluginsTab
              key={JSON.stringify(activeSnapshot.document.plugins)}
              snapshot={activeSnapshot}
              busy={busy}
              onUpdatePreferences={updatePreferences}
              onPreviewUpdate={(patch: PrivilegedSettingsPatch) =>
                runPreview(() => previewBrowserSettingsUpdate(patch))
              }
              onPreviewInstallUrl={(url) =>
                runPluginPreview(async () => ({
                  kind: "install",
                  data: await previewBrowserPluginInstallUrl(url),
                }))
              }
              onPreviewInstallFile={(file) =>
                runPluginPreview(async () => ({
                  kind: "install",
                  data: await previewBrowserPluginInstallFile(file),
                }))
              }
              onPreviewUninstall={(pluginId) =>
                runPluginPreview(async () => ({
                  kind: "uninstall",
                  data: await previewBrowserPluginUninstall(pluginId),
                }))
              }
              onRestoreDefaults={handleRestoreDefaults}
              onRefresh={refreshSettings}
            />
          ) : loading ? (
            <Skeleton className="h-64 w-full rounded-md" />
          ) : (
            <p className="rounded-md border border-border bg-card p-6 text-body-sm text-muted-foreground">
              {t("apiUnavailableHint")}
            </p>
          )}
        </TabsContent>

        <TabsContent value="backup">
          <BackupTab
            busy={busy}
            onPreviewImport={(doc) => runPreview(() => previewBrowserSettingsImport(doc))}
            onPreviewReset={(scope: SettingsResetScope) =>
              runPreview(() => previewBrowserSettingsReset(scope))
            }
          />
        </TabsContent>
      </Tabs>

      <SettingsConfirmDialog
        preview={preview}
        submitting={busy}
        onClose={() => setPreview(null)}
        onConfirm={handleConfirm}
      />

      <PluginConfirmDialog
        pending={pendingPlugin}
        submitting={busy}
        onClose={() => setPendingPlugin(null)}
        onConfirm={handleConfirmPlugin}
      />
    </Container>
  )
}
