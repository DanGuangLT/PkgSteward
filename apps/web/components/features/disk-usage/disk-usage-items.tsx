"use client"

import Link from "next/link"
import { useId, useMemo, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  FolderOpenIcon,
  SparklesIcon,
} from "lucide-react"
import { useFormatter, useLocale, useTranslations } from "next-intl"

import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import { DiscoveryControls, DiscoveryEmpty, DiscoveryFilter, DiscoverySort } from "@/components/shared/list-discovery"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useViewState } from "@/hooks/use-navigation-continuity"
import type { DiskUsageJob, DiskUsageRow } from "@/lib/api/types"
import {
  defaultDiskSortDirection,
  DISK_DISCOVERY,
  DISK_KINDS,
  DISK_STATES,
  diskDiscoveryCodec,
  selectDiskRows,
  type DiskSort,
  type DiskSortDirection,
} from "@/lib/disk-usage/discovery"
import { diskSizeKind } from "@/lib/disk-usage/disk-usage-list"
import { diskRowBarWidthPercent, diskRowSharePercent } from "@/lib/disk-usage/disk-usage-metrics"
import { fileManagerHref } from "@/lib/file-ops/file-ops-list"
import { appendReturnContext, makeViewStateKey } from "@/lib/ui/navigation-targets"

export function DiskSize({ bytes, partial = false }: { bytes: number | null; partial?: boolean }) {
  const t = useTranslations("diskUsage")
  const format = useFormatter()
  const kind = diskSizeKind(bytes, partial)
  if (kind === "pending" || bytes === null) return <>{t("size.pending")}</>
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const
  const exponent = bytes === 0 ? 0 : Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)))
  const size = t("size.value", {
    value: format.number(bytes / 1024 ** exponent, {
      maximumFractionDigits: exponent === 0 ? 0 : 2,
      roundingMode: kind === "lower_bound" ? "floor" : "halfExpand",
    }),
    unit: units[exponent],
  })
  return <>{kind === "lower_bound" ? t("size.lowerBound", { size }) : size}</>
}

function DiskRowStatus({ row }: { row: DiskUsageRow }) {
  const t = useTranslations("diskUsage")
  const badgeVariant = row.state === "complete"
    ? "secondary"
    : row.state === "excluded"
      ? "outline"
      : "outline"
  return (
    <div className="space-y-1 text-body-sm">
      <Badge variant={badgeVariant} className="h-auto min-h-6 max-w-full whitespace-normal">
        {t(`rows.${row.state}`)}
      </Badge>
      {row.reason ? <p className="text-caption text-muted-foreground">{t(`reasons.${row.reason}`)}</p> : null}
    </div>
  )
}

function DiskRowSizeCell({
  row,
  maxBytes,
  totalBytes,
}: {
  row: DiskUsageRow
  maxBytes: number
  totalBytes: number | null
}) {
  const format = useFormatter()
  const share = diskRowSharePercent(row.sizeBytes, totalBytes)
  const width = diskRowBarWidthPercent(row.sizeBytes, maxBytes)

  return (
    <div className="min-w-28 space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-semibold tabular-nums text-foreground">
          <DiskSize bytes={row.sizeBytes} partial={row.state !== "complete"} />
        </span>
        {share !== null ? (
          <span className="text-caption tabular-nums text-muted-foreground">
            {format.number(share, { maximumFractionDigits: 1 })}%
          </span>
        ) : null}
      </div>
      {width > 0 ? (
        <div className="h-1.5 w-full max-w-32 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
          <div className="h-full rounded-full bg-foreground" style={{ width: `${width}%` }} />
        </div>
      ) : null}
    </div>
  )
}

