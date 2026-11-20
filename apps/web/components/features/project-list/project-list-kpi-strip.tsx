"use client"

import Link from "next/link"
import {
  AlertTriangleIcon,
  FolderKanbanIcon,
  HardDriveIcon,
  PackageIcon,
  SparklesIcon,
} from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import { Button } from "@/components/ui/button"
import type { ProjectListMetrics, ProjectQuickView } from "@/lib/projects/project-metrics"
import { cn } from "@/lib/utils"

interface ProjectListKpiStripProps {
  metrics: ProjectListMetrics
  skippedCount: number
  quickView: ProjectQuickView
  onSelectQuickView(view: ProjectQuickView): void
}

export function ProjectListKpiStrip({
  metrics,
  skippedCount,
  quickView,
  onSelectQuickView,
}: ProjectListKpiStripProps) {
  const t = useTranslations("projects")
  const tDisabled = useTranslations("disabledReasons")
  const format = useFormatter()
  const attentionTotal = metrics.attentionCount
  const attentionActive = quickView === "missing_lockfile" || quickView === "inactive_30d"

  function handleAttentionClick() {
    if (quickView === "missing_lockfile" && metrics.inactiveOver30dCount > 0) {
      onSelectQuickView("inactive_30d")
    } else if (attentionActive) {
      onSelectQuickView("all")
    } else if (metrics.missingLockfileCount > 0) {
      onSelectQuickView("missing_lockfile")
    } else if (metrics.inactiveOver30dCount > 0) {
      onSelectQuickView("inactive_30d")
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <button
        type="button"
        aria-pressed={quickView === "all"}
        onClick={() => onSelectQuickView("all")}
        className={cn(
          "flex min-w-0 flex-col gap-1.5 rounded-md border bg-card p-4 text-left transition-colors focus-ring hover:bg-muted/50",
          quickView === "all" ? "border-foreground" : "border-border",
        )}
      >
        <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
          <span>{t("kpi.totalProjects")}</span>
          <FolderKanbanIcon className="size-4 shrink-0" aria-hidden="true" />
        </div>
        <p className="text-heading-lg tabular-nums text-foreground">
          {format.number(metrics.totalProjects)}
        </p>
        <p className="text-caption text-muted-foreground">
          {t("summary.skipped", {
            count: skippedCount,
            formattedCount: format.number(skippedCount),
          })}
        </p>
      </button>

      <DisabledTooltip
        reason={metrics.withNodeModulesCount === 0 ? tDisabled("noNodeModulesProjects") : null}
        className="flex w-full"
      >
        <button
          type="button"
          aria-pressed={quickView === "has_node_modules"}
          disabled={metrics.withNodeModulesCount === 0}
          onClick={() => onSelectQuickView(quickView === "has_node_modules" ? "all" : "has_node_modules")}
          className={cn(
            "flex w-full min-w-0 flex-col gap-1.5 rounded-md border bg-card p-4 text-left transition-colors focus-ring hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-card",
            quickView === "has_node_modules" ? "border-foreground" : "border-border",
          )}
        >
          <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
            <span>{t("kpi.withNodeModules")}</span>
            <PackageIcon className="size-4 shrink-0" aria-hidden="true" />
          </div>
          <p className="text-heading-lg tabular-nums text-foreground">
            {format.number(metrics.withNodeModulesCount)}
          </p>
          <p className="text-caption tabular-nums text-muted-foreground">
            {metrics.measuredNodeModulesCount > 0 ? (
              <>
                <DiskSize bytes={metrics.knownNodeModulesBytes} />
                {" · "}
                {t("kpi.measuredCount", {
                  count: format.number(metrics.measuredNodeModulesCount),
                })}
              </>
            ) : (
              t("kpi.notMeasuredYet")
            )}
          </p>
        </button>
      </DisabledTooltip>

      <div className="flex min-w-0 flex-col justify-between gap-2 rounded-md border border-border bg-card p-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
            <span>{t("kpi.orphanNodeModules")}</span>
            <HardDriveIcon className="size-4 shrink-0" aria-hidden="true" />
          </div>
          <p className="text-heading-lg tabular-nums text-foreground">
            {format.number(metrics.orphanCount)}
          </p>
        </div>
        {metrics.orphanCount > 0 ? (
          <Button asChild size="sm" variant="secondary" className="self-start">
            <Link href="/cleanup">
              <SparklesIcon aria-hidden="true" />
              {t("kpi.openCleanup")}
            </Link>
          </Button>
        ) : (
          <p className="text-caption text-muted-foreground">{t("kpi.noOrphans")}</p>
        )}
      </div>

      <DisabledTooltip
        reason={attentionTotal === 0 ? tDisabled("noAttentionProjects") : null}
        className="flex w-full"
      >
        <button
          type="button"
          aria-pressed={attentionActive}
          disabled={attentionTotal === 0}
          onClick={handleAttentionClick}
          className={cn(
            "flex w-full min-w-0 flex-col gap-1.5 rounded-md border bg-card p-4 text-left transition-colors focus-ring hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-card",
            attentionActive ? "border-foreground" : "border-border",
          )}
        >
          <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
            <span>{t("kpi.attention")}</span>
            <AlertTriangleIcon className="size-4 shrink-0" aria-hidden="true" />
          </div>
          <p className="text-heading-lg tabular-nums text-foreground">
            {format.number(attentionTotal)}
          </p>
          <p className="text-caption text-muted-foreground">
            {attentionTotal > 0
              ? t("kpi.attentionBreakdown", {
                  missingLockfile: format.number(metrics.missingLockfileCount),
                  stale: format.number(metrics.inactiveOver30dCount),
                })
              : t("kpi.allHealthy")}
          </p>
        </button>
      </DisabledTooltip>
    </div>
  )
}
