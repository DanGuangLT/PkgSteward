import Link from "next/link"
import { getTranslations } from "next-intl/server"

import { ProjectPageShell } from "@/components/features/project-detail/project-page-shell"
import { Container } from "@/components/layout/container"
import { Button } from "@/components/ui/button"
import { getProjectDetail } from "@/lib/api/projects/projects"
import { getRunnerContext } from "@/lib/api/npm-runs/npm-runs"
import { unwrapApiData } from "@/lib/api/response"
import type { ProjectDetail, RunnerContext } from "@/lib/api/types"
import { runnerError } from "@/lib/npm-runner/runner-policy"

export default async function ProjectPage({ searchParams }: {
  searchParams: Promise<{ path?: string | string[] }>
}) {
  const [query, t] = await Promise.all([searchParams, getTranslations("projectDetail")])
  const path = typeof query.path === "string" && query.path.trim() ? query.path : null
  let detail: ProjectDetail | null = null
  let context: RunnerContext | null = null
  let detailError: string | null = null
  let contextError: string | null = null
  if (path !== null) {
    const [detailResult, contextResult] = await Promise.allSettled([getProjectDetail(path), getRunnerContext(path)])
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
  }

  return (
    <Container className="flex min-w-0 flex-1 flex-col gap-8 py-8 md:py-12 lg:py-16">
      <Button asChild variant="secondary" className="self-start"><Link href="/" prefetch={false}>{t("back")}</Link></Button>
      <h1 className="text-heading-xl">{t("title")}</h1>
      {path ? <ProjectPageShell key={path} path={path} detail={detail} detailError={detailError} context={context} contextError={contextError} /> : (
        <div className="rounded-md border border-border bg-card p-4 text-body-sm">
          <p>{t("missingPath")}</p>
        </div>
      )}
    </Container>
  )
}
