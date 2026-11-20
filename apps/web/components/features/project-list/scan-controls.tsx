"use client"

import { FolderSearchIcon, Loader2Icon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import { Button } from "@/components/ui/button"
import type { ScanController } from "@/hooks/use-scan"
import { scanStartDisabledReason } from "@/lib/ui/disabled-reasons"

interface ScanControlsProps {
  controller: ScanController
  mode: "first" | "rescan"
}

export function ScanControls({ controller, mode }: ScanControlsProps) {
  const t = useTranslations("projects")
  const tDisabled = useTranslations("disabledReasons")
  const format = useFormatter()
  const { state } = controller
  const tracking = state.phase === "tracking" ? state : null
  const job = tracking?.job ?? (state.phase === "refreshing" ? state.job : null)
  const startReasonKey = scanStartDisabledReason(state.phase, tracking?.cancelPending ?? false)
  const startDisabledReason = startReasonKey ? tDisabled(startReasonKey) : null
  const cancelDisabledReason = tracking?.cancelPending ? tDisabled("scanCancelling") : null
  const status = state.phase === "starting" ? t("status.starting")
    : state.phase === "refreshing" ? t("status.refreshing")
      : tracking?.cancelPending ? t("status.cancelling")
        : tracking?.pollErrorCode !== undefined ? t("errors.pollFailed")
          : t("status.running")

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <DisabledTooltip reason={startDisabledReason}>
          <Button type="button" disabled={state.phase !== "idle"} onClick={() => void controller.start()}>
            <FolderSearchIcon aria-hidden="true" />
            {t(mode === "first" ? "actions.first" : "actions.rescan")}
          </Button>
        </DisabledTooltip>
        {tracking ? (
          <>
            <DisabledTooltip reason={cancelDisabledReason}>
              <Button type="button" variant="secondary" disabled={tracking.cancelPending}
                onClick={() => void controller.cancel()}>
                {t("actions.cancel")}
              </Button>
            </DisabledTooltip>
            {tracking.pollErrorCode !== undefined ? (
              <DisabledTooltip reason={cancelDisabledReason}>
                <Button type="button" variant="secondary" disabled={tracking.cancelPending}
                  onClick={controller.retryPoll}>
                  {t("actions.retryPoll")}
                </Button>
              </DisabledTooltip>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="space-y-2 text-body-sm text-muted-foreground">
        {/* Chỉ dòng trạng thái là live; bộ đếm đổi mỗi giây nên không đọc lại liên tục. */}
        <div role="status" aria-live="polite" aria-atomic="true">
          {state.phase !== "idle" ? (
            <p className="flex items-start gap-2">
              {tracking?.pollErrorCode === undefined || tracking.cancelPending ? (
                <Loader2Icon aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
              ) : null}
              {status}
            </p>
          ) : null}
        </div>
        {state.phase !== "idle" && (tracking || job) ? (
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {(["visitedDirs", "foundProjects", "skippedCount"] as const).map((key) => {
              const count = job?.progress[key] ?? 0
              return <li key={key}>{t(`progress.${key}`, { count, formattedCount: format.number(count) })}</li>
            })}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
