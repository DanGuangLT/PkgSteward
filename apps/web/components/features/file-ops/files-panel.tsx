"use client"

import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { EyeIcon, FolderXIcon, LockIcon, LockOpenIcon, Trash2Icon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { FileOpsJob } from "@/components/features/file-ops/file-ops-job"
import { FileTree } from "@/components/features/file-ops/file-tree"
import { PreviewReview } from "@/components/features/file-ops/preview-review"
import { ReturnLink } from "@/components/shared/return-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useFileOps } from "@/hooks/use-file-ops"
import { useFileTree } from "@/hooks/use-file-tree"
import { useRouteScrollContinuity } from "@/hooks/use-navigation-continuity"
import type { FileTreeEntry, ScannedProject } from "@/lib/api/types"
import { MAX_DELETE_PATHS, isInsidePath, toggleTreePath } from "@/lib/file-ops/tree-selection"
import { makeViewStateKey, type ResolvedReturnTarget } from "@/lib/ui/navigation-targets"

const DEFAULT_BACK_TARGET: ResolvedReturnTarget = { href: "/", originId: null, isFallback: true }

export function FilesPanel({
  project,
  backTarget = DEFAULT_BACK_TARGET,
  embedded = false,
  active = true,
}: {
  project: ScannedProject
  backTarget?: ResolvedReturnTarget
  embedded?: boolean
  active?: boolean
}) {
  const t = useTranslations("fileOps")
  const tNav = useTranslations("navigationState")
  const tCommon = useTranslations("common")
  const format = useFormatter()
  const router = useRouter()
  const controller = useFileOps()
  const tree = useFileTree(project.path)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const { state } = controller
  const reviewAction = useRef<HTMLButtonElement>(null)
  const picking = state.phase === "idle" || state.phase === "starting"
  const busy = state.phase === "starting"
  // Job là toàn cục: preview bắt đầu ở /cleanup có thể nối lại ngay trên trang này.
  const startedElsewhere = state.preview?.targets.some(({ path }) => (
    path !== project.path && !isInsidePath(project.path, path)
  ))
  const count = selected.size
  const tooMany = count > MAX_DELETE_PATHS

  useRouteScrollContinuity({
    routeKey: makeViewStateKey("files", project.path),
    ready: tree.levels.get(project.path)?.status !== "loading",
    active,
  })

  const backLabel = backTarget.isFallback || backTarget.href === "/" || backTarget.href.startsWith("/?")
    ? t("actions.toProjects")
    : backTarget.href.startsWith("/projects")
      ? tNav("backToProject")
      : tCommon("back")

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
    <section className="flex min-w-0 flex-col gap-5" aria-label={t("files.title")}>
      {!embedded ? (
        <ReturnLink href={backTarget.href} originId={backTarget.originId} className="self-start">
          {backLabel}
        </ReturnLink>
      ) : null}

      <div className="flex min-w-0 flex-col gap-4 rounded-md border border-border bg-card p-4 text-card-foreground md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1.5">
            <p className="text-heading-md [overflow-wrap:anywhere]">{project.name ?? project.path}</p>
            <p className="font-mono text-caption text-muted-foreground [overflow-wrap:anywhere]">{project.path}</p>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {project.packageManager ? <Badge variant="secondary">{project.packageManager}</Badge> : null}
              {project.hasLockfile ? (
                <Badge variant="success">
                  <LockIcon aria-hidden="true" />
                  {t("reviewTools.lockfileWith")}
                </Badge>
              ) : (
                <Badge variant="outline">
                  <LockOpenIcon aria-hidden="true" />
                  {t("reviewTools.lockfileWithout")}
                </Badge>
              )}
              {project.nodeModules.exists && project.nodeModules.sizeBytes !== null ? (
                <Badge variant="secondary" className="tabular-nums">
                  node_modules: <DiskSize bytes={project.nodeModules.sizeBytes} />
                </Badge>
              ) : null}
            </div>
          </div>

          {picking ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {project.nodeModules.exists ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void controller.startDelete([project.nodeModules.path])}
                >
                  <FolderXIcon aria-hidden="true" />
                  {t("actions.deleteNodeModules")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void controller.startDelete([project.path])}
              >
                <Trash2Icon aria-hidden="true" />
                {t("actions.deleteProject")}
              </Button>
            </div>
          ) : null}
        </div>
        <p className="border-t border-border/60 pt-3 text-caption text-muted-foreground">
          {t("files.description")}
        </p>
      </div>

      <FileOpsJob controller={controller} returnFocusRef={reviewAction} onStartOver={startOver} />
      {startedElsewhere ? (
        <p role="status" className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-body-sm font-semibold text-warning">
          {t("files.otherPreview")}
        </p>
      ) : null}
      <PreviewReview controller={controller} actionRef={reviewAction} />
      {state.phase === "reviewing" ? (
        <Button type="button" variant="secondary" className="self-start" onClick={controller.reset}>
          {t("actions.backToTree")}
        </Button>
      ) : null}

      {picking ? (
        <>
          <FileTree root={project.path} tree={tree} selected={selected} onToggle={toggle} />
          <div className="sticky bottom-0 z-20 flex min-w-0 flex-col gap-3 rounded-md border border-border bg-background/95 p-4 text-body-sm shadow-modal backdrop-blur-xs">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="font-semibold text-foreground">
                  {t("selection.count", { count, formattedCount: format.number(count) })}
                </p>
                {tooMany ? (
                  <p role="alert" className="text-caption font-semibold text-destructive">
                    {t("selection.tooMany", { formattedLimit: format.number(MAX_DELETE_PATHS) })}
                  </p>
                ) : (
                  <p className="text-caption text-muted-foreground">{t("files.selectionHint")}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {count > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setSelected(new Set())}
                  >
                    {t("actions.clearSelection")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  disabled={busy || count === 0 || tooMany}
                  onClick={() => void controller.startDelete([...selected])}
                >
                  <EyeIcon aria-hidden="true" />
                  {t("actions.previewSelection", { count, formattedCount: format.number(count) })}
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
