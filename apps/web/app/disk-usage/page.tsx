import { getTranslations } from "next-intl/server"

import { DiskUsagePanel } from "@/components/features/disk-usage/disk-usage-panel"
import { Container } from "@/components/layout/container"
import { getActiveDiskUsage } from "@/lib/api/disk-usage/disk-usage"

export default async function DiskUsagePage({ searchParams }: {
  searchParams: Promise<{ path?: string | string[]; view?: string | string[] }>
}) {
  const [query, t, activeJob] = await Promise.all([
    searchParams,
    getTranslations("diskUsage"),
    getActiveDiskUsage().catch(() => null),
  ])
  const path = typeof query.path === "string" ? query.path : ""
  const view = query.view === "packages" ? "packages" : "directory"

  return (
    <Container className="flex min-w-0 flex-1 flex-col gap-8 py-8 md:py-12 lg:py-16">
      <h1 className="text-heading-xl">{t("title")}</h1>
      <DiskUsagePanel key={JSON.stringify([path, view])} initialPath={path} initialView={view} activeJob={activeJob} />
    </Container>
  )
}
