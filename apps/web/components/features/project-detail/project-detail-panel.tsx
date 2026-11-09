"use client"

import { AlertTriangleIcon, CheckIcon, CircleIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import type { ReactNode } from "react"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { ProjectManagerPanel } from "@/components/features/package-managers/project-manager-panel"
import { ProjectAdvisories } from "@/components/features/project-detail/project-advisories"
import { ProjectDependencies } from "@/components/features/project-detail/project-dependencies"
import { ProjectScripts } from "@/components/features/project-detail/project-scripts"
import { Button } from "@/components/ui/button"
import { useProjectAnalysis } from "@/hooks/use-project-analysis"
import type { AnalysisSection, ProjectDetail } from "@/lib/api/types"
import { diskUsageHref } from "@/lib/disk-usage/disk-usage-list"
import { projectAnalysisStatusKey, projectAuditIsClean, projectDetailHref } from "@/lib/projects/project-detail-list"
import type messages from "@/messages/vi.json"

export function ProjectErrorMessage({ code }: { code: string }) {
  const t = useTranslations("projectDetail")
  const key = `errors.${code}` as `errors.${keyof typeof messages.projectDetail.errors}`
  return <p><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" />{t(t.has(key) ? key : "errors.UNKNOWN")}</p>
}

function ProjectSectionStatus({ title, section, progress }: {
  title: string
  section: AnalysisSection<unknown>
  progress: string
}) {
  const t = useTranslations("projectDetail")
  const complete = section.state === "complete"
  return (
    <div className="min-w-0 space-y-2 rounded-md bg-muted p-4 text-body-sm [overflow-wrap:anywhere]">
      <h3 className="font-semibold">{title}</h3>
      <p>{complete ? <CheckIcon aria-hidden="true" className="mr-1 inline size-4" /> : <CircleIcon aria-hidden="true" className="mr-1 inline size-4" />}{t(`sections.${section.state}`)}</p>
      <p>{progress}</p>
      {section.failureCode ? <ProjectErrorMessage code={section.failureCode} /> : null}
      {section.warningCodes.filter(code => code !== section.failureCode).map(code => <ProjectErrorMessage key={code} code={code} />)}
    </div>
  )
}

export function ProjectDetailPanel({ detail, runner, runnerBusy = false }: { detail: ProjectDetail; runner?: ReactNode; runnerBusy?: boolean }) {
  const t = useTranslations("projectDetail")
  const format = useFormatter()
  const router = useRouter()
  const [refreshing, beginRefresh] = useTransition()
  const controller = useProjectAnalysis(detail)
  const { state } = controller
  const local = state.detail ?? detail
  const job = state.job
  const busy = state.phase === "starting" || state.phase === "tracking"
  const blocked = local.warnings.includes("REGISTRY_CONFIG_UNSUPPORTED")
  const previous = job !== null && (state.phase === "starting" || state.startUnknown
    || (state.phase === "tracking" && state.jobId !== job.jobId))
  const differentInputs = job !== null && (job.inputHash !== local.inputHash || job.scanId !== local.scanId)
  const conflict = state.error?.conflict
  const manager = local.manager === "unknown" ? t("summary.managerUnknown")
    : local.manager === "ambiguous" ? t("summary.managerAmbiguous") : local.manager
  const diskPath = `${local.requestPath.replace(/[\\/]+$/, "")}/node_modules`

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <section aria-label={t("summary.title")} className="min-w-0 space-y-4 rounded-md border border-border bg-card p-4 text-card-foreground md:p-6">
        <h2 className="text-heading-lg [overflow-wrap:anywhere]">{local.name ?? t("summary.unknown")}</h2>
        <p className="font-mono text-body-sm [overflow-wrap:anywhere]">{local.requestPath}</p>
        <dl className="grid min-w-0 gap-4 text-body-sm sm:grid-cols-2 [overflow-wrap:anywhere]">
          <div><dt className="text-muted-foreground">{t("summary.version")}</dt><dd className="font-mono">{local.version ?? t("summary.unknown")}</dd></div>
          <div><dt className="text-muted-foreground">{t("summary.manager")}</dt><dd>{manager}</dd></div>
          <div><dt className="text-muted-foreground">{t("summary.packageManager")}</dt><dd className="font-mono">{local.packageManager ?? t("summary.unknown")}</dd></div>
          <div><dt className="text-muted-foreground">{t("summary.lockfile")}</dt><dd className="font-mono">{local.lockfile ?? t("summary.unknown")}</dd></div>
          <div><dt className="text-muted-foreground">{t("summary.readAt")}</dt><dd><time dateTime={local.readAt}>{format.dateTime(new Date(local.readAt), { dateStyle: "medium", timeStyle: "short" })}</time></dd></div>
        </dl>
        {local.warnings.filter(code => code !== "REGISTRY_CONFIG_UNSUPPORTED").map(code => <ProjectErrorMessage key={code} code={code} />)}
      </section>

      <ProjectManagerPanel path={local.requestPath} />

      {runner}

      <section className="min-w-0 space-y-4" aria-label={t("analysis.start")}>
        <p id="project-registry-notice" className="text-body-sm">{t("analysis.publicRegistryNotice")}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button type="button" variant={runner ? "secondary" : "default"} disabled={busy || refreshing || blocked || runnerBusy}
            aria-describedby={blocked ? "project-registry-notice project-registry-blocked" : "project-registry-notice"}
            className="h-auto min-h-10 whitespace-normal" onClick={() => { void controller.start(local.requestPath) }}>{t("analysis.start")}</Button>
          <Button type="button" variant="secondary" disabled={busy || refreshing} className="h-auto min-h-10 whitespace-normal"
            onClick={() => beginRefresh(() => router.refresh())}>{t(refreshing ? "analysis.refreshing" : "analysis.refresh")}</Button>
          {state.phase === "tracking" ? (
            <Button type="button" variant="secondary" disabled={state.cancelPending} className="h-auto min-h-10 whitespace-normal"
              onClick={() => { void controller.cancel() }}>{t(state.cancelPending ? "analysis.cancelling" : "analysis.cancel")}</Button>
          ) : null}
          {state.phase === "tracking" && state.pollError !== null && !state.cancelPending ? (
            <Button type="button" variant="secondary" className="h-auto min-h-10 whitespace-normal"
              onClick={() => controller.retryPoll()}>{t("analysis.retryPoll")}</Button>
          ) : null}
        </div>
        {blocked ? <div id="project-registry-blocked" className="text-body-sm"><ProjectErrorMessage code="REGISTRY_CONFIG_UNSUPPORTED" /></div> : null}
        <p className="text-body-sm text-muted-foreground">{t("analysis.continues")}</p>
        <p aria-live="polite" aria-atomic="true" className="text-body-sm">
          <CircleIcon aria-hidden="true" className="mr-1 inline size-4" />{t(projectAnalysisStatusKey(state))}
          {job && !previous && job.status === "running" ? ` ${t(`phases.${job.phase}`)}` : null}
        </p>
        {state.error ? (
          <div role="alert" className="min-w-0 space-y-3 rounded-md border border-border bg-muted p-4 text-body-sm">
            <ProjectErrorMessage code={conflict ? "ANALYSIS_RUNNING" : state.error.code} />
            {conflict ? <>
              <p className="font-mono [overflow-wrap:anywhere]">{conflict.path}</p>
              <Link href={projectDetailHref(conflict.path)} prefetch={false} className="inline-block rounded-sm text-ink-soft underline focus-ring">{t("analysis.follow")}</Link>
            </> : null}
          </div>
        ) : null}
        {job ? (
          <div className="min-w-0 space-y-4 text-body-sm">
            {previous ? <p><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" />{t("analysis.previous")}</p> : null}
            {job.partial ? <p><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" />{t("analysis.partial")}</p> : null}
            {job.stale || differentInputs ? <p><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" />{t("analysis.stale")}</p> : null}
            {!previous && !differentInputs && projectAuditIsClean(job) ? <p><CheckIcon aria-hidden="true" className="mr-1 inline size-4" />{t("analysis.clean")}</p> : null}
            <p>{t("analysis.startedAt")} <time dateTime={job.startedAt}>{format.dateTime(new Date(job.startedAt), { dateStyle: "medium", timeStyle: "short" })}</time></p>
            {job.finishedAt !== null ? <p>{t("analysis.finishedAt")} <time dateTime={job.finishedAt}>{format.dateTime(new Date(job.finishedAt), { dateStyle: "medium", timeStyle: "short" })}</time></p> : null}
            {job.checkedAt !== null ? <p>{t("analysis.checkedAt")} <time dateTime={job.checkedAt}>{format.dateTime(new Date(job.checkedAt), { dateStyle: "medium", timeStyle: "short" })}</time></p> : null}
            <p className="text-muted-foreground">{t("analysis.historical")}</p>
            {job.failureCode ? <ProjectErrorMessage code={job.failureCode} /> : null}
            {job.warningCodes.filter(code => code !== job.failureCode
              && !job.outdated.warningCodes.includes(code) && !job.audit.warningCodes.includes(code))
              .map(code => <ProjectErrorMessage key={code} code={code} />)}
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <ProjectSectionStatus title={t("dependencies.title")} section={job.outdated} progress={t("analysis.progress", {
                formattedChecked: format.number(job.outdated.checkedCount),
                formattedTotal: job.outdated.totalCount === null ? t("analysis.unknownTotal") : format.number(job.outdated.totalCount),
              })} />
              {/* Audit counts versions checked; its totalCount counts findings, so the two never pair. */}
              <ProjectSectionStatus title={t("audit.title")} section={job.audit} progress={t("audit.checkedVersions", {
                count: job.audit.checkedCount, formattedCount: format.number(job.audit.checkedCount),
              })} />
            </div>
          </div>
        ) : null}
      </section>

      <ProjectDependencies dependencies={local.dependencies} job={job} />
      {job ? <ProjectAdvisories items={job.audit.items} /> : (
        <section className="space-y-3 text-body-sm" aria-label={t("audit.title")}>
          <h2 className="text-heading-md">{t("audit.title")}</h2>
          <p>{t("audit.lockfileCoverage")}</p><p>{t("audit.notInstalledState")}</p><p>{t("status.idle")}</p>
        </section>
      )}
      <ProjectScripts scripts={local.scripts} />
      <section className="min-w-0 space-y-3 text-body-sm" aria-label={t("diskUsage.title")}>
        <h2 className="text-heading-md">{t("diskUsage.title")}</h2>
        {local.diskUsage !== null ? <>
          <p>{local.diskUsage.sizeBytes === 0 ? t("diskUsage.empty") : <>{t("diskUsage.cached")}: <DiskSize bytes={local.diskUsage.sizeBytes} /></>}</p>
          <p>{t("diskUsage.measuredAt")} <time dateTime={local.diskUsage.measuredAt}>{format.dateTime(new Date(local.diskUsage.measuredAt), { dateStyle: "medium", timeStyle: "short" })}</time></p>
        </> : <>
          <p>{t("diskUsage.unknown")}</p>
          <Link href={diskUsageHref(diskPath, "packages")} prefetch={false} className="inline-block rounded-sm text-ink-soft underline focus-ring">{t("diskUsage.view")}</Link>
        </>}
      </section>
    </div>
  )
}
