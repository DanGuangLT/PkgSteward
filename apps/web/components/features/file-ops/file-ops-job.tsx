"use client"

import Link from "next/link"
import { useRef, type RefObject } from "react"
import { useFormatter, useTranslations } from "next-intl"

import { DeleteConfirmDialog } from "@/components/features/file-ops/delete-confirm-dialog"
import { OperationResults } from "@/components/features/file-ops/operation-results"
import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { FileOpsController } from "@/hooks/use-file-ops"
import { fileOpsErrorKey } from "@/lib/file-ops/file-ops-list"
import { fileOpsStatusKey } from "@/lib/file-ops/file-ops-policy"
import { cn } from "@/lib/utils"

interface FileOpsJobProps {
  controller: FileOpsController
  returnFocusRef: RefObject<HTMLElement | null>
  onStartOver(): void
}

/** Phần chung của 2 màn hình: trạng thái, lỗi, nút dừng, dialog xác nhận và kết quả xoá. */
export function FileOpsJob({ controller, returnFocusRef, onStartOver }: FileOpsJobProps) {
  const t = useTranslations("fileOps")
  const tDisabled = useTranslations("disabledReasons")
  const format = useFormatter()
  const { state, error } = controller
  const errorMessage = error ? t(fileOpsErrorKey(error, state)) : null
  const preview = state.preview
  const summary = state.phase === "reviewing" || state.phase === "executing" ? state.summary : null
  const pollPaused = (state.phase === "measuring" || state.phase === "operating") && state.errorCode !== undefined
  const stopping = state.phase === "operating" && (state.cancelPending || state.operation?.status === "stopping")
  const progress = preview?.progress
  const canStartOver = state.phase === "finished" || state.phase === "lost"
  const statusRef = useRef<HTMLParagraphElement>(null)

  const measurePercent = progress && progress.totalTargets > 0
    ? Math.min(100, Math.round((progress.measuredTargets / progress.totalTargets) * 100))
    : 0
  const opTotal = state.phase === "operating" ? state.operation?.results.length ?? 0 : 0
  const opDone = state.phase === "operating"
    ? (state.operation?.results.filter((r) => r.status !== "pending" && r.status !== "running").length ?? 0)
    : 0
  const opPercent = opTotal > 0 ? Math.min(100, Math.round((opDone / opTotal) * 100)) : 0
  const isIdle = state.phase === "idle"

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div
        className={cn(
          "flex min-w-0 flex-col gap-3 text-body-sm",
          isIdle ? "sr-only" : "rounded-md border border-border bg-card p-4",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            ref={statusRef}
            tabIndex={-1}
            aria-live="polite"
            aria-atomic="true"
            className="scroll-mt-24 rounded-sm font-semibold text-foreground focus-ring"
          >
            {t(fileOpsStatusKey(state))}
          </p>
          {state.phase === "measuring" && progress ? (
            <p className="text-caption font-medium text-muted-foreground">
              {t("progress", {
                measured: format.number(progress.measuredTargets),
                total: format.number(progress.totalTargets),
              })}
            </p>
          ) : null}
        </div>

        {state.phase === "measuring" && progress ? (
          <Progress value={measurePercent} aria-label={t("status.measuring")} />
        ) : null}

        {state.phase === "operating" && opTotal > 0 ? (
          <Progress value={opPercent} aria-label={t("status.deleting")} />
        ) : null}

        {state.phase === "operating" && state.operation?.currentPath ? (
          <p className="font-mono text-caption text-muted-foreground [overflow-wrap:anywhere]">
            {t("currentPath", { path: state.operation.currentPath })}
          </p>
        ) : null}

        {state.phase === "measuring" || state.phase === "operating" || canStartOver ? (
          <div className="flex flex-wrap gap-2">
            {state.phase === "measuring" ? (
              <DisabledTooltip reason={state.cancelPending ? tDisabled("stopping") : null}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={state.cancelPending}
                  onClick={() => void controller.cancelPreview()}
                >
                  {t("actions.stopMeasuring")}
                </Button>
              </DisabledTooltip>
            ) : null}
            {state.phase === "operating" ? (
              <DisabledTooltip reason={stopping ? tDisabled("stopping") : null}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={stopping}
                  onClick={() => void controller.cancelOperation()}
                >
                  {t("actions.stopDeleting")}
                </Button>
              </DisabledTooltip>
            ) : null}
            {pollPaused ? (
              <Button type="button" variant="secondary" size="sm" onClick={controller.retryPoll}>
                {t("actions.retryPoll")}
              </Button>
            ) : null}
            {canStartOver ? (
              <>
                <Button type="button" variant="secondary" size="sm" onClick={onStartOver}>
                  {t("actions.startOver")}
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/" prefetch={false}>{t("actions.toProjects")}</Link>
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {errorMessage && summary === null && state.phase !== "unconfirmed" ? (
        <div role="alert" className="min-w-0 space-y-3 rounded-md border border-destructive/50 bg-card p-4 text-body-sm">
          <p className="font-semibold text-destructive">{errorMessage}</p>
          {pollPaused ? <p className="text-muted-foreground">{t("errors.pollPaused")}</p> : null}
          {error && error.paths.length > 0 ? (
            <ul className="space-y-1 font-mono text-caption [overflow-wrap:anywhere]">
              {error.paths.map((path) => <li key={path}>{path}</li>)}
            </ul>
          ) : null}
          {error?.source === "start" && error.code === "NOT_FOUND" ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/" prefetch={false}>{t("actions.toProjects")}</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {state.phase === "unconfirmed" ? (
        <div role="alert" className="min-w-0 space-y-3 rounded-md border border-border bg-muted p-4 text-body-sm">
          <p className="font-semibold">{t("unconfirmed.title")}</p>
          <p>{t("unconfirmed.description")}</p>
          {errorMessage ? <p>{errorMessage}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void controller.resendExecute()}>
              {t("actions.resend")}
            </Button>
            {/* Lệnh xoá có thể đã chạy: làm mới luôn dữ liệu đang hiện. */}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                controller.abandon()
                onStartOver()
              }}
            >
              {t("actions.abandon")}
            </Button>
          </div>
        </div>
      ) : null}

      {summary && preview ? (
        <DeleteConfirmDialog
          previewId={preview.previewId}
          summary={summary}
          targets={preview.targets}
          pending={state.phase === "executing"}
          errorMessage={errorMessage}
          returnFocusRef={returnFocusRef}
          revealRef={statusRef}
          onConfirm={(confirmation) => void controller.execute(confirmation)}
          onCancel={controller.closeSummary}
        />
      ) : null}

      {state.operation ? <OperationResults operation={state.operation} /> : null}
    </div>
  )
}
