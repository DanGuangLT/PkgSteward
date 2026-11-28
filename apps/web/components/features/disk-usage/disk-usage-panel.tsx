"use client"

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react"
import {
  BookmarkCheckIcon,
  BookmarkPlusIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"

import { DiskUsageControls } from "@/components/features/disk-usage/disk-usage-controls"
import { DiskUsageItems } from "@/components/features/disk-usage/disk-usage-items"
import { DiskUsageKpiStrip } from "@/components/features/disk-usage/disk-usage-kpi-strip"
import { DiskUsageQuickTargets } from "@/components/features/disk-usage/disk-usage-quick-targets"
import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import { ReturnLink } from "@/components/shared/return-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useDiskUsage } from "@/hooks/use-disk-usage"
import { useDiskUsageFavorites } from "@/hooks/use-disk-usage-favorites"
import {
  useNavigationContinuity,
  useRouteScrollContinuity,
  useViewState,
} from "@/hooks/use-navigation-continuity"
import type { DiskUsageActiveJob, DiskUsageRow, DiskView, ScannedProject } from "@/lib/api/types"
import { isPathFavorited } from "@/lib/disk-usage/disk-usage-favorites"
import { computeDiskUsageMetrics } from "@/lib/disk-usage/disk-usage-metrics"
import {
  diskExpandTarget,
  diskMeasurementInput,
  diskSaveSnapshot,
  diskStatusKey,
  type DiskSnapshot,
} from "@/lib/disk-usage/disk-usage-policy"
import {
  diskUsagePrefsCodec,
  makeViewStateKey,
  type DiskUsagePrefsState,
  type ResolvedReturnTarget,
} from "@/lib/ui/navigation-targets"

interface DiskMemoryEntry {
  current: DiskSnapshot
  ancestors: DiskSnapshot[]
}

const DEFAULT_BACK_TARGET: ResolvedReturnTarget = { href: "/", originId: null, isFallback: true }

export function DiskUsagePanel({
  initialPath,
  initialView,
  hasExplicitPath = false,
  hasExplicitView = false,
  backTarget = DEFAULT_BACK_TARGET,
  activeJob,
  scanRoots = [],
  scannedProjects = [],
  hasScan = false,
  embedded = false,
  active = true,
}: {
  initialPath: string
  initialView: DiskView
  hasExplicitPath?: boolean
  hasExplicitView?: boolean
  backTarget?: ResolvedReturnTarget
  activeJob: DiskUsageActiveJob | null
  scanRoots?: readonly string[]
  scannedProjects?: readonly ScannedProject[]
  hasScan?: boolean
  embedded?: boolean
  active?: boolean
}) {
  const t = useTranslations("diskUsage")
  const tDisabled = useTranslations("disabledReasons")
  const tNav = useTranslations("navigationState")
  const tCommon = useTranslations("common")
  const format = useFormatter()
  const { hydrated, currentUrl, getMemorySnapshot, setMemorySnapshot } = useNavigationContinuity()
  const scopeKey = JSON.stringify([initialPath, initialView])
  const prefsKey = makeViewStateKey("disk-usage-prefs", scopeKey)
  const snapshotKey = makeViewStateKey("disk-usage-snapshot", scopeKey)
  const scrollKey = makeViewStateKey("disk-usage", scopeKey)

  const [prefs, setPrefs] = useViewState<DiskUsagePrefsState>(prefsKey, diskUsagePrefsCodec, {
    path: initialPath,
    view: initialView,
    hasMeasuredRef: false,
    ancestorCount: 0,
  })
  const controller = useDiskUsage({ path: initialPath, view: initialView }, activeJob)
  const { state, error, restore, setTarget } = controller
  const job = state.job
  const busy = state.phase !== "idle"
  const previousSnapshot = job !== null && (state.phase === "starting"
    || (state.phase === "tracking" && state.jobId !== job.jobId))
  const { path, view } = state.form
  const [controlsExpanded, setControlsExpanded] = useState(false)
  const { favorites, addFavorite, removeFavorite } = useDiskUsageFavorites()
  const [history, setHistory] = useState<DiskSnapshot[]>(() => {
    if (!hydrated || activeJob !== null) return []
    const record = getMemorySnapshot<DiskMemoryEntry>(snapshotKey)
    return record && !record.invalid ? record.value.ancestors.slice(-16) : []
  })
  const restoredMemRef = useRef(false)
  const appliedPrefsRef = useRef(false)
  const resultsId = useId()
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const ancestors = history.filter((entry) => entry.job.jobId !== job?.jobId)

  const scannedProjectPaths = useMemo(
    () => new Set(scannedProjects.map((project) => project.path.toLowerCase())),
    [scannedProjects],
  )
  const metrics = useMemo(() => (job ? computeDiskUsageMetrics(job) : null), [job])

  useEffect(() => {
    if (!hydrated || activeJob !== null || restoredMemRef.current) return
    restoredMemRef.current = true
    if (state.phase !== "idle" || state.job !== null) return
    const record = getMemorySnapshot<DiskMemoryEntry>(snapshotKey)
    if (record && !record.invalid && record.value.current.job.status !== "running") {
      restore(record.value.current)
      appliedPrefsRef.current = true
    }
  }, [activeJob, getMemorySnapshot, hydrated, restore, snapshotKey, state.job, state.phase])

  useEffect(() => {
    if (!hydrated || activeJob !== null || appliedPrefsRef.current) return
    if (hasExplicitPath || hasExplicitView || state.phase !== "idle" || state.job !== null) {
      appliedPrefsRef.current = true
      return
    }
    const record = getMemorySnapshot<DiskMemoryEntry>(snapshotKey)
    if (record && !record.invalid) return
    appliedPrefsRef.current = true
    if (prefs.path !== initialPath || prefs.view !== initialView) {
      setTarget({ path: prefs.path, view: prefs.view })
    }
  }, [
    activeJob,
    getMemorySnapshot,
    hasExplicitPath,
    hasExplicitView,
    hydrated,
    initialPath,
    initialView,
    prefs.path,
    prefs.view,
    setTarget,
    snapshotKey,
    state.job,
    state.phase,
  ])

  useEffect(() => {
    if (!hydrated || state.phase !== "idle" || !job || job.status === "running") return
    const current = diskSaveSnapshot(state)
    if (!current) return
    const nextAncestors = history.slice(-16)
    const existing = getMemorySnapshot<DiskMemoryEntry>(snapshotKey)
    const unchangedMem = existing
      && !existing.invalid
      && existing.value.current.job === current.job
      && existing.value.current.requestTarget.path === current.requestTarget.path
      && existing.value.current.requestTarget.view === current.requestTarget.view
      && existing.value.ancestors.length === nextAncestors.length
      && existing.value.ancestors.every((item, idx) => item.job.jobId === nextAncestors[idx]?.job.jobId)
    if (!unchangedMem) {
      setMemorySnapshot<DiskMemoryEntry>(snapshotKey, { current, ancestors: nextAncestors })
    }
    setPrefs({
      path: state.form.path,
      view: state.form.view,
      hasMeasuredRef: true,
      ancestorCount: nextAncestors.length,
    })
  }, [getMemorySnapshot, history, hydrated, job, setMemorySnapshot, setPrefs, snapshotKey, state])

  useRouteScrollContinuity({ routeKey: scrollKey, ready: state.phase !== "starting", active })

  const memoryRecord = hydrated ? getMemorySnapshot<DiskMemoryEntry>(snapshotKey) : null
  const showSnapshotUnavailable = hydrated
    && activeJob === null
    && state.phase === "idle"
    && job === null
    && prefs.hasMeasuredRef
    && (!memoryRecord || memoryRecord.invalid)

  const backLabel = backTarget.isFallback || backTarget.href === "/" || backTarget.href.startsWith("/?")
    ? t("actions.projects")
    : backTarget.href.startsWith("/projects")
      ? tNav("backToProject")
      : tCommon("back")

  function updateFormTarget(nextPath: string, nextView: DiskView) {
    controller.setTarget({ path: nextPath, view: nextView })
    setPrefs((current) => ({ ...current, path: nextPath, view: nextView }))
  }

  function measure(force: boolean) {
    if (busy) return
    if (!force) setHistory([])
    setControlsExpanded(false)
    heading.current?.focus()
    void controller.start(diskMeasurementInput(state, force))
  }

  function pickAndMeasure(targetPath: string, targetView: DiskView) {
    if (busy) return
    updateFormTarget(targetPath, targetView)
    setHistory([])
    setControlsExpanded(false)
    heading.current?.focus()
    void controller.start({ path: targetPath, view: targetView, force: false })
  }

  function toggleFavoriteFor(targetPath: string, targetView: DiskView) {
    const existing = isPathFavorited(favorites, targetPath, targetView)
    if (existing) {
      removeFavorite(existing.id)
      return
    }
    const result = addFavorite({ path: targetPath, view: targetView })
    if (!result.ok && result.reason === "limit_reached") {
      toast.error(t("favorites.limitReached"))
    }
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

  const showFullControls = job === null || controlsExpanded
  const activeFavorited = job ? isPathFavorited(favorites, job.path, job.view) !== null : false
  const formFavorited = isPathFavorited(favorites, path, view) !== null
  const cancelPending = state.phase === "tracking" && state.cancelPending
  const busyReason = busy ? tDisabled(cancelPending ? "diskCancelling" : "diskRunning") : null
  const cancelReason = cancelPending ? tDisabled("diskCancelling") : null

  return (
    <section className="flex min-w-0 flex-col gap-5" aria-label={t("title")}>
      {embedded ? <p className="text-body-sm text-muted-foreground">{t("description")}</p> : null}

      {job !== null && !controlsExpanded ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
          <div className="min-w-0 flex-1 basis-60 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-caption font-medium text-muted-foreground">{t("activeBar.label")}</span>
              <Badge variant="secondary">{t(`views.${job.view}`)}</Badge>
            </div>
            <p className="font-mono text-body-sm font-medium text-foreground [overflow-wrap:anywhere]">{job.path}</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {!embedded ? (
              <DisabledTooltip reason={busyReason}>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-pressed={activeFavorited}
                  onClick={() => toggleFavoriteFor(job.path, job.view)}
                >
                  {activeFavorited ? <BookmarkCheckIcon aria-hidden="true" /> : <BookmarkPlusIcon aria-hidden="true" />}
                  {t(activeFavorited ? "favorites.pinned" : "favorites.pin")}
                </Button>
              </DisabledTooltip>
            ) : null}
            <DisabledTooltip reason={busyReason}>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => measure(true)}
              >
                <RefreshCwIcon aria-hidden="true" />
                {t("activeBar.recalculate")}
              </Button>
            </DisabledTooltip>
            {state.phase === "tracking" ? (
              <DisabledTooltip reason={cancelReason}>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={state.cancelPending}
                  onClick={() => void controller.cancel()}
                >
                  {state.cancelPending ? t("status.cancelling") : t("actions.cancel")}
                </Button>
              </DisabledTooltip>
            ) : null}
            {state.phase === "tracking" && state.errorCode !== undefined ? (
              <Button type="button" size="sm" variant="secondary" onClick={controller.retryPoll}>
                {t("actions.retryPoll")}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setControlsExpanded(true)}
            >
              <SlidersHorizontalIcon aria-hidden="true" />
              {t("activeBar.changeTarget")}
            </Button>
          </div>
        </div>
      ) : null}

      {showFullControls ? (
        <div className="flex min-w-0 flex-col gap-4">
          {job !== null ? (
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="ghost" onClick={() => setControlsExpanded(false)}>
                {t("activeBar.hideControls")}
              </Button>
            </div>
          ) : null}
          {!embedded ? (
            <DiskUsageQuickTargets
              roots={scanRoots}
              projects={scannedProjects}
              hasScan={hasScan}
              favorites={favorites}
              activePath={path}
              activeView={view}
              disabled={busy}
              onPickTarget={pickAndMeasure}
              onRemoveFavorite={removeFavorite}
            />
          ) : null}
          <DiskUsageControls
            controller={controller}
            path={path}
            view={view}
            primaryAction={job === null}
            canPinFavorite={!embedded}
            isFavorited={formFavorited}
            onPathChange={(nextPath) => updateFormTarget(nextPath, view)}
            onViewChange={(nextView) => updateFormTarget(path, nextView)}
            onMeasure={measure}
            onToggleFavorite={() => toggleFavoriteFor(path, view)}
          />
        </div>
      ) : null}

      {errorMessage ? (
        <div role="alert" className="min-w-0 space-y-3 rounded-md border border-border bg-muted p-4 text-body-sm">
          <p>{errorMessage}</p>
          {error?.lost && job ? <p>{t("errors.lost")}</p> : null}
          {state.phase === "tracking" && state.errorCode !== undefined ? <p>{t("errors.pollPaused")}</p> : null}
          {error?.conflict ? (
            <>
              <p className="font-mono [overflow-wrap:anywhere]">{error.conflict.path}</p>
              <DisabledTooltip reason={busyReason}>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => {
                  if (!error.conflict) return
                  setHistory([])
                  heading.current?.focus()
                  controller.follow(error.conflict)
                }}>{t("actions.follow")}</Button>
              </DisabledTooltip>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-body-sm">
        <p aria-live="polite" aria-atomic="true" className="font-medium text-foreground">
          {t(diskStatusKey(state))}
        </p>
        {job && !previousSnapshot ? (
          <p className="text-caption text-muted-foreground">
            {t("progress", {
              dirs: job.progress.visitedDirs,
              entries: job.progress.visitedEntries,
              skipped: job.progress.skippedCount,
              links: job.progress.skippedLinks,
              formattedDirs: format.number(job.progress.visitedDirs),
              formattedEntries: format.number(job.progress.visitedEntries),
              formattedSkipped: format.number(job.progress.skippedCount),
              formattedLinks: format.number(job.progress.skippedLinks),
            })}
          </p>
        ) : null}
      </div>

      {ancestors.length > 0 || job ? (
        <nav aria-label={t("breadcrumbs")} className="min-w-0">
          <ol className="flex min-w-0 flex-wrap items-center gap-1.5 text-caption">
            {ancestors.map((snapshot) => (
              <Fragment key={snapshot.job.jobId}>
                <li className="min-w-0 max-w-full">
                  <DisabledTooltip reason={busyReason}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      aria-label={t("actions.backTo", { path: snapshot.job.path })}
                      aria-controls={resultsId}
                      className="h-auto min-h-8 max-w-full py-1 font-mono text-caption whitespace-normal [overflow-wrap:anywhere]"
                      onClick={() => back(snapshot)}
                    >
                      {snapshot.job.path}
                    </Button>
                  </DisabledTooltip>
                </li>
                <li aria-hidden="true" className="text-muted-foreground">
                  <ChevronRightIcon className="size-3.5" />
                </li>
              </Fragment>
            ))}
            {job ? (
              <li
                aria-current="page"
                className="min-w-0 max-w-full rounded-sm bg-muted px-2.5 py-1 font-mono text-caption font-medium text-foreground [overflow-wrap:anywhere]"
              >
                {job.path}
              </li>
            ) : null}
          </ol>
        </nav>
      ) : null}

      <section id={resultsId} aria-labelledby={headingId} className="min-w-0 space-y-5">
        {/* scroll-mt-24: khi focus cuộn tới, tiêu đề không bị thanh điều hướng sticky 64px che. */}
        <h2 id={headingId} ref={heading} tabIndex={-1} className="scroll-mt-24 text-heading-md focus-ring">
          {t("results")}
        </h2>
        {job && metrics ? (
          <>
            <DiskUsageKpiStrip job={job} metrics={metrics} previousSnapshot={previousSnapshot} />
            <DiskUsageItems
              job={job}
              resultsId={resultsId}
              onExpand={expand}
              interaction={busy ? "busy" : "ready"}
              scannedProjectPaths={scannedProjectPaths}
              returnTo={hydrated ? currentUrl : "/disk-usage"}
            />
          </>
        ) : (
          <div className="space-y-2 rounded-md border border-dashed border-border p-5 text-body-sm text-muted-foreground">
            {showSnapshotUnavailable ? <p role="status">{tNav("snapshotUnavailable")}</p> : null}
            <p>{t(state.phase === "idle" ? "empty.initial" : "empty.listing")}</p>
          </div>
        )}
      </section>

      {!embedded ? (
        <ReturnLink href={backTarget.href} originId={backTarget.originId} className="self-start">
          {backLabel}
        </ReturnLink>
      ) : null}
    </section>
  )
}
