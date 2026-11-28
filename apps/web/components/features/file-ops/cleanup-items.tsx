"use client"

import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  FolderKanbanIcon,
  FolderOpenIcon,
  LockIcon,
  LockOpenIcon,
} from "lucide-react"
import { useFormatter, useLocale, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { RiskBadge, RiskReasons } from "@/components/features/file-ops/risk-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { FileOpsTarget } from "@/lib/api/types"
import {
  defaultCleanupSortDirection,
  fileManagerHref,
  formatRelativeDays,
  groupTargetsByOwner,
  isReviewTarget,
  projectInspectHref,
  targetDisplayName,
  targetFailureKey,
  type CleanupSort,
  type CleanupSortDirection,
} from "@/lib/file-ops/file-ops-list"
import { cn } from "@/lib/utils"

type TriState = boolean | "indeterminate"

function isInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest("a, button, input, label, [role='checkbox']") !== null
}

function withReturnTo(href: string, returnTo: string): string {
  const url = new URL(href, "http://127.0.0.1")
  url.searchParams.set("returnTo", returnTo)
  return `${url.pathname}${url.search}`
}

function TargetSizeCell({ target, maxBytes }: { target: FileOpsTarget; maxBytes: number }) {
  const t = useTranslations("fileOps")
  const format = useFormatter()
  const { size, method } = target
  if (size.status !== "done") {
    return <span className="text-caption text-muted-foreground">{t(`targets.${size.status}`)}</span>
  }
  const bytes = size.reclaimableBytes
  const ratio = bytes !== null && maxBytes > 0 ? Math.min(100, Math.max(4, Math.round((bytes / maxBytes) * 100))) : 0

  return (
    <div className="min-w-28 space-y-1">
      <p className="font-semibold tabular-nums text-foreground">
        {bytes === null ? t("targets.noData") : <DiskSize bytes={bytes} />}
      </p>
      {bytes !== null && maxBytes > 0 ? (
        <div className="h-1.5 w-full max-w-28 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
          <div className="h-full rounded-full bg-foreground" style={{ width: `${ratio}%` }} />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
        {method === "recycle" ? <span>{t("targets.onEmptyBin")}</span> : null}
        {size.sharedBytes !== null && size.sharedBytes > 0 ? (
          <span>
            <DiskSize bytes={size.sharedBytes} /> {t("targets.shared")}
          </span>
        ) : null}
        {size.fileCount !== null && size.fileCount > 0 ? (
          <span>{t("reviewTools.fileCount", { formattedCount: format.number(size.fileCount) })}</span>
        ) : null}
      </div>
    </div>
  )
}

function TargetActivityCell({ isoDate, referenceNowMs }: { isoDate: string | null; referenceNowMs: number }) {
  const t = useTranslations("fileOps")
  const format = useFormatter()
  if (!isoDate) return <span className="text-muted-foreground">—</span>
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) return <span className="text-muted-foreground">—</span>
  const days = formatRelativeDays(isoDate, referenceNowMs)
  return (
    <div className="space-y-0.5 whitespace-nowrap">
      <time dateTime={isoDate} className="block font-medium text-foreground">
        {days === null ? "—" : days === 0 ? t("reviewTools.today") : t("reviewTools.daysAgo", { days: format.number(days) })}
      </time>
      <p className="text-caption text-muted-foreground">{format.dateTime(parsed, { dateStyle: "medium" })}</p>
    </div>
  )
}

function TargetIdentity({ target, compact = false }: { target: FileOpsTarget; compact?: boolean }) {
  const t = useTranslations("fileOps")
  const displayName = targetDisplayName(target)
  return (
    <div className="min-w-0 space-y-1.5">
      {!compact ? (
        <p className="font-semibold text-foreground [overflow-wrap:anywhere]">{displayName}</p>
      ) : null}
      <p className="font-mono text-caption text-muted-foreground [overflow-wrap:anywhere]">{target.path}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {target.kind ? <Badge variant="secondary">{t(`kinds.${target.kind}`)}</Badge> : null}
        {target.method ? <Badge variant="outline">{t(`method.${target.method}`)}</Badge> : null}
        {target.hasLockfile === true ? (
          <Badge variant="success">
            <LockIcon aria-hidden="true" />
            {t("reviewTools.lockfileWith")}
          </Badge>
        ) : target.hasLockfile === false ? (
          <Badge variant="outline">
            <LockOpenIcon aria-hidden="true" />
            {t("reviewTools.lockfileWithout")}
          </Badge>
        ) : null}
      </div>
      {!target.valid ? (
        <p className="text-caption font-medium text-destructive">{t(targetFailureKey(target.failureCode))}</p>
      ) : null}
    </div>
  )
}

function InspectLinks({ ownerPath, ownerLabel, returnTo }: { ownerPath: string | null; ownerLabel: string; returnTo: string }) {
  const t = useTranslations("fileOps")
  if (!ownerPath) return null
  const inspectLabel = `${t("reviewTools.inspectProject")}: ${ownerLabel}`
  const filesLabel = `${t("reviewTools.openFiles")}: ${ownerLabel}`
  return (
    <div
      className="flex shrink-0 items-center gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      <Button asChild size="icon-sm" variant="ghost" title={inspectLabel}>
        <Link href={projectInspectHref(ownerPath, returnTo)} aria-label={inspectLabel}>
          <FolderKanbanIcon aria-hidden="true" />
        </Link>
      </Button>
      <Button asChild size="icon-sm" variant="ghost" title={filesLabel}>
        <Link href={withReturnTo(fileManagerHref(ownerPath), returnTo)} aria-label={filesLabel}>
          <FolderOpenIcon aria-hidden="true" />
        </Link>
      </Button>
    </div>
  )
}

function SortableHeader({
  column,
  label,
  activeSort,
  direction,
  onSort,
}: {
  column: CleanupSort
  label: string
  activeSort: CleanupSort | undefined
  direction: CleanupSortDirection
  onSort: ((column: CleanupSort) => void) | undefined
}) {
  if (!onSort) return <TableHead scope="col">{label}</TableHead>
  const isSorted = activeSort === column
  const ariaSort = isSorted ? (direction === "asc" ? "ascending" : "descending") : undefined
  return (
    <TableHead scope="col" aria-sort={ariaSort} className="p-0">
      <button
        type="button"
        onClick={() => onSort(column)}
        className="flex h-full min-h-10 w-full items-center gap-1.5 px-3 py-2 text-left text-caption font-semibold text-foreground transition-colors focus-ring hover:bg-muted/60"
      >
        <span>{label}</span>
        {isSorted ? (
          direction === "asc" ? (
            <ArrowUpIcon className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ArrowDownIcon className="size-3.5 shrink-0" aria-hidden="true" />
          )
        ) : (
          <ArrowUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
    </TableHead>
  )
}

export function CleanupItems({
  targets,
  selected,
  disabled,
  referenceTime,
  maxTargetBytes = 0,
  sort,
  sortDir = "desc",
  viewMode = "list",
  visibleCheckState,
  showInspectLinks = false,
  returnTo = "/cleanup",
  onToggle,
  onRangeSelect,
  onToggleAllVisible,
  onToggleGroup,
  onSortChange,
}: {
  targets: readonly FileOpsTarget[]
  selected: ReadonlySet<string>
  disabled: boolean
  referenceTime: string
  maxTargetBytes?: number
  sort?: CleanupSort
  sortDir?: CleanupSortDirection
  viewMode?: "list" | "grouped"
  visibleCheckState?: TriState
  showInspectLinks?: boolean
  returnTo?: string
  onToggle: (path: string) => void
  onRangeSelect?: (anchorPath: string | null, targetPath: string, orderedPaths: readonly string[]) => void
  onToggleAllVisible?: () => void
  onToggleGroup?: (paths: readonly string[]) => void
  onSortChange?: (column: CleanupSort) => void
}) {
  const t = useTranslations("fileOps")
  const locale = useLocale()
  const format = useFormatter()
  const anchorRef = useRef<string | null>(null)
  const [sortAnnouncement, setSortAnnouncement] = useState("")

  const referenceNowMs = useMemo(() => {
    const parsed = Date.parse(referenceTime)
    return Number.isNaN(parsed) ? 0 : parsed
  }, [referenceTime])

  const hasEligibleTargets = useMemo(() => targets.some(isReviewTarget), [targets])

  const effectiveMaxBytes = useMemo(() => {
    if (maxTargetBytes > 0) return maxTargetBytes
    let max = 0
    for (const target of targets) {
      const bytes = target.size.reclaimableBytes ?? 0
      if (bytes > max) max = bytes
    }
    return max
  }, [maxTargetBytes, targets])

  const groups = useMemo(
    () => (viewMode === "grouped" ? groupTargetsByOwner(targets, locale) : []),
    [viewMode, targets, locale],
  )

  const orderedPaths = useMemo(
    () => (viewMode === "grouped"
      ? groups.flatMap((group) => group.targets.map((target) => target.path))
      : targets.map((target) => target.path)),
    [viewMode, groups, targets],
  )

  function handleTargetClick(path: string, shiftKey: boolean) {
    if (disabled) return
    if (shiftKey && onRangeSelect) {
      onRangeSelect(anchorRef.current, path, orderedPaths)
    } else {
      onToggle(path)
    }
    anchorRef.current = path
  }

  function handleSort(column: CleanupSort) {
    if (!onSortChange) return
    const nextDir: CleanupSortDirection = sort === column
      ? (sortDir === "asc" ? "desc" : "asc")
      : defaultCleanupSortDirection(column)
    const columnLabels: Record<CleanupSort, string> = {
      name: t("columns.target"),
      size: t("columns.reclaimable"),
      age: t("columns.activity"),
      risk: t("columns.risk"),
    }
    setSortAnnouncement(t("reviewTools.sortedAnnouncement", {
      column: columnLabels[column],
      direction: nextDir === "asc" ? t("reviewTools.sortAsc") : t("reviewTools.sortDesc"),
      count: format.number(targets.length),
    }))
    onSortChange(column)
  }

  if (viewMode === "grouped") {
    return (
      <div className="flex min-w-0 flex-col gap-4" role="region" aria-label={t("listLabel")}>
        {groups.map((group) => {
          const eligiblePaths = group.targets.filter(isReviewTarget).map((item) => item.path)
          const selectedCount = eligiblePaths.filter((path) => selected.has(path)).length
          const groupState: TriState = eligiblePaths.length > 0 && selectedCount === eligiblePaths.length
            ? true
            : selectedCount > 0
              ? "indeterminate"
              : false
          const groupTitle = group.isOrphanGroup
            ? t("reviewTools.orphanGroup")
            : (group.ownerName ?? group.ownerPath ?? "")

          return (
            <div key={group.key} className="overflow-hidden rounded-md border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  {onToggleGroup ? (
                    <Checkbox
                      checked={groupState}
                      disabled={disabled || eligiblePaths.length === 0}
                      aria-label={t("reviewTools.selectGroup", { name: groupTitle })}
                      onCheckedChange={() => onToggleGroup(eligiblePaths)}
                    />
                  ) : null}
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground [overflow-wrap:anywhere]">{groupTitle}</p>
                    {group.ownerPath ? (
                      <p className="font-mono text-caption text-muted-foreground [overflow-wrap:anywhere]">{group.ownerPath}</p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Badge variant="secondary">
                    {t("reviewTools.groupItems", { count: format.number(group.targets.length) })}
                  </Badge>
                  <span className="text-body-sm font-semibold tabular-nums text-foreground">
                    <DiskSize bytes={group.totalReclaimableBytes} />
                  </span>
                  {showInspectLinks ? <InspectLinks ownerPath={group.ownerPath} ownerLabel={groupTitle} returnTo={returnTo} /> : null}
                </div>
              </div>

              <ul className="divide-y divide-border">
                {group.targets.map((target) => {
                  const canPick = isReviewTarget(target) && !disabled
                  const isSelected = selected.has(target.path)
                  return (
                    <li
                      key={target.path}
                      onClick={(event) => {
                        if (!canPick || isInteractiveElement(event.target)) return
                        if (event.shiftKey) event.preventDefault()
                        handleTargetClick(target.path, event.shiftKey)
                      }}
                      className={cn(
                        "flex flex-col gap-3 px-4 py-3 transition-colors xl:flex-row xl:items-start xl:justify-between",
                        canPick ? "cursor-pointer hover:bg-muted/40" : "opacity-75",
                        isSelected && "bg-muted/60",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <Checkbox
                          className="mt-0.5"
                          checked={isSelected}
                          disabled={!canPick}
                          aria-label={t("actions.selectTarget", { path: target.path })}
                          onCheckedChange={() => handleTargetClick(target.path, false)}
                        />
                        <TargetIdentity target={target} compact />
                      </div>
                      <div className="flex min-w-0 flex-wrap items-start gap-4 pl-8 xl:shrink-0 xl:pl-0">
                        <TargetSizeCell target={target} maxBytes={effectiveMaxBytes} />
                        <TargetActivityCell isoDate={target.lastActivityAt} referenceNowMs={referenceNowMs} />
                        {target.valid ? (
                          <div className="min-w-28 max-w-64 space-y-1 [overflow-wrap:anywhere]">
                            <RiskBadge level={target.risk.level} />
                            <RiskReasons risk={target.risk} />
                          </div>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <p role="status" aria-live="polite" className="sr-only">{sortAnnouncement}</p>

      <div className="hidden rounded-md border border-border bg-card md:block">
        <Table
          containerProps={{
            tabIndex: 0,
            role: "region",
            "aria-label": t("listLabel"),
            className: "rounded-md focus-ring",
          }}
        >
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="w-11">
                {onToggleAllVisible && visibleCheckState !== undefined ? (
                  <Checkbox
                    checked={visibleCheckState}
                    disabled={disabled || !hasEligibleTargets}
                    aria-label={t("reviewTools.selectVisibleAll")}
                    onCheckedChange={onToggleAllVisible}
                  />
                ) : (
                  <span className="sr-only">{t("columns.select")}</span>
                )}
              </TableHead>
              <SortableHeader column="name" label={t("columns.target")} activeSort={sort} direction={sortDir} onSort={onSortChange ? handleSort : undefined} />
              <SortableHeader column="size" label={t("columns.reclaimable")} activeSort={sort} direction={sortDir} onSort={onSortChange ? handleSort : undefined} />
              <SortableHeader column="age" label={t("columns.activity")} activeSort={sort} direction={sortDir} onSort={onSortChange ? handleSort : undefined} />
              <SortableHeader column="risk" label={t("columns.risk")} activeSort={sort} direction={sortDir} onSort={onSortChange ? handleSort : undefined} />
              {showInspectLinks ? (
                <TableHead scope="col" className="w-20 text-right">{t("reviewTools.columnsActions")}</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {targets.map((target) => {
              const canPick = isReviewTarget(target) && !disabled
              const isSelected = selected.has(target.path)
              return (
                <TableRow
                  key={target.path}
                  data-state={isSelected ? "selected" : undefined}
                  onClick={(event) => {
                    if (!canPick || isInteractiveElement(event.target)) return
                    if (event.shiftKey) event.preventDefault()
                    handleTargetClick(target.path, event.shiftKey)
                  }}
                  className={cn(
                    canPick ? "cursor-pointer" : "opacity-75",
                    isSelected && "bg-muted/60",
                  )}
                >
                  <TableCell className="align-top pt-3.5">
                    <Checkbox
                      checked={isSelected}
                      disabled={!canPick}
                      aria-label={t("actions.selectTarget", { path: target.path })}
                      onCheckedChange={() => handleTargetClick(target.path, false)}
                    />
                  </TableCell>
                  <TableCell className="max-w-md whitespace-normal align-top">
                    <TargetIdentity target={target} />
                  </TableCell>
                  <TableCell className="align-top">
                    <TargetSizeCell target={target} maxBytes={effectiveMaxBytes} />
                  </TableCell>
                  <TableCell className="align-top">
                    <TargetActivityCell isoDate={target.lastActivityAt} referenceNowMs={referenceNowMs} />
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal align-top">
                    {target.valid ? (
                      <div className="space-y-1.5">
                        <RiskBadge level={target.risk.level} />
                        <RiskReasons risk={target.risk} />
                      </div>
                    ) : null}
                  </TableCell>
                  {showInspectLinks ? (
                    <TableCell className="align-top text-right">
                      <div className="flex justify-end">
                        <InspectLinks
                          ownerPath={target.owner?.path ?? null}
                          ownerLabel={targetDisplayName(target)}
                          returnTo={returnTo}
                        />
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <ul className="flex min-w-0 flex-col gap-3 md:hidden" aria-label={t("listLabel")}>
        {targets.map((target) => {
          const canPick = isReviewTarget(target) && !disabled
          const isSelected = selected.has(target.path)
          return (
            <li
              key={target.path}
              onClick={(event) => {
                if (!canPick || isInteractiveElement(event.target)) return
                handleTargetClick(target.path, false)
              }}
              className={cn(
                "flex min-w-0 flex-col gap-3 rounded-md border p-4 text-body-sm transition-colors",
                isSelected ? "border-foreground bg-muted/60" : "border-border bg-card",
                !canPick && "opacity-75",
              )}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  className="mt-0.5"
                  checked={isSelected}
                  disabled={!canPick}
                  aria-label={t("actions.selectTarget", { path: target.path })}
                  onCheckedChange={() => handleTargetClick(target.path, false)}
                />
                <div className="min-w-0 flex-1">
                  <TargetIdentity target={target} />
                </div>
                {showInspectLinks ? (
                  <InspectLinks
                    ownerPath={target.owner?.path ?? null}
                    ownerLabel={targetDisplayName(target)}
                    returnTo={returnTo}
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3 pl-8">
                <TargetSizeCell target={target} maxBytes={effectiveMaxBytes} />
                <TargetActivityCell isoDate={target.lastActivityAt} referenceNowMs={referenceNowMs} />
              </div>
              {target.valid ? (
                <div className="space-y-1.5 pl-8">
                  <RiskBadge level={target.risk.level} />
                  <RiskReasons risk={target.risk} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
