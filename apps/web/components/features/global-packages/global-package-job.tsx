"use client"

import { AlertTriangleIcon, CircleIcon, LoaderCircleIcon, RefreshCwIcon, RotateCwIcon, SquareIcon, type LucideIcon } from "lucide-react"
import { useState, type ReactNode } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { NpmRunnerLog } from "@/components/features/npm-runner/npm-runner-log"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { GlobalController } from "@/components/features/global-packages/global-packages-panel"
import type messages from "@/messages/vi.json"

export function GlobalActionLabel({ pending, icon: Icon, children }: { pending: boolean; icon?: LucideIcon; children: ReactNode }) {
  return <>{pending ? <LoaderCircleIcon aria-hidden="true" className="size-4 shrink-0 animate-spin" /> : Icon ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}<span className="min-w-0 [overflow-wrap:anywhere]">{children}</span></>
}

export function GlobalCodeMessage({ code, kind = "errors" }: { code: string; kind?: "errors" | "warnings" | "risk" }) {
  const t = useTranslations("globalPackages")
  const key = `${kind}.${code}` as
    | `errors.${keyof typeof messages.globalPackages.errors}`
    | `warnings.${keyof typeof messages.globalPackages.warnings}`
    | `risk.${keyof typeof messages.globalPackages.risk}`
  return <>{t(t.has(key) ? key : "errors.UNKNOWN")}</>
}

