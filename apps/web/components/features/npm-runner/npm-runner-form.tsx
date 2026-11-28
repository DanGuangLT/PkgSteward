"use client"

import { useId } from "react"
import type { ReactNode } from "react"
import { AlertTriangleIcon, PlayIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ConsoleShell, RunnerContext } from "@/lib/api/types"
import { runnerUsesPackage } from "@/lib/npm-runner/runner-display"
import { CONSOLE_SHELLS, normalizeConsoleShell, type RunnerSelection } from "@/lib/npm-runner/runner-policy"
import type messages from "@/messages/vi.json"

const actions = ["install_all", "install_one", "update_all", "update_one", "uninstall_one", "script"] as const

export function NpmRunnerForm({ context, selection, blockedReason, shellDisabled = false, onChange, onRun, children }: {
  context: RunnerContext | null
  selection: RunnerSelection
  blockedReason: string | null
  shellDisabled?: boolean
  onChange(selection: RunnerSelection): void
  onRun(): void
  children: ReactNode
}) {
  const t = useTranslations("npmRunner")
  const tDisabled = useTranslations("disabledReasons")
  const id = useId()
  const errorKey = `errors.${blockedReason}` as `errors.${keyof typeof messages.npmRunner.errors}`
  const blockedMessage = blockedReason ? t(t.has(errorKey) ? errorKey : "errors.UNKNOWN") : null
  const selectedScript = context?.scripts.findIndex(script => script.name === selection.script) ?? -1
  const currentShell = normalizeConsoleShell(selection.consoleShell)
  const eligibleScripts = context?.scripts.filter(script => script.eligible).slice(0, 6) ?? []

  return (
    <form className="min-w-0 space-y-4" onSubmit={event => { event.preventDefault(); if (!blockedReason) onRun() }}>
      <dl className="grid min-w-0 gap-3 rounded-md border border-border bg-background px-4 py-3 text-body-sm sm:grid-cols-3 [overflow-wrap:anywhere]">
        <div className="min-w-0">
          <dt className="text-caption text-muted-foreground">{t("form.manager")}</dt>
          <dd className="font-medium text-foreground">{context?.manager ?? t("outcome.unknown")}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption text-muted-foreground">{t("form.version")}</dt>
          <dd className="font-mono text-foreground">{context?.version ?? t("outcome.unknown")}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption text-muted-foreground">{t("form.target")}</dt>
          <dd className="font-mono text-caption text-foreground">{context?.path ?? t("outcome.unknown")}</dd>
        </div>
      </dl>

      <div className="grid min-w-0 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-action`}>{t("form.action")}</Label>
          <Select value={selection.action} onValueChange={action => {
            if (actions.some(value => value === action)) {
              onChange({ action: action as RunnerSelection["action"], consoleShell: currentShell })
            }
          }}>
            <SelectTrigger id={`${id}-action`} className="w-full min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent position="popper" className="max-w-(--radix-select-trigger-width)">
              {actions.map(action => <SelectItem key={action} value={action}>{t(`actions.${action}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-shell`}>{t("shells.label")}</Label>
          <Select
            value={currentShell}
            disabled={shellDisabled}
            onValueChange={shell => {
              if (CONSOLE_SHELLS.some(value => value === shell)) {
                onChange({ ...selection, consoleShell: shell as ConsoleShell })
              }
            }}
          >
            <DisabledTooltip
              reason={shellDisabled ? tDisabled("shellLockedWhileRunning") : null}
              className="w-full"
            >
              <SelectTrigger id={`${id}-shell`} className="w-full min-w-0"><SelectValue /></SelectTrigger>
            </DisabledTooltip>
            <SelectContent position="popper" className="max-w-(--radix-select-trigger-width)">
              {CONSOLE_SHELLS.map(shell => (
                <SelectItem key={shell} value={shell}>{t(`shells.${shell}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {runnerUsesPackage(selection.action) ? (
          <div className="min-w-0 space-y-2 md:col-span-2 lg:col-span-1">
            <Label htmlFor={`${id}-package`}>{t("form.package")}</Label>
            <Input
              id={`${id}-package`}
              value={selection.package ?? ""}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={blockedReason === "INVALID_PACKAGE_SPEC"}
              aria-describedby={`${id}-package-hint${blockedReason === "INVALID_PACKAGE_SPEC" ? ` ${id}-blocked` : ""}`}
              onChange={event => onChange({ ...selection, package: event.target.value })}
            />
            <p id={`${id}-package-hint`} className="text-caption text-muted-foreground">
              {t(selection.action === "install_one" ? "form.packageHint" : "form.packageNameHint")}
            </p>
          </div>
        ) : null}

        {selection.action === "script" ? (
          <div className="min-w-0 space-y-2 md:col-span-2 lg:col-span-1">
            <Label htmlFor={`${id}-script`}>{t("form.script")}</Label>
            <Select
              value={selectedScript < 0 ? "" : String(selectedScript)}
              onValueChange={value => {
                const script = context?.scripts[Number(value)]
                if (script?.eligible) onChange({ ...selection, script: script.name })
              }}
            >
              <SelectTrigger id={`${id}-script`} className="w-full min-w-0">
                <SelectValue placeholder={t("form.chooseScript")} />
              </SelectTrigger>
              <SelectContent position="popper" className="max-w-(--radix-select-trigger-width)">
                {context?.scripts.map((script, index) => (
                  <SelectItem
                    key={script.name}
                    value={String(index)}
                    disabled={!script.eligible}
                    className="[overflow-wrap:anywhere]"
                  >
                    {script.name || t("form.unnamedScript")}
                    {!script.eligible ? ` — ${t("form.scriptUnavailable")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {eligibleScripts.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-caption font-medium text-muted-foreground">{t("form.quickScripts")}</span>
          {eligibleScripts.map(script => {
            const active = selection.action === "script" && selection.script === script.name
            return (
              <Button
                key={script.name}
                type="button"
                size="sm"
                variant={active ? "secondary" : "outline"}
                aria-pressed={active}
                className="h-auto min-h-8 max-w-full py-1.5 font-mono text-caption whitespace-normal [overflow-wrap:anywhere]"
                onClick={() => onChange({ action: "script", script: script.name, consoleShell: currentShell })}
              >
                {script.name}
              </Button>
            )
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <DisabledTooltip reason={blockedMessage}>
          <Button
            type="submit"
            disabled={blockedReason !== null}
            aria-describedby={`${id}-trust${blockedReason ? ` ${id}-blocked` : ""}`}
          >
            <PlayIcon aria-hidden="true" />
            {t("run")}
          </Button>
        </DisabledTooltip>
        {children}
      </div>

      {blockedMessage ? (
        <p id={`${id}-blocked`} className="text-body-sm font-medium text-foreground">
          {blockedMessage}
        </p>
      ) : null}

      <div
        id={`${id}-trust`}
        className="space-y-1.5 rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-caption font-medium text-warning"
      >
        <p><AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" />{t("trust.projectCode")}</p>
        <p>{t("trust.noRollback")}</p>
      </div>

      <details className="rounded-md border border-border bg-background px-4 py-2.5 text-caption text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium text-foreground focus-ring">
          {t("trust.summary")}
        </summary>
        <div className="mt-2.5 space-y-1.5 border-t border-border/60 pt-2.5 leading-relaxed">
          <p>{t("trust.config")}</p>
          <p>{t("trust.network")}</p>
          <p>{t("trust.logs")}</p>
          <p>{t("trust.stop")}</p>
          <p>{t("trust.path")}</p>
        </div>
      </details>
    </form>
  )
}
