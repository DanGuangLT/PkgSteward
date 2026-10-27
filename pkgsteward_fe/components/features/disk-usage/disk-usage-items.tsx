"use client"

import { useMemo } from "react"
import { useFormatter, useLocale, useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { DiskUsageJob, DiskUsageRow } from "@/lib/api/types"
import { diskSizeKind, sortDiskRows } from "@/lib/disk-usage/disk-usage-list"

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
  return (
    <div className="space-y-1 text-body-sm">
      <p>{t(`rows.${row.state}`)}</p>
      {row.reason ? <p className="text-muted-foreground">{t(`reasons.${row.reason}`)}</p> : null}
    </div>
  )
}

function DiskRowName({ row, onExpand, resultsId, canExpand }: {
  row: DiskUsageRow
  onExpand(row: DiskUsageRow): void
  resultsId: string
  canExpand: boolean
}) {
  const t = useTranslations("diskUsage")
  const expandable = row.state !== "excluded" && (row.kind === "directory" || row.kind === "package")
  return (
    <div className="min-w-0 space-y-2">
      <p className="font-mono font-semibold [overflow-wrap:anywhere]">{row.name}</p>
      <p className="text-caption text-muted-foreground">{t(`kinds.${row.kind}`)}</p>
      {row.aliases.length > 0 ? (
        <p className="font-mono text-caption [overflow-wrap:anywhere]">{t("aliases", { names: row.aliases.join(", ") })}</p>
      ) : null}
      {expandable ? (
        <Button type="button" variant="secondary" size="sm" disabled={!canExpand}
          aria-label={t("actions.expandName", { name: row.name })} aria-expanded={false}
          aria-controls={resultsId} onClick={() => onExpand(row)}>{t("actions.expand")}</Button>
      ) : null}
    </div>
  )
}

function DiskFileCount({ count }: { count: number | null }) {
  const t = useTranslations("diskUsage")
  const format = useFormatter()
  return <>{count === null ? t("size.pending") : t("fileCount", { count, formattedCount: format.number(count) })}</>
}

export function DiskUsageItems({ job, resultsId, onExpand, interaction }: {
  job: DiskUsageJob
  resultsId: string
  onExpand(row: DiskUsageRow): void
  interaction: "busy" | "ready"
}) {
  const t = useTranslations("diskUsage")
  const locale = useLocale()
  const rows = useMemo(() => sortDiskRows(job.children, locale), [job.children, locale])
  const canExpand = interaction === "ready" && job.status !== "running"
  if (rows.length === 0) return <p className="text-body-sm text-muted-foreground">{t(job.status === "running" ? "empty.listing" : "empty.rows")}</p>

  return (
    <>
      <div className="hidden min-w-0 rounded-md bg-card text-card-foreground lg:block">
        <Table className="table-fixed">
          <TableCaption className="sr-only">{t("listLabel")}</TableCaption>
          <TableHeader><TableRow>
            <TableHead className="w-1/5 whitespace-normal" scope="col">{t("columns.name")}</TableHead>
            <TableHead className="w-1/3 whitespace-normal" scope="col">{t("columns.path")}</TableHead>
            <TableHead className="whitespace-normal" scope="col">{t("columns.size")}</TableHead>
            <TableHead className="whitespace-normal" scope="col">{t("columns.fileCount")}</TableHead>
            <TableHead className="whitespace-normal" scope="col">{t("columns.status")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map((row) => (
            <TableRow key={row.path}>
              <TableCell className="align-top whitespace-normal"><DiskRowName row={row} onExpand={onExpand} resultsId={resultsId} canExpand={canExpand} /></TableCell>
              <TableCell className="align-top font-mono text-caption whitespace-normal [overflow-wrap:anywhere]">{row.path}</TableCell>
              <TableCell className="align-top whitespace-normal"><DiskSize bytes={row.sizeBytes} partial={row.state !== "complete"} /></TableCell>
              <TableCell className="align-top whitespace-normal"><DiskFileCount count={row.fileCount} /></TableCell>
              <TableCell className="align-top whitespace-normal"><DiskRowStatus row={row} /></TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </div>
      <ul className="grid min-w-0 gap-4 lg:hidden" aria-label={t("listLabel")}>
        {rows.map((row) => (
          <li key={row.path} className="min-w-0">
            <Card>
              <CardHeader className="min-w-0">
                <CardTitle><DiskRowName row={row} onExpand={onExpand} resultsId={resultsId} canExpand={canExpand} /></CardTitle>
                <p className="font-mono text-caption text-muted-foreground [overflow-wrap:anywhere]">{row.path}</p>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3 text-body-sm">
                  <div><dt className="text-muted-foreground">{t("columns.size")}</dt><dd><DiskSize bytes={row.sizeBytes} partial={row.state !== "complete"} /></dd></div>
                  <div><dt className="text-muted-foreground">{t("columns.fileCount")}</dt><dd><DiskFileCount count={row.fileCount} /></dd></div>
                  <div><dt className="text-muted-foreground">{t("columns.status")}</dt><dd><DiskRowStatus row={row} /></dd></div>
                </dl>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </>
  )
}