export function GlobalPackageJob({ controller }: { controller: GlobalController }) {
  const t = useTranslations("globalPackages")
  const format = useFormatter()
  const { state, cancel, refresh, retryPoll } = controller
  const [cancelledJob, setCancelledJob] = useState<string | null>(null)
  const job = state.job
  const status = state.phase === "lost" ? "lost" : state.startUnknown ? "startUnknown"
    : state.cancelUnknown ? "cancelUnknown" : state.phase === "starting" ? "starting"
    : job?.status ?? (state.phase === "tracking" ? "running" : "idle")
  const statusKey = `status.${status}` as `status.${keyof typeof messages.globalPackages.status}`
  const statusLabel = t(t.has(statusKey) ? statusKey : "errors.UNKNOWN")
  const stopping = job?.status === "stopping"
  const cleanup = job !== null && (job.status === "termination_failed"
    || (job.gateHeld && job.status !== "running" && job.status !== "stopping"))
  const canCancel = state.phase !== "lost" && !state.startUnknown && state.jobId !== null
    && (cleanup || (!stopping && (job?.status === "running" || (!job && state.phase === "tracking"))))
  const Icon = ["idle", "starting", "running", "stopping", "completed"].includes(status) ? CircleIcon : AlertTriangleIcon
  const activeKind = state.activity?.kind
  const loadingLabel = (state.phase === "starting" || state.phase === "tracking") && activeKind
    ? t(activeKind === "versions" ? "loadingVersions" : activeKind === "preview" ? "loadingPreview" : activeKind === "mutation" ? "loadingExecute" : "loadingInventory") : null

  return <section className="min-w-0 space-y-4 rounded-md border border-border bg-card p-4 text-card-foreground md:p-6" aria-label={t("job.title")}>
    <h2 className="text-heading-lg">{t("job.title")}</h2>
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant="secondary" className="h-auto min-h-6 max-w-full whitespace-normal"><Icon aria-hidden="true" />{statusLabel}</Badge>
      {job ? <span className="text-body-sm">{t(`job.kind.${job.kind}`)} · {t(`job.phase.${job.phase}`)}</span> : null}
    </div>
    <p aria-live="polite" aria-atomic="true" className="sr-only">{statusLabel}</p>
    <div role="status" aria-live="polite" aria-atomic="true" className="flex items-center gap-2 text-body-sm">
      {loadingLabel ? <GlobalActionLabel pending>{loadingLabel}</GlobalActionLabel> : null}
    </div>
    <p className="text-body-sm text-muted-foreground">{t("job.continues")}</p>
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      {canCancel ? <Button type="button" variant="secondary" className="h-auto min-h-10 border-border whitespace-normal"
        aria-busy={state.cancelPending}
        disabled={state.cancelPending || state.cancelUnknown || state.refreshing || (!cleanup && cancelledJob === state.jobId)}
        onClick={() => { setCancelledJob(state.jobId); void cancel() }}><GlobalActionLabel pending={state.cancelPending} icon={cleanup ? RotateCwIcon : SquareIcon}>{t(state.cancelPending ? "loadingCancel" : cleanup ? "job.retryCleanup" : "job.cancel")}</GlobalActionLabel></Button> : null}
      <Button type="button" variant="secondary" className="h-auto min-h-10 border-border whitespace-normal"
        aria-busy={state.refreshing}
        disabled={state.refreshing || state.cancelPending || state.phase === "starting"
          || (state.phase === "tracking" && !state.startUnknown && !state.cancelUnknown && !state.pollError)}
        onClick={() => { void refresh() }}><GlobalActionLabel pending={state.refreshing} icon={RefreshCwIcon}>{t(state.refreshing ? "job.refreshing" : "job.refresh")}</GlobalActionLabel></Button>
      {state.pollError && !state.cancelUnknown && state.phase !== "lost" ? <Button type="button" variant="secondary"
        className="h-auto min-h-10 border-border whitespace-normal" onClick={retryPoll}><RotateCwIcon aria-hidden="true" />{t("job.retryPoll")}</Button> : null}
    </div>
    {state.startUnknown ? <p className="text-body-sm">{t("job.startUnknown")}</p> : null}
    {state.cancelUnknown ? <p className="text-body-sm">{t("job.cancelUnknown")}</p> : null}
    {state.phase === "lost" ? <p className="text-body-sm">{t("job.lost")}</p> : null}
    {state.error || state.pollError ? <div role="alert" className="space-y-2 rounded-md bg-muted p-4 text-body-sm">
      <p><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" /><GlobalCodeMessage code={state.error?.code ?? state.pollError ?? "UNKNOWN"} /></p>
      {state.error?.statusCode === 409 ? <p>{t("previewAgainHint")}</p> : null}
      {state.pollError ? <p>{t("job.pollPaused")}</p> : null}
    </div> : null}
    {job ? <div className="min-w-0 space-y-3 text-body-sm [overflow-wrap:anywhere]">
      {job.manager ? <p className="font-mono">{job.manager}{job.managerVersion ? ` ${job.managerVersion}` : ""}</p> : null}
      {job.package ? <p>{job.package}</p> : null}
      {job.action ? <p>{t(job.action === "remove" ? "remove" : "change")}: <span className="font-mono">{job.currentVersion ?? t("unknown")} → {job.action === "remove" ? t("removed") : job.targetVersion ?? t("unknown")}</span></p> : null}
      <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div><dt className="text-muted-foreground">{t("job.exitCode")}</dt><dd>{job.exitCode === null ? t("unknown") : format.number(job.exitCode)}</dd></div>
        <div><dt className="text-muted-foreground">{t("job.signal")}</dt><dd className="break-all font-mono">{job.signal ?? t("none")}</dd></div>
        <div><dt className="text-muted-foreground">{t("job.stopReason")}</dt><dd>{job.stopReason ? t(`job.stopReasons.${job.stopReason}`) : t("none")}</dd></div>
      </dl>
      <p>{t("job.startedAt", { time: format.dateTime(new Date(job.startedAt), { dateStyle: "medium", timeStyle: "short" }) })}</p>
      {job.finishedAt ? <p>{t("job.finishedAt", { time: format.dateTime(new Date(job.finishedAt), { dateStyle: "medium", timeStyle: "short" }) })}</p> : null}
      {job.failureCode ? <p><GlobalCodeMessage code={job.failureCode} /></p> : null}
      {job.mayHaveChanged ? <p>{t("job.mayHaveChanged")}</p> : null}
      {job.gateHeld ? <p>{t("job.gateHeld")}</p> : null}
      {job.refreshRequired ? <p>{t("job.refreshRequired")}</p> : null}
      {job.warningCodes.length ? <ul className="space-y-2">{job.warningCodes.map(code => <li key={code}>
        <AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" /><GlobalCodeMessage kind="warnings" code={code} />
      </li>)}</ul> : null}
    </div> : null}
    <NpmRunnerLog logs={state.logs} />
  </section>
}
