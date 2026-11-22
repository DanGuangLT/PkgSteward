"use client"

import {
  ArchiveRestoreIcon,
  HardDriveIcon,
  PaletteIcon,
  PuzzleIcon,
  RefreshCwIcon,
  ServerIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
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
import { cn } from "@/lib/utils"

type SettingsCategoryId = "appearance" | "behavior" | "runtime" | "plugins" | "server" | "backup"

interface CategoryDefinition {
  id: SettingsCategoryId
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  advancedOnly?: boolean
}

const SETTINGS_CATEGORIES: readonly CategoryDefinition[] = [
  { id: "appearance", icon: PaletteIcon },
  { id: "behavior", icon: SlidersHorizontalIcon },
  { id: "runtime", icon: HardDriveIcon },
  { id: "plugins", icon: PuzzleIcon },
  { id: "server", icon: ServerIcon, advancedOnly: true },
  { id: "backup", icon: ArchiveRestoreIcon, advancedOnly: true },
]

export function SettingsWorkspace({
  initialSnapshot,
  variant = "page",
  onClose,
}: {
  initialSnapshot: SettingsSnapshot | null
  variant?: "modal" | "page"
  onClose?: () => void
}) {
  const t = useTranslations("settings")
  const tCommon = useTranslations("common")
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
  const [activeTab, setActiveTab] = useState<SettingsCategoryId>("appearance")
  const resolvedTab: SettingsCategoryId =
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

  const basicCategories = SETTINGS_CATEGORIES.filter((cat) => !cat.advancedOnly)
  const advancedCategories = SETTINGS_CATEGORIES.filter((cat) => cat.advancedOnly)

  const renderCategoryButton = (cat: CategoryDefinition) => {
    const Icon = cat.icon
    const selected = resolvedTab === cat.id
    return (
      <button
        key={cat.id}
        type="button"
        role="tab"
        id={`settings-tab-${cat.id}`}
        aria-selected={selected}
        aria-controls={`settings-panel-${cat.id}`}
        onClick={() => setActiveTab(cat.id)}
        className={cn(
          "relative flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-left text-body-sm transition-colors focus-ring md:w-full",
          selected
            ? "bg-primary/10 font-semibold text-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        )}
      >
        {selected && (
          <span
            className="hidden h-4 w-0.5 rounded-full bg-primary md:block"
            aria-hidden
          />
        )}
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{t(`tabs.${cat.id}`)}</span>
      </button>
    )
  }

  const renderPanelContent = () => {
    switch (resolvedTab) {
      case "appearance":
        return <AppearanceTab />
      case "behavior":
        return <BehaviorTab />
      case "runtime":
        return activeSnapshot ? (
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
        )
      case "server":
        return activeSnapshot ? (
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
        )
      case "plugins":
        return activeSnapshot ? (
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
        )
      case "backup":
        return (
          <BackupTab
            busy={busy}
            onPreviewImport={(doc) => runPreview(() => previewBrowserSettingsImport(doc))}
            onPreviewReset={(scope: SettingsResetScope) =>
              runPreview(() => previewBrowserSettingsReset(scope))
            }
          />
        )
    }
  }

  const headerBar = (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/60",
        variant === "modal" ? "px-4 py-3 sm:px-6" : "rounded-t-xl border-x border-t p-4 sm:px-6"
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2.5">
          <Settings2Icon className="size-5 shrink-0 text-primary" aria-hidden />
          {variant === "modal" ? (
            <h2 className="truncate text-heading-lg text-foreground">{t("title")}</h2>
          ) : (
            <h1 className="truncate text-heading-xl text-foreground">{t("title")}</h1>
          )}
        </div>
        <p className="truncate text-caption text-muted-foreground">{t("description")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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

        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void refreshSettings()}
        >
          <RefreshCwIcon className="size-4" aria-hidden />
          {t("refreshCta")}
        </Button>

        {variant === "modal" && onClose && (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={tCommon("close")}
            onClick={onClose}
          >
            <XIcon aria-hidden />
          </Button>
        )}
      </div>
    </div>
  )

  const splitWorkspace = (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row",
        variant === "page" && "rounded-b-xl border-x border-b border-border bg-background"
      )}
    >
      <aside className="flex shrink-0 flex-col border-b border-border bg-muted/20 md:w-60 md:border-r md:border-b-0">
        <div
          role="tablist"
          aria-label={t("navCategoriesLabel")}
          aria-orientation="vertical"
          className="flex flex-row gap-1 overflow-x-auto p-2 md:flex-1 md:flex-col md:overflow-y-auto md:p-3"
        >
          {basicCategories.map(renderCategoryButton)}

          {advancedMode && (
            <>
              <div className="mx-2 my-1 hidden border-t border-border md:block" />
              <span className="hidden px-3 pt-1 pb-0.5 text-caption font-semibold tracking-wide text-muted-foreground uppercase md:block">
                {t("advancedSectionHeading")}
              </span>
              {advancedCategories.map(renderCategoryButton)}
            </>
          )}
        </div>

        {variant === "modal" && (
          <div className="hidden border-t border-border px-3 py-2 text-caption text-muted-foreground md:block">
            {t("shortcutHint")}
          </div>
        )}
      </aside>

      <div
        role="tabpanel"
        id={`settings-panel-${resolvedTab}`}
        aria-labelledby={`settings-tab-${resolvedTab}`}
        className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6"
      >
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
        {renderPanelContent()}
      </div>
    </div>
  )

  const dialogs = (
    <>
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
    </>
  )

  if (variant === "modal") {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        {headerBar}
        {splitWorkspace}
        {dialogs}
      </div>
    )
  }

  return (
    <Container className="flex flex-1 flex-col py-6 sm:py-8">
      {headerBar}
      {splitWorkspace}
      {dialogs}
    </Container>
  )
}
