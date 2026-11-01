"use client"

import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { RiskBadge, RiskReasons } from "@/components/features/file-ops/risk-badge"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { FileOpsTarget } from "@/lib/api/types"
import { isReviewTarget, targetFailureKey } from "@/lib/file-ops/file-ops-list"

export type TargetInteraction = "measuring" | "locked" | "ready"

interface CleanupItemsProps {
  targets: readonly FileOpsTarget[]
  selected: ReadonlySet<string>
  interaction: TargetInteraction
  referenceTime: string
  onToggle(path: string): void
}

type TargetProps = Pick<CleanupItemsProps, "selected" | "interaction" | "onToggle"> & { target: FileOpsTarget }

function TargetCheckbox({ target, selected, interaction, onToggle }: TargetProps) {
  const t = useTranslations("fileOps")
  return (
    <Checkbox aria-label={t("actions.selectTarget", { path: target.path })} checked={selected.has(target.path)}
      disabled={interaction !== "ready" || !isReviewTarget(target)} onCheckedChange={() => onToggle(target.path)} />
  )
}

function TargetName({ target }: { target: FileOpsTarget }) {
  const t = useTranslations("fileOps")
  return (
    <div className="min-w-0 space-y-2">
      <p className="font-mono text-caption [overflow-wrap:anywhere]">{target.path}</p>
      {target.owner ? <p className="text-caption text-muted-foreground [overflow-wrap:anywhere]">{target.owner.name ?? target.owner.path}</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-caption">
        {target.kind ? <Badge variant="secondary">{t(`kinds.${target.kind}`)}</Badge> : null}
        {target.method ? <span className="text-muted-foreground">{t(`method.${target.method}`)}</span> : null}
      </div>
    </div>
  )
}

function TargetFreed({ target }: { target: FileOpsTarget }) {
  const t = useTranslations("fileOps")
  const { size } = target
  if (!target.valid) return <>{t(targetFailureKey(target.failureCode))}</>
  if (size.status !== "done") return <>{t(`targets.${size.status}`)}</>
  return target.method === "recycle" ? (
    <span className="space-y-1">
      <span className="block font-semibold"><DiskSize bytes={size.sizeBytes} /></span>
      <span className="block text-caption text-muted-foreground">{t("targets.onEmptyBin")}</span>
    </span>
  ) : <span className="font-semibold"><DiskSize bytes={size.reclaimableBytes} /></span>
}

function TargetSize({ target }: { target: FileOpsTarget }) {
  const t = useTranslations("fileOps")
  const { size } = target
  if (!target.valid || size.status !== "done") return <>{t("targets.noData")}</>
  return (
    <span className="text-muted-foreground">
      <DiskSize bytes={size.sizeBytes} /> · <DiskSize bytes={size.sharedBytes} /> {t("targets.shared")}
    </span>
  )
}

function TargetActivity({ date, referenceTime }: { date: string | null; referenceTime: string }) {
  const t = useTranslations("fileOps")
  const format = useFormatter()
  if (date === null) return <>{t("targets.noData")}</>
  return <time dateTime={date}>{format.relativeTime(new Date(date), new Date(referenceTime))}</time>
}

function TargetRisk({ target }: { target: FileOpsTarget }) {
  if (!target.valid) return null
  return (
    <div className="min-w-0 space-y-2">
      <RiskBadge level={target.risk.level} />
      <RiskReasons risk={target.risk} />
    </div>
  )
}

export function CleanupItems({ targets, selected, interaction, referenceTime, onToggle }: CleanupItemsProps) {
  const t = useTranslations("fileOps")
  const rowProps = { selected, interaction, onToggle }

  return (
    <>
      <div className="hidden min-w-0 rounded-md bg-card text-card-foreground lg:block">
        <Table className="table-fixed">
          <TableCaption className="sr-only">{t("listLabel")}</TableCaption>
          <TableHeader><TableRow>
            <TableHead className="w-12" scope="col"><span className="sr-only">{t("columns.select")}</span></TableHead>
            <TableHead className="w-2/5 whitespace-normal" scope="col">{t("columns.target")}</TableHead>
            <TableHead className="whitespace-normal" scope="col">{t("columns.reclaimable")}</TableHead>
            <TableHead className="whitespace-normal" scope="col">{t("columns.size")}</TableHead>
            <TableHead className="whitespace-normal" scope="col">{t("columns.activity")}</TableHead>
            <TableHead className="w-1/5 whitespace-normal" scope="col">{t("columns.risk")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{targets.map((target) => (
            <TableRow key={target.path}>
              <TableCell className="align-top"><TargetCheckbox target={target} {...rowProps} /></TableCell>
              <TableCell className="align-top whitespace-normal"><TargetName target={target} /></TableCell>
              <TableCell className="align-top whitespace-normal"><TargetFreed target={target} /></TableCell>
              <TableCell className="align-top text-body-sm whitespace-normal"><TargetSize target={target} /></TableCell>
              <TableCell className="align-top text-body-sm text-muted-foreground whitespace-normal">
                <TargetActivity date={target.lastActivityAt} referenceTime={referenceTime} />
              </TableCell>
              <TableCell className="align-top whitespace-normal"><TargetRisk target={target} /></TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </div>

      <ul className="grid min-w-0 gap-4 lg:hidden" aria-label={t("listLabel")}>
        {targets.map((target) => (
          <li key={target.path} className="min-w-0">
            <Card>
              <CardHeader className="min-w-0">
                <CardTitle className="flex min-w-0 items-start gap-3 text-body-md">
                  <TargetCheckbox target={target} {...rowProps} />
                  <TargetName target={target} />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3 text-body-sm">
                  <div><dt className="text-muted-foreground">{t("columns.reclaimable")}</dt><dd><TargetFreed target={target} /></dd></div>
                  <div><dt className="text-muted-foreground">{t("columns.size")}</dt><dd><TargetSize target={target} /></dd></div>
                  <div><dt className="text-muted-foreground">{t("columns.activity")}</dt><dd><TargetActivity date={target.lastActivityAt} referenceTime={referenceTime} /></dd></div>
                  <div><dt className="text-muted-foreground">{t("columns.risk")}</dt><dd><TargetRisk target={target} /></dd></div>
                </dl>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </>
  )
}
