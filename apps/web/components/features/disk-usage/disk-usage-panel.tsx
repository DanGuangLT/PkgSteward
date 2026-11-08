"use client"

import Link from "next/link"
import { useId, useRef, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"

import { DiskUsageControls } from "@/components/features/disk-usage/disk-usage-controls"
import { DiskSize, DiskUsageItems } from "@/components/features/disk-usage/disk-usage-items"
import { Button } from "@/components/ui/button"
import { useDiskUsage } from "@/hooks/use-disk-usage"
import type { DiskUsageRow, DiskView } from "@/lib/api/types"
import { diskExpandTarget, diskMeasurementInput, diskSaveSnapshot, diskStatusKey, type DiskSnapshot } from "@/lib/disk-usage/disk-usage-policy"

export function DiskUsagePanel({ initialPath, initialView }: { initialPath: string; initialView: DiskView }) {
  const t = useTranslations("diskUsage")
  const format = useFormatter()
  const controller = useDiskUsage({ path: initialPath, view: initialView })
  const { state, error } = controller
  const job = state.job
  const busy = state.phase !== "idle"
  const previousSnapshot = job !== null && (state.phase === "starting"
    || (state.phase === "tracking" && state.jobId !== job.jobId))
  const { path, view } = state.form
  const [history, setHistory] = useState<DiskSnapshot[]>([])
  const resultsId = useId()
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const ancestors = history.filter((entry) => entry.job.jobId !== job?.jobId)

  function measure(force: boolean) {
    if (busy) return
    if (!force) setHistory([])
    heading.current?.focus()
    void controller.start(diskMeasurementInput(state, force))
  }

  function expand(row: DiskUsageRow) {
    if (busy || !job || job.status === "running" || row.state === "excluded") return
    const snapshot = diskSaveSnapshot(state)
    if (!snapshot) return
    setHistory((previous) => [...previous.filter((entry) => entry.job.jobId !== job.jobId), snapshot].slice(-16))
    heading.current?.focus()
    void controller.start(diskExpandTarget(row))
  }

  function back(snapshot: DiskSnapshot) {
    if (busy) return
    const index = history.findIndex((entry) => entry.job.jobId === snapshot.job.jobId)
    setHistory((previous) => previous.slice(0, index))
    controller.restore(snapshot)
    heading.current?.focus()
  }

  const errorMessage = error ? (() => {
    switch (error.code) {
      case "CONFLICT": return t("errors.conflict")
      case "NOT_FOUND": return t("errors.notFound")
      case "FORBIDDEN": return t("errors.forbidden")
      case "VALIDATION_ERROR": return t("errors.validation")
      case "RATE_LIMITED": return t("errors.rateLimited")
      case "BACKEND_UNAVAILABLE": return t("errors.backendUnavailable")
      case "INVALID_RESPONSE": return t("errors.invalidResponse")
      default: return t("errors.generic")
    }
  })() : null

  return (
    <section className="flex min-w-0 flex-col gap-6" aria-label={t("title")}>
      <p className="text-body-sm text-muted-foreground">{t("description")}</p>
      <DiskUsageControls controller={controller} path={path} view={view}
        onPathChange={(path) => controller.setTarget({ path, view })}
        onViewChange={(view) => controller.setTarget({ path, view })} onMeasure={measure} />

      {errorMessage ? (
        <div role="alert" className="min-w-0 space-y-3 rounded-md border border-border bg-muted p-4 text-body-sm">
          <p>{errorMessage}</p>
          {error?.lost && job ? <p>{t("errors.lost")}</p> : null}
          {state.phase === "tracking" && state.errorCode !== undefined ? <p>{t("errors.pollPaused")}</p> : null}
          {error?.conflict ? (
            <>
              <p className="font-mono [overflow-wrap:anywhere]">{error.conflict.path}</p>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => {
                if (!error.conflict) return
                setHistory([])
                heading.current?.focus()
                controller.follow(error.conflict)
              }}>{t("actions.follow")}</Button>
            </>
          ) : null}
        </div>
      ) : null}

      <p aria-live="polite" aria-atomic="true" className="text-body-sm">
        {t(diskStatusKey(state))}
        {job && !previousSnapshot ? ` ${t("progress", {
          dirs: job.progress.visitedDirs, entries: job.progress.visitedEntries,
          skipped: job.progress.skippedCount, links: job.progress.skippedLinks,
          formattedDirs: format.number(job.progress.visitedDirs), formattedEntries: format.number(job.progress.visitedEntries),
          formattedSkipped: format.number(job.progress.skippedCount), formattedLinks: format.number(job.progress.skippedLinks),
        })}` : null}
      </p>

      {ancestors.length > 0 || job ? (
        <nav aria-label={t("breadcrumbs")} className="min-w-0">
          <ol className="flex min-w-0 flex-col gap-2">
            {ancestors.map((snapshot) => (
              <li key={snapshot.job.jobId} className="min-w-0">
                <Button type="button" variant="secondary" disabled={busy}
                  aria-label={t("actions.backTo", { path: snapshot.job.path })}
                  aria-expanded={true} aria-controls={resultsId}
                  className="h-auto max-w-full justify-start py-2 text-left font-mono whitespace-normal [overflow-wrap:anywhere]"
                  onClick={() => back(snapshot)}>{snapshot.job.path}</Button>
              </li>
            ))}
            {job ? <li aria-current="page" className="font-mono text-body-sm [overflow-wrap:anywhere]">{job.path}</li> : null}
          </ol>
        </nav>
      ) : null}

      <section id={resultsId} aria-labelledby={headingId} className="min-w-0 space-y-6">
        {/* scroll-mt-24: khi focus cuộn tới, tiêu đề không bị thanh điều hướng sticky 64px che. */}
        <h2 id={headingId} ref={heading} tabIndex={-1} className="scroll-mt-24 text-heading-md focus-ring">{t("results")}</h2>
        {job ? (
          <>
            <div className="min-w-0 space-y-3 rounded-md bg-card p-4 text-card-foreground">
              {previousSnapshot ? <p className="text-body-sm">{t("previousSnapshot")}</p> : null}
              <p className="font-mono text-body-sm [overflow-wrap:anywhere]">{job.path}</p>
              <p className="text-body-sm">{t(`views.${job.view}`)}</p>
              <p className="text-heading-lg">{t("total")} <DiskSize bytes={job.sizeBytes} partial={job.partial || job.status !== "completed"} /></p>
              <p className="text-body-sm text-muted-foreground">{t("metric")}</p>
              <p className="text-body-sm">{t("overlap")}</p>
              {job.measuredAt ? (
                <p className="text-body-sm">{t("measuredAt")} <time dateTime={job.measuredAt}>{format.dateTime(new Date(job.measuredAt), { dateStyle: "medium", timeStyle: "short" })}</time></p>
              ) : null}
              {job.cacheHit ? <p className="text-body-sm">{t("cacheHit")}</p> : null}
              <p className="text-body-sm text-muted-foreground">{t("cacheHint")}</p>
              {job.partial ? <p className="text-body-sm">{t("partial")}</p> : null}
              {job.stopReason ? <p className="text-body-sm">{t(`stops.${job.stopReason}`)}</p> : null}
              {job.failureCode ? <p className="text-body-sm">{t(`failures.${job.failureCode}`)}</p> : null}
              {job.view === "packages" ? <p className="text-body-sm">{t("packagesHint")}</p> : null}
            </div>
            <DiskUsageItems job={job} resultsId={resultsId} onExpand={expand} interaction={busy ? "busy" : "ready"} />
          </>
        ) : <p className="text-body-sm text-muted-foreground">{t(state.phase === "idle" ? "empty.initial" : "empty.listing")}</p>}
      </section>
      <Button asChild variant="secondary" className="self-start"><Link href="/" prefetch={false}>{t("actions.projects")}</Link></Button>
    </section>
  )
}
