"use client"

import { PlusIcon, Trash2Icon, ZapIcon } from "lucide-react"
import { useState } from "react"
import { useTranslations } from "next-intl"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  validateMaxDepthInput,
  validateScanRootInput,
  validateTimeoutInput,
} from "@/lib/settings/settings-validation"
import type { PrivilegedSettingsPatch, SettingsSnapshot, SettingValueSource } from "@/lib/settings/types"

function SourceBadge({ source }: { source: SettingValueSource }) {
  const t = useTranslations("settings.sources")
  return <Badge variant={source === "settings" ? "default" : "secondary"}>{t(source)}</Badge>
}

export function RuntimeTab({
  snapshot,
  busy,
  onPreviewUpdate,
}: {
  snapshot: SettingsSnapshot
  busy: boolean
  onPreviewUpdate: (patch: PrivilegedSettingsPatch) => Promise<void>
}) {
  const t = useTranslations("settings.runtime")
  const tVal = useTranslations("settings.validation")
  const initial = snapshot.document.runtime

  const [scanAllDrives, setScanAllDrives] = useState(initial.scanRootPaths.trim() === "*")
  const [scanPaths, setScanPaths] = useState<string[]>(() =>
    initial.scanRootPaths.trim() === "*"
      ? []
      : initial.scanRootPaths
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
  )
  const [newPathInput, setNewPathInput] = useState("")
  const [pathError, setPathError] = useState<string | null>(null)

  const [maxScanDepth, setMaxScanDepth] = useState(String(initial.maxScanDepth))
  const [scanTimeoutEnabled, setScanTimeoutEnabled] = useState(initial.scanTimeoutMs !== null)
  const [scanTimeoutMs, setScanTimeoutMs] = useState(String(initial.scanTimeoutMs ?? 900_000))
  const [npmTimeoutEnabled, setNpmTimeoutEnabled] = useState(initial.npmCommandTimeoutMs !== null)
  const [npmTimeoutMs, setNpmTimeoutMs] = useState(String(initial.npmCommandTimeoutMs ?? 300_000))
  const [formError, setFormError] = useState<string | null>(null)

  const handleAddPath = () => {
    const trimmed = newPathInput.trim()
    if (!trimmed) return
    const code = validateScanRootInput(trimmed)
    if (code) {
      setPathError(tVal(code))
      return
    }
    if (trimmed === "*") {
      setScanAllDrives(true)
      setScanPaths([])
      setNewPathInput("")
      setPathError(null)
      return
    }
    setScanAllDrives(false)
    setScanPaths((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    setNewPathInput("")
    setPathError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!scanAllDrives && scanPaths.length === 0) {
      setFormError(t("customPathsRequired"))
      return
    }
    const depthErr = validateMaxDepthInput(maxScanDepth)
    if (depthErr) {
      setFormError(tVal(depthErr))
      return
    }
    const scanToErr = validateTimeoutInput(scanTimeoutEnabled, scanTimeoutMs)
    if (scanToErr) {
      setFormError(tVal(scanToErr))
      return
    }
    const npmToErr = validateTimeoutInput(npmTimeoutEnabled, npmTimeoutMs)
    if (npmToErr) {
      setFormError(tVal(npmToErr))
      return
    }

    await onPreviewUpdate({
      runtime: {
        scanRootPaths: scanAllDrives ? "*" : scanPaths.join(", "),
        maxScanDepth: Number(maxScanDepth.trim()),
        scanTimeoutMs: scanTimeoutEnabled ? Number(scanTimeoutMs.trim()) : null,
        npmCommandTimeoutMs: npmTimeoutEnabled ? Number(npmTimeoutMs.trim()) : null,
      },
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex items-start gap-2.5 rounded-md border border-border bg-card p-3.5 text-body-sm text-foreground">
        <ZapIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span>{t("hotReloadBanner")}</span>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("scanRootsTitle")}</CardTitle>
            <SourceBadge source={snapshot.sources.runtime.scanRootPaths} />
          </div>
          <CardDescription>{t("scanRootsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ToggleGroup
            type="single"
            value={scanAllDrives ? "all" : "custom"}
            onValueChange={(val) => {
              if (val === "all") setScanAllDrives(true)
              if (val === "custom") setScanAllDrives(false)
            }}
          >
            <ToggleGroupItem value="custom">{t("modeCustom")}</ToggleGroupItem>
            <ToggleGroupItem value="all">{t("modeAllDrives")}</ToggleGroupItem>
          </ToggleGroup>

          {scanAllDrives ? (
            <div className="rounded-md border border-warning/40 bg-warning-soft p-3 text-body-sm text-warning">
              {t("allDrivesWarning")}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Input
                  value={newPathInput}
                  onChange={(e) => {
                    setNewPathInput(e.target.value)
                    if (pathError) setPathError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleAddPath()
                    }
                  }}
                  placeholder={t("pathPlaceholder")}
                  aria-label={t("pathPlaceholder")}
                  className="font-mono"
                />
                <Button type="button" variant="secondary" onClick={handleAddPath}>
                  <PlusIcon className="size-4" aria-hidden />
                  {t("addPath")}
                </Button>
              </div>
              {pathError && <p className="text-caption text-destructive">{pathError}</p>}

              {scanPaths.length === 0 ? (
                <p className="text-body-sm text-muted-foreground">{t("noCustomPaths")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {scanPaths.map((dir) => (
                    <li
                      key={dir}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2"
                    >
                      <span className="truncate font-mono text-body-sm text-foreground">{dir}</span>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("removePath", { path: dir })}
                        onClick={() => setScanPaths((prev) => prev.filter((item) => item !== dir))}
                      >
                        <Trash2Icon className="size-4 text-destructive" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("limitsTitle")}</CardTitle>
          <CardDescription>{t("limitsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="max-scan-depth">{t("maxScanDepthLabel")}</Label>
              <SourceBadge source={snapshot.sources.runtime.maxScanDepth} />
            </div>
            <Input
              id="max-scan-depth"
              type="number"
              min={0}
              max={20}
              value={maxScanDepth}
              onChange={(e) => setMaxScanDepth(e.target.value)}
              className="max-w-44 font-mono"
            />
            <p className="text-caption text-muted-foreground">{t("maxScanDepthHint")}</p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="scan-timeout-ms">{t("scanTimeoutLabel")}</Label>
              <SourceBadge source={snapshot.sources.runtime.scanTimeoutMs} />
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 select-none">
              <Checkbox
                checked={!scanTimeoutEnabled}
                onCheckedChange={(val) => setScanTimeoutEnabled(val !== true)}
              />
              <span className="text-body-sm text-foreground">{t("noTimeLimit")}</span>
            </label>
            {scanTimeoutEnabled && (
              <Input
                id="scan-timeout-ms"
                type="number"
                min={1000}
                step={1000}
                value={scanTimeoutMs}
                onChange={(e) => setScanTimeoutMs(e.target.value)}
                className="max-w-52 font-mono"
              />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="npm-timeout-ms">{t("npmTimeoutLabel")}</Label>
              <SourceBadge source={snapshot.sources.runtime.npmCommandTimeoutMs} />
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 select-none">
              <Checkbox
                checked={!npmTimeoutEnabled}
                onCheckedChange={(val) => setNpmTimeoutEnabled(val !== true)}
              />
              <span className="text-body-sm text-foreground">{t("noTimeLimit")}</span>
            </label>
            {npmTimeoutEnabled && (
              <Input
                id="npm-timeout-ms"
                type="number"
                min={1000}
                step={1000}
                value={npmTimeoutMs}
                onChange={(e) => setNpmTimeoutMs(e.target.value)}
                className="max-w-52 font-mono"
              />
            )}
          </div>

          {formError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-body-sm text-destructive">
              {formError}
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {t("previewSaveCta")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}
