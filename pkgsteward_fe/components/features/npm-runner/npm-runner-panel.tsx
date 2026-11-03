"use client"

import { AlertTriangleIcon, CheckIcon, CircleIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { useFormatter, useTranslations } from "next-intl"

import { NpmRunnerForm } from "@/components/features/npm-runner/npm-runner-form"
import { NpmRunnerLog } from "@/components/features/npm-runner/npm-runner-log"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { useNpmRunner } from "@/hooks/use-npm-runner"
import { runnerDisplay } from "@/lib/npm-runner/runner-display"
import type { RunnerSelection } from "@/lib/npm-runner/runner-policy"
import type messages from "@/messages/vi.json"

export function NpmRunnerPanel({ controller, contextError }: {
  controller: ReturnType<typeof useNpmRunner>
  contextError: string | null
}) {
  const t = useTranslations("npmRunner")
  const format = useFormatter()
  const [selection, setSelection] = useState<RunnerSelection>({ action: "install_all" })
  const { state } = controller
  const display = runnerDisplay(state, selection, contextError)
  const job = state.job
  const href = state.error?.conflict ? controller.follow() : null
  const Icon = display.status === "success" ? CheckIcon
    : ["idle", "starting", "running", "stopping"].includes(display.status) ? CircleIcon : AlertTriangleIcon
  const warningCodes = [...new Set([...(state.context?.warnings ?? []), ...(job?.warningCodes ?? [])])]
  function errorMessage(code: string) {
    const key = `errors.${code}` as `errors.${keyof typeof messages.npmRunner.errors}`
    return t(t.has(key) ? key : "errors.UNKNOWN")
  }

  return <section className="min-w-0 space-y-4 rounded-md border border-border bg-card p-4 text-card-foreground md:p-6" aria-label={t("title")}>
    <h2 className="text-heading-lg">{t("title")}</h2>
    <NpmRunnerForm context={state.context} selection={selection} onChange={setSelection} blockedReason={display.blockedReason}
      onRun={() => { void controller.start(selection) }}>
      <p className="text-body-sm text-muted-foreground">{t("outcome.continues")}</p>
    </NpmRunnerForm>
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant={display.status === "success" ? "success" : "secondary"} className="h-auto min-h-6 max-w-full whitespace-normal">
        <Icon aria-hidden="true" />{t(`status.${display.status}`)}
      </Badge>
      {job ? <span className="text-body-sm">{t(`phases.${job.phase}`)}</span> : null}
    </div>
    <p aria-live="polite" aria-atomic="true" className="sr-only">{t(`status.${display.status}`)}</p>
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      {display.canCancel ? <Button type="button" variant="secondary" disabled={state.cancelPending || state.cancelUnknown}
        className="h-auto min-h-10 whitespace-normal" onClick={() => { void controller.cancel() }}>{t(display.cancelLabel)}</Button> : null}
      <Button type="button" variant="secondary" disabled={state.refreshing || state.cancelPending || state.phase === "starting"}
        className="h-auto min-h-10 whitespace-normal" onClick={() => { void controller.refresh() }}>{t(state.refreshing ? "refreshing" : "refresh")}</Button>
      {state.pollError && !state.cancelUnknown && state.phase !== "lost" ? <Button type="button" variant="secondary"
        className="h-auto min-h-10 whitespace-normal" onClick={() => controller.retryPoll()}>{t("retryPoll")}</Button> : null}
    </div>
    {state.startUnknown ? <p className="text-body-sm">{t("outcome.startUnknown")}</p> : null}
    {state.cancelUnknown ? <p className="text-body-sm">{t("outcome.cancelUnknown")}</p> : null}
    {state.phase === "lost" ? <p className="text-body-sm">{t("outcome.lost")}</p> : null}
    {state.error || state.pollError ? <div role="alert" className="min-w-0 space-y-2 rounded-md bg-muted p-4 text-body-sm">
      <p><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" />{errorMessage(state.error?.code ?? state.pollError ?? "UNKNOWN")}</p>
      {state.pollError ? <p>{t("outcome.pollPaused")}</p> : null}
      {href ? <>
        <p className="font-mono [overflow-wrap:anywhere]">{state.error?.conflict?.requestPath}</p>
        <Link href={href} prefetch={false} className="inline-block rounded-sm text-ink-soft underline focus-ring">{t("follow")}</Link>
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
      {job.mayHaveChanged ? <p>{t("outcome.mayHaveChanged")}</p> : null}
      {job.gateHeld ? <p>{t("outcome.gateHeld")}</p> : null}
      {job.refreshRequired ? <p>{t("outcome.refreshRequired")}</p> : null}
    </div> : null}
    {warningCodes.length ? <ul className="space-y-2 text-body-sm">{warningCodes.map(code => {
      const key = `warnings.${code}` as `warnings.${keyof typeof messages.npmRunner.warnings}`
      return <li key={code}><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" />{t.has(key) ? t(key) : t("errors.UNKNOWN")}</li>
    })}</ul> : null}
    <NpmRunnerLog logs={state.logs} />
  </section>
}
