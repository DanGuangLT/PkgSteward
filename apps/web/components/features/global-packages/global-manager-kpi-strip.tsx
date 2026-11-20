"use client"

import { CheckCircle2Icon, CpuIcon, PackageIcon, ShieldIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { Badge } from "@/components/ui/badge"
import type { GlobalManagerMetrics } from "@/lib/global-packages/global-metrics"

export function GlobalManagerKpiStrip({ metrics }: { metrics: GlobalManagerMetrics }) {
  const t = useTranslations("globalPackages")
  const format = useFormatter()

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-background p-4">
        <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
          <span>{t("kpi.total")}</span>
          <PackageIcon className="size-4 shrink-0" aria-hidden="true" />
        </div>
        <p className="text-heading-lg tabular-nums text-foreground">
          {format.number(metrics.totalCount)}
        </p>
        <p className="text-caption text-muted-foreground">{t("kpi.installedInPrefix")}</p>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-background p-4">
        <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
          <span>{t("kpi.manageable")}</span>
          <CheckCircle2Icon className="size-4 shrink-0" aria-hidden="true" />
        </div>
        <p className="text-heading-lg tabular-nums text-foreground">
          {format.number(metrics.manageableCount)}
        </p>
        <p className="text-caption text-muted-foreground">{t("kpi.readyForActions")}</p>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-background p-4">
        <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
          <span>{t("kpi.protectedLinked")}</span>
          <ShieldIcon className="size-4 shrink-0" aria-hidden="true" />
        </div>
        <p className="text-heading-lg tabular-nums text-foreground">
          {format.number(metrics.protectedOrLinkedCount)}
        </p>
        <p className="text-caption text-muted-foreground">
          {metrics.invalidCount > 0
            ? t("kpi.invalidExtra", { count: format.number(metrics.invalidCount) })
            : t("kpi.viewOnly")}
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-background p-4">
        <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
          <span>{t("kpi.activeVersion")}</span>
          <CpuIcon className="size-4 shrink-0" aria-hidden="true" />
        </div>
        <p className="truncate font-mono text-heading-lg tabular-nums text-foreground" title={metrics.version ?? undefined}>
          {metrics.version ?? t("unknown")}
        </p>
        <div>
          <Badge variant={metrics.available ? "success" : "outline"}>
            {t(metrics.available ? "kpi.available" : "kpi.unavailableBadge")}
          </Badge>
        </div>
      </div>
    </div>
  )
}
