"use client"

import { AlertTriangleIcon, CheckIcon, CircleIcon } from "lucide-react"
import Link from "next/link"
import { useRef, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"

import { NativeSessionDetails, RecoveryHoldBanner } from "@/components/features/npm-runner/native-session-status"
import { NpmRunnerForm } from "@/components/features/npm-runner/npm-runner-form"
import { useSettingsOptional } from "@/components/settings/settings-provider"
import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useNavigationContinuity, useViewState } from "@/hooks/use-navigation-continuity"
import type { useNpmRunner } from "@/hooks/use-npm-runner"
import type { ConsoleShell } from "@/lib/api/types"
import { runnerDisplay } from "@/lib/npm-runner/runner-display"
import { isRunActive, normalizeConsoleShell, runnerFollowHref, type RunnerSelection } from "@/lib/npm-runner/runner-policy"
import { appendReturnContext, makeViewStateKey, runnerShellCodec } from "@/lib/ui/navigation-targets"
import { revealRegion } from "@/lib/ui/reveal-region"
import type messages from "@/messages/vi.json"

export function NpmRunnerPanel({ controller, contextError }: {
  controller: ReturnType<typeof useNpmRunner>
  contextError: string | null
}) {
  const t = useTranslations("npmRunner")
  const tDisabled = useTranslations("disabledReasons")
  const format = useFormatter()
  const settings = useSettingsOptional()
  const { hydrated, currentUrl, entryId } = useNavigationContinuity()
  const { state } = controller
  const [shellChoice, setShellChoice] = useViewState<ConsoleShell>(
    makeViewStateKey("npmRunner:consoleShell", controller.requestPath ?? state.requestPath ?? ""),
    runnerShellCodec,
    settings?.behavior.defaultConsoleShell ?? "cmd",
  )
  const [actionSelection, setActionSelection] = useState<Omit<RunnerSelection, "consoleShell">>({ action: "install_all" })
  const selection: RunnerSelection = { ...actionSelection, consoleShell: shellChoice }
  const statusRef = useRef<HTMLDivElement>(null)
  const display = runnerDisplay(state, selection, contextError)
  const job = state.job
  const runningOtherPath = job && isRunActive(job) && job.requestPath !== state.requestPath ? job.requestPath : null
  const conflictPath = state.error?.conflict?.requestPath ?? runningOtherPath
  const conflictHref = state.error?.conflict
    ? controller.follow()
    : runningOtherPath
      ? runnerFollowHref({ reason: "RUNNING", jobId: job!.jobId, requestPath: runningOtherPath })
      : null
  const href = conflictHref
    ? appendReturnContext(conflictHref, { returnTo: hydrated ? currentUrl : undefined, originId: hydrated ? entryId : null })
    : null
  const Icon = display.status === "success" ? CheckIcon
    : ["idle", "starting", "running", "stopping"].includes(display.status) ? CircleIcon : AlertTriangleIcon
  const warningCodes = [...new Set([...(state.context?.warnings ?? []), ...(job?.warningCodes ?? [])])]
  const cancelDisabledReason = state.cancelPending
    ? tDisabled("stopping")
    : state.cancelUnknown
      ? tDisabled("cancelUnknown")
      : null
  const refreshDisabledReason = state.refreshing
    ? tDisabled("refreshing")
    : state.cancelPending
      ? tDisabled("stopping")
      : state.phase === "starting"
        ? tDisabled("runnerStarting")
        : state.clearPending
          ? tDisabled("clearingRecovery")
          : null
  function errorMessage(code: string) {
    const key = `errors.${code}` as `errors.${keyof typeof messages.npmRunner.errors}`
    return t(t.has(key) ? key : "errors.UNKNOWN")
  }

  return <section className="min-w-0 space-y-4 rounded-md border border-border bg-card p-4 text-card-foreground md:p-6" aria-label={t("title")}>
    <h2 className="text-heading-lg">{t("title")}</h2>
    {state.recoveryHold?.active ? (
      <RecoveryHoldBanner
        hold={state.recoveryHold}
        clearPending={state.clearPending}
        onClear={controller.clearRecovery}
      />
    ) : null}
    <NpmRunnerForm
      context={state.context}
      selection={selection}
      shellDisabled={display.shellDisabled}
      onChange={next => {
        if (next.consoleShell !== undefined) {
          setShellChoice(normalizeConsoleShell(next.consoleShell))
        }
        setActionSelection({ action: next.action, package: next.package, script: next.script })
      }}
      blockedReason={display.blockedReason}
      onRun={() => {
        // Nút Chạy bị vô hiệu khi lệnh chạy: đưa focus xuống trạng thái để bàn phím không rơi về đầu trang.
        revealRegion(statusRef.current, { reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches })
        void controller.start(selection)
      }}>
      <p className="text-body-sm text-muted-foreground">{t("outcome.continues")}</p>
    </NpmRunnerForm>
    <div ref={statusRef} tabIndex={-1} className="flex scroll-mt-24 flex-wrap items-center gap-3 rounded-sm focus-ring">
      <Badge variant={display.status === "success" ? "success" : "secondary"} className="h-auto min-h-6 max-w-full whitespace-normal">
        <Icon aria-hidden="true" />{t(`status.${display.status}`)}
      </Badge>
      {job ? <span className="text-body-sm">{t(`phases.${job.phase}`)}</span> : null}
    </div>
    <p aria-live="polite" aria-atomic="true" className="sr-only">{t(`status.${display.status}`)}</p>
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      {display.canCancel ? (
        <DisabledTooltip reason={cancelDisabledReason}>
          <Button type="button" variant="secondary" disabled={state.cancelPending || state.cancelUnknown}
            className="h-auto min-h-10 whitespace-normal" onClick={() => { void controller.cancel() }}>{t(display.cancelLabel)}</Button>
        </DisabledTooltip>
      ) : null}
      <DisabledTooltip reason={refreshDisabledReason}>
        <Button type="button" variant="secondary" disabled={state.refreshing || state.cancelPending || state.phase === "starting" || state.clearPending}
          className="h-auto min-h-10 whitespace-normal" onClick={() => { void controller.refresh() }}>{t(state.refreshing ? "refreshing" : "refresh")}</Button>
      </DisabledTooltip>
      {state.pollError && !state.cancelUnknown && state.phase !== "lost" ? <Button type="button" variant="secondary"
        className="h-auto min-h-10 whitespace-normal" onClick={() => controller.retryPoll()}>{t("retryPoll")}</Button> : null}
    </div>
    {state.startUnknown ? <p className="rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-body-sm font-medium text-warning">{t("outcome.startUnknown")}</p> : null}
    {state.cancelUnknown ? <p className="rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-body-sm font-medium text-warning">{t("outcome.cancelUnknown")}</p> : null}
    {state.phase === "lost" ? <p className="rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-body-sm font-medium text-warning">{t("outcome.lost")}</p> : null}
    {state.error || state.pollError || runningOtherPath ? <div role="alert" className="min-w-0 space-y-2 rounded-md border border-warning/40 bg-warning-soft p-4 text-body-sm text-warning">
      <p className="font-medium"><AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" />{errorMessage(state.error?.code ?? state.pollError ?? (runningOtherPath ? "RUNNING" : "UNKNOWN"))}</p>
      {state.pollError ? <p>{t("outcome.pollPaused")}</p> : null}
      {href && conflictPath ? <>
        <p className="font-mono [overflow-wrap:anywhere]">{conflictPath}</p>
        <Link href={href} prefetch={false} className="inline-block rounded-sm font-semibold underline focus-ring">{t("follow")}</Link>
      </> : null}
    </div> : null}
    {job ? <div className="min-w-0 space-y-3 text-body-sm [overflow-wrap:anywhere]">
      <p className="font-mono">{job.path}</p>
      <p>{t(`actions.${job.action}`)}{job.package ? <>: <span>{job.package}</span></> : null}{job.script ? <>: <span className="font-mono">{job.script}</span></> : null}</p>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div><dt className="text-muted-foreground">{t("outcome.exitCode")}</dt><dd>{job.exitCode === null ? t("outcome.unknown") : format.number(job.exitCode)}</dd></div>
        <div><dt className="text-muted-foreground">{t("outcome.signal")}</dt><dd className="font-mono">{job.signal ?? t("outcome.none")}</dd></div>
        <div><dt className="text-muted-foreground">{t("outcome.stopReason")}</dt><dd>{job.stopReason ? t(`stopReasons.${job.stopReason}`) : t("outcome.none")}</dd></div>
        <div><dt className="text-muted-foreground">{t("outcome.failureCode")}</dt><dd className="font-mono">{job.failureCode ?? t("outcome.none")}</dd></div>
      </dl>
      <p>{t("outcome.startedAt")} <time dateTime={job.startedAt}>{format.dateTime(new Date(job.startedAt), { dateStyle: "medium", timeStyle: "short" })}</time></p>
      {job.finishedAt ? <p>{t("outcome.finishedAt")} <time dateTime={job.finishedAt}>{format.dateTime(new Date(job.finishedAt), { dateStyle: "medium", timeStyle: "short" })}</time></p> : null}
      {job.failureCode ? <p>{errorMessage(job.failureCode)}</p> : null}
      {job.nativeSession ? (
        <NativeSessionDetails nativeSession={job.nativeSession} initialCommand={job.initialCommand ?? null} />
      ) : null}
      {job.mayHaveChanged ? <p className="font-medium text-warning">{t("outcome.mayHaveChanged")}</p> : null}
      {job.gateHeld ? <p className="font-medium text-warning">{t("outcome.gateHeld")}</p> : null}
      {job.refreshRequired ? <p className="font-medium text-warning">{t("outcome.refreshRequired")}</p> : null}
    </div> : null}
    {warningCodes.length ? (
      <ul className="space-y-2 rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-body-sm font-medium text-warning">
        {warningCodes.map(code => {
          const key = `warnings.${code}` as `warnings.${keyof typeof messages.npmRunner.warnings}`
          return <li key={code}><AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" />{t.has(key) ? t(key) : t("errors.UNKNOWN")}</li>
        })}
      </ul>
    ) : null}
  </section>
}
