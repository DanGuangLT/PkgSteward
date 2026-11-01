"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { useFormatter, useTranslations } from "next-intl"

import { FileOpsJob } from "@/components/features/file-ops/file-ops-job"
import { FileTree } from "@/components/features/file-ops/file-tree"
import { PreviewReview } from "@/components/features/file-ops/preview-review"
import { Button } from "@/components/ui/button"
import { useFileOps } from "@/hooks/use-file-ops"
import { useFileTree } from "@/hooks/use-file-tree"
import type { FileTreeEntry, ScannedProject } from "@/lib/api/types"
import { MAX_DELETE_PATHS, toggleTreePath } from "@/lib/file-ops/tree-selection"

export function FilesPanel({ project, referenceTime }: { project: ScannedProject; referenceTime: string }) {
  const t = useTranslations("fileOps")
  const format = useFormatter()
  const router = useRouter()
  const controller = useFileOps()
  const tree = useFileTree(project.path)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const { state } = controller
  const picking = state.operation === null && (state.phase === "idle" || state.phase === "starting")
  const busy = state.phase === "starting"
  const count = selected.size
  const tooMany = count > MAX_DELETE_PATHS

  function toggle(entry: FileTreeEntry) {
    setSelected((previous) => toggleTreePath(previous, entry, tree.childrenOf))
  }

  // Làm mới dữ liệu trang ở đây, không phải lúc xoá xong: project vừa xoá sẽ làm mất bảng kết quả.
  function startOver() {
    controller.reset()
    setSelected(new Set())
    tree.reload()
    router.refresh()
  }

  return (
    <section className="flex min-w-0 flex-col gap-6" aria-label={t("files.title")}>
      <div className="min-w-0 space-y-1">
        <p className="text-heading-md [overflow-wrap:anywhere]">{project.name ?? project.path}</p>
        <p className="font-mono text-caption text-muted-foreground [overflow-wrap:anywhere]">{project.path}</p>
      </div>
      <p className="text-body-sm text-muted-foreground">{t("files.description")}</p>

      <FileOpsJob controller={controller} onStartOver={startOver} />
      <PreviewReview controller={controller} referenceTime={referenceTime} />
      {state.phase === "reviewing" ? (
        <Button type="button" variant="secondary" className="self-start" onClick={controller.reset}>{t("actions.backToTree")}</Button>
      ) : null}

      {picking ? (
        <>
          <div className="flex flex-wrap gap-2">
            {project.nodeModules.exists ? (
              <Button type="button" variant="secondary" disabled={busy}
                onClick={() => void controller.startDelete([project.nodeModules.path])}>{t("actions.deleteNodeModules")}</Button>
            ) : null}
            <Button type="button" variant="secondary" disabled={busy}
              onClick={() => void controller.startDelete([project.path])}>{t("actions.deleteProject")}</Button>
          </div>
          <FileTree root={project.path} tree={tree} selected={selected} onToggle={toggle} />
          <div className="sticky bottom-0 flex min-w-0 flex-col gap-3 rounded-md border border-border bg-background p-4 text-body-sm">
            <p>{t("selection.count", { count, formattedCount: format.number(count) })}</p>
            {tooMany ? <p role="alert">{t("selection.tooMany", { formattedLimit: format.number(MAX_DELETE_PATHS) })}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy || count === 0 || tooMany}
                onClick={() => void controller.startDelete([...selected])}>
                {t("actions.previewSelection", { count, formattedCount: format.number(count) })}
              </Button>
              <Button type="button" variant="secondary" disabled={busy || count === 0} onClick={() => setSelected(new Set())}>
                {t("actions.clearSelection")}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
