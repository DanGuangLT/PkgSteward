"use client"

import { AlertTriangleIcon, CheckIcon, CircleIcon, EyeIcon, ListIcon, RefreshCwIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { useEffect, useId, useRef, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { DiscoveryControls, DiscoveryFilter, DiscoveryEmpty } from "@/components/shared/list-discovery"
import { useNavigationContinuity, useViewState } from "@/hooks/use-navigation-continuity"
import { appendReturnContext, makeViewStateKey } from "@/lib/ui/navigation-targets"
import { VERSION_DISCOVERY, VERSION_SUPPORT, VERSION_DEPRECATION, versionDiscoveryCodec, selectManagerVersions } from "@/lib/package-managers/discovery"

import { PmActionLabel, PmCodeMessage } from "@/components/features/package-managers/pm-messages"
import { PmPreviewDialog } from "@/components/features/package-managers/pm-preview-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { usePackageManagers } from "@/hooks/use-package-managers"
import { pmCleanupPending, pmJobSettling, pmMutationSucceeded, pmReadFailure } from "@/lib/package-managers/pm-session"
import type { PmState } from "@/lib/package-managers/pm-session"
import type { PmJob, PmManager, PmWritableManager } from "@/lib/package-managers/pm-types"
import { projectDetailHref } from "@/lib/projects/project-detail-list"
import { revealRegion } from "@/lib/ui/reveal-region"

const WRITABLE: readonly PmWritableManager[] = ["npm", "pnpm"]
const writable = (manager: PmManager | undefined): manager is PmWritableManager =>
  manager === "npm" || manager === "pnpm"

function statusKey(state: PmState): "status.idle" | "status.starting" | "status.lost" | "status.unknown"
  | "status.running.versions" | "status.running.preview" | "status.running.mutation" | null {
  if (state.startUnknown) return "status.unknown"
  if (state.phase === "lost") return "status.lost"
  if (state.phase === "starting") return "status.starting"
  if (state.phase === "tracking" && state.activity) return `status.running.${state.activity.kind}`
  return state.job ? null : "status.idle"
}

function MutationResult({ job }: { job: PmJob }) {
  const t = useTranslations("packageManagers")
  if (pmMutationSucceeded(job)) return <p><CheckIcon aria-hidden="true" className="mr-1 inline size-4" />{t("result.success")}</p>
  const unchanged = !job.mayHaveChanged && !job.fileCommitted
  return <div className="space-y-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-warning">
    <p className="font-medium"><AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" />
      {t(job.fileCommitted && (job.cleanupRequired || job.refreshRequired || job.gateHeld) ? "result.cleanup"
        : unchanged ? (job.status === "cancelled" ? "result.cancelledBefore" : "result.failed") : "result.mayHaveChanged")}</p>
    {job.failureCode ? <p><PmCodeMessage code={job.failureCode} /></p> : null}
  </div>
}

export function ProjectManagerPanel({ path }: { path: string }) {
  const t = useTranslations("packageManagers")
  const format = useFormatter()
  const id = useId()
  const { hydrated, currentUrl, entryId } = useNavigationContinuity()
  const returnContext = { returnTo: hydrated ? currentUrl : undefined, originId: hydrated ? entryId : null }
  const controller = usePackageManagers(path)
  const { state, stopPreview } = controller
  const context = state.context
  const [chosen, setChosen] = useState<PmWritableManager | null>(null)
  const [target, setTarget] = useState("")
  const previewButtonRef = useRef<HTMLButtonElement>(null)
  const statusRef = useRef<HTMLHeadingElement>(null)
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  const pinned = context?.parsedPin?.manager
  const manager: PmWritableManager = chosen ?? (writable(pinned) ? pinned : context?.lockManagers.find(writable) ?? "npm")
  const d = useTranslations("listDiscovery")
  const [view, setView, reset] = useViewState(makeViewStateKey("package-manager-versions", JSON.stringify([path, manager])), versionDiscoveryCodec, VERSION_DISCOVERY)
  const catalog = state.versions?.manager === manager ? state.versions : null
  const visible = selectManagerVersions(catalog?.versions ?? [], view, catalog?.tags ?? {}, target)
  const options = visible.options
  const tagOf = new Map(Object.entries(catalog?.tags ?? {}).map(([tag, version]) => [version, tag]))
  const cleanupPending = pmCleanupPending(state.job)
  const busy = state.phase !== "idle" || state.startUnknown || state.cancelPending || cleanupPending
  const otherRunning = state.otherJob !== null && (pmJobSettling(state.otherJob) || pmCleanupPending(state.otherJob))
  const readFailure = pmReadFailure(state)
  const blocker = context?.reason ?? context?.pinReason ?? (context?.devEnginesPresent ? "CONFIG_UNSUPPORTED" : null)
  const blocked = busy || otherRunning || !context || blocker !== null
  const pendingKind = state.phase === "starting" || state.phase === "tracking" ? state.activity?.kind : undefined
  const previewPending = pendingKind === "preview" && state.form.preview === null
  const key = statusKey(state)

  // Escape stops a loading preview (the dialog is not open yet), then focus returns to its button.
  useEffect(() => {
    if (!previewPending) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !stopPreview()) return
      event.preventDefault()
      previewButtonRef.current?.focus()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [previewPending, stopPreview])

  function chooseManager(next: PmWritableManager) {
    setChosen(next)
    setTarget("")
  }
  function closePreview(event: Event, previewId: string) {
    const current = stateRef.current
    const started = current.activity?.kind === "mutation" && current.previewId === previewId
    event.preventDefault()
    if (started) revealRegion(statusRef.current, { reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches })
    else previewButtonRef.current?.focus()
  }

  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-4 rounded-md border border-border bg-card p-4 text-card-foreground md:p-6">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 id={`${id}-title`} className="text-heading-md [overflow-wrap:anywhere]">{t("title")}</h2>
          <p className="text-caption text-muted-foreground">{t("scope")}</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={state.contextLoading} aria-busy={state.contextLoading}
          className="h-auto min-h-9 shrink-0 whitespace-normal" onClick={() => { void controller.refresh() }}>
          <PmActionLabel pending={state.contextLoading} icon={RefreshCwIcon}>{t(state.contextLoading ? "refreshing" : "refresh")}</PmActionLabel>
        </Button>
      </div>

      {context ? (
        <dl className="grid min-w-0 gap-3 rounded-md border border-border bg-background p-4 text-body-sm sm:grid-cols-2 [overflow-wrap:anywhere]">
          <div className="min-w-0 space-y-1">
            <dt className="text-caption text-muted-foreground">{t("declared")}</dt>
            <dd className="break-all font-mono font-medium text-foreground">
              {context.rawPin ?? t("pinMissing")}{context.rawPinTruncated ? ` ${t("pinTruncated")}` : null}
            </dd>
            {context.pinState === "unsupported" ? <dd><PmCodeMessage code="PIN_UNSUPPORTED" /></dd> : null}
          </div>
          <div className="min-w-0 space-y-1">
            <dt className="text-caption text-muted-foreground">{t("installed")}</dt>
            {context.installed.map(tool => (
              <dd key={tool.manager} className="min-w-0">
                {tool.status === "unsupported" ? t("toolUnsupported", { manager: tool.manager })
                  : tool.version ? (
                    <>
                      <span className="font-mono font-medium text-foreground">{tool.manager} {tool.version}</span>
                      {tool.toolPath ? <span className="block break-all font-mono text-caption text-muted-foreground">{tool.toolPath}</span> : null}
                    </>
                  ) : (
                    <>
                      {t("toolUnknown", { manager: tool.manager })}
                      {tool.reason ? <> (<PmCodeMessage code={tool.reason} />)</> : null}
                    </>
                  )}
              </dd>
            ))}
          </div>
          <div className="min-w-0 border-t border-border/60 pt-2.5 sm:col-span-2">
            <dt className="sr-only">{t("asOfLabel")}</dt>
            <dd className="text-caption text-muted-foreground">
              {t("asOf", { time: format.dateTime(new Date(context.asOf), { dateStyle: "medium", timeStyle: "short" }) })}
            </dd>
          </div>
        </dl>
      ) : state.contextError ? null : <p className="text-body-sm text-muted-foreground">{t("loadingContext")}</p>}

      {state.contextError ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-card px-3.5 py-2.5 text-body-sm font-medium text-destructive">
          <AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" /><PmCodeMessage code={state.contextError.code} />
        </p>
      ) : null}
      {context?.workspace.kind === "leaf" ? (
        <div className="space-y-1 rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-body-sm font-medium text-warning">
          <p><AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" />{t("leaf")}</p>
          {context.workspace.root ? <p className="break-all font-mono text-caption">{context.workspace.root}</p> : null}
        </div>
      ) : blocker ? (
        <p className="rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-body-sm font-medium text-warning">
          <AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" /><PmCodeMessage code={blocker} />
        </p>
      ) : null}
      {context?.warnings.length ? (
        <ul className="space-y-2 rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-body-sm font-medium text-warning">
          {context.warnings.map(code => (
            <li key={code}>
              <AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" /><PmCodeMessage kind="warnings" code={code} />
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-4 rounded-md border border-border bg-background p-4">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <Label htmlFor={`${id}-manager`}>{t("manager")}</Label>
            <Select value={manager} disabled={blocked} onValueChange={value => chooseManager(value as PmWritableManager)}>
              <SelectTrigger id={`${id}-manager`} className="w-full min-w-0"><SelectValue /></SelectTrigger>
              <SelectContent>{WRITABLE.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-2">
            <Label htmlFor={`${id}-version`}>{t("version")}</Label>
            <Select value={target} disabled={blocked || options.length === 0} onValueChange={value => { setTarget(value); controller.select({ manager, targetVersion: value }) }}>
              <SelectTrigger id={`${id}-version`} className="w-full min-w-0 font-mono"><SelectValue placeholder={t("versionPlaceholder")} /></SelectTrigger>
              <SelectContent>{options.map(item => <SelectItem key={item.version} value={item.version} disabled={!item.supported} className="font-mono">
                {visible.selectedHidden && item.version === target ? d("selectedHidden", { version: item.version }) : tagOf.has(item.version) ? t("tagged", { version: item.version, tag: tagOf.get(item.version) ?? "" }) : item.version}
              </SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <DiscoveryControls query={view.query} onQueryChange={query => setView({ ...view, query })} count={visible.matches.length} total={catalog?.versions.length ?? 0} onReset={reset}>
          <DiscoveryFilter label={d("support")} value={view.support} options={VERSION_SUPPORT.map(value => ({ value, label: d(`values.${value}`), count: catalog?.versions.filter(row => row.supported === (value === "supported")).length ?? 0 }))} onValueChange={support => setView({ ...view, support })} />
          <DiscoveryFilter label={d("deprecation")} value={view.deprecation} options={VERSION_DEPRECATION.map(value => ({ value, label: d(`values.${value}`), count: catalog?.versions.filter(row => row.deprecated === (value === "deprecated")).length ?? 0 }))} onValueChange={deprecation => setView({ ...view, deprecation })} />
        </DiscoveryControls>
        {catalog && visible.matches.length === 0 ? <DiscoveryEmpty total={catalog.versions.length} /> : null}

        <p className="text-caption text-muted-foreground">{t("versionsHint")}</p>
        {catalog && options.length === 0 ? <p className="text-body-sm">{t("versionsEmpty")}</p> : null}
        {catalog?.stale ? <p className="text-body-sm">{t("versionsStale")}</p> : null}

        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
          <Button type="button" variant="secondary" disabled={blocked} aria-busy={pendingKind === "versions"}
            className="h-auto min-h-10 border-border whitespace-normal" onClick={() => { void controller.loadVersions(manager) }}>
            <PmActionLabel pending={pendingKind === "versions"} icon={ListIcon}>{t(pendingKind === "versions" ? "loadingVersions" : "loadVersions")}</PmActionLabel>
          </Button>
          <Button ref={previewButtonRef} type="button" variant="secondary" disabled={blocked || !target} aria-busy={previewPending}
            aria-describedby={previewPending ? `${id}-stop` : undefined}
            className="h-auto min-h-10 border-border whitespace-normal" onClick={() => { void controller.preview({ manager, targetVersion: target }) }}>
            <PmActionLabel pending={previewPending} icon={EyeIcon}>{t(previewPending ? "loadingPreview" : "preview")}</PmActionLabel>
          </Button>
          {state.phase === "tracking" && state.job && pmJobSettling(state.job) ? (
            <Button type="button" variant="secondary" disabled={state.cancelPending} className="h-auto min-h-10 border-border whitespace-normal"
              onClick={() => { void controller.cancel() }}><PmActionLabel pending={state.cancelPending} icon={XIcon}>{t(state.cancelPending ? "cancelling" : "cancel")}</PmActionLabel></Button>
          ) : null}
          {cleanupPending ? (
            <Button type="button" variant="secondary" disabled={state.cancelPending} className="h-auto min-h-10 border-border whitespace-normal"
              onClick={() => { void controller.cancel() }}><PmActionLabel pending={state.cancelPending} icon={RefreshCwIcon}>{t(state.cancelPending ? "retryingCleanup" : "retryCleanup")}</PmActionLabel></Button>
          ) : null}
          {state.pollError !== null && state.phase === "tracking" ? (
            <Button type="button" variant="secondary" className="h-auto min-h-10 border-border whitespace-normal"
              onClick={() => controller.retryPoll()}>{t("retryPoll")}</Button>
          ) : null}
        </div>
        {previewPending ? <p id={`${id}-stop`} className="text-caption text-muted-foreground">{t("stopPreviewHint")}</p> : null}
      </div>

      <p className="text-caption text-muted-foreground">{t("method")} {t("registry")}</p>

      <div className="min-w-0 space-y-2 border-t border-border/60 pt-3 text-body-sm">
        <h3 ref={statusRef} tabIndex={-1} className="rounded-sm font-semibold focus-ring">{t("statusTitle")}</h3>
        <p aria-live="polite" aria-atomic="true"><CircleIcon aria-hidden="true" className="mr-1 inline size-4" />
          {key ? t(key) : t("status.done")}</p>
        {otherRunning && state.otherJob ? <div className="space-y-2">
          <p>{t("otherJob")}</p>
          <p className="break-all font-mono">{state.otherJob.path}</p>
          <Link href={appendReturnContext(projectDetailHref(state.otherJob.path), returnContext)} prefetch={false} className="inline-block rounded-sm text-ink-soft underline focus-ring">{t("follow")}</Link>
        </div> : null}
        {state.lostJobId ? <p className="rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 font-medium text-warning"><AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" />{t("lostNotice")}</p> : null}
        {readFailure ? <p role="alert" className="font-medium text-destructive"><AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" /><PmCodeMessage code={readFailure} /></p> : null}
        {cleanupPending ? <p className="rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 font-medium text-warning"><AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" />{t("cleanupPending")}</p> : null}
        {state.error && !state.form.preview ? <p role="alert" className="font-medium text-destructive"><AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" /><PmCodeMessage code={state.error.code} /></p> : null}
        {state.mutationResult ? <MutationResult job={state.mutationResult} /> : null}
      </div>

      <PmPreviewDialog controller={controller} blocked={busy || otherRunning} onCloseAutoFocus={closePreview}
        onCancel={controller.dismissPreview} />
    </section>
  )
}
