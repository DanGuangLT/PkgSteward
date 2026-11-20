"use client"

import { AlertTriangleIcon, CheckIcon, CircleIcon, SquareIcon, TerminalIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { useFormatter, useTranslations } from "next-intl"

import { useRunnerDock } from "@/components/features/npm-runner/npm-runner-provider"
import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useNavigationContinuity } from "@/hooks/use-navigation-continuity"
import type { NativeConsoleMeta, RunCommandResult, RunRecoveryHold } from "@/lib/api/types"
import { runnerDisplay } from "@/lib/npm-runner/runner-display"
import { isRunActive } from "@/lib/npm-runner/runner-policy"
import { appendReturnContext } from "@/lib/ui/navigation-targets"
import type messages from "@/messages/vi.json"

function formatCommandResult(
  result: RunCommandResult | null,
  t: ReturnType<typeof useTranslations<"npmRunner">>,
  format: ReturnType<typeof useFormatter>,
): string {
  if (!result) return t("outcome.unknown")
  if (result.exitCode !== null) return t("native.exitValue", { code: format.number(result.exitCode) })
  if (result.signal) return t("native.signalValue", { signal: result.signal })
  return t("outcome.none")
}

export function NativeSessionDetails({
  nativeSession,
  initialCommand,
}: {
  nativeSession: NativeConsoleMeta
  initialCommand: RunCommandResult | null
}) {
  const t = useTranslations("npmRunner")
  const format = useFormatter()
  const phaseKey = `nativePhases.${nativeSession.phase}` as `nativePhases.${keyof typeof messages.npmRunner.nativePhases}`
  const isOpen = nativeSession.phase === "shell_open" || nativeSession.phase === "initial_finished"

  return (
    <div className="min-w-0 space-y-2 text-body-sm [overflow-wrap:anywhere]">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t("native.shell")}</dt>
          <dd>{t(`shells.${nativeSession.shell}`)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("native.consoleState")}</dt>
          <dd>{t.has(phaseKey) ? t(phaseKey) : t("outcome.unknown")}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("native.initialCommand")}</dt>
          <dd className="font-mono">{formatCommandResult(initialCommand, t, format)}</dd>
        </div>
        {nativeSession.sessionResult ? (
          <div>
            <dt className="text-muted-foreground">{t("native.consoleExit")}</dt>
            <dd className="font-mono">{formatCommandResult(nativeSession.sessionResult, t, format)}</dd>
          </div>
        ) : null}
      </dl>
      {isOpen ? <p className="text-muted-foreground">{t("native.runningKeepOpen")}</p> : null}
    </div>
  )
}

