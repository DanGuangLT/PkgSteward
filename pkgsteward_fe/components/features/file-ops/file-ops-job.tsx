"use client"

import Link from "next/link"
import { useFormatter, useTranslations } from "next-intl"

import { DeleteConfirmDialog } from "@/components/features/file-ops/delete-confirm-dialog"
import { OperationResults } from "@/components/features/file-ops/operation-results"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { FileOpsController } from "@/hooks/use-file-ops"
import { fileOpsErrorKey } from "@/lib/file-ops/file-ops-list"
import { fileOpsStatusKey } from "@/lib/file-ops/file-ops-policy"

/** Phần chung của 2 màn hình: trạng thái, lỗi, nút dừng, dialog xác nhận và kết quả xoá. */
export function FileOpsJob({ controller, onStartOver }: { controller: FileOpsController; onStartOver(): void }) {
  const t = useTranslations("fileOps")
  const format = useFormatter()
  const { state, error } = controller
  const errorMessage = error ? t(fileOpsErrorKey(error, state)) : null
  const preview = state.preview
  const summary = state.phase === "reviewing" || state.phase === "executing" ? state.summary : null
  const pollPaused = (state.phase === "measuring" || state.phase === "operating") && state.errorCode !== undefined
  const stopping = state.phase === "operating" && (state.cancelPending || state.operation?.status === "stopping")
  const progress = preview?.progress
  const lostOperation = state.phase === "idle" && state.operation !== null
  const canStartOver = state.phase === "finished" || lostOperation

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p aria-live="polite" aria-atomic="true" className="text-body-sm">
        {t(fileOpsStatusKey(state))}
        {state.phase === "operating" && state.operation?.currentPath
          ? ` ${t("currentPath", { path: state.operation.currentPath })}` : null}
      </p>

      {state.phase === "measuring" && progress ? (
        <div className="min-w-0 space-y-2">
          <Progress value={progress.totalTargets === 0 ? 0 : (progress.measuredTargets / progress.totalTargets) * 100}
            aria-label={t("status.measuring")} />
          <p className="text-body-sm text-muted-foreground">{t("progress", {
            measured: format.number(progress.measuredTargets), total: format.number(progress.totalTargets),
          })}</p>
        </div>
      ) : null}

      {errorMessage && summary === null && state.phase !== "unconfirmed" ? (
        <div role="alert" className="min-w-0 space-y-3 rounded-md border border-border bg-muted p-4 text-body-sm">
          <p>{errorMessage}</p>
          {pollPaused ? <p>{t("errors.pollPaused")}</p> : null}
          {error && error.paths.length > 0 ? (
            <ul className="space-y-1 font-mono text-caption [overflow-wrap:anywhere]">
              {error.paths.map((path) => <li key={path}>{path}</li>)}
            </ul>
          ) : null}
          {error?.source === "start" && error.code === "NOT_FOUND" ? (
            <Button asChild variant="secondary"><Link href="/" prefetch={false}>{t("actions.toProjects")}</Link></Button>
          ) : null}
        </div>
      ) : null}

      {state.phase === "unconfirmed" ? (
        <div role="alert" className="min-w-0 space-y-3 rounded-md border border-border bg-muted p-4 text-body-sm">
          <p className="font-semibold">{t("unconfirmed.title")}</p>
          <p>{t("unconfirmed.description")}</p>
          {errorMessage ? <p>{errorMessage}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void controller.resendExecute()}>{t("actions.resend")}</Button>
            <Button type="button" variant="secondary" onClick={controller.abandon}>{t("actions.abandon")}</Button>
          </div>
        </div>
      ) : null}

      {state.phase === "measuring" || state.phase === "operating" ? (
        <div className="flex flex-wrap gap-2">
          {state.phase === "measuring" ? (
            <Button type="button" variant="secondary" disabled={state.cancelPending} onClick={() => void controller.cancelPreview()}>
              {t("actions.stopMeasuring")}
            </Button>
          ) : (
            <Button type="button" variant="secondary" disabled={stopping} onClick={() => void controller.cancelOperation()}>
              {t("actions.stopDeleting")}
            </Button>
          )}
          {pollPaused ? <Button type="button" variant="secondary" onClick={controller.retryPoll}>{t("actions.retryPoll")}</Button> : null}
        </div>
      ) : null}

      {summary && preview ? (
        <DeleteConfirmDialog previewId={preview.previewId} summary={summary} targets={preview.targets}
          pending={state.phase === "executing"} errorMessage={errorMessage}
          onConfirm={(confirmation) => void controller.execute(confirmation)} onCancel={controller.closeSummary} />
      ) : null}

      {state.operation ? <OperationResults operation={state.operation} /> : null}
      {canStartOver ? (
        <Button type="button" variant="secondary" className="self-start" onClick={onStartOver}>{t("actions.startOver")}</Button>
      ) : null}
    </div>
  )
}
