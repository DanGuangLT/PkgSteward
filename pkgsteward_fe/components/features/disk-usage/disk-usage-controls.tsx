"use client"

import { useId, type FormEvent } from "react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { DiskController } from "@/hooks/use-disk-usage"
import type { DiskView } from "@/lib/api/types"

interface DiskUsageControlsProps {
  controller: DiskController
  path: string
  view: DiskView
  onPathChange(path: string): void
  onViewChange(view: DiskView): void
  onMeasure(force: boolean): void
}

export function DiskUsageControls({ controller, path, view, onPathChange, onViewChange, onMeasure }: DiskUsageControlsProps) {
  const t = useTranslations("diskUsage")
  const pathId = useId()
  const viewId = useId()
  const hintId = useId()
  const { state } = controller
  const busy = state.phase !== "idle"

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!busy && path.trim()) onMeasure(false)
  }

  return (
    <form onSubmit={onSubmit} className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-2">
          <Label htmlFor={pathId}>{t("controls.path")}</Label>
          <Input id={pathId} value={path} onChange={(event) => onPathChange(event.target.value)}
            disabled={busy} required maxLength={32768} autoComplete="off" spellCheck={false}
            aria-describedby={hintId} className="min-w-0 font-mono" />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor={viewId}>{t("controls.view")}</Label>
          <Select value={view} onValueChange={(value) => onViewChange(value as DiskView)} disabled={busy}>
            <SelectTrigger id={viewId} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="directory">{t("views.directory")}</SelectItem>
              <SelectItem value="packages">{t("views.packages")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p id={hintId} className="text-body-sm text-muted-foreground">{t("controls.hint")}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !path.trim()}>{t("actions.measure")}</Button>
        {state.job ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => onMeasure(true)}>{t("actions.recalculate")}</Button>
        ) : null}
        {state.phase === "tracking" ? (
          <Button type="button" variant="secondary" disabled={state.cancelPending} onClick={() => void controller.cancel()}>
            {state.cancelPending ? t("status.cancelling") : t("actions.cancel")}
          </Button>
        ) : null}
        {state.phase === "tracking" && state.errorCode !== undefined ? (
          <Button type="button" variant="secondary" onClick={controller.retryPoll}>{t("actions.retryPoll")}</Button>
        ) : null}
      </div>
    </form>
  )
}
