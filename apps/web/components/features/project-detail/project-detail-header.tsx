"use client"

import {
  AlertTriangleIcon,
  ArrowUpCircleIcon,
  HardDriveIcon,
  LockIcon,
  LockOpenIcon,
  PackageIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { Badge } from "@/components/ui/badge"
import type { ProjectAnalysisJob, ProjectDetail } from "@/lib/api/types"
import { projectAuditIsClean } from "@/lib/projects/project-detail-list"
import type { ProjectDetailMetrics } from "@/lib/projects/project-metrics"

interface ProjectDetailHeaderProps {
  detail: ProjectDetail
  job: ProjectAnalysisJob | null
  metrics: ProjectDetailMetrics
  renderWarning(code: string): React.ReactNode
}

export function ProjectDetailHeader({
  detail,
  job,
  metrics,
  renderWarning,
}: ProjectDetailHeaderProps) {
  const t = useTranslations("projectDetail")
  const format = useFormatter()
  const manager = detail.manager === "unknown"
    ? t("summary.managerUnknown")
    : detail.manager === "ambiguous"
      ? t("summary.managerAmbiguous")
      : detail.manager
  const auditClean = job !== null && projectAuditIsClean(job)
  const extraWarnings = detail.warnings.filter((code) => code !== "REGISTRY_CONFIG_UNSUPPORTED")

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section
        aria-label={t("summary.title")}
        className="min-w-0 space-y-4 rounded-md border border-border bg-card p-4 text-card-foreground md:p-6"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-heading-lg [overflow-wrap:anywhere]">
                {detail.name ?? t("summary.unknown")}
              </h2>
              {detail.version ? (
                <Badge variant="outline" className="font-mono">
                  v{detail.version}
                </Badge>
              ) : null}
            </div>
            <p className="font-mono text-caption text-muted-foreground [overflow-wrap:anywhere]">
              {detail.requestPath}
            </p>
          </div>
          <p className="shrink-0 text-caption text-muted-foreground">
            {t("summary.readAt")}{" "}
            <time dateTime={detail.readAt} className="font-medium text-foreground">
              {format.dateTime(new Date(detail.readAt), { dateStyle: "medium", timeStyle: "short" })}
            </time>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{manager}</Badge>
          {detail.packageManager ? (
            <Badge variant="outline" className="font-mono">
              {detail.packageManager}
            </Badge>
          ) : null}
          {detail.lockfile ? (
            <Badge variant="success" className="font-mono">
              <LockIcon aria-hidden="true" />
              {detail.lockfile}
            </Badge>
          ) : (
            <Badge variant="outline">
              <LockOpenIcon aria-hidden="true" />
              {t("summary.noLockfile")}
            </Badge>
          )}
          {detail.diskUsage !== null ? (
            <Badge variant="secondary" className="tabular-nums">
              <HardDriveIcon aria-hidden="true" />
              node_modules: <DiskSize bytes={detail.diskUsage.sizeBytes} />
            </Badge>
          ) : null}
        </div>

        {extraWarnings.length > 0 ? (
          <div className="space-y-1.5 rounded-md border border-warning/40 bg-warning-soft p-3 text-body-sm font-medium text-warning">
            {extraWarnings.map((code) => (
              <div key={code}>{renderWarning(code)}</div>
            ))}
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
            <span>{t("kpi.dependencies")}</span>
            <PackageIcon className="size-4 shrink-0" aria-hidden="true" />
          </div>
          <p className="text-heading-lg tabular-nums text-foreground">
            {format.number(metrics.dependencyCount)}
          </p>
          <p className="text-caption text-muted-foreground">{t("kpi.declaredInManifest")}</p>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
            <span>{t("kpi.outdated")}</span>
            <ArrowUpCircleIcon className="size-4 shrink-0" aria-hidden="true" />
          </div>
          <p className="text-heading-lg tabular-nums text-foreground">
            {metrics.outdatedCount === null ? "—" : format.number(metrics.outdatedCount)}
          </p>
          <p className="text-caption text-muted-foreground">
            {metrics.outdatedCount === null
              ? t("kpi.notChecked")
              : metrics.outdatedCount === 0
                ? t("kpi.allUpToDate")
                : t("kpi.updatesAvailable")}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
            <span>{t("kpi.advisories")}</span>
            {metrics.criticalOrHighAdvisoryCount > 0 ? (
              <ShieldAlertIcon className="size-4 shrink-0" aria-hidden="true" />
            ) : auditClean ? (
              <ShieldCheckIcon className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangleIcon className="size-4 shrink-0" aria-hidden="true" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-heading-lg tabular-nums text-foreground">
              {metrics.advisoryCount === null ? "—" : format.number(metrics.advisoryCount)}
            </p>
            {metrics.criticalOrHighAdvisoryCount > 0 ? (
              <Badge variant="destructive">
                {t("kpi.criticalHighBadge", { count: format.number(metrics.criticalOrHighAdvisoryCount) })}
              </Badge>
            ) : auditClean ? (
              <Badge variant="success">{t("kpi.cleanBadge")}</Badge>
            ) : null}
          </div>
          <p className="text-caption text-muted-foreground">
            {metrics.advisoryCount === null
              ? t("kpi.notChecked")
              : auditClean
                ? t("kpi.noAdvisories")
                : t("kpi.findingsFromAudit")}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
            <span>{t("kpi.scripts")}</span>
            <TerminalIcon className="size-4 shrink-0" aria-hidden="true" />
          </div>
          <p className="text-heading-lg tabular-nums text-foreground">
            {format.number(metrics.scriptCount)}
          </p>
          <p className="text-caption text-muted-foreground">{t("kpi.scriptsDeclared")}</p>
        </div>
      </div>
    </div>
  )
}
