import { getTranslations } from "next-intl/server"

import { Container } from "@/components/layout/container"
import { ProjectList, type InitialProjects } from "@/components/features/project-list/project-list"
import { ApiError } from "@/lib/api/response"
import { getActiveScan, getLatestScan } from "@/lib/api/scans/scans"

async function getInitialProjects(): Promise<InitialProjects> {
  try {
    const result = await getLatestScan()
    if (result === null) return { kind: "empty" }

    return {
      kind: "ready",
      snapshot: {
        scanId: result.scanId,
        finishedAt: result.finishedAt,
        partial: result.partial,
        skippedCount: result.skippedCount,
        projects: result.projects,
        orphanCount: result.orphanNodeModules.length,
      },
    }
  } catch (error) {
    return {
      kind: "error",
      code: error instanceof ApiError ? error.code ?? "INTERNAL_SERVER_ERROR" : "INTERNAL_SERVER_ERROR",
    }
  }
}

async function getInitialScanView() {
  // Check for an active job first so a scan that finishes during the read is still observed.
  const activeScan = await getActiveScan().catch(() => null)
  return { activeScan, initial: await getInitialProjects() }
}

export default async function Home() {
  const [{ initial, activeScan }, t] = await Promise.all([
    getInitialScanView(),
    getTranslations("projects"),
  ])
  const referenceTime = new Date().toISOString()

  return (
    <Container className="flex min-w-0 flex-1 flex-col gap-8 py-8 md:py-12 lg:py-16">
      <h1 className="text-heading-xl">{t("title")}</h1>
      <ProjectList initial={initial} activeScan={activeScan} referenceTime={referenceTime} />
    </Container>
  )
}
