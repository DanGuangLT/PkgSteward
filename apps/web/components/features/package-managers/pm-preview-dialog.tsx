"use client"

import { useEffect, useId, useState } from "react"
import { AlertTriangleIcon, EyeIcon, PencilIcon, XIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { RiskBadge } from "@/components/features/file-ops/risk-badge"
import { PmActionLabel, PmCodeMessage } from "@/components/features/package-managers/pm-messages"
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import type { PackageManagersController } from "@/hooks/use-package-managers"
import { pmConsentError } from "@/lib/package-managers/pm-preview-form"

export function PmPreviewDialog({ controller, blocked, onCloseAutoFocus, onCancel }: {
  controller: PackageManagersController
  blocked: boolean
  onCloseAutoFocus(event: Event, previewId: string): void
  onCancel(): void
}) {
  const t = useTranslations("packageManagers")
  const tr = useTranslations("fileOps")
  const format = useFormatter()
  const id = useId()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const { state, acknowledge, execute, preview: previewAgain } = controller
  const preview = state.form.preview
  if (!preview) return null
  const error = pmConsentError(state.form, now)
  const expired = error === "PREVIEW_EXPIRED"
  const pending = state.phase === "starting"
  const executing = state.activity?.kind === "mutation" && (state.phase === "starting" || state.phase === "tracking")
  const previewing = state.activity?.kind === "preview" && (state.phase === "starting" || state.phase === "tracking")
  const selection = state.form.selection

  return <AlertDialog open onOpenChange={open => { if (!open && !pending) onCancel() }}>
    <AlertDialogContent className="max-h-[calc(100dvh-2rem)] min-w-0 overflow-y-auto data-[size=default]:sm:max-w-2xl"
      onCloseAutoFocus={event => onCloseAutoFocus(event, preview.previewId)}>
      <AlertDialogHeader>
        <AlertDialogTitle>{t("dialog.title")}</AlertDialogTitle>
        <AlertDialogDescription>{t("dialog.description")}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="min-w-0 space-y-4 text-body-sm">
        <RiskBadge level={preview.risk.level} />
        <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">{t("dialog.project")}</dt>
            <dd className="[overflow-wrap:anywhere]">{preview.projectName}</dd>
            <dd className="break-all font-mono">{preview.path}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">{t("dialog.file")}</dt><dd className="font-mono">{preview.edit.file}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">{t("dialog.runner")}</dt><dd className="font-mono">{preview.manager} {preview.installedRunnerVersion}</dd></div>
          <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">{t("dialog.change")}</dt>
            <dd className="break-all font-mono">{preview.edit.before ?? t("pinMissing")} → {preview.edit.after}</dd></div>
        </dl>
        <div className="space-y-3 rounded-md bg-muted p-4">
          <h3 className="font-semibold">{t("dialog.warnings")}</h3>
          <ul className="space-y-2">{preview.warnings.map(code => <li key={code}>
            <AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" /><PmCodeMessage kind="warnings" code={code} />
          </li>)}</ul>
          {preview.limitations.length ? <>
            <h3 className="font-semibold">{t("dialog.limitations")}</h3>
            <ul className="space-y-2">{preview.limitations.map(code => <li key={code}><PmCodeMessage kind="limitations" code={code} /></li>)}</ul>
          </> : null}
        </div>
        <p>{t("dialog.expiresAt", { time: format.dateTime(new Date(preview.expiresAt), { timeStyle: "medium" }) })}</p>
        {expired && selection ? <div role="alert" className="space-y-3 rounded-md border border-border p-4">
          <p><PmCodeMessage code="PREVIEW_EXPIRED" /></p>
          <Button type="button" variant="secondary" disabled={blocked} aria-busy={previewing} className="h-auto min-h-10 border-border whitespace-normal"
            onClick={() => { void previewAgain(selection) }}><PmActionLabel pending={previewing} icon={EyeIcon}>{t(previewing ? "loadingPreview" : "dialog.previewAgain")}</PmActionLabel></Button>
        </div> : null}
        {preview.risk.reasons.map(({ code }) => <div key={code} className="flex min-w-0 items-start gap-3">
          <Checkbox id={`${id}-${code}`} checked={state.form.acknowledged.includes(code)} disabled={blocked || expired}
            onCheckedChange={checked => acknowledge(code, checked === true)} />
          <Label htmlFor={`${id}-${code}`} className="min-w-0 text-body-sm leading-snug font-normal select-text">
            {t("dialog.acknowledge", { reason: tr.has(`risk.${code}`) ? tr(`risk.${code}` as "risk.RECENTLY_ACTIVE") : code })}
          </Label>
        </div>)}
        {state.error ? <p role="alert"><PmCodeMessage code={state.error.code} /></p> : null}
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending} className="h-auto min-h-10 border-border whitespace-normal"><XIcon aria-hidden="true" />{t("cancel")}</AlertDialogCancel>
        <Button type="button" variant="destructive" disabled={blocked || error !== null} aria-busy={executing}
          className="h-auto min-h-10 whitespace-normal" onClick={() => { void execute() }}>
          <PmActionLabel pending={executing} icon={PencilIcon}>{t(executing ? "dialog.confirming" : "dialog.confirm")}</PmActionLabel>
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
