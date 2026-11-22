"use client"

import { CopyIcon, DownloadIcon, RotateCcwIcon, UploadIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { exportBrowserSettings } from "@/lib/api/settings/settings-browser"
import { parseImportSettingsJson } from "@/lib/settings/settings-validation"
import type { SettingsResetScope } from "@/lib/settings/types"

const RESET_SCOPES: readonly SettingsResetScope[] = [
  "appearance",
  "behavior",
  "runtime",
  "server",
  "plugins",
  "all",
]

export function BackupTab({
  busy,
  onPreviewImport,
  onPreviewReset,
}: {
  busy: boolean
  onPreviewImport: (doc: Record<string, unknown>) => Promise<void>
  onPreviewReset: (scope: SettingsResetScope) => Promise<void>
}) {
  const t = useTranslations("settings.backup")
  const [importText, setImportText] = useState("")
  const [importError, setImportError] = useState<string | null>(null)
  const [resetScope, setResetScope] = useState<SettingsResetScope>("appearance")

  const handleDownloadExport = async () => {
    try {
      const exported = await exportBrowserSettings()
      const blob = new Blob([`${JSON.stringify(exported.document, null, 2)}\n`], {
        type: "application/json",
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = "pkgsteward-settings.json"
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success(t("exportSuccess"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("exportFailed"))
    }
  }

  const handleCopyExport = async () => {
    try {
      const exported = await exportBrowserSettings()
      await navigator.clipboard.writeText(`${JSON.stringify(exported.document, null, 2)}\n`)
      toast.success(t("copySuccess"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("exportFailed"))
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      setImportText(text)
      setImportError(null)
    } catch {
      setImportError(t("fileReadFailed"))
    }
  }

  const handlePreviewImport = async () => {
    setImportError(null)
    const parsed = parseImportSettingsJson(importText)
    if (!parsed.ok) {
      setImportError(t("invalidJson"))
      return
    }
    await onPreviewImport(parsed.value)
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("exportTitle")}</CardTitle>
          <CardDescription>{t("exportDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button type="button" onClick={handleDownloadExport}>
            <DownloadIcon className="size-4" aria-hidden />
            {t("downloadJsonCta")}
          </Button>
          <Button type="button" variant="secondary" onClick={handleCopyExport}>
            <CopyIcon className="size-4" aria-hidden />
            {t("copyJsonCta")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("importTitle")}</CardTitle>
          <CardDescription>{t("importDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="settings-import-file">{t("chooseFileLabel")}</Label>
            <input
              id="settings-import-file"
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
              className="block w-full text-body-sm text-foreground file:mr-3 file:rounded-full file:border file:border-border file:bg-secondary file:px-4 file:py-2 file:text-button file:text-secondary-foreground"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="settings-import-json">{t("pasteJsonLabel")}</Label>
            <textarea
              id="settings-import-json"
              rows={8}
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value)
                if (importError) setImportError(null)
              }}
              placeholder='{ "schemaVersion": 1, ... }'
              className="w-full rounded-md border border-input bg-background p-3 font-mono text-caption text-foreground focus-ring-input"
            />
          </div>

          {importError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-body-sm text-destructive">
              {importError}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="button"
              disabled={busy || importText.trim() === ""}
              onClick={handlePreviewImport}
            >
              <UploadIcon className="size-4" aria-hidden />
              {t("previewImportCta")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("resetTitle")}</CardTitle>
          <CardDescription>{t("resetDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t("resetScopeLabel")}</Label>
            <ToggleGroup
              type="single"
              value={resetScope}
              onValueChange={(val) => {
                if (val && RESET_SCOPES.includes(val as SettingsResetScope)) {
                  setResetScope(val as SettingsResetScope)
                }
              }}
            >
              {RESET_SCOPES.map((scope) => (
                <ToggleGroupItem key={scope} value={scope}>
                  {t(`resetScopes.${scope}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void onPreviewReset(resetScope)}
            >
              <RotateCcwIcon className="size-4" aria-hidden />
              {t("previewResetCta")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
