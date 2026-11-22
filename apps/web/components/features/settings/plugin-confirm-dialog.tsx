"use client"

import { AlertTriangleIcon, ShieldAlertIcon, Trash2Icon } from "lucide-react"
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
import type {
  PluginInstallPreviewResponse,
  PluginUninstallPreviewResponse,
} from "@/lib/settings/types"

export type PendingPluginAction =
  | { kind: "install"; data: PluginInstallPreviewResponse }
  | { kind: "uninstall"; data: PluginUninstallPreviewResponse }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function getRiskReasonText(
  tConfirm: ReturnType<typeof useTranslations<"settings.confirmDialog">>,
  code: string,
  fallback: string
): string {
  switch (code) {
    case "PLUGIN_INSTALL_REMOTE":
      return tConfirm("riskReason.PLUGIN_INSTALL_REMOTE")
    case "PLUGIN_SANDBOX_SCRIPT":
      return tConfirm("riskReason.PLUGIN_SANDBOX_SCRIPT")
    case "PLUGIN_OVERWRITE":
      return tConfirm("riskReason.PLUGIN_OVERWRITE")
    case "PLUGIN_UNINSTALL":
      return tConfirm("riskReason.PLUGIN_UNINSTALL")
    default:
      return fallback
  }
}

export function PluginConfirmDialog({
  pending,
  submitting,
  onClose,
  onConfirm,
}: {
  pending: PendingPluginAction | null
  submitting: boolean
  onClose: () => void
  onConfirm: (acknowledgedRisks: string[]) => Promise<void>
}) {
  const t = useTranslations("settings.pluginDialog")
  const tConfirm = useTranslations("settings.confirmDialog")
  const tCommon = useTranslations("common")
  const [acknowledged, setAcknowledged] = useState<string[]>([])

  const reasons = pending?.data.risk.reasons ?? []
  const highRiskCodes = [
    ...new Set(reasons.filter((reason) => reason.level === "high").map((reason) => reason.code)),
  ]
  const missingHighAck = highRiskCodes.some((code) => !acknowledged.includes(code))

  const handleOpenChange = (open: boolean) => {
    if (!open && !submitting) {
      setAcknowledged([])
      onClose()
    }
  }

  return (
    <AlertDialog open={pending !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-[580px]">
        <AlertDialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <AlertDialogTitle>
              {pending?.kind === "uninstall" ? t("uninstallTitle") : t("installTitle")}
            </AlertDialogTitle>
            {pending && (
              <Badge
                variant={
                  pending.data.risk.level === "high"
                    ? "destructive"
                    : pending.data.risk.level === "medium"
                      ? "warning"
                      : "secondary"
                }
              >
                {tConfirm(`riskLevel.${pending.data.risk.level}`)}
              </Badge>
            )}
          </div>
          <AlertDialogDescription>
            {pending?.kind === "uninstall" ? t("uninstallDescription") : t("installDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {pending && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2 rounded-md border border-border bg-muted/40 p-3 text-body-sm sm:grid-cols-2">
              <div>
                <div className="text-caption text-muted-foreground">{t("nameLabel")}</div>
                <div className="font-semibold text-foreground">{pending.data.pluginName}</div>
              </div>
              <div>
                <div className="text-caption text-muted-foreground">{t("idLabel")}</div>
                <div className="font-mono text-foreground">{pending.data.pluginId}</div>
              </div>
              {pending.kind === "install" ? (
                <>
                  <div>
                    <div className="text-caption text-muted-foreground">{t("formatLabel")}</div>
                    <div className="font-mono text-foreground">
                      {pending.data.format} ({pending.data.entryKind})
                    </div>
                  </div>
                  <div>
                    <div className="text-caption text-muted-foreground">{t("packageSizeLabel")}</div>
                    <div className="font-mono text-foreground">
                      {pending.data.fileCount} · {formatBytes(pending.data.totalBytes)}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-caption text-muted-foreground">{t("sourceLabel")}</div>
                    <div className="truncate font-mono text-caption text-foreground">
                      {pending.data.sourceLabel}
                    </div>
                  </div>
                </>
              ) : (
                <div className="sm:col-span-2">
                  <div className="text-caption text-muted-foreground">{t("targetDirLabel")}</div>
                  <div className="truncate font-mono text-caption text-foreground">
                    {pending.data.targetDir}
                  </div>
                </div>
              )}
            </div>

            {pending.kind === "uninstall" && pending.data.preinstalled && (
              <div className="flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning-soft p-3 text-body-sm text-warning">
                <Trash2Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{t("preinstalledUninstallHint")}</span>
              </div>
            )}

            {reasons.length > 0 && (
              <div className="flex flex-col gap-2">
                {reasons.map((reason) => {
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
                          <span>{getRiskReasonText(tConfirm, reason.code, reason.message)}</span>
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
                          <span className="text-body-sm font-medium">
                            {tConfirm("acknowledgeHighRisk")}
                          </span>
                        </label>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting} onClick={() => setAcknowledged([])}>
            {tCommon("cancel")}
          </AlertDialogCancel>
          <Button
            type="button"
            variant={pending?.kind === "uninstall" ? "destructive" : "default"}
            disabled={!pending || submitting || missingHighAck}
            onClick={async () => {
              await onConfirm(acknowledged)
              setAcknowledged([])
            }}
          >
            {submitting
              ? tCommon("loading")
              : pending?.kind === "uninstall"
                ? t("confirmUninstallCta")
                : t("confirmInstallCta")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
