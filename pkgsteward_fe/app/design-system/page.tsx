import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { Container } from "@/components/layout/container"
import { Button } from "@/components/ui/button"

import { ColorSection } from "./_components/color-section"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("designSystem")
  return { title: t("metaTitle") }
}

// Thứ tự ở đây = thứ tự section trên trang và trong mục lục. `id` trùng với
// id của section và với namespace con `designSystem.<id>` (có key `title`).
const SECTIONS = [{ id: "colors", Section: ColorSection }] as const

/** Style guide sống: token + component đọc thẳng từ theme đang chọn. */
export default async function DesignSystemPage() {
  const t = await getTranslations("designSystem")

  return (
    <Container className="flex flex-col gap-8 py-8 md:gap-12 md:py-12 lg:gap-16 lg:py-16">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-heading-xl">{t("title")}</h1>
          <p className="max-w-prose text-body-md">{t("description")}</p>
        </div>
        <nav aria-label={t("tocLabel")}>
          <ul className="flex flex-wrap gap-2">
            {SECTIONS.map(({ id }) => (
              <li key={id}>
                <Button asChild variant="secondary" className="rounded-full">
                  <a href={`#${id}`}>{t(`${id}.title`)}</a>
                </Button>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      {SECTIONS.map(({ id, Section }) => (
        <Section key={id} />
      ))}
    </Container>
  )
}
