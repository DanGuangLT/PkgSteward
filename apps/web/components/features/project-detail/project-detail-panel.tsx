"use client"

import { AlertTriangleIcon, CheckIcon, CircleIcon, HardDriveIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useTransition } from "react"
import type { ReactNode } from "react"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { ProjectManagerPanel } from "@/components/features/package-managers/project-manager-panel"
import { ProjectAdvisories } from "@/components/features/project-detail/project-advisories"
import { ProjectDependencies } from "@/components/features/project-detail/project-dependencies"
import { ProjectDetailHeader } from "@/components/features/project-detail/project-detail-header"
import { ProjectScripts } from "@/components/features/project-detail/project-scripts"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useNavigationContinuity, useRouteScrollContinuity } from "@/hooks/use-navigation-continuity"
import { useProjectAnalysis } from "@/hooks/use-project-analysis"
import type { AnalysisSection, ProjectAnalysisJob, ProjectDetail } from "@/lib/api/types"
import { diskUsageHref } from "@/lib/disk-usage/disk-usage-list"
import { projectAnalysisStatusKey, projectAuditIsClean, projectDetailHref } from "@/lib/projects/project-detail-list"
import { analysisProgressPercent, computeProjectDetailMetrics } from "@/lib/projects/project-metrics"
import { appendReturnContext, makeViewStateKey } from "@/lib/ui/navigation-targets"
import type messages from "@/messages/vi.json"

interface ProjectAnalysisMemorySnapshot {
  job: ProjectAnalysisJob
  scanId: string
  inputHash: string
}

export function ProjectErrorMessage({ code, tone = "warning" }: { code: string; tone?: "warning" | "destructive" }) {
  const t = useTranslations("projectDetail")
  const key = `errors.${code}` as `errors.${keyof typeof messages.projectDetail.errors}`
  return (
    <p className={tone === "destructive" ? "font-medium text-destructive" : "font-medium text-warning"}>
      <AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" />
      {t(t.has(key) ? key : "errors.UNKNOWN")}
    </p>
  )
}

function ProjectSectionStatus({ title, section, progress }: {
  title: string
  section: AnalysisSection<unknown>
  progress: string
}) {
  const t = useTranslations("projectDetail")
  const complete = section.state === "complete"
  return (
    <div className="min-w-0 space-y-2 rounded-md border border-border bg-background p-4 text-body-sm [overflow-wrap:anywhere]">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <span className="inline-flex items-center gap-1 text-caption font-medium text-muted-foreground">
          {complete ? <CheckIcon aria-hidden="true" className="size-3.5" /> : <CircleIcon aria-hidden="true" className="size-3.5" />}
          {t(`sections.${section.state}`)}
        </span>
      </div>
      <p className="text-caption text-muted-foreground">{progress}</p>
      {section.failureCode ? <ProjectErrorMessage code={section.failureCode} tone="destructive" /> : null}
      {section.warningCodes.filter(code => code !== section.failureCode).map(code => <ProjectErrorMessage key={code} code={code} />)}
    </div>
  )
}

