import Link from "next/link"
import { getTranslations } from "next-intl/server"

import { Container } from "@/components/layout/container"
import { buttonVariants } from "@/components/ui/button"

export default async function NotFound() {
  const t = await getTranslations("notFound")

  return (
    <Container className="space-y-4 py-8 md:py-12 lg:py-16">
      <h1 className="text-heading-xl">{t("title")}</h1>
      <Link href="/projects" className={buttonVariants()}>
        {t("backToProjects")}
      </Link>
    </Container>
  )
}
