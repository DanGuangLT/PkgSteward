"use client"

import { CheckCircle2Icon, HardDriveIcon, LayersIcon, TriangleAlertIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import type { CleanupKind } from "@/lib/api/types"
import type { CleanupMetrics } from "@/lib/file-ops/file-ops-list"
import { cn } from "@/lib/utils"

const KIND_ORDER: readonly CleanupKind[] = ["node_modules", "orphan_node_modules", "build_cache"]

export function CleanupKpiStrip({
  metrics,
  selectedOnly,
  attentionActive,
  onShowAll,
  onToggleSelectedOnly,
  onToggleAttention,
}: {
  metrics: CleanupMetrics
  selectedOnly: boolean
  attentionActive: boolean
  onShowAll: () => void
  onToggleSelectedOnly: () => void
  onToggleAttention: () => void
}) {
  const t = useTranslations("fileOps")
  const tDisabled = useTranslations("disabledReasons")
  const format = useFormatter()
  const activeKinds = KIND_ORDER.filter((kind) => metrics.byKind[kind].count > 0)
  const hasAttention = metrics.attentionCount > 0 || metrics.invalidCount > 0

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <button
        type="button"
        onClick={onShowAll}
        className={cn(
          "flex min-w-0 flex-col gap-1.5 rounded-md border bg-card p-4 text-left transition-colors focus-ring hover:bg-muted/50",
          !selectedOnly && !attentionActive ? "border-foreground" : "border-border",
        )}
      >
        <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
          <span>{t("kpi.totalReclaimable")}</span>
          <HardDriveIcon className="size-4 shrink-0" aria-hidden="true" />
        </div>
        <p className="text-heading-lg tabular-nums text-foreground">
          <DiskSize bytes={metrics.totalReclaimableBytes} />
        </p>
        <p className="text-caption text-muted-foreground">
          {t("kpi.totalItems", { formattedCount: format.number(metrics.eligibleCount) })}
        </p>
      </button>

      <button
        type="button"
        aria-pressed={selectedOnly}
        onClick={onToggleSelectedOnly}
        className={cn(
          "flex min-w-0 flex-col gap-1.5 rounded-md border bg-card p-4 text-left transition-colors focus-ring hover:bg-muted/50",
          selectedOnly ? "border-foreground" : "border-border",
        )}
      >
        <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
          <span>{t("kpi.selectedSpace")}</span>
          <CheckCircle2Icon className="size-4 shrink-0" aria-hidden="true" />
        </div>
        <p className="text-heading-lg tabular-nums text-foreground">
          <DiskSize bytes={metrics.selected.count > 0 ? metrics.selected.reclaimableBytes + metrics.selected.recycleBytes : 0} />
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground">
          {metrics.selected.count === 0 ? (
            t("kpi.selectedNone")
          ) : (
            <>
              <span>
                {t("selection.reclaimable")} <strong className="text-foreground"><DiskSize bytes={metrics.selected.reclaimableBytes} /></strong>
              </span>
              {metrics.selected.recycleBytes > 0 ? (
                <span>
                  · {t("selection.recycle")} <strong className="text-foreground"><DiskSize bytes={metrics.selected.recycleBytes} /></strong>
                </span>
              ) : null}
            </>
          )}
        </p>
      </button>

      <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
          <span>{t("kpi.byKind")}</span>
          <LayersIcon className="size-4 shrink-0" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1 text-caption">
          {activeKinds.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            activeKinds.map((kind) => (
              <div key={kind} className="flex items-center justify-between gap-2">
                <span className="truncate text-foreground">{t(`kinds.${kind}`)}</span>
                <span className="shrink-0 font-medium tabular-nums text-muted-foreground">
                  {format.number(metrics.byKind[kind].count)} · <DiskSize bytes={metrics.byKind[kind].bytes} />
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <DisabledTooltip
        reason={!hasAttention ? tDisabled("noAttentionItems") : null}
        className="flex w-full"
      >
        <button
          type="button"
          aria-pressed={attentionActive}
          disabled={!hasAttention}
          onClick={onToggleAttention}
          className={cn(
            "flex w-full min-w-0 flex-col gap-1.5 rounded-md border bg-card p-4 text-left transition-colors focus-ring hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-card",
            attentionActive ? "border-foreground" : "border-border",
          )}
        >
          <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
            <span>{t("kpi.attention")}</span>
            <TriangleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
          </div>
          <p className="text-heading-lg tabular-nums text-foreground">
            {format.number(metrics.attentionCount + metrics.invalidCount)}
          </p>
          <p className="text-caption text-muted-foreground">
            {hasAttention
              ? t("kpi.attentionCounts", {
                  risky: format.number(metrics.attentionCount),
                  invalid: format.number(metrics.invalidCount),
                })
              : t("kpi.attentionAllClear")}
          </p>
        </button>
      </DisabledTooltip>
    </div>
  )
}
