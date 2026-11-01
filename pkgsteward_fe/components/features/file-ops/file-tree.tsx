"use client"

import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon, Link2Icon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import type { FileTreeController } from "@/hooks/use-file-tree"
import type { FileTreeEntry } from "@/lib/api/types"
import { treeCheckState } from "@/lib/file-ops/tree-selection"
import { cn } from "@/lib/utils"

interface FileTreeProps {
  root: string
  tree: FileTreeController
  selected: ReadonlySet<string>
  onToggle(entry: FileTreeEntry): void
}

function EntryIcon({ entry }: { entry: FileTreeEntry }) {
  const Icon = entry.type === "directory" ? FolderIcon : entry.type === "link" ? Link2Icon : FileIcon
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
}

function TreeRow({ entry, ...tree }: FileTreeProps & { entry: FileTreeEntry }) {
  const t = useTranslations("fileOps")
  const open = tree.tree.expanded.has(entry.path)
  const state = treeCheckState(tree.selected, entry.path)
  const checkboxId = `tree-${entry.path}`

  return (
    <li className="min-w-0">
      <div className="flex min-w-0 items-center gap-2 py-1">
        {entry.type === "directory" ? (
          <Button type="button" variant="ghost" size="icon-sm" aria-expanded={open}
            aria-label={t(open ? "actions.collapse" : "actions.expand", { name: entry.name })}
            onClick={() => tree.tree.toggleExpanded(entry.path)}>
            {open ? <ChevronDownIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
          </Button>
        ) : <span aria-hidden="true" className="size-8 shrink-0" />}
        <Checkbox id={checkboxId} disabled={!entry.selectable}
          checked={state === "indeterminate" ? "indeterminate" : state === "checked"}
          onCheckedChange={() => tree.onToggle(entry)} />
        <EntryIcon entry={entry} />
        <div className="min-w-0 flex-1">
          <Label htmlFor={checkboxId} className={cn(
            "block font-mono text-body-sm leading-snug font-normal [overflow-wrap:anywhere]",
            !entry.selectable && "text-muted-foreground"
          )}>
            {entry.name}
          </Label>
          {entry.type === "link" ? <p className="text-caption text-muted-foreground">{t("tree.link")}</p> : null}
        </div>
        {entry.sizeBytes !== null ? <span className="shrink-0 text-caption text-muted-foreground"><DiskSize bytes={entry.sizeBytes} /></span> : null}
      </div>
      {open ? <TreeLevelView {...tree} path={entry.path} /> : null}
    </li>
  )
}

function TreeLevelView({ path, ...tree }: FileTreeProps & { path: string }) {
  const t = useTranslations("fileOps")
  const format = useFormatter()
  const level = tree.tree.levels.get(path)

  if (!level || level.status === "loading") {
    return <div role="status" className="space-y-2 py-2 pl-10" aria-label={t("tree.loading")}><Skeleton className="h-5 w-48 max-w-full" /></div>
  }
  if (level.status === "failed") {
    return (
      <div role="alert" className="space-y-2 py-2 pl-10 text-body-sm">
        <p>{t(level.code === "NOT_FOUND" ? "tree.gone" : level.code === "BACKEND_UNAVAILABLE" ? "errors.backendUnavailable" : "tree.failed")}</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => tree.tree.retry(path)}>{t("actions.retryTree")}</Button>
      </div>
    )
  }
  if (level.entries.length === 0) return <p className="py-2 pl-10 text-body-sm text-muted-foreground">{t("tree.empty")}</p>

  return (
    <>
      <ul className={path === tree.root ? "min-w-0" : "min-w-0 pl-4 sm:pl-6"}>
        {level.entries.map((entry) => <TreeRow key={entry.path} {...tree} entry={entry} />)}
      </ul>
      {level.truncated ? <p className="py-2 pl-10 text-body-sm text-muted-foreground">{t("tree.truncated", { limit: format.number(2000) })}</p> : null}
    </>
  )
}

export function FileTree(props: FileTreeProps) {
  return <div className="min-w-0 rounded-md bg-card p-2 text-card-foreground sm:p-4"><TreeLevelView {...props} path={props.root} /></div>
}
