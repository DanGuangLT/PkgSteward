import { getTranslations } from "next-intl/server"

import { FilesPanel } from "@/components/features/file-ops/files-panel"
import { Container } from "@/components/layout/container"
import { ReturnLink } from "@/components/shared/return-link"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { ApiError } from "@/lib/api/response"
import { getLatestScan } from "@/lib/api/scans/scans"
import { fileManagerHref } from "@/lib/file-ops/file-ops-list"
import { resolveReturnTarget } from "@/lib/ui/navigation-targets"

async function findProject(path: string) {
  try {
    const result = await getLatestScan()
    return { project: result?.projects.find((project) => project.path === path) ?? null, failed: false }
  } catch (error) {
    if (error instanceof ApiError) return { project: null, failed: true }
    throw error
  }
}

export default async function FilesPage({ searchParams }: {
  searchParams: Promise<{ path?: string | string[]; returnTo?: string | string[]; origin?: string | string[] }>
}) {
  const [query, t, tNav, tCommon] = await Promise.all([
    searchParams,
    getTranslations("fileOps"),
    getTranslations("navigationState"),
    getTranslations("common"),
  ])
  const path = typeof query.path === "string" ? query.path : ""
  const { project, failed } = path ? await findProject(path) : { project: null, failed: false }
  const message = failed ? "loadFailed" : path ? "missingProject" : "noProject"
  const backTarget = resolveReturnTarget(query, "/", path ? fileManagerHref(path) : "/files")
  const emptyBackLabel = backTarget.isFallback || backTarget.href === "/" || backTarget.href.startsWith("/?")
    ? t("actions.toProjects")
    : backTarget.href.startsWith("/projects")
      ? tNav("backToProject")
      : tCommon("back")

  return (
    <Container className="flex min-w-0 flex-1 flex-col gap-8 py-8 md:py-12 lg:py-16">
      <h1 className="text-heading-xl">{t("files.title")}</h1>
      {project ? <FilesPanel key={project.path} project={project} backTarget={backTarget} /> : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t(`files.${message}.title`)}</EmptyTitle>
            <EmptyDescription>{t(`files.${message}.description`)}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ReturnLink href={backTarget.href} originId={backTarget.originId}>
              {emptyBackLabel}
            </ReturnLink>
          </EmptyContent>
        </Empty>
      )}
    </Container>
  )
}