export function RecoveryHoldBanner({
  hold,
  clearPending,
  onClear,
}: {
  hold: RunRecoveryHold
  clearPending: boolean
  onClear: () => Promise<void>
}) {
  const t = useTranslations("npmRunner")
  const tDisabled = useTranslations("disabledReasons")
  const tCommon = useTranslations("common")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const reasonKey = `recovery.reasons.${hold.reason}` as `recovery.reasons.${keyof typeof messages.npmRunner.recovery.reasons}`
  const clearReason = clearPending ? tDisabled("clearingRecovery") : null

  return (
    <div role="alert" className="min-w-0 space-y-3 rounded-md border border-border bg-muted p-4 text-body-sm">
      <p className="font-medium">
        <AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" />
        {t("recovery.title")}
      </p>
      <p>{t.has(reasonKey) ? t(reasonKey) : t("recovery.reasons.DEFAULT")}</p>
      {hold.journalPath ? (
        <p className="font-mono text-muted-foreground [overflow-wrap:anywhere]">
          {t("recovery.journalPath")}: {hold.journalPath}
        </p>
      ) : null}
      <div>
        <DisabledTooltip reason={clearReason}>
          <Button
            type="button"
            variant="secondary"
            disabled={clearPending}
            className="h-auto min-h-10 whitespace-normal"
            onClick={() => setConfirmOpen(true)}
          >
            {clearPending ? t("recovery.clearing") : t("recovery.clearAction")}
          </Button>
        </DisabledTooltip>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={open => { if (!open && !clearPending) setConfirmOpen(false) }}>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] min-w-0 overflow-y-auto data-[size=default]:sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("recovery.dialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("recovery.dialogDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <DisabledTooltip reason={clearReason} className="w-full sm:w-auto">
              <AlertDialogCancel disabled={clearPending} className="h-auto min-h-10 w-full border-border whitespace-normal sm:w-auto">
                <XIcon aria-hidden="true" />
                {tCommon("cancel")}
              </AlertDialogCancel>
            </DisabledTooltip>
            <DisabledTooltip reason={clearReason} className="w-full sm:w-auto">
              <Button
                type="button"
                variant="destructive"
                disabled={clearPending}
                className="h-auto min-h-10 w-full whitespace-normal sm:w-auto"
                onClick={() => {
                  setConfirmOpen(false)
                  void onClear()
                }}
              >
                {clearPending ? t("recovery.clearing") : t("recovery.dialogConfirm")}
              </Button>
            </DisabledTooltip>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function NativeSessionStatus() {
  const t = useTranslations("npmRunner")
  const tDisabled = useTranslations("disabledReasons")
  const format = useFormatter()
  const dock = useRunnerDock()
  const { hydrated, currentUrl, entryId } = useNavigationContinuity()
  const { state } = dock
  const job = state.job
  const visible = Boolean(
    state.recoveryHold?.active
    || state.phase !== "idle"
    || state.startUnknown
    || state.cancelUnknown
    || state.error?.conflict
    || job !== null,
  )

  if (!visible) return null

  const display = runnerDisplay(state, { action: job?.action ?? "install_all" }, state.contextError)
  const badgeStatus = !job && state.error?.conflict?.reason === "RUNNING" ? "running" : display.status
  const Icon = badgeStatus === "success"
    ? CheckIcon
    : ["idle", "starting", "running", "stopping"].includes(badgeStatus)
      ? CircleIcon
      : AlertTriangleIcon
  const shellKey = job?.nativeSession ? (`shells.${job.nativeSession.shell}` as `shells.${keyof typeof messages.npmRunner.shells}`) : null
  const nativePhaseKey = job?.nativeSession ? (`nativePhases.${job.nativeSession.phase}` as `nativePhases.${keyof typeof messages.npmRunner.nativePhases}`) : null
  const followHref = state.error?.conflict
    ? dock.follow()
    : job && isRunActive(job)
      ? `/projects?${new URLSearchParams({ path: job.requestPath })}`
      : null
  const href = followHref
    ? appendReturnContext(followHref, {
        returnTo: hydrated ? currentUrl : undefined,
        originId: hydrated ? entryId : null,
      })
    : null
  const errorKey = state.error?.code
    ? `errors.${state.error.code}` as `errors.${keyof typeof messages.npmRunner.errors}`
    : null
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

  return (
    <aside
      aria-label={t("native.dockTitle")}
      className="sticky bottom-0 z-40 border-t border-border bg-card/95 text-card-foreground backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <TerminalIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-body-sm font-semibold">{t("native.dockTitle")}</span>
            <Badge variant={badgeStatus === "success" ? "success" : "secondary"} className="h-auto min-h-6 whitespace-normal">
              <Icon aria-hidden="true" />
              {t(`status.${badgeStatus}`)}
            </Badge>
            {shellKey ? (
              <span className="text-body-sm text-muted-foreground">
                {t.has(shellKey) ? t(shellKey) : job?.nativeSession?.shell}
              </span>
            ) : null}
            {job ? (
              <span className="truncate font-mono text-body-sm text-muted-foreground [overflow-wrap:anywhere]">
                {job.path}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {display.canCancel ? (
              <DisabledTooltip reason={cancelDisabledReason}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={state.cancelPending || state.cancelUnknown}
                  onClick={() => { void dock.cancel() }}
                >
                  <SquareIcon aria-hidden="true" />
                  {t(display.cancelLabel)}
                </Button>
              </DisabledTooltip>
            ) : null}
            <DisabledTooltip reason={refreshDisabledReason}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={state.refreshing || state.cancelPending || state.phase === "starting" || state.clearPending}
                onClick={() => { void dock.refresh() }}
              >
                {t(state.refreshing ? "refreshing" : "refresh")}
              </Button>
            </DisabledTooltip>
            {href ? (
              <Link href={href} prefetch={false} className="inline-block rounded-sm px-2 py-1 text-body-sm underline focus-ring">
                {t("follow")}
              </Link>
            ) : null}
            {!display.busy && job ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => dock.dismissCompletedJob()}>
                <XIcon aria-hidden="true" />
                {t("dismiss")}
              </Button>
            ) : null}
          </div>
        </div>
        {job?.nativeSession && nativePhaseKey ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-muted-foreground">
            <span>{t("native.consoleState")}: {t.has(nativePhaseKey) ? t(nativePhaseKey) : t("outcome.unknown")}</span>
            {job.initialCommand ? (
              <span className="font-mono">
                {t("native.initialCommand")}: {formatCommandResult(job.initialCommand, t, format)}
              </span>
            ) : null}
          </div>
        ) : null}
        {state.error && errorKey ? (
          <p role="alert" className="text-body-sm text-destructive">
            {t.has(errorKey) ? t(errorKey) : t("errors.UNKNOWN")}
          </p>
        ) : null}
        {state.recoveryHold?.active ? (
          <RecoveryHoldBanner
            hold={state.recoveryHold}
            clearPending={state.clearPending}
            onClear={dock.clearRecovery}
          />
        ) : null}
      </div>
    </aside>
  )
}
