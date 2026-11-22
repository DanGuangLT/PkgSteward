"use client"

import { HardDriveIcon, PlusIcon, Trash2Icon, ZapIcon } from "lucide-react"
import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"

import { UnitNumberInput } from "@/components/features/settings/unit-number-input"
import { useSettings } from "@/components/settings/settings-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  formatDurationHintMs,
  inferScanRootMode,
  MAX_TIMEOUT_MS,
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
  const locale = useLocale() === "en" ? "en" : "vi"
  const { behavior } = useSettings()
  const initial = snapshot.document.runtime
  const availableDrives = snapshot.availableDrives ?? []

  const initialInferred = inferScanRootMode(initial.scanRootPaths, availableDrives)
  const [scanMode, setScanMode] = useState<"all" | "drives" | "custom">(initialInferred.mode)
  const [selectedDrives, setSelectedDrives] = useState<string[]>(initialInferred.selectedDrives)
  const [scanPaths, setScanPaths] = useState<string[]>(initialInferred.customPaths)
  const [newPathInput, setNewPathInput] = useState("")
  const [addAttempted, setAddAttempted] = useState(false)

  const [maxScanDepth, setMaxScanDepth] = useState(String(initial.maxScanDepth))
  const [scanTimeoutEnabled, setScanTimeoutEnabled] = useState(initial.scanTimeoutMs !== null)
  const [scanTimeoutMs, setScanTimeoutMs] = useState(String(initial.scanTimeoutMs ?? 900_000))
  const [npmTimeoutEnabled, setNpmTimeoutEnabled] = useState(initial.npmCommandTimeoutMs !== null)
  const [npmTimeoutMs, setNpmTimeoutMs] = useState(String(initial.npmCommandTimeoutMs ?? 300_000))
  const [submitted, setSubmitted] = useState(false)

  const livePathError =
    newPathInput.trim() !== "" || addAttempted ? validateScanRootInput(newPathInput) : null
  const drivesError =
    submitted && scanMode === "drives" && selectedDrives.length === 0 ? t("drivesRequired") : null
  const customPathsError =
    submitted && scanMode === "custom" && scanPaths.length === 0 ? t("customPathsRequired") : null
  const depthError = behavior.advancedMode ? validateMaxDepthInput(maxScanDepth) : null
  const scanTimeoutError = behavior.advancedMode
    ? validateTimeoutInput(scanTimeoutEnabled, scanTimeoutMs)
    : null
  const npmTimeoutError = behavior.advancedMode
    ? validateTimeoutInput(npmTimeoutEnabled, npmTimeoutMs)
    : null

  const hasValidationErrors = Boolean(
    (scanMode === "drives" && selectedDrives.length === 0) ||
      (scanMode === "custom" && scanPaths.length === 0) ||
      depthError ||
      scanTimeoutError ||
      npmTimeoutError
  )

  const handleAddPath = () => {
    const trimmed = newPathInput.trim()
    setAddAttempted(true)
    if (!trimmed) return
    const code = validateScanRootInput(trimmed)
    if (code) return

    if (trimmed === "*") {
      setScanMode("all")
      setScanPaths([])
      setNewPathInput("")
      setAddAttempted(false)
      return
    }
    setScanMode("custom")
    setScanPaths((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    setNewPathInput("")
    setAddAttempted(false)
  }

  const toggleDrive = (drive: string, checked: boolean) => {
    setSelectedDrives((prev) =>
      checked ? (prev.includes(drive) ? prev : [...prev, drive]) : prev.filter((item) => item !== drive)
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (hasValidationErrors) return

    const nextScanRootPaths =
      scanMode === "all"
        ? "*"
        : scanMode === "drives"
          ? selectedDrives.join(", ")
          : scanPaths.join(", ")

    await onPreviewUpdate({
      runtime: {
        scanRootPaths: nextScanRootPaths,
        maxScanDepth: Number(maxScanDepth.trim()),
        scanTimeoutMs: scanTimeoutEnabled ? Number(scanTimeoutMs.trim()) : null,
        npmCommandTimeoutMs: npmTimeoutEnabled ? Number(npmTimeoutMs.trim()) : null,
      },
    })
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-6">
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
            value={scanMode}
            onValueChange={(val) => {
              if (val === "drives" || val === "custom" || val === "all") {
                setSubmitted(false)
                setScanMode(val)
              }
            }}
          >
            <ToggleGroupItem value="drives">{t("modeDrives")}</ToggleGroupItem>
            <ToggleGroupItem value="custom">{t("modeCustom")}</ToggleGroupItem>
            <ToggleGroupItem value="all">{t("modeAllDrives")}</ToggleGroupItem>
          </ToggleGroup>

          {scanMode === "all" && (
            <div className="rounded-md border border-warning/40 bg-warning-soft p-3 text-body-sm text-warning">
              {t("allDrivesWarning")}
            </div>
          )}

          {scanMode === "drives" && (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-body-sm font-semibold text-foreground">
                    {t("drivesPickerTitle")}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {t("drivesPickerDescription")}
                  </span>
                </div>
                {availableDrives.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setSelectedDrives([...availableDrives])}
                    >
                      {t("selectAllDrives")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedDrives([])}
                    >
                      {t("clearDrives")}
                    </Button>
                  </div>
                )}
              </div>

              {availableDrives.length === 0 ? (
                <p className="text-body-sm text-muted-foreground">{t("noDrivesDetected")}</p>
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {availableDrives.map((drive) => {
                    const checked = selectedDrives.includes(drive)
                    return (
                      <label
                        key={drive}
                        className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-card px-3.5 py-2.5 select-none hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(val) => toggleDrive(drive, val === true)}
                        />
                        <HardDriveIcon className="size-4 shrink-0 text-primary" aria-hidden />
                        <span className="font-mono text-body-sm font-semibold text-foreground">
                          {drive}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}

              {drivesError && (
                <p role="alert" className="text-caption text-destructive">
                  {drivesError}
                </p>
              )}
            </div>
          )}

          {scanMode === "custom" && (
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Input
                  value={newPathInput}
                  onChange={(e) => {
                    setNewPathInput(e.target.value)
                    if (addAttempted) setAddAttempted(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleAddPath()
                    }
                  }}
                  placeholder={t("pathPlaceholder")}
                  aria-label={t("pathPlaceholder")}
                  aria-invalid={livePathError ? true : undefined}
                  className="font-mono"
                />
                <Button type="button" variant="secondary" onClick={handleAddPath}>
                  <PlusIcon className="size-4" aria-hidden />
                  {t("addPath")}
                </Button>
              </div>
              {livePathError && (
                <p role="alert" className="text-caption text-destructive">
                  {tVal(livePathError)}
                </p>
              )}

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

              {customPathsError && (
                <p role="alert" className="text-caption text-destructive">
                  {customPathsError}
                </p>
              )}
            </div>
          )}

          {!behavior.advancedMode && (
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                {t("previewSaveCta")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {behavior.advancedMode && (
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
              <UnitNumberInput
                id="max-scan-depth"
                type="number"
                min={0}
                max={20}
                step={1}
                unit={t("depthUnit")}
                value={maxScanDepth}
                onChange={(e) => setMaxScanDepth(e.target.value)}
                error={depthError ? tVal(depthError) : null}
                hint={t("maxScanDepthHint")}
                containerClassName="max-w-56"
              />
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
                <UnitNumberInput
                  id="scan-timeout-ms"
                  type="number"
                  min={1000}
                  max={MAX_TIMEOUT_MS}
                  step={1000}
                  unit="ms"
                  value={scanTimeoutMs}
                  onChange={(e) => setScanTimeoutMs(e.target.value)}
                  error={scanTimeoutError ? tVal(scanTimeoutError) : null}
                  hint={formatDurationHintMs(scanTimeoutMs, locale)}
                  containerClassName="max-w-64"
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
                <UnitNumberInput
                  id="npm-timeout-ms"
                  type="number"
                  min={1000}
                  max={MAX_TIMEOUT_MS}
                  step={1000}
                  unit="ms"
                  value={npmTimeoutMs}
                  onChange={(e) => setNpmTimeoutMs(e.target.value)}
                  error={npmTimeoutError ? tVal(npmTimeoutError) : null}
                  hint={formatDurationHintMs(npmTimeoutMs, locale)}
                  containerClassName="max-w-64"
                />
              )}
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                {t("previewSaveCta")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </form>
  )
}
