import { getTranslations } from "next-intl/server"

import { Logo } from "@/components/layout/logo"
import { cn } from "@/lib/utils"

import { ShowcaseItem, ShowcaseSection, TokenName } from "@/app/design-system/_components/showcase"

// Cỡ logo hay dùng; 32px (size-8) là cỡ trên thanh điều hướng.
const LOGO_SIZES = [
  { token: "size-6", px: 24, className: "size-6" },
  { token: "size-8", px: 32, className: "size-8" },
  { token: "size-12", px: 48, className: "size-12" },
  { token: "size-16", px: 64, className: "size-16" },
] as const

export async function BrandSection() {
  const [t, tNav] = await Promise.all([
    getTranslations("designSystem.brand"),
    getTranslations("nav"),
  ])

  return (
    <ShowcaseSection id="brand" title={t("title")} description={t("description")}>
      <div className="grid gap-8 lg:grid-cols-2">
        <ShowcaseItem
          title={t("logo.title")}
          description={t("logo.description")}
          className="items-end gap-6"
        >
          {LOGO_SIZES.map((size) => (
            <div key={size.token} className="flex flex-col items-start gap-2">
              <Logo className={cn("shrink-0", size.className)} />
              <TokenName className="text-foreground">{size.token}</TokenName>
              <TokenName>{`${size.px}px`}</TokenName>
            </div>
          ))}
        </ShowcaseItem>
        <ShowcaseItem title={t("lockup.title")} description={t("lockup.description")}>
          <span className="flex items-center gap-2 text-heading-lg font-bold text-primary">
            <Logo className="size-8 shrink-0" />
            {tNav("brand")}
          </span>
        </ShowcaseItem>
      </div>
    </ShowcaseSection>
  )
}
