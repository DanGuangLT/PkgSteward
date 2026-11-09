"use client"

import { AlertTriangleIcon, CheckIcon, CircleIcon, EyeIcon, ListIcon, RefreshCwIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { useEffect, useId, useRef, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"

import { PmActionLabel, PmCodeMessage } from "@/components/features/package-managers/pm-messages"
import { PmPreviewDialog } from "@/components/features/package-managers/pm-preview-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { usePackageManagers } from "@/hooks/use-package-managers"
import { pmJobSettling, pmMutationSucceeded } from "@/lib/package-managers/pm-session"
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
  return <div className="space-y-2">
    <p><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" />
      {t(job.fileCommitted && (job.cleanupRequired || job.refreshRequired || job.gateHeld) ? "result.cleanup"
        : unchanged ? (job.status === "cancelled" ? "result.cancelledBefore" : "result.failed") : "result.mayHaveChanged")}</p>
    {job.failureCode ? <p><PmCodeMessage code={job.failureCode} /></p> : null}
  </div>
}

export function ProjectManagerPanel({ path }: { path: string }) {
  const t = useTranslations("packageManagers")
  const format = useFormatter()
  const id = useId()
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
  const catalog = state.versions?.manager === manager ? state.versions : null
  const options = catalog?.versions.filter(item => item.supported) ?? []
  const tagOf = new Map(Object.entries(catalog?.tags ?? {}).map(([tag, version]) => [version, tag]))
  const busy = state.phase === "starting" || state.phase === "tracking" || state.startUnknown || state.cancelPending
  const otherRunning = state.otherJob !== null && pmJobSettling(state.otherJob)
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
        <h2 id={`${id}-title`} className="text-heading-md [overflow-wrap:anywhere]">{t("title")}</h2>
        <Button type="button" variant="secondary" disabled={state.contextLoading} aria-busy={state.contextLoading}
          className="h-auto min-h-10 border-border whitespace-normal" onClick={() => { void controller.refresh() }}>
          <PmActionLabel pending={state.contextLoading} icon={RefreshCwIcon}>{t(state.contextLoading ? "refreshing" : "refresh")}</PmActionLabel>
        </Button>
      </div>
      <p className="text-body-sm">{t("scope")}</p>
      <p className="text-body-sm text-muted-foreground">{t("method")}</p>

      {context ? <dl className="grid min-w-0 gap-4 text-body-sm sm:grid-cols-2 [overflow-wrap:anywhere]">
        <div className="min-w-0"><dt className="text-muted-foreground">{t("declared")}</dt>
          <dd className="break-all font-mono">{context.rawPin ?? t("pinMissing")}{context.rawPinTruncated ? ` ${t("pinTruncated")}` : null}</dd>
          {context.pinState === "unsupported" ? <dd><PmCodeMessage code="PIN_UNSUPPORTED" /></dd> : null}</div>
        <div className="min-w-0"><dt className="text-muted-foreground">{t("installed")}</dt>
          {context.installed.map(tool => <dd key={tool.manager} className="min-w-0">
            {tool.status === "unsupported" ? t("toolUnsupported", { manager: tool.manager })
              : tool.version ? <><span className="font-mono">{tool.manager} {tool.version}</span>
                {tool.toolPath ? <span className="block break-all font-mono text-caption text-muted-foreground">{tool.toolPath}</span> : null}</>
              : <>{t("toolUnknown", { manager: tool.manager })}{tool.reason ? <> (<PmCodeMessage code={tool.reason} />)</> : null}</>}
          </dd>)}</div>
        <div className="min-w-0 sm:col-span-2"><dt className="sr-only">{t("asOfLabel")}</dt>
          <dd className="text-muted-foreground">{t("asOf", { time: format.dateTime(new Date(context.asOf), { dateStyle: "medium", timeStyle: "short" }) })}</dd></div>
      </dl> : state.contextError ? null : <p className="text-body-sm">{t("loadingContext")}</p>}

      {state.contextError ? <p role="alert" className="text-body-sm"><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" /><PmCodeMessage code={state.contextError.code} /></p> : null}
      {context?.workspace.kind === "leaf" ? <div className="space-y-1 text-body-sm">
        <p><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" />{t("leaf")}</p>
        {context.workspace.root ? <p className="break-all font-mono">{context.workspace.root}</p> : null}
      </div> : blocker ? <p className="text-body-sm"><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" /><PmCodeMessage code={blocker} /></p> : null}
      {context?.warnings.map(code => <p key={code} className="text-body-sm"><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" /><PmCodeMessage kind="warnings" code={code} /></p>)}

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
            <SelectContent>{options.map(item => <SelectItem key={item.version} value={item.version} className="font-mono">
              {tagOf.has(item.version) ? t("tagged", { version: item.version, tag: tagOf.get(item.version) ?? "" }) : item.version}
            </SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-body-sm text-muted-foreground">{t("versionsHint")}</p>
      {catalog && options.length === 0 ? <p className="text-body-sm">{t("versionsEmpty")}</p> : null}
      {catalog?.stale ? <p className="text-body-sm">{t("versionsStale")}</p> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
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
        {state.pollError !== null && state.phase === "tracking" ? (
          <Button type="button" variant="secondary" className="h-auto min-h-10 border-border whitespace-normal"
            onClick={() => controller.retryPoll()}>{t("retryPoll")}</Button>
        ) : null}
      </div>
      {previewPending ? <p id={`${id}-stop`} className="text-body-sm text-muted-foreground">{t("stopPreviewHint")}</p> : null}
      <p className="text-body-sm text-muted-foreground">{t("registry")}</p>

      <div className="min-w-0 space-y-2 text-body-sm">
        <h3 ref={statusRef} tabIndex={-1} className="rounded-sm font-semibold focus-ring">{t("statusTitle")}</h3>
        <p aria-live="polite" aria-atomic="true"><CircleIcon aria-hidden="true" className="mr-1 inline size-4" />
          {key ? t(key) : t("status.done")}</p>
        {otherRunning && state.otherJob ? <div className="space-y-2">
          <p>{t("otherJob")}</p>
          <p className="break-all font-mono">{state.otherJob.path}</p>
          <Link href={projectDetailHref(state.otherJob.path)} prefetch={false} className="inline-block rounded-sm text-ink-soft underline focus-ring">{t("follow")}</Link>
        </div> : null}
        {state.error && !state.form.preview ? <p role="alert"><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" /><PmCodeMessage code={state.error.code} /></p> : null}
        {state.mutationResult ? <MutationResult job={state.mutationResult} /> : null}
      </div>

      <PmPreviewDialog controller={controller} blocked={busy || otherRunning} onCloseAutoFocus={closePreview}
        onCancel={controller.dismissPreview} />
    </section>
  )
}
