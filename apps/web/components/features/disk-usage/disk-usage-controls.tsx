"use client"

import { useId, type FormEvent } from "react"
import { BookmarkCheckIcon, BookmarkPlusIcon, FolderIcon, PackageIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { DiskController } from "@/hooks/use-disk-usage"
import type { DiskView } from "@/lib/api/types"

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
  const pathId = useId()
  const hintId = useId()
  const { state } = controller
  const busy = state.phase !== "idle"

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
          </div>
        </div>
      </div>
      <p id={hintId} className="text-caption text-muted-foreground">{t("controls.hint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant={primaryAction ? "default" : "secondary"} disabled={busy || !path.trim()}>
          {t("actions.measure")}
        </Button>
        {state.job ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => onMeasure(true)}>
            {t("actions.recalculate")}
          </Button>
        ) : null}
        {canPinFavorite && onToggleFavorite && path.trim() ? (
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
        ) : null}
        {state.phase === "tracking" ? (
          <Button type="button" variant="secondary" disabled={state.cancelPending} onClick={() => void controller.cancel()}>
            {state.cancelPending ? t("status.cancelling") : t("actions.cancel")}
          </Button>
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
