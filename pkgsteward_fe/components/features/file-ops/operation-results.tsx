"use client"

import { useMemo } from "react"
import { CheckIcon, MinusIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { Badge } from "@/components/ui/badge"
import type { FileOpsOperation, FileOpsTargetResult } from "@/lib/api/types"
import { operationCounts, resultErrorKey, sortOperationResults } from "@/lib/file-ops/file-ops-list"

const STATUS = {
  success: { variant: "success", Icon: CheckIcon },
  failed: { variant: "destructive", Icon: OctagonAlertIcon },
  not_started: { variant: "outline", Icon: MinusIcon },
  running: { variant: "secondary", Icon: TriangleAlertIcon },
  pending: { variant: "outline", Icon: MinusIcon },
} as const

function ResultRow({ result }: { result: FileOpsTargetResult }) {
  const t = useTranslations("fileOps")
  const { variant, Icon } = STATUS[result.status]
  return (
    <li className="min-w-0 space-y-2 rounded-md bg-card p-4 text-card-foreground">
      <p className="font-mono text-caption [overflow-wrap:anywhere]">{result.path}</p>
      <div className="flex flex-wrap items-center gap-2 text-body-sm">
        <Badge variant={variant}><Icon aria-hidden="true" />{t(`results.status.${result.status}`)}</Badge>
        <span className="text-muted-foreground">{t(`method.${result.method}`)}</span>
      </div>
      {result.errorCode ? <p className="text-body-sm">{t(resultErrorKey(result.errorCode))}</p> : null}
      {result.mayBePartial ? <p className="text-body-sm font-semibold">{t("results.mayBePartial")}</p> : null}
    </li>
  )
}

export function OperationResults({ operation }: { operation: FileOpsOperation }) {
  const t = useTranslations("fileOps")
  const format = useFormatter()
  const counts = operationCounts(operation)
  const results = useMemo(() => sortOperationResults(operation.results), [operation.results])

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label={t("results.label")}>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-body-sm">
        <li>{t("results.counts.success", { count: counts.success, formattedCount: format.number(counts.success) })}</li>
        <li>{t("results.counts.failed", { count: counts.failed, formattedCount: format.number(counts.failed) })}</li>
        <li>{t("results.counts.notStarted", { count: counts.notStarted, formattedCount: format.number(counts.notStarted) })}</li>
        {counts.remaining > 0 ? (
          <li>{t("results.counts.remaining", { count: counts.remaining, formattedCount: format.number(counts.remaining) })}</li>
        ) : null}
      </ul>
      <p className="text-heading-md">{t("results.reclaimed")} <DiskSize bytes={counts.reclaimedBytes} /></p>
      <p className="text-body-sm text-muted-foreground">{t("results.estimateHint")}</p>
      {counts.recycled > 0 ? <p className="text-body-sm">{t("results.recycledHint", {
        count: counts.recycled, formattedCount: format.number(counts.recycled),
      })}</p> : null}
      <ul className="grid min-w-0 gap-3">
        {results.map((result) => <ResultRow key={result.path} result={result} />)}
      </ul>
    </section>
  )
}
