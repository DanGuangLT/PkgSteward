"use client"

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"

import { CLEANUP_KINDS, CleanupFilters } from "@/components/features/file-ops/cleanup-filters"
import { FileOpsJob } from "@/components/features/file-ops/file-ops-job"
import { PreviewReview } from "@/components/features/file-ops/preview-review"
import { useFileOps } from "@/hooks/use-file-ops"
import { cleanupPreviewInput, type CleanupFilterForm } from "@/lib/file-ops/file-ops-list"

export function CleanupPanel() {
  const t = useTranslations("fileOps")
  const controller = useFileOps()
  const { state } = controller
  const reviewAction = useRef<HTMLButtonElement>(null)
  const [form, setForm] = useState<CleanupFilterForm>({ kinds: [...CLEANUP_KINDS], olderThanDays: "", minSizeMib: "" })
  const input = cleanupPreviewInput(form)
  const idle = state.phase === "idle" || state.phase === "reviewing" || state.phase === "finished"

  return (
    <section className="flex min-w-0 flex-col gap-6" aria-label={t("cleanup.title")}>
      <p className="text-body-sm text-muted-foreground">{t("cleanup.description")}</p>
      <CleanupFilters form={form} disabled={!idle} invalid={input === null} onChange={setForm}
        onSubmit={() => { if (input) void controller.startCleanup(input) }} />
      <FileOpsJob controller={controller} returnFocusRef={reviewAction} onStartOver={controller.reset} />
      <PreviewReview controller={controller} actionRef={reviewAction} />
    </section>
  )
}
