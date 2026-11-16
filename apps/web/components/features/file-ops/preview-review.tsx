"use client"

import { useId, useState, type RefObject } from "react"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { CleanupItems } from "@/components/features/file-ops/cleanup-items"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import type { FileOpsController } from "@/hooks/use-file-ops"
import type { FileOpsPreview } from "@/lib/api/types"
import {
  initialReviewSelection, isReviewTarget, reviewTotals,
} from "@/lib/file-ops/file-ops-list"
import { MAX_DELETE_PATHS } from "@/lib/file-ops/tree-selection"

const NOTHING_SELECTED: ReadonlySet<string> = new Set()

interface ReviewSelectionProps {
  controller: FileOpsController
  preview: FileOpsPreview
  actionRef: RefObject<HTMLButtonElement | null>
}

// Mốc của thời gian tương đối lấy từ preview: trang có thể đã mở từ lâu.
const previewTime = ({ startedAt, finishedAt }: FileOpsPreview): string => finishedAt ?? startedAt

// Khoá theo previewId và chỉ mount khi đo xong: lựa chọn ban đầu phải đọc từ danh sách đầy đủ.
function ReviewSelection({ controller, preview, actionRef }: ReviewSelectionProps) {
  const t = useTranslations("fileOps")
  const format = useFormatter()
  const allId = useId()
  const { state } = controller
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => initialReviewSelection(preview))
  const targets = preview.targets
  const eligible = targets.filter(isReviewTarget)
  const totals = reviewTotals(preview.targets, selected)
  const ready = state.phase === "reviewing" && !state.summarizing
  const tooMany = selected.size > MAX_DELETE_PATHS

  function toggle(path: string) {
    setSelected((previous) => {
      const next = new Set(previous)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  function toggleAll() {
    setSelected(selected.size === eligible.length ? new Set() : new Set(eligible.map(({ path }) => path)))
  }

  if (targets.length === 0) {
    if (preview.status === "failed") return null
    return <p className="text-body-sm text-muted-foreground">{t(preview.status === "cancelled" ? "empty.stoppedEarly" : "empty.noTargets")}</p>
  }

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <Checkbox id={allId} disabled={!ready || eligible.length === 0}
            checked={selected.size === 0 ? false : selected.size === eligible.length ? true : "indeterminate"}
            onCheckedChange={toggleAll} />
          <Label htmlFor={allId}>{t("actions.selectAll")}</Label>
        </div>
      </div>
      <p className="text-caption text-muted-foreground">{t("selection.estimateHint")}</p>
      <CleanupItems targets={targets} selected={selected} interaction={ready ? "ready" : "locked"}
        referenceTime={previewTime(preview)} onToggle={toggle} resourceKey={JSON.stringify([preview.source, preview.scanId])} />
      <div className="sticky bottom-0 flex min-w-0 flex-col gap-3 rounded-md border border-border bg-background p-4 text-body-sm">
        <ul className="flex min-w-0 flex-wrap gap-x-6 gap-y-2">
          <li>{t("selection.count", { count: totals.count, formattedCount: format.number(totals.count) })}</li>
          {totals.reclaimableBytes > 0 || totals.recycleBytes === 0 ? (
            <li>{t("selection.reclaimable")} <span className="font-semibold"><DiskSize bytes={totals.reclaimableBytes} /></span></li>
          ) : null}
          {totals.recycleBytes > 0 ? (
            <li>{t("selection.recycle")} <span className="font-semibold"><DiskSize bytes={totals.recycleBytes} /></span></li>
          ) : null}
        </ul>
        {tooMany ? <p role="alert">{t("selection.tooMany", { formattedLimit: format.number(MAX_DELETE_PATHS) })}</p> : null}
        <Button ref={actionRef} type="button" variant="destructive" className="self-start" disabled={!ready || selected.size === 0 || tooMany}
          onClick={() => void controller.summarize([...selected])}>
          {t("actions.review", { count: totals.count, formattedCount: format.number(totals.count) })}
        </Button>
      </div>
    </>
  )
}

export function PreviewReview({ controller, actionRef }: { controller: FileOpsController; actionRef: RefObject<HTMLButtonElement | null> }) {
  const { state } = controller
  const preview = state.preview

  if (preview === null) return null
  if (state.phase === "measuring") {
    return (
      <CleanupItems targets={preview.targets} selected={NOTHING_SELECTED}
        interaction="measuring" referenceTime={previewTime(preview)} onToggle={() => undefined} resourceKey={JSON.stringify([preview.source, preview.scanId])} />
    )
  }
  if (state.phase !== "reviewing" && state.phase !== "executing" && state.phase !== "unconfirmed") return null
  return (
    <ReviewSelection key={preview.previewId} controller={controller} preview={preview}
      actionRef={actionRef} />
  )
}
