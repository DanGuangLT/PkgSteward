"use client"

import Link from "next/link"
import { FolderSearchIcon, RefreshCwIcon, ScanSearchIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export interface CleanupScanProjectItem {
  path: string
  name: string | null
  hasLockfile: boolean
  lastActivityAt: string
  nodeModulesExists: boolean
  nodeModulesSizeBytes: number | null
}

export interface CleanupScanContext {
  scanId: string
  finishedAt: string
  partial: boolean
  projectCount: number
  withNodeModulesCount: number
  orphanCount: number
  projects: CleanupScanProjectItem[]
}

export function CleanupScanBanner({ scanContext }: { scanContext: CleanupScanContext | null }) {
  const t = useTranslations("fileOps")
  const format = useFormatter()

  if (scanContext === null) {
    return (
      <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
            <ScanSearchIcon className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-heading-md text-foreground">{t("scanContext.missingTitle")}</p>
            <p className="text-body-sm text-muted-foreground">{t("scanContext.missingDescription")}</p>
          </div>
        </div>
        <Button asChild className="self-start sm:self-center">
          <Link href="/">{t("scanContext.goScan")}</Link>
        </Button>
      </div>
    )
  }

  const finishedDate = new Date(scanContext.finishedAt)
  const formattedTime = Number.isNaN(finishedDate.getTime())
    ? scanContext.finishedAt
    : format.dateTime(finishedDate, { dateStyle: "medium", timeStyle: "short" })

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3 text-body-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <FolderSearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium text-foreground">
          {t("scanContext.summary", {
            projects: format.number(scanContext.projectCount),
            withNodeModules: format.number(scanContext.withNodeModulesCount),
            orphans: format.number(scanContext.orphanCount),
          })}
        </p>
        <span className="text-caption text-muted-foreground">
          {t("scanContext.scannedAt", { time: formattedTime })}
        </span>
        {scanContext.partial ? (
          <Badge variant="outline">{t("scanContext.partial")}</Badge>
        ) : null}
      </div>
      <Button asChild variant="ghost" size="sm">
        <Link href="/">
          <RefreshCwIcon aria-hidden="true" />
          {t("scanContext.rescan")}
        </Link>
      </Button>
    </div>
  )
}
