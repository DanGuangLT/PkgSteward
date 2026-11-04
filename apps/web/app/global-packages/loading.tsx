import { getTranslations } from "next-intl/server"
import { Container } from "@/components/layout/container"

export default async function GlobalPackagesLoading() {
  const t = await getTranslations("globalPackages")
  return <Container className="min-w-0 space-y-4 py-8 md:py-12 lg:py-16">
    <h1 className="text-heading-xl">{t("title")}</h1>
    <p role="status" className="text-body-sm text-muted-foreground">{t("loading")}</p>
  </Container>
}
