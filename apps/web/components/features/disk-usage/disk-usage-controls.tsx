"use client"

import { useId, type FormEvent } from "react"
import { BookmarkCheckIcon, BookmarkPlusIcon, FolderIcon, PackageIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { DiskController } from "@/hooks/use-disk-usage"
import type { DiskView } from "@/lib/api/types"
import { diskMeasureDisabledReason } from "@/lib/ui/disabled-reasons"

interface DiskUsageControlsProps {
  controller: DiskController
  path: string
  view: DiskView
  primaryAction?: boolean
  canPinFavorite?: boolean
  isFavorited?: boolean
  onPathChange(path: string): void
  onViewChange(view: DiskView): void
  onMeasure(force: boolean): void
  onToggleFavorite?(): void
}

export function DiskUsageControls({
  controller,
  path,
  view,
  primaryAction = true,
  canPinFavorite = false,
  isFavorited = false,
  onPathChange,
  onViewChange,
  onMeasure,
  onToggleFavorite,
}: DiskUsageControlsProps) {
  const t = useTranslations("diskUsage")
  const tDisabled = useTranslations("disabledReasons")
  const pathId = useId()
  const hintId = useId()
  const { state } = controller
  const busy = state.phase !== "idle"
  const cancelPending = state.phase === "tracking" && state.cancelPending
  const busyReason = busy ? tDisabled(cancelPending ? "diskCancelling" : "diskRunning") : null
  const measureReasonKey = diskMeasureDisabledReason({
    busy,
    hasPath: Boolean(path.trim()),
    cancelPending,
  })
  const measureReason = measureReasonKey ? tDisabled(measureReasonKey) : null
  const cancelReason = cancelPending ? tDisabled("diskCancelling") : null

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!busy && path.trim()) onMeasure(false)
  }

  return (
    <form onSubmit={onSubmit} className="min-w-0 space-y-4 rounded-md border border-border bg-card p-4 text-card-foreground">
      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0 space-y-2">
          <Label htmlFor={pathId}>{t("controls.path")}</Label>
          <Input
            id={pathId}
            value={path}
            onChange={(event) => onPathChange(event.target.value)}
            disabled={busy}
            required
            maxLength={32768}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={hintId}
            className="min-w-0 font-mono"
          />
        </div>
        <div className="min-w-0 space-y-2">
          <span className="block text-body-sm font-medium text-foreground">{t("controls.view")}</span>
          <div
            role="group"
            aria-label={t("controls.view")}
            className="inline-flex h-10 w-full items-center gap-0.5 rounded-md border border-border bg-background p-1 md:w-auto"
          >
            <DisabledTooltip reason={busyReason} className="flex-1 md:flex-none">
              <Button
                type="button"
                size="sm"
                variant={view === "directory" ? "secondary" : "ghost"}
                aria-pressed={view === "directory"}
                disabled={busy}
                className="h-8 flex-1 rounded-sm px-3 md:flex-none"
                onClick={() => onViewChange("directory")}
              >
                <FolderIcon aria-hidden="true" />
                {t("views.directory")}
              </Button>
            </DisabledTooltip>
            <DisabledTooltip reason={busyReason} className="flex-1 md:flex-none">
              <Button
                type="button"
                size="sm"
                variant={view === "packages" ? "secondary" : "ghost"}
                aria-pressed={view === "packages"}
                disabled={busy}
                className="h-8 flex-1 rounded-sm px-3 md:flex-none"
                onClick={() => onViewChange("packages")}
              >
                <PackageIcon aria-hidden="true" />
                {t("views.packagesShort")}
              </Button>
            </DisabledTooltip>
          </div>
        </div>
      </div>
      <p id={hintId} className="text-caption text-muted-foreground">{t("controls.hint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <DisabledTooltip reason={measureReason}>
          <Button type="submit" variant={primaryAction ? "default" : "secondary"} disabled={busy || !path.trim()}>
            {t("actions.measure")}
          </Button>
        </DisabledTooltip>
        {state.job ? (
          <DisabledTooltip reason={busyReason}>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => onMeasure(true)}>
              {t("actions.recalculate")}
            </Button>
          </DisabledTooltip>
        ) : null}
        {canPinFavorite && onToggleFavorite && path.trim() ? (
          <DisabledTooltip reason={busyReason}>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              aria-pressed={isFavorited}
              onClick={onToggleFavorite}
            >
              {isFavorited ? <BookmarkCheckIcon aria-hidden="true" /> : <BookmarkPlusIcon aria-hidden="true" />}
              {t(isFavorited ? "favorites.pinned" : "favorites.pin")}
            </Button>
          </DisabledTooltip>
        ) : null}
        {state.phase === "tracking" ? (
          <DisabledTooltip reason={cancelReason}>
            <Button type="button" variant="secondary" disabled={state.cancelPending} onClick={() => void controller.cancel()}>
              {state.cancelPending ? t("status.cancelling") : t("actions.cancel")}
            </Button>
          </DisabledTooltip>
        ) : null}
        {state.phase === "tracking" && state.errorCode !== undefined ? (
          <Button type="button" variant="secondary" onClick={controller.retryPoll}>
            {t("actions.retryPoll")}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
