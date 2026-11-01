"use client"

import { useId, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { RiskBadge } from "@/components/features/file-ops/risk-badge"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { FileOpsSummary, FileOpsTarget, RiskCode } from "@/lib/api/types"
import {
  canConfirm, confirmationKey, requiredAcknowledgements, requiresTypedText, type ConfirmationInput,
} from "@/lib/file-ops/confirmation"

interface DeleteConfirmDialogProps {
  previewId: string
  summary: FileOpsSummary
  targets: readonly FileOpsTarget[]
  pending: boolean
  errorMessage: string | null
  onConfirm(confirmation: ConfirmationInput): void
  onCancel(): void
}

function ConfirmBody({ summary, targets, pending, errorMessage, onConfirm }: Omit<DeleteConfirmDialogProps, "onCancel" | "previewId">) {
  const t = useTranslations("fileOps")
  const tCommon = useTranslations("common")
  const format = useFormatter()
  const baseId = useId()
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<RiskCode>>(() => new Set())
  const [typedText, setTypedText] = useState("")
  const needsTicks = requiredAcknowledgements(summary).length > 0
  const confirmation = { acknowledged, typedText }
  const byPath = new Map(targets.map((target) => [target.path, target]))
  const count = summary.paths.length

  function acknowledge(code: RiskCode, checked: boolean) {
    setAcknowledged((previous) => {
      const next = new Set(previous)
      if (checked) next.add(code)
      else next.delete(code)
      return next
    })
  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-4 text-body-sm">
        <RiskBadge level={summary.risk.level} />
        {needsTicks ? (
          <fieldset className="min-w-0 space-y-3">
            <legend className="mb-3 font-semibold">{t("dialog.acknowledge")}</legend>
            {summary.risk.reasons.map(({ code }) => (
              <div key={code} className="flex min-w-0 items-start gap-3">
                <Checkbox id={`${baseId}-${code}`} checked={acknowledged.has(code)} disabled={pending}
                  onCheckedChange={(checked) => acknowledge(code, checked === true)} />
                <Label htmlFor={`${baseId}-${code}`} className="min-w-0 text-body-sm leading-snug font-normal select-text">
                  {t("dialog.understand", { reason: t(`risk.${code}`) })}
                </Label>
              </div>
            ))}
          </fieldset>
        ) : (
          <ul className="min-w-0 space-y-1">
            {summary.risk.reasons.map(({ code }) => <li key={code}>{t(`risk.${code}`)}</li>)}
          </ul>
        )}

        <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
          {summary.totals.reclaimableBytes > 0 || summary.totals.recycleBytes === 0 ? (
            <div className="min-w-0">
              <dt className="text-muted-foreground">{t("selection.reclaimable")}</dt>
              <dd className="text-heading-md"><DiskSize bytes={summary.totals.reclaimableBytes} /></dd>
            </div>
          ) : null}
          {summary.totals.recycleBytes > 0 ? (
            <div className="min-w-0">
              <dt className="text-muted-foreground">{t("selection.recycle")}</dt>
              <dd className="text-heading-md"><DiskSize bytes={summary.totals.recycleBytes} /></dd>
            </div>
          ) : null}
        </dl>

        <ul aria-label={t("dialog.listLabel")} tabIndex={0}
          className="flex max-h-48 min-w-0 flex-col gap-3 overflow-y-auto rounded-md bg-muted p-4 focus-ring">
          {summary.paths.map((path) => {
            const target = byPath.get(path)
            return (
              <li key={path} className="min-w-0 space-y-1">
                <p className="font-mono text-caption text-foreground [overflow-wrap:anywhere]">{path}</p>
                <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                  {target?.method ? <span className="font-semibold text-foreground">{t(`method.${target.method}`)}</span> : null}
                  {target?.risk.level === "high" ? <RiskBadge level="high" /> : null}
                </div>
                {target && target.nestedProjects.length > 0 ? (
                  <p className="text-caption text-muted-foreground">{t("dialog.nestedProjects", {
                    count: target.nestedProjects.length, formattedCount: format.number(target.nestedProjects.length),
                  })}</p>
                ) : null}
              </li>
            )
          })}
        </ul>

        {requiresTypedText(summary) ? (
          <div className="min-w-0 space-y-2">
            <Label htmlFor={`${baseId}-text`} className="block leading-snug font-normal select-text">
              {t.rich("dialog.typeText", {
                text: summary.confirmText ?? "",
                code: (chunks) => <code className="font-mono font-semibold [overflow-wrap:anywhere]">{chunks}</code>,
              })}
            </Label>
            <Input id={`${baseId}-text`} value={typedText} disabled={pending} autoComplete="off" spellCheck={false}
              maxLength={1024} className="font-mono" onChange={(event) => setTypedText(event.target.value)} />
          </div>
        ) : null}

        {errorMessage ? <p role="alert" className="rounded-md border border-border bg-muted p-4">{errorMessage}</p> : null}
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>{tCommon("cancel")}</AlertDialogCancel>
        <Button type="button" variant="destructive" disabled={pending || !canConfirm(summary, confirmation)} onClick={() => onConfirm(confirmation)}>
          {pending ? t("dialog.sending") : t("dialog.confirm", { count, formattedCount: format.number(count) })}
        </Button>
      </AlertDialogFooter>
    </>
  )
}

/**
 * Mở liên tục theo `summary`: nút xác nhận không tự đóng dialog (khác AlertDialogAction) để
 * lỗi từ backend hiện ngay trong dialog. Radix focus sẵn nút Huỷ.
 */
export function DeleteConfirmDialog({ previewId, onCancel, ...body }: DeleteConfirmDialogProps) {
  const t = useTranslations("fileOps")
  const format = useFormatter()
  const { summary, pending } = body
  const count = summary.paths.length

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !pending) onCancel() }}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto data-[size=default]:sm:max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("dialog.title", { count, formattedCount: format.number(count) })}</AlertDialogTitle>
          <AlertDialogDescription>{t("dialog.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <ConfirmBody key={confirmationKey(previewId, summary)} {...body} />
      </AlertDialogContent>
    </AlertDialog>
  )
}
