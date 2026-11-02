import Link from "next/link"
import { getTranslations } from "next-intl/server"

import { ProjectDetailPanel, ProjectErrorMessage } from "@/components/features/project-detail/project-detail-panel"
import { Container } from "@/components/layout/container"
import { Button } from "@/components/ui/button"
import { getProjectDetail } from "@/lib/api/projects"
import { ApiError, unwrapApiData } from "@/lib/api/response"
import type { ProjectDetail } from "@/lib/api/types"

export default async function ProjectPage({ searchParams }: {
  searchParams: Promise<{ path?: string | string[] }>
}) {
  const [query, t] = await Promise.all([searchParams, getTranslations("projectDetail")])
  const path = typeof query.path === "string" && query.path.trim() ? query.path : null
  let detail: ProjectDetail | null = null
  let errorCode: string | null = null
  if (path !== null) {
    try {
      detail = unwrapApiData(await getProjectDetail(path))
    } catch (cause) {
      errorCode = cause instanceof ApiError ? cause.code ?? "UNKNOWN" : "UNKNOWN"
      if (cause instanceof ApiError && cause.statusCode === 409
        && typeof cause.details === "object" && cause.details !== null
        && "reason" in cause.details && typeof cause.details.reason === "string") {
        errorCode = cause.details.reason
      }
    }
  }

  return (
    <Container className="flex min-w-0 flex-1 flex-col gap-8 py-8 md:py-12 lg:py-16">
      <Button asChild variant="secondary" className="self-start"><Link href="/" prefetch={false}>{t("back")}</Link></Button>
      <h1 className="text-heading-xl">{t("title")}</h1>
      {detail ? <ProjectDetailPanel key={detail.requestPath} detail={detail} /> : (
        <div role={errorCode ? "alert" : undefined} className="rounded-md border border-border bg-card p-4 text-body-sm">
          {errorCode ? <ProjectErrorMessage code={errorCode} /> : <p>{t("missingPath")}</p>}
        </div>
      )}
    </Container>
  )
}