export function ProjectDetailPanel({ detail, detailError, runner, runnerBusy, active = true }: {
  detail: ProjectDetail | null
  detailError: string | null
  runner: ReactNode
  runnerBusy: boolean
  active?: boolean
}) {
  const t = useTranslations("projectDetail")
  const format = useFormatter()
  const router = useRouter()
  const [refreshing, beginRefresh] = useTransition()
  const { hydrated, currentUrl, entryId, getMemorySnapshot, setMemorySnapshot } = useNavigationContinuity()
  const controller = useProjectAnalysis(detail)
  const { state, restoreSnapshot } = controller
  const local = detail ? state.detail ?? detail : null
  const job = state.job
  const analysisKey = local ? makeViewStateKey("project-analysis", local.requestPath) : null
  const scrollKey = makeViewStateKey("project-detail", local?.requestPath ?? "")

  useEffect(() => {
    if (!hydrated || !detail || detail.activeAnalysisJobId || !analysisKey) return
    if (state.phase !== "idle" || state.job !== null) return
    const record = getMemorySnapshot<ProjectAnalysisMemorySnapshot>(analysisKey)
    if (!record || record.invalid) return
    if (record.value.scanId !== detail.scanId || record.value.inputHash !== detail.inputHash) return
    restoreSnapshot(record.value.job)
  }, [analysisKey, detail, getMemorySnapshot, hydrated, restoreSnapshot, state.job, state.phase])

  useEffect(() => {
    if (!hydrated || !analysisKey || !local || !job || job.status === "running" || job.stale) return
    if (job.scanId !== local.scanId || job.inputHash !== local.inputHash) return
    const existing = getMemorySnapshot<ProjectAnalysisMemorySnapshot>(analysisKey)
    if (existing && !existing.invalid && existing.value.job === job) return
    setMemorySnapshot<ProjectAnalysisMemorySnapshot>(analysisKey, {
      job,
      scanId: local.scanId,
      inputHash: local.inputHash,
    })
  }, [analysisKey, getMemorySnapshot, hydrated, job, local, setMemorySnapshot])

  useRouteScrollContinuity({ routeKey: scrollKey, ready: true, active })

  const metrics = useMemo(
    () => (local ? computeProjectDetailMetrics(local, job) : null),
    [local, job],
  )
  const progressValue = useMemo(() => analysisProgressPercent(job), [job])

  const returnContext = { returnTo: hydrated ? currentUrl : undefined, originId: hydrated ? entryId : null }
  const busy = state.phase === "starting" || state.phase === "tracking"
  const blocked = local?.warnings.includes("REGISTRY_CONFIG_UNSUPPORTED")
  const previous = job !== null && (state.phase === "starting" || state.startUnknown
    || (state.phase === "tracking" && state.jobId !== job.jobId))
  const differentInputs = job !== null && local !== null && (job.inputHash !== local.inputHash || job.scanId !== local.scanId)
  const conflict = state.error?.conflict

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {local && metrics ? (
        <>
          <ProjectDetailHeader
            detail={local}
            job={job}
            metrics={metrics}
            renderWarning={(code) => <ProjectErrorMessage code={code} />}
          />

          <ProjectManagerPanel path={local.requestPath} />
        </>
      ) : (
        <div role="alert" className="rounded-md border border-destructive/40 bg-card p-4 text-body-sm">
          <ProjectErrorMessage code={detailError ?? "UNKNOWN"} tone="destructive" />
        </div>
      )}

      {runner}

      {local ? (
        <>
          <section
            className="min-w-0 space-y-4 rounded-md border border-border bg-card p-4 text-card-foreground md:p-6"
            aria-label={t("analysis.start")}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="space-y-1">
                <h2 className="text-heading-md">{t("analysis.start")}</h2>
                <p id="project-registry-notice" className="text-caption text-muted-foreground">
                  {t("analysis.publicRegistryNotice")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || refreshing || blocked || runnerBusy}
                  aria-describedby={blocked ? "project-registry-notice project-registry-blocked" : "project-registry-notice"}
                  className="h-auto min-h-10 whitespace-normal"
                  onClick={() => { void controller.start(local.requestPath) }}
                >
                  {t("analysis.start")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || refreshing}
                  className="h-auto min-h-10 whitespace-normal"
                  onClick={() => beginRefresh(() => router.refresh())}
                >
                  {t(refreshing ? "analysis.refreshing" : "analysis.refresh")}
                </Button>
                {state.phase === "tracking" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={state.cancelPending}
                    className="h-auto min-h-10 whitespace-normal"
                    onClick={() => { void controller.cancel() }}
                  >
                    {t(state.cancelPending ? "analysis.cancelling" : "analysis.cancel")}
                  </Button>
                ) : null}
                {state.phase === "tracking" && state.pollError !== null && !state.cancelPending ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-auto min-h-10 whitespace-normal"
                    onClick={() => controller.retryPoll()}
                  >
                    {t("analysis.retryPoll")}
                  </Button>
                ) : null}
              </div>
            </div>

            {blocked ? (
              <div id="project-registry-blocked" className="rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-body-sm">
                <ProjectErrorMessage code="REGISTRY_CONFIG_UNSUPPORTED" />
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-body-sm">
                <p aria-live="polite" aria-atomic="true" className="font-medium text-foreground">
                  <CircleIcon aria-hidden="true" className="mr-1.5 inline size-3.5" />
                  {t(projectAnalysisStatusKey(state))}
                  {job && !previous && job.status === "running" ? ` · ${t(`phases.${job.phase}`)}` : null}
                </p>
                {progressValue !== null ? (
                  <span className="text-caption font-medium tabular-nums text-muted-foreground">
                    {format.number(progressValue)}%
                  </span>
                ) : null}
              </div>
              {progressValue !== null ? (
                <Progress value={progressValue} aria-label={t("analysis.progressLabel")} />
              ) : null}
              <p className="text-caption text-muted-foreground">{t("analysis.continues")}</p>
            </div>

            {state.error ? (
              <div role="alert" className="min-w-0 space-y-3 rounded-md border border-destructive/40 bg-card p-4 text-body-sm">
                <ProjectErrorMessage code={conflict ? "ANALYSIS_RUNNING" : state.error.code} tone={conflict ? "warning" : "destructive"} />
                {conflict ? (
                  <>
                    <p className="font-mono [overflow-wrap:anywhere]">{conflict.path}</p>
                    <Link
                      href={appendReturnContext(projectDetailHref(conflict.path), returnContext)}
                      prefetch={false}
                      className="inline-block rounded-sm text-ink-soft underline focus-ring"
                    >
                      {t("analysis.follow")}
                    </Link>
                  </>
                ) : null}
              </div>
            ) : null}

            {job ? (
              <div className="min-w-0 space-y-4 border-t border-border/60 pt-4 text-body-sm">
                {previous || job.partial || job.stale || differentInputs ? (
                  <div className="space-y-1.5 rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 font-medium text-warning">
                    {previous ? <p><AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" />{t("analysis.previous")}</p> : null}
                    {job.partial ? <p><AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" />{t("analysis.partial")}</p> : null}
                    {job.stale || differentInputs ? <p><AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" />{t("analysis.stale")}</p> : null}
                  </div>
                ) : null}
                {!previous && !differentInputs && projectAuditIsClean(job) ? (
                  <p className="font-medium text-foreground">
                    <CheckIcon aria-hidden="true" className="mr-1 inline size-4" />
                    {t("analysis.clean")}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-caption text-muted-foreground">
                  <p>
                    {t("analysis.startedAt")}{" "}
                    <time dateTime={job.startedAt} className="text-foreground">
                      {format.dateTime(new Date(job.startedAt), { dateStyle: "medium", timeStyle: "short" })}
                    </time>
                  </p>
                  {job.finishedAt !== null ? (
                    <p>
                      {t("analysis.finishedAt")}{" "}
                      <time dateTime={job.finishedAt} className="text-foreground">
                        {format.dateTime(new Date(job.finishedAt), { dateStyle: "medium", timeStyle: "short" })}
                      </time>
                    </p>
                  ) : null}
                  {job.checkedAt !== null ? (
                    <p>
                      {t("analysis.checkedAt")}{" "}
                      <time dateTime={job.checkedAt} className="text-foreground">
                        {format.dateTime(new Date(job.checkedAt), { dateStyle: "medium", timeStyle: "short" })}
                      </time>
                    </p>
                  ) : null}
                </div>
                <p className="text-caption text-muted-foreground">{t("analysis.historical")}</p>
                {job.failureCode ? <ProjectErrorMessage code={job.failureCode} tone="destructive" /> : null}
                {job.warningCodes
                  .filter(code => code !== job.failureCode
                    && !job.outdated.warningCodes.includes(code)
                    && !job.audit.warningCodes.includes(code))
                  .map(code => <ProjectErrorMessage key={code} code={code} />)}
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <ProjectSectionStatus
                    title={t("dependencies.title")}
                    section={job.outdated}
                    progress={t("analysis.progress", {
                      formattedChecked: format.number(job.outdated.checkedCount),
                      formattedTotal: job.outdated.totalCount === null
                        ? t("analysis.unknownTotal")
                        : format.number(job.outdated.totalCount),
                    })}
                  />
                  {/* Audit counts versions checked; its totalCount counts findings, so the two never pair. */}
                  <ProjectSectionStatus
                    title={t("audit.title")}
                    section={job.audit}
                    progress={t("audit.checkedVersions", {
                      count: job.audit.checkedCount,
                      formattedCount: format.number(job.audit.checkedCount),
                    })}
                  />
                </div>
              </div>
            ) : null}
          </section>

          <ProjectDependencies dependencies={local.dependencies} job={job} resourceKey={local.requestPath} />

          {job ? (
            <ProjectAdvisories items={job.audit.items} resourceKey={local.requestPath} />
          ) : (
            <section
              className="space-y-2 rounded-md border border-border bg-card p-4 text-body-sm text-card-foreground md:p-6"
              aria-label={t("audit.title")}
            >
              <h2 className="text-heading-md">{t("audit.title")}</h2>
              <p className="text-muted-foreground">{t("audit.lockfileCoverage")}</p>
              <p className="text-muted-foreground">{t("audit.notInstalledState")}</p>
              <p>{t("status.idle")}</p>
            </section>
          )}

          <ProjectScripts scripts={local.scripts} resourceKey={local.requestPath} />

          <section
            className="min-w-0 space-y-3 rounded-md border border-border bg-card p-4 text-body-sm text-card-foreground md:p-6"
            aria-label={t("diskUsage.title")}
          >
            <h2 className="text-heading-md">{t("diskUsage.title")}</h2>
            {local.diskUsage !== null ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    {local.diskUsage.sizeBytes === 0
                      ? t("diskUsage.empty")
                      : <>{t("diskUsage.cached")}: <DiskSize bytes={local.diskUsage.sizeBytes} /></>}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {t("diskUsage.measuredAt")}{" "}
                    <time dateTime={local.diskUsage.measuredAt}>
                      {format.dateTime(new Date(local.diskUsage.measuredAt), { dateStyle: "medium", timeStyle: "short" })}
                    </time>
                  </p>
                </div>
                <Button asChild variant="secondary" size="sm">
                  <Link
                    href={appendReturnContext(diskUsageHref(`${local.requestPath.replace(/[\\/]+$/, "")}/node_modules`, "packages"), returnContext)}
                    prefetch={false}
                  >
                    <HardDriveIcon data-icon="inline-start" aria-hidden="true" />
                    {t("diskUsage.view")}
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted-foreground">{t("diskUsage.unknown")}</p>
                <Button asChild variant="secondary" size="sm">
                  <Link
                    href={appendReturnContext(diskUsageHref(`${local.requestPath.replace(/[\\/]+$/, "")}/node_modules`, "packages"), returnContext)}
                    prefetch={false}
                  >
                    <HardDriveIcon data-icon="inline-start" aria-hidden="true" />
                    {t("diskUsage.view")}
                  </Link>
                </Button>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
