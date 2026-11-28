"use client"

import {
  BookmarkIcon,
  FolderKanbanIcon,
  LayersIcon,
  PencilIcon,
  PlayIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  BUILTIN_CLEANUP_PRESETS,
  MAX_CUSTOM_PRESETS,
  matchBuiltinPreset,
  type BuiltinPresetId,
  type CustomCleanupPreset,
} from "@/lib/file-ops/cleanup-presets"
import type { CleanupFilterForm } from "@/lib/file-ops/file-ops-list"
import { cleanupRunDisabledReason } from "@/lib/ui/disabled-reasons"
import { cn } from "@/lib/utils"

const PRESET_ICONS: Record<BuiltinPresetId, typeof ShieldCheckIcon> = {
  "safe-recommended": ShieldCheckIcon,
  "all-node-modules": FolderKanbanIcon,
  "build-caches": LayersIcon,
  "deep-clean": SparklesIcon,
}

export function CleanupPresetsBar({
  currentForm,
  customPresets,
  activeCustomPresetId,
  disabled,
  hasScan,
  allowPrimaryCta = true,
  onSelectBuiltinPreset,
  onSelectCustomPreset,
  onRunPreset,
  onCustomizePreset,
  onEditCustomPreset,
  onDeleteCustomPreset,
}: {
  currentForm: CleanupFilterForm
  customPresets: readonly CustomCleanupPreset[]
  activeCustomPresetId: string | null
  disabled: boolean
  hasScan: boolean
  allowPrimaryCta?: boolean
  onSelectBuiltinPreset: (form: Required<CleanupFilterForm>) => void
  onSelectCustomPreset: (preset: CustomCleanupPreset) => void
  onRunPreset: (form: Required<CleanupFilterForm>, label: string, customId?: string) => void
  onCustomizePreset: (form: Required<CleanupFilterForm>) => void
  onEditCustomPreset: (preset: CustomCleanupPreset) => void
  onDeleteCustomPreset: (id: string) => void
}) {
  const t = useTranslations("fileOps")
  const tDisabled = useTranslations("disabledReasons")
  const format = useFormatter()
  const hasActiveCustom = activeCustomPresetId !== null
    && customPresets.some((preset) => preset.id === activeCustomPresetId)
  const activeBuiltin = hasActiveCustom ? null : matchBuiltinPreset(currentForm)
  const fallbackToRecommended = !hasActiveCustom && activeBuiltin === null
  const runDisabled = disabled || !hasScan
  const busyReason = disabled ? tDisabled("fileOpsBusy") : null
  const runReasonKey = cleanupRunDisabledReason({ busy: disabled, hasScan })
  const runDisabledReason = runReasonKey ? tDisabled(runReasonKey) : null

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-heading-md text-foreground">{t("presets.quickHeading")}</h2>
          <p className="text-body-sm text-muted-foreground">{t("presets.quickHint")}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BUILTIN_CLEANUP_PRESETS.map((preset) => {
            const Icon = PRESET_ICONS[preset.id]
            const isSelected = activeBuiltin === preset.id
            const isPrimary = allowPrimaryCta && (isSelected || (fallbackToRecommended && Boolean(preset.recommended)))
            const title = t(`presets.builtin.${preset.id}.title`)
            return (
              <div
                key={preset.id}
                className={cn(
                  "flex min-w-0 flex-col justify-between rounded-md border bg-card transition-colors",
                  isSelected ? "border-foreground" : "border-border hover:border-foreground/40",
                )}
              >
                <DisabledTooltip reason={busyReason} className="flex flex-1">
                  <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={isSelected}
                    onClick={() => onSelectBuiltinPreset(preset.form)}
                    className="flex min-w-0 flex-1 cursor-pointer flex-col gap-2 rounded-t-md px-4 pt-4 pb-3 text-left focus-ring disabled:cursor-default"
                  >
                    <div className="flex w-full items-start justify-between gap-2">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                        <Icon className="size-4" aria-hidden="true" />
                      </div>
                      {preset.recommended ? (
                        <Badge variant="success">{t("presets.recommendedBadge")}</Badge>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <p className="text-body-md font-semibold text-foreground">{title}</p>
                      <p className="text-caption text-muted-foreground">
                        {t(`presets.builtin.${preset.id}.description`)}
                      </p>
                    </div>
                    <p className="mt-auto pt-1 text-caption font-medium text-foreground">
                      {t(`presets.builtin.${preset.id}.summary`)}
                    </p>
                  </button>
                </DisabledTooltip>

                <div className="flex flex-wrap items-center gap-2 px-4 pt-1 pb-4">
                  <DisabledTooltip reason={runDisabledReason} className="flex-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={isPrimary ? "default" : "secondary"}
                      className="flex-1"
                      disabled={runDisabled}
                      onClick={() => onRunPreset(preset.form, title)}
                    >
                      <PlayIcon aria-hidden="true" />
                      {t("presets.runNow")}
                    </Button>
                  </DisabledTooltip>
                  <DisabledTooltip reason={busyReason}>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`${t("presets.customize")}: ${title}`}
                      onClick={() => onCustomizePreset(preset.form)}
                    >
                      <SlidersHorizontalIcon aria-hidden="true" />
                      <span className="sr-only sm:not-sr-only">{t("presets.customize")}</span>
                    </Button>
                  </DisabledTooltip>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookmarkIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-body-sm font-semibold text-foreground">{t("presets.customHeading")}</h3>
            <Badge variant="secondary">
              {t("presets.customCount", {
                count: format.number(customPresets.length),
                max: format.number(MAX_CUSTOM_PRESETS),
              })}
            </Badge>
          </div>
        </div>

        {customPresets.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-3 text-caption text-muted-foreground">
            {t("presets.customEmpty")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {customPresets.map((preset) => {
              const isSelected = activeCustomPresetId === preset.id
              const isPrimary = allowPrimaryCta && isSelected
              return (
                <div
                  key={preset.id}
                  className={cn(
                    "flex min-w-0 flex-col justify-between rounded-md border bg-card transition-colors",
                    isSelected ? "border-foreground" : "border-border hover:border-foreground/40",
                  )}
                >
                  <DisabledTooltip reason={busyReason} className="flex flex-1">
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={isSelected}
                      onClick={() => onSelectCustomPreset(preset)}
                      className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1.5 rounded-t-md px-3.5 pt-3.5 pb-2.5 text-left focus-ring disabled:cursor-default"
                    >
                      <p className="w-full truncate text-body-sm font-semibold text-foreground" title={disabled ? undefined : preset.name}>
                        {preset.name}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {preset.form.kinds.map((kind) => (
                          <Badge key={kind} variant="secondary">{t(`kinds.${kind}`)}</Badge>
                        ))}
                        {preset.form.olderThanDays ? (
                          <Badge variant="outline">
                            {t("customizer.summaryDays", { days: preset.form.olderThanDays })}
                          </Badge>
                        ) : null}
                        {preset.form.minSizeMib ? (
                          <Badge variant="outline">
                            {t("customizer.summaryMinSize", { mib: preset.form.minSizeMib })}
                          </Badge>
                        ) : null}
                        {preset.form.projectPaths.length > 0 ? (
                          <Badge variant="outline">
                            {t("customizer.summaryProjects", { count: format.number(preset.form.projectPaths.length) })}
                          </Badge>
                        ) : null}
                      </div>
                    </button>
                  </DisabledTooltip>
                  <div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-1 pb-3.5">
                    <DisabledTooltip reason={runDisabledReason} className="flex-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={isPrimary ? "default" : "secondary"}
                        className="flex-1"
                        disabled={runDisabled}
                        onClick={() => onRunPreset(preset.form, preset.name, preset.id)}
                      >
                        <PlayIcon aria-hidden="true" />
                        {t("presets.runNow")}
                      </Button>
                    </DisabledTooltip>
                    <DisabledTooltip reason={busyReason}>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={disabled}
                        aria-label={`${t("presets.edit")}: ${preset.name}`}
                        onClick={() => onEditCustomPreset(preset)}
                      >
                        <PencilIcon aria-hidden="true" />
                      </Button>
                    </DisabledTooltip>
                    <DisabledTooltip reason={busyReason}>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={disabled}
                        aria-label={`${t("presets.delete")}: ${preset.name}`}
                        onClick={() => onDeleteCustomPreset(preset.id)}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    </DisabledTooltip>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
