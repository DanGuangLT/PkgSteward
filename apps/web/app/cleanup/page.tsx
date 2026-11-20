import { getTranslations } from "next-intl/server"

import { CleanupPanel } from "@/components/features/file-ops/cleanup-panel"
import type { CleanupScanContext } from "@/components/features/file-ops/cleanup-scan-banner"
import { Container } from "@/components/layout/container"
import { getLatestScan } from "@/lib/api/scans/scans"
import type { ScanResult } from "@/lib/api/types"

function toCleanupScanContext(scan: ScanResult | null): CleanupScanContext | null {
  if (!scan) return null
  let withNodeModulesCount = 0
  const projects = scan.projects.map((project) => {
    if (project.nodeModules.exists) withNodeModulesCount += 1
    return {
      path: project.path,
      name: project.name,
      hasLockfile: project.hasLockfile,
      lastActivityAt: project.lastActivityAt,
      nodeModulesExists: project.nodeModules.exists,
      nodeModulesSizeBytes: project.nodeModules.sizeBytes,
    }
  })
  return {
    scanId: scan.scanId,
    finishedAt: scan.finishedAt,
    partial: scan.partial,
    projectCount: scan.projects.length,
    withNodeModulesCount,
    orphanCount: scan.orphanNodeModules.length,
    projects,
  }
}

export default async function CleanupPage() {
  const [t, latestScan] = await Promise.all([
    getTranslations("fileOps"),
    getLatestScan().catch(() => null),
  ])
  const scanContext = toCleanupScanContext(latestScan)

  return (
    <Container className="flex min-w-0 flex-1 flex-col gap-6 py-8 md:py-12 lg:py-16">
      <div className="space-y-2">
        <h1 className="text-heading-xl">{t("cleanup.title")}</h1>
        <p className="max-w-3xl text-body-sm text-muted-foreground">{t("cleanup.description")}</p>
      </div>
      <CleanupPanel scanContext={scanContext} />
    </Container>
  )
}
