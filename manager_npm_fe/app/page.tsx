import Link from "next/link"
import { FolderSearchIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { Container } from "@/components/layout/container"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export default async function Home() {
  const t = await getTranslations("home")

  return (
    <Container className="flex flex-1 flex-col gap-8 py-8 md:py-12 lg:py-16">
      <h1 className="text-heading-xl">{t("title")}</h1>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderSearchIcon />
          </EmptyMedia>
          <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
          <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="secondary">
            <Link href="/design-system">{t("viewDesignSystem")}</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </Container>
  )
}
