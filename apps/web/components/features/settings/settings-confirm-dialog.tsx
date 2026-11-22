"use client"

import { AlertTriangleIcon, RefreshCwIcon, ShieldAlertIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { useTranslations } from "next-intl"

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
import { Checkbox } from "@/components/ui/checkbox"
import type { SettingsPreviewResponse } from "@/lib/settings/types"

function formatPreviewValue(val: unknown): string {
  if (val === null) return "null"
  if (val === undefined) return "—"
  if (typeof val === "string") return val === "" ? '""' : val
  return JSON.stringify(val)
}

function getRiskReasonText(
  t: ReturnType<typeof useTranslations<"settings.confirmDialog">>,
  code: string,
  fallback: string
): string {
  switch (code) {
    case "BROAD_SCAN_ROOTS":
      return t("riskReason.BROAD_SCAN_ROOTS")
    case "PLUGINS_LOCAL_ENABLED":
      return t("riskReason.PLUGINS_LOCAL_ENABLED")
    case "SCAN_SCOPE_CHANGED":
      return t("riskReason.SCAN_SCOPE_CHANGED")
    case "SERVER_RESTART_REQUIRED":
      return t("riskReason.SERVER_RESTART_REQUIRED")
    case "SETTINGS_RESET":
      return t("riskReason.SETTINGS_RESET")
    case "PLUGIN_INSTALL_REMOTE":
      return t("riskReason.PLUGIN_INSTALL_REMOTE")
    case "PLUGIN_SANDBOX_SCRIPT":
      return t("riskReason.PLUGIN_SANDBOX_SCRIPT")
    case "PLUGIN_OVERWRITE":
      return t("riskReason.PLUGIN_OVERWRITE")
    case "PLUGIN_UNINSTALL":
      return t("riskReason.PLUGIN_UNINSTALL")
    default:
      return fallback
  }
}

export function SettingsConfirmDialog({
  preview,
  submitting,
  onClose,
  onConfirm,
}: {
  preview: SettingsPreviewResponse | null
  submitting: boolean
  onClose: () => void
  onConfirm: (acknowledgedRisks: string[]) => Promise<void>
}) {
  const t = useTranslations("settings.confirmDialog")
  const tCommon = useTranslations("common")
  const [acknowledged, setAcknowledged] = useState<string[]>([])

  const highRiskCodes = [
    ...new Set(
      (preview?.risk.reasons ?? [])
        .filter((reason) => reason.level === "high")
        .map((reason) => reason.code)
    ),
  ]
  const missingHighAck = highRiskCodes.some((code) => !acknowledged.includes(code))

  const handleOpenChange = (open: boolean) => {
    if (!open && !submitting) {
      setAcknowledged([])
      onClose()
    }
  }

  return (
    <AlertDialog open={preview !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-[640px]">
        <AlertDialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <AlertDialogTitle>
              {preview?.action === "import"
                ? t("importTitle")
                : preview?.action === "reset"
                  ? t("resetTitle")
                  : t("updateTitle")}
            </AlertDialogTitle>
            {preview && (
              <Badge
                variant={
                  preview.risk.level === "high"
                    ? "destructive"
                    : preview.risk.level === "medium"
                      ? "warning"
                      : "secondary"
                }
              >
                {t(`riskLevel.${preview.risk.level}`)}
              </Badge>
            )}
          </div>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>

        {preview && (
          <div className="flex flex-col gap-4">
            {preview.clearsScanCache && (
              <div className="flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning-soft p-3 text-body-sm text-warning">
                <Trash2Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{t("clearsScanCache")}</span>
              </div>
            )}

            {preview.restartRequiredFields.length > 0 && (
              <div className="flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning-soft p-3 text-body-sm text-warning">
                <RefreshCwIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {t("restartRequired", {
                    fields: preview.restartRequiredFields.join(", "),
                  })}
                </span>
              </div>
            )}

            {preview.risk.reasons.length > 0 && (
              <div className="flex flex-col gap-2">
                {preview.risk.reasons.map((reason) => {
                  const isHigh = reason.level === "high"
                  const checked = acknowledged.includes(reason.code)
                  return (
                    <div
                      key={reason.code}
                      className={
                        isHigh
                          ? "flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-body-sm text-destructive"
                          : "flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning-soft p-3 text-body-sm text-warning"
                      }
                    >
                      <div className="flex items-start gap-2">
                        {isHigh ? (
                          <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                        ) : (
                          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                        )}
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-caption font-semibold">{reason.code}</span>
                          <span>{getRiskReasonText(t, reason.code, reason.message)}</span>
                        </div>
                      </div>
                      {isHigh && (
                        <label className="flex cursor-pointer items-center gap-2.5 pt-1 text-foreground select-none">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(val) =>
                              setAcknowledged((prev) =>
                                val === true
                                  ? [...new Set([...prev, reason.code])]
                                  : prev.filter((item) => item !== reason.code)
                              )
                            }
                          />
                          <span className="text-body-sm font-medium">{t("acknowledgeHighRisk")}</span>
                        </label>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <div className="text-body-sm font-semibold text-foreground">
                {t("changesTitle", { count: preview.changes.length })}
              </div>
              {preview.changes.length === 0 ? (
                <p className="rounded-md border border-border bg-muted/50 p-3 text-body-sm text-muted-foreground">
                  {t("noChanges")}
                </p>
              ) : (
                <div className="max-h-60 overflow-auto rounded-md border border-border">
                  <table className="w-full text-left text-caption">
                    <thead className="border-b border-border bg-muted/60 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">{t("colField")}</th>
                        <th className="px-3 py-2 font-semibold">{t("colBefore")}</th>
                        <th className="px-3 py-2 font-semibold">{t("colAfter")}</th>
                        <th className="px-3 py-2 font-semibold">{t("colEffect")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {preview.changes.map((item) => (
                        <tr key={item.path}>
                          <td className="px-3 py-2 font-mono text-foreground">{item.path}</td>
                          <td className="max-w-36 truncate px-3 py-2 font-mono text-muted-foreground">
                            {formatPreviewValue(item.before)}
                          </td>
                          <td className="max-w-36 truncate px-3 py-2 font-mono font-semibold text-foreground">
                            {formatPreviewValue(item.after)}
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              variant={
                                item.effect === "restart-required"
                                  ? "warning"
                                  : item.effect === "hot-reload"
                                    ? "success"
                                    : "secondary"
                              }
                            >
                              {t(`effect.${item.effect}`)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting} onClick={() => setAcknowledged([])}>
            {tCommon("cancel")}
          </AlertDialogCancel>
          <Button
            type="button"
            disabled={!preview || submitting || preview.changes.length === 0 || missingHighAck}
            onClick={async () => {
              await onConfirm(acknowledged)
              setAcknowledged([])
            }}
          >
            {submitting ? tCommon("loading") : tCommon("confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
