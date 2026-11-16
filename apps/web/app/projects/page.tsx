import { getTranslations } from "next-intl/server"

import { ProjectPageShell } from "@/components/features/project-detail/project-page-shell"
import { Container } from "@/components/layout/container"
import { ReturnLink } from "@/components/shared/return-link"
import { getActiveDiskUsage } from "@/lib/api/disk-usage/disk-usage"
import { getProjectDetail } from "@/lib/api/projects/projects"
import { getRunnerContext } from "@/lib/api/npm-runs/npm-runs"
import { getLatestScan } from "@/lib/api/scans/scans"
import { unwrapApiData } from "@/lib/api/response"
import type { DiskUsageActiveJob, ProjectDetail, RunnerContext, ScannedProject } from "@/lib/api/types"
import { runnerError } from "@/lib/npm-runner/runner-policy"
import { projectDetailHref } from "@/lib/projects/project-detail-list"
import { resolveReturnTarget } from "@/lib/ui/navigation-targets"

export default async function ProjectPage({ searchParams }: {
  searchParams: Promise<{ path?: string | string[]; returnTo?: string | string[]; origin?: string | string[] }>
}) {
  const [query, t, tNav, tCommon] = await Promise.all([
    searchParams,
    getTranslations("projectDetail"),
    getTranslations("navigationState"),
    getTranslations("common"),
  ])
  const path = typeof query.path === "string" && query.path.trim() ? query.path : null
  const backTarget = resolveReturnTarget(query, "/", path ? projectDetailHref(path) : "/")
  const backLabel = backTarget.isFallback || backTarget.href === "/" || backTarget.href.startsWith("/?")
    ? t("back")
    : backTarget.href.startsWith("/projects")
      ? tNav("backToProject")
      : tCommon("back")
  let detail: ProjectDetail | null = null
  let context: RunnerContext | null = null
  let detailError: string | null = null
  let contextError: string | null = null
  let scannedProject: ScannedProject | null = null
  let activeDiskJob: DiskUsageActiveJob | null = null
  if (path !== null) {
    const [detailResult, contextResult, scanResult, diskResult] = await Promise.allSettled([
      getProjectDetail(path),
      getRunnerContext(path),
      getLatestScan().catch(() => null),
      getActiveDiskUsage().catch(() => null),
    ])
    try {
      if (detailResult.status === "rejected") throw detailResult.reason
      detail = unwrapApiData(detailResult.value)
    } catch (cause) {
      detailError = runnerError(cause).code
    }
    try {
      if (contextResult.status === "rejected") throw contextResult.reason
      context = unwrapApiData(contextResult.value)
    } catch (cause) {
      contextError = runnerError(cause).code
    }
    if (scanResult.status === "fulfilled" && scanResult.value) {
      scannedProject = scanResult.value.projects.find((item) => item.path === path)
        ?? (detail ? scanResult.value.projects.find((item) => item.path === detail?.requestPath) ?? null : null)
    }
    if (diskResult.status === "fulfilled") {
      activeDiskJob = diskResult.value
    }
  }

  return (
    <Container className="flex min-w-0 flex-1 flex-col gap-8 py-8 md:py-12 lg:py-16">
      <ReturnLink href={backTarget.href} originId={backTarget.originId} className="self-start">
        {backLabel}
      </ReturnLink>
      <h1 className="text-heading-xl">{t("title")}</h1>
      {path ? (
        <ProjectPageShell
          key={path}
          path={path}
          detail={detail}
          detailError={detailError}
          context={context}
          contextError={contextError}
          scannedProject={scannedProject}
          activeDiskJob={activeDiskJob}
        />
      ) : (
        <div className="rounded-md border border-border bg-card p-4 text-body-sm">
          <p>{t("missingPath")}</p>
        </div>
      )}
    </Container>
  )
}
