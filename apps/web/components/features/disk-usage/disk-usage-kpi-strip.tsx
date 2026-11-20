"use client"

import { BarChart3Icon, FilesIcon, HardDriveIcon, InfoIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { Badge } from "@/components/ui/badge"
import type { DiskUsageJob } from "@/lib/api/types"
import type { DiskUsageMetrics } from "@/lib/disk-usage/disk-usage-metrics"

interface DiskUsageKpiStripProps {
  job: DiskUsageJob
  metrics: DiskUsageMetrics
  previousSnapshot: boolean
}

export function DiskUsageKpiStrip({ job, metrics, previousSnapshot }: DiskUsageKpiStripProps) {
  const t = useTranslations("diskUsage")
  const format = useFormatter()

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
            <span>{t("kpi.totalSize")}</span>
            <HardDriveIcon className="size-4 shrink-0" aria-hidden="true" />
          </div>
          <p className="text-heading-lg tabular-nums text-foreground">
            <DiskSize bytes={metrics.totalBytes} partial={job.partial || job.status !== "completed"} />
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {job.cacheHit ? <Badge variant="secondary">{t("kpi.cachedBadge")}</Badge> : null}
            {job.partial ? <Badge variant="outline">{t("kpi.partialBadge")}</Badge> : null}
            {previousSnapshot ? <Badge variant="outline">{t("kpi.previousBadge")}</Badge> : null}
            {!job.cacheHit && !job.partial && !previousSnapshot ? (
              <span className="text-caption text-muted-foreground">{t(`views.${job.view}`)}</span>
            ) : null}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
            <span>{t("kpi.filesAndItems")}</span>
            <FilesIcon className="size-4 shrink-0" aria-hidden="true" />
          </div>
          <p className="text-heading-lg tabular-nums text-foreground">
            {metrics.totalFiles === null ? t("size.pending") : format.number(metrics.totalFiles)}
          </p>
          <p className="text-caption text-muted-foreground">
            {t("kpi.listedItems", { formattedCount: format.number(metrics.itemCount) })}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
            <span>{t("kpi.heaviestItem")}</span>
            <BarChart3Icon className="size-4 shrink-0" aria-hidden="true" />
          </div>
          <p className="truncate font-mono text-body-md font-semibold text-foreground" title={metrics.topChild?.name}>
            {metrics.topChild ? metrics.topChild.name : "—"}
          </p>
          <p className="text-caption tabular-nums text-muted-foreground">
            {metrics.topChild ? (
              <>
                <DiskSize bytes={metrics.topChild.sizeBytes} />
                {metrics.topChild.sharePercent !== null ? (
                  <> · {format.number(metrics.topChild.sharePercent, { maximumFractionDigits: 1 })}%</>
                ) : null}
              </>
            ) : (
              t("kpi.noHeaviest")
            )}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
            <span>{t("kpi.measurementInfo")}</span>
            <InfoIcon className="size-4 shrink-0" aria-hidden="true" />
          </div>
          <p className="text-body-sm font-semibold text-foreground">
            {job.measuredAt ? (
              <time dateTime={job.measuredAt}>
                {format.dateTime(new Date(job.measuredAt), { dateStyle: "medium", timeStyle: "short" })}
              </time>
            ) : (
              t(`status.${job.status}`)
            )}
          </p>
          <p className="text-caption text-muted-foreground">
            {t("kpi.skippedSummary", {
              skipped: format.number(job.progress.skippedCount),
              links: format.number(job.progress.skippedLinks),
            })}
          </p>
        </div>
      </div>

      {previousSnapshot ? (
        <p className="rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-caption font-medium text-warning">
          {t("previousSnapshot")}
        </p>
      ) : null}

      {job.stopReason || job.failureCode ? (
        <div role="status" className="space-y-1 rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-body-sm font-medium text-warning">
          {job.stopReason ? <p>{t(`stops.${job.stopReason}`)}</p> : null}
          {job.failureCode ? <p>{t(`failures.${job.failureCode}`)}</p> : null}
        </div>
      ) : null}

      <details
        key={job.jobId}
        open={job.partial || undefined}
        className="rounded-md border border-border bg-card px-4 py-2.5 text-caption text-muted-foreground"
      >
        <summary className="cursor-pointer select-none font-medium text-foreground focus-ring">
          {t("kpi.notesDisclosure")}
        </summary>
        <div className="mt-2.5 space-y-1.5 border-t border-border/60 pt-2.5 leading-relaxed">
          <p>{t("metric")}</p>
          <p>{t("overlap")}</p>
          {job.cacheHit ? <p>{t("cacheHit")}</p> : null}
          <p>{t("cacheHint")}</p>
          {job.partial ? <p className="text-foreground">{t("partial")}</p> : null}
          {job.view === "packages" ? <p>{t("packagesHint")}</p> : null}
        </div>
      </details>
    </div>
  )
}
