import { getTranslations } from "next-intl/server"

import { GlobalPackagesPanel } from "@/components/features/global-packages/global-packages-panel"
import { Container } from "@/components/layout/container"
import { getGlobalSnapshot, getLatestGlobalJob } from "@/lib/api/global-packages"
import { unwrapApiData } from "@/lib/api/response"

export default async function GlobalPackagesPage() {
  const [t, snapshot, latest] = await Promise.all([
    getTranslations("globalPackages"), getGlobalSnapshot(), getLatestGlobalJob(),
  ])
  return <Container className="flex min-w-0 flex-1 flex-col gap-8 py-8 md:py-12 lg:py-16">
    <h1 className="text-heading-xl">{t("title")}</h1>
    <GlobalPackagesPanel snapshot={unwrapApiData(snapshot)} latest={unwrapApiData(latest)} />
  </Container>
}