function DiskRowName({
  row,
  onExpand,
  resultsId,
  canExpand,
  filesHref,
  showCleanupLink,
}: {
  row: DiskUsageRow
  onExpand(row: DiskUsageRow): void
  resultsId: string
  canExpand: boolean
  filesHref: string | null
  showCleanupLink: boolean
}) {
  const t = useTranslations("diskUsage")
  const tDisabled = useTranslations("disabledReasons")
  const expandable = row.state !== "excluded" && (row.kind === "directory" || row.kind === "package")
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="font-mono font-semibold text-foreground [overflow-wrap:anywhere]">{row.name}</p>
      <p className="text-caption text-muted-foreground">{t(`kinds.${row.kind}`)}</p>
      {row.aliases.length > 0 ? (
        <p className="font-mono text-caption text-muted-foreground [overflow-wrap:anywhere]">
          {t("aliases", { names: row.aliases.join(", ") })}
        </p>
      ) : null}
      {expandable || filesHref || showCleanupLink ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {expandable ? (
            <DisabledTooltip reason={!canExpand ? tDisabled("diskRunning") : null}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!canExpand}
                aria-label={t("actions.expandName", { name: row.name })}
                aria-controls={resultsId}
                onClick={() => onExpand(row)}
              >
                {t("actions.expand")}
              </Button>
            </DisabledTooltip>
          ) : null}
          {filesHref ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={filesHref} prefetch={false}>
                <FolderOpenIcon aria-hidden="true" />
                {t("actions.openFiles")}
              </Link>
            </Button>
          ) : null}
          {showCleanupLink ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/cleanup" prefetch={false}>
                <SparklesIcon aria-hidden="true" />
                {t("actions.openCleanup")}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function DiskFileCount({ count }: { count: number | null }) {
  const t = useTranslations("diskUsage")
  const format = useFormatter()
  return (
    <span className="tabular-nums">
      {count === null ? t("size.pending") : t("fileCount", { count, formattedCount: format.number(count) })}
    </span>
  )
}

function SortableHeader({
  column,
  label,
  activeSort,
  direction,
  onSort,
  className,
}: {
  column: DiskSort
  label: string
  activeSort: DiskSort
  direction: DiskSortDirection
  onSort(column: DiskSort): void
  className?: string
}) {
  const isSorted = activeSort === column
  const ariaSort = isSorted ? (direction === "asc" ? "ascending" : "descending") : undefined
  return (
    <TableHead scope="col" aria-sort={ariaSort} className={`p-0 ${className ?? ""}`}>
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

export function DiskUsageItems({
  job,
  resultsId,
  onExpand,
  interaction,
  scannedProjectPaths,
  returnTo,
}: {
  job: DiskUsageJob
  resultsId: string
  onExpand(row: DiskUsageRow): void
  interaction: "busy" | "ready"
  scannedProjectPaths?: ReadonlySet<string>
  returnTo?: string
}) {
  const t = useTranslations("diskUsage")
  const locale = useLocale()
  const format = useFormatter()
  const d = useTranslations("listDiscovery")
  const minId = useId()
  const [view, setView, reset] = useViewState(
    makeViewStateKey("disk-usage-items", JSON.stringify([job.path, job.view])),
    diskDiscoveryCodec,
    DISK_DISCOVERY,
  )
  const [sortAnnouncement, setSortAnnouncement] = useState("")
  const rows = useMemo(() => selectDiskRows(job.children, view, locale), [job.children, view, locale])
  const maxRowBytes = useMemo(() => {
    let max = 0
    for (const row of job.children) {
      if (row.sizeBytes !== null && row.sizeBytes > max) max = row.sizeBytes
    }
    return max
  }, [job.children])
  const canExpand = interaction === "ready" && job.status !== "running"

  function handleSort(column: DiskSort) {
    const nextDir: DiskSortDirection = view.sort === column
      ? (view.sortDir === "asc" ? "desc" : "asc")
      : defaultDiskSortDirection(column)
    const labels: Record<DiskSort, string> = {
      name: t("columns.name"),
      size: t("columns.size"),
      files: t("columns.fileCount"),
    }
    setSortAnnouncement(t("sort.announcement", {
      column: labels[column],
      direction: nextDir === "asc" ? t("sort.asc") : t("sort.desc"),
      count: format.number(rows.length),
    }))
    setView({ ...view, sort: column, sortDir: nextDir })
  }

  function rowLinks(row: DiskUsageRow) {
    const isScannedProject = row.kind === "directory" && scannedProjectPaths?.has(row.path.toLowerCase()) === true
    const filesHref = isScannedProject
      ? appendReturnContext(fileManagerHref(row.path), { returnTo })
      : null
    const showCleanupLink = row.kind === "directory" && row.name.toLowerCase() === "node_modules"
    return { filesHref, showCleanupLink }
  }

  return (
    <div className="min-w-0 space-y-4">
      <p role="status" aria-live="polite" className="sr-only">{sortAnnouncement}</p>

      <div className="rounded-md border border-border bg-card p-4">
        <DiscoveryControls
          query={view.query}
          onQueryChange={query => setView({ ...view, query })}
          count={rows.length}
          total={job.children.length}
          onReset={reset}
        >
          <DiscoveryFilter
            label={d("kinds")}
            value={view.kinds}
            options={DISK_KINDS.map(value => ({
              value,
              label: d(`values.${value}`),
              count: job.children.filter(row => row.kind === value).length,
            }))}
            onValueChange={kinds => setView({ ...view, kinds })}
          />
          <DiscoveryFilter
            label={d("states")}
            value={view.states}
            options={DISK_STATES.map(value => ({
              value,
              label: d(`values.${value}`),
              count: job.children.filter(row => row.state === value).length,
            }))}
            onValueChange={states => setView({ ...view, states })}
          />
          <div className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background px-3.5 py-2 text-body-sm transition-shadow focus-within:border-foreground focus-within:ring-2 focus-within:ring-ring sm:w-auto">
            <Label htmlFor={minId} className="shrink-0 text-body-sm font-semibold text-foreground">{d("minSize")}</Label>
            <input
              id={minId}
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={view.minSize}
              onChange={event => {
                const minSize = event.target.value
                if (/^\d{0,15}$/.test(minSize)) setView({ ...view, minSize })
              }}
              className="w-24 min-w-0 bg-transparent text-body-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <DiscoverySort
            value={view.sort}
            options={[
              { value: "size" as const, label: d("size") },
              { value: "files" as const, label: t("columns.fileCount") },
              { value: "name" as const, label: d("name") },
            ]}
            onValueChange={sort => setView({ ...view, sort, sortDir: defaultDiskSortDirection(sort) })}
          />
        </DiscoveryControls>
      </div>

      {rows.length === 0
        ? job.children.length === 0 && job.status === "running"
          ? <p className="text-body-sm">{t("empty.listing")}</p>
          : <DiscoveryEmpty total={job.children.length} />
        : null}

      {rows.length > 0 ? (
        <>
          <div className="hidden min-w-0 rounded-md border border-border bg-card text-card-foreground lg:block">
            <Table className="table-fixed">
              <TableCaption className="sr-only">{t("listLabel")}</TableCaption>
              <TableHeader>
                <TableRow>
                  <SortableHeader column="name" label={t("columns.name")} activeSort={view.sort} direction={view.sortDir} onSort={handleSort} className="w-1/4" />
                  <TableHead className="w-1/4 whitespace-normal" scope="col">{t("columns.path")}</TableHead>
                  <SortableHeader column="size" label={t("columns.size")} activeSort={view.sort} direction={view.sortDir} onSort={handleSort} className="w-1/5" />
                  <SortableHeader column="files" label={t("columns.fileCount")} activeSort={view.sort} direction={view.sortDir} onSort={handleSort} />
                  <TableHead className="whitespace-normal" scope="col">{t("columns.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const { filesHref, showCleanupLink } = rowLinks(row)
                  return (
                    <TableRow key={row.path}>
                      <TableCell className="align-top whitespace-normal">
                        <DiskRowName
                          row={row}
                          onExpand={onExpand}
                          resultsId={resultsId}
                          canExpand={canExpand}
                          filesHref={filesHref}
                          showCleanupLink={showCleanupLink}
                        />
                      </TableCell>
                      <TableCell className="align-top font-mono text-caption text-muted-foreground whitespace-normal [overflow-wrap:anywhere]">
                        {row.path}
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <DiskRowSizeCell row={row} maxBytes={maxRowBytes} totalBytes={job.sizeBytes} />
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <DiskFileCount count={row.fileCount} />
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <DiskRowStatus row={row} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <ul className="grid min-w-0 gap-3 lg:hidden" aria-label={t("listLabel")}>
            {rows.map((row) => {
              const { filesHref, showCleanupLink } = rowLinks(row)
              return (
                <li key={row.path} className="min-w-0">
                  <Card className="border border-border">
                    <CardHeader className="min-w-0">
                      <CardTitle>
                        <DiskRowName
                          row={row}
                          onExpand={onExpand}
                          resultsId={resultsId}
                          canExpand={canExpand}
                          filesHref={filesHref}
                          showCleanupLink={showCleanupLink}
                        />
                      </CardTitle>
                      <p className="font-mono text-caption text-muted-foreground [overflow-wrap:anywhere]">{row.path}</p>
                    </CardHeader>
                    <CardContent>
                      <dl className="space-y-3 text-body-sm">
                        <div>
                          <dt className="text-caption text-muted-foreground">{t("columns.size")}</dt>
                          <dd className="pt-1">
                            <DiskRowSizeCell row={row} maxBytes={maxRowBytes} totalBytes={job.sizeBytes} />
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <dt className="text-caption text-muted-foreground">{t("columns.fileCount")}</dt>
                          <dd><DiskFileCount count={row.fileCount} /></dd>
                        </div>
                        <div className="flex items-start justify-between gap-2">
                          <dt className="text-caption text-muted-foreground">{t("columns.status")}</dt>
                          <dd><DiskRowStatus row={row} /></dd>
                        </div>
                      </dl>
                    </CardContent>
                  </Card>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </div>
  )
}
