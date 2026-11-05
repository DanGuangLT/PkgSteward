"use client"

import { useEffect, useId, useState } from "react"
import { AlertTriangleIcon, EyeIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { RiskBadge } from "@/components/features/file-ops/risk-badge"
import { GlobalActionLabel, GlobalCodeMessage } from "@/components/features/global-packages/global-package-job"
import { globalActionPending } from "@/lib/global-packages/global-session"
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { globalConsentError } from "@/lib/global-packages/global-preview-form"
import type { GlobalController } from "@/components/features/global-packages/global-packages-panel"

const permanentWarnings = ["lifecycle", "consumers", "partial", "crash", "rollback"] as const

export function GlobalPackagePreview({ controller, blocked, onCloseAutoFocus, onCancel }: {
  controller: GlobalController
  blocked: boolean
  onCloseAutoFocus(event: Event, previewId: string): void
  onCancel(): void
}) {
  const t = useTranslations("globalPackages")
  const format = useFormatter()
  const id = useId()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const { state, consent, execute, preview: previewAgain } = controller
  const preview = state.form.preview
  if (!preview) return null
  const error = globalConsentError(state.form, now)
  const expired = error === "PREVIEW_EXPIRED"
  const pending = state.phase === "starting"
  const executing = globalActionPending(state, "mutation")
  const previewing = globalActionPending(state, "preview")

  return <AlertDialog open onOpenChange={open => { if (!open && !pending) onCancel() }}>
    <AlertDialogContent className="max-h-[calc(100dvh-2rem)] min-w-0 overflow-y-auto data-[size=default]:sm:max-w-2xl"
      onCloseAutoFocus={event => onCloseAutoFocus(event, preview.previewId)}>
      <AlertDialogHeader>
        <AlertDialogTitle>{t("dialog.title")}</AlertDialogTitle>
        <AlertDialogDescription>{t("dialog.description")}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="min-w-0 space-y-4 text-body-sm">
        <RiskBadge level="high" />
        <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="min-w-0"><dt className="text-muted-foreground">{t("manager")}</dt><dd className="break-all font-mono">{preview.manager} {preview.managerVersion}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">{t("package")}</dt><dd className="break-all">{preview.package}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">{t("globalRoot")}</dt><dd className="break-all font-mono">{preview.globalRoot}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">{t("binDir")}</dt><dd className="break-all font-mono">{preview.binDir}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">{t("dialog.change")}</dt><dd className="break-all font-mono">{preview.currentVersion} → {preview.action === "remove" ? t("removed") : preview.targetVersion ?? t("unknown")}</dd></div>
        </dl>
        <p className="font-semibold">{t(preview.action === "remove" ? "remove" : "change")}</p>
        <div className="space-y-3 rounded-md bg-muted p-4">
          <h3 className="font-semibold">{t("dialog.warnings")}</h3>
          <ul className="space-y-2">{permanentWarnings.map(code => <li key={code}>
            <AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" />{t(`dialog.${code}`)}
          </li>)}</ul>
        </div>
        {preview.risk.reasons.length ? <ul className="space-y-2">{preview.risk.reasons.map(({ code }) => <li key={code}><GlobalCodeMessage kind="risk" code={code} /></li>)}</ul> : null}
        {preview.warningCodes.length ? <ul className="space-y-2">{preview.warningCodes.map(code => <li key={code}><GlobalCodeMessage kind="warnings" code={code} /></li>)}</ul> : null}
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="min-w-0"><h3 className="font-semibold">{t("dialog.binsAdded")}</h3>
            {preview.bins.added.length ? <ul className="break-all font-mono">{preview.bins.added.map(bin => <li key={bin.name}>{bin.name} → {bin.target}</li>)}</ul> : <p>{t("none")}</p>}
          </div>
          <div className="min-w-0"><h3 className="font-semibold">{t("dialog.binsRemoved")}</h3>
            {preview.bins.removed.length ? <ul className="break-all font-mono">{preview.bins.removed.map(bin => <li key={bin.name}>{bin.name} → {bin.target}</li>)}</ul> : <p>{t("none")}</p>}
          </div>
          <div className="min-w-0 sm:col-span-2"><h3 className="font-semibold">{t("dialog.binsReplaced")}</h3>
            {preview.bins.replaced.length ? <ul className="break-all font-mono">{preview.bins.replaced.map(bin => <li key={bin.before.name}>{bin.before.name}: {bin.before.target} → {bin.after.target}</li>)}</ul> : <p>{t("none")}</p>}
          </div>
        </div>
        <p>{t("dialog.expiresAt", { time: format.dateTime(new Date(preview.expiresAt), { timeStyle: "medium" }) })}</p>
        {expired ? <div role="alert" className="space-y-3 rounded-md border border-border p-4">
          <p>{t("errors.PREVIEW_EXPIRED")}</p>
          <Button type="button" variant="secondary" disabled={blocked} aria-busy={previewing} className="h-auto min-h-10 border-border whitespace-normal"
            onClick={() => { void previewAgain(state.form.selection) }}><GlobalActionLabel pending={previewing} icon={EyeIcon}>{t(previewing ? "loadingPreview" : "previewAgain")}</GlobalActionLabel></Button>
        </div> : null}
        <div className="flex min-w-0 items-start gap-3">
          <Checkbox id={`${id}-risk`} checked={state.form.acknowledged} disabled={blocked || expired}
            onCheckedChange={checked => consent({ acknowledged: checked === true })} />
          <Label htmlFor={`${id}-risk`} className="min-w-0 text-body-sm leading-snug font-normal select-text">{t("dialog.acknowledge")}</Label>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-confirm`} className="block leading-snug font-normal select-text">
            {t.rich("dialog.typeText", { text: preview.confirmText,
              code: chunks => <code className="break-all font-mono font-semibold select-text">{chunks}</code> })}
          </Label>
          <Input id={`${id}-confirm`} value={state.form.confirmText} disabled={blocked || expired} autoComplete="off" spellCheck={false}
            className="min-w-0 font-mono" onChange={event => consent({ confirmText: event.target.value })} />
        </div>
        {state.error ? <p role="alert"><GlobalCodeMessage code={state.error.code} /></p> : null}
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending} className="h-auto min-h-10 border-border whitespace-normal"><XIcon aria-hidden="true" />{t("cancel")}</AlertDialogCancel>
        <Button type="button" variant="destructive" disabled={blocked || error !== null}
          aria-busy={executing} className="h-auto min-h-10 whitespace-normal" onClick={() => { void execute() }}><GlobalActionLabel pending={executing} icon={preview.action === "remove" ? Trash2Icon : PencilIcon}>{t(executing ? "loadingExecute" : preview.action === "remove" ? "dialog.confirmRemove" : "dialog.confirmChange")}</GlobalActionLabel></Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
