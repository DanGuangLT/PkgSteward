import { getTranslations } from "next-intl/server"

import { CleanupPanel } from "@/components/features/file-ops/cleanup-panel"
import { Container } from "@/components/layout/container"

export default async function CleanupPage() {
  const t = await getTranslations("fileOps")

  return (
    <Container className="flex min-w-0 flex-1 flex-col gap-8 py-8 md:py-12 lg:py-16">
      <h1 className="text-heading-xl">{t("cleanup.title")}</h1>
      <CleanupPanel />
    </Container>
  )
}
