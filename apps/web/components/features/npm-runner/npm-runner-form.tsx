"use client"

import { useId } from "react"
import type { ReactNode } from "react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { RunnerContext } from "@/lib/api/types"
import { runnerUsesPackage } from "@/lib/npm-runner/runner-display"
import type { RunnerSelection } from "@/lib/npm-runner/runner-policy"
import type messages from "@/messages/vi.json"

const actions = ["install_all", "install_one", "update_all", "update_one", "uninstall_one", "script"] as const

export function NpmRunnerForm({ context, selection, blockedReason, onChange, onRun, children }: {
  context: RunnerContext | null
  selection: RunnerSelection
  blockedReason: string | null
  onChange(selection: RunnerSelection): void
  onRun(): void
  children: ReactNode
}) {
  const t = useTranslations("npmRunner")
  const id = useId()
  const errorKey = `errors.${blockedReason}` as `errors.${keyof typeof messages.npmRunner.errors}`
  const selectedScript = context?.scripts.findIndex(script => script.name === selection.script) ?? -1
  return (
    <form className="min-w-0 space-y-4" onSubmit={event => { event.preventDefault(); if (!blockedReason) onRun() }}>
      <dl className="grid min-w-0 gap-3 text-body-sm sm:grid-cols-2 [overflow-wrap:anywhere]">
        <div><dt className="text-muted-foreground">{t("form.manager")}</dt><dd>{context?.manager ?? t("outcome.unknown")}</dd></div>
        <div><dt className="text-muted-foreground">{t("form.version")}</dt><dd className="font-mono">{context?.version ?? t("outcome.unknown")}</dd></div>
        <div className="sm:col-span-2"><dt className="text-muted-foreground">{t("form.target")}</dt><dd className="font-mono">{context?.path ?? t("outcome.unknown")}</dd></div>
      </dl>
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-start">
        <div className="min-w-0 space-y-2 lg:flex-1">
          <Label htmlFor={`${id}-action`}>{t("form.action")}</Label>
          <Select value={selection.action} onValueChange={action => {
            if (actions.some(value => value === action)) onChange({ action: action as RunnerSelection["action"] })
          }}>
            <SelectTrigger id={`${id}-action`} className="w-full min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent position="popper" className="max-w-(--radix-select-trigger-width)">{actions.map(action => <SelectItem key={action} value={action}>{t(`actions.${action}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {runnerUsesPackage(selection.action) ? (
          <div className="min-w-0 space-y-2 lg:flex-1">
            <Label htmlFor={`${id}-package`}>{t("form.package")}</Label>
            <Input id={`${id}-package`} value={selection.package ?? ""} autoComplete="off" spellCheck={false}
              aria-invalid={blockedReason === "INVALID_PACKAGE_SPEC"}
              aria-describedby={`${id}-package-hint${blockedReason === "INVALID_PACKAGE_SPEC" ? ` ${id}-blocked` : ""}`}
              onChange={event => onChange({ ...selection, package: event.target.value })} />
            <p id={`${id}-package-hint`} className="text-body-sm text-muted-foreground">{t(selection.action === "install_one" ? "form.packageHint" : "form.packageNameHint")}</p>
          </div>
        ) : null}
        {selection.action === "script" ? (
          <div className="min-w-0 space-y-2 lg:flex-1">
            <Label htmlFor={`${id}-script`}>{t("form.script")}</Label>
            <Select value={selectedScript < 0 ? "" : String(selectedScript)}
              onValueChange={value => {
                const script = context?.scripts[Number(value)]
                if (script?.eligible) onChange({ ...selection, script: script.name })
              }}>
              <SelectTrigger id={`${id}-script`} className="w-full min-w-0"><SelectValue placeholder={t("form.chooseScript")} /></SelectTrigger>
              <SelectContent position="popper" className="max-w-(--radix-select-trigger-width)">{context?.scripts.map((script, index) => (
                <SelectItem key={script.name} value={String(index)} disabled={!script.eligible} className="[overflow-wrap:anywhere]">
                  {script.name || t("form.unnamedScript")}{!script.eligible ? ` — ${t("form.scriptUnavailable")}` : ""}
                </SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      {children}
      <Button type="submit" disabled={blockedReason !== null} aria-describedby={`${id}-trust${blockedReason ? ` ${id}-blocked` : ""}`}>
        {t("run")}
      </Button>
      <div id={`${id}-trust`} className="space-y-2 text-body-sm text-muted-foreground">
        <p>{t("trust.projectCode")}</p><p>{t("trust.config")}</p><p>{t("trust.network")}</p>
        <p>{t("trust.logs")}</p><p>{t("trust.noRollback")}</p><p>{t("trust.stop")}</p><p>{t("trust.path")}</p>
      </div>
      {blockedReason ? <p id={`${id}-blocked`} className="text-body-sm">{t(t.has(errorKey) ? errorKey : "errors.UNKNOWN")}</p> : null}
    </form>
  )
}
