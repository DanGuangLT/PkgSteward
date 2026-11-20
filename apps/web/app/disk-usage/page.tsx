import { getTranslations } from "next-intl/server"

import { DiskUsagePanel } from "@/components/features/disk-usage/disk-usage-panel"
import { Container } from "@/components/layout/container"
import { getActiveDiskUsage } from "@/lib/api/disk-usage/disk-usage"
import { getLatestScan } from "@/lib/api/scans/scans"
import { diskUsageHref } from "@/lib/disk-usage/disk-usage-list"
import { resolveReturnTarget } from "@/lib/ui/navigation-targets"

export default async function DiskUsagePage({ searchParams }: {
  searchParams: Promise<{
    path?: string | string[]
    view?: string | string[]
    returnTo?: string | string[]
    origin?: string | string[]
  }>
}) {
  const [query, t, activeJob, latestScan] = await Promise.all([
    searchParams,
    getTranslations("diskUsage"),
    getActiveDiskUsage().catch(() => null),
    getLatestScan().catch(() => null),
  ])
  const hasExplicitPath = typeof query.path === "string"
  const hasExplicitView = query.view === "directory" || query.view === "packages"
  const path = typeof query.path === "string" ? query.path : ""
  const view = query.view === "packages" ? "packages" : "directory"
  const currentUrl = hasExplicitPath || hasExplicitView ? diskUsageHref(path, view) : "/disk-usage"
  const backTarget = resolveReturnTarget(query, "/", currentUrl)

  return (
    <Container className="flex min-w-0 flex-1 flex-col gap-6 py-8 md:py-12 lg:py-14">
      <div className="space-y-1.5">
        <h1 className="text-heading-xl">{t("title")}</h1>
        <p className="text-body-sm text-muted-foreground">{t("description")}</p>
      </div>
      <DiskUsagePanel
        key={JSON.stringify([path, view])}
        initialPath={path}
        initialView={view}
        hasExplicitPath={hasExplicitPath}
        hasExplicitView={hasExplicitView}
        backTarget={backTarget}
        activeJob={activeJob}
        scanRoots={latestScan?.roots ?? []}
        scannedProjects={latestScan?.projects ?? []}
        hasScan={latestScan !== null}
      />
    </Container>
  )
}
