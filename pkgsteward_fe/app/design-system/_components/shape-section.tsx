import { getTranslations } from "next-intl/server"

import { cn } from "@/lib/utils"

import { ShowcaseItem, ShowcaseSection, TokenName } from "./showcase"

// Thang bo góc suy ra từ --radius (styles/tokens.css).
const RADII = [
  { id: "sm", token: "rounded-sm", scale: "0.5 × --radius", className: "rounded-sm" },
  { id: "md", token: "rounded-md", scale: "--radius", className: "rounded-md" },
  { id: "xl", token: "rounded-xl", scale: "2 × --radius", className: "rounded-xl" },
  { id: "full", token: "rounded-full", scale: "9999px", className: "rounded-full" },
] as const

// Khoảng cách theo thiết kế: 4 · 6 · 8 · 12 · 16 · 24 · 32 · 64px (1 bước Tailwind = 4px).
const SPACING = [
  { step: "1", px: 4, className: "w-1" },
  { step: "1.5", px: 6, className: "w-1.5" },
  { step: "2", px: 8, className: "w-2" },
  { step: "3", px: 12, className: "w-3" },
  { step: "4", px: 16, className: "w-4" },
  { step: "6", px: 24, className: "w-6" },
  { step: "8", px: 32, className: "w-8" },
  { step: "16", px: 64, className: "w-16" },
] as const

export async function ShapeSection() {
  const t = await getTranslations("designSystem.shape")

  return (
    <ShowcaseSection id="shape" title={t("title")} description={t("description")}>
      <div className="grid gap-8 lg:grid-cols-2">
        <ShowcaseItem
          title={t("radius.title")}
          description={t("radius.description")}
          className="grid grid-cols-2 items-start gap-6 sm:grid-cols-4"
        >
          {RADII.map((radius) => (
            <div key={radius.id} className="flex flex-col gap-2">
              <div
                aria-hidden
                className={cn("size-20 border border-border bg-secondary", radius.className)}
              />
              <TokenName className="text-foreground">{radius.token}</TokenName>
              <TokenName>{radius.scale}</TokenName>
              <p className="text-body-sm">{t(`radius.${radius.id}`)}</p>
            </div>
          ))}
        </ShowcaseItem>
        <ShowcaseItem
          title={t("shadow.title")}
          description={t("shadow.description")}
          className="gap-6"
        >
          <figure className="flex flex-col gap-2">
            <div aria-hidden className="h-24 w-40 rounded-md bg-card" />
            <figcaption className="text-body-sm">{t("shadow.none")}</figcaption>
          </figure>
          <figure className="flex flex-col gap-2">
            <div aria-hidden className="h-24 w-40 rounded-xl bg-popover shadow-modal" />
            <figcaption className="text-body-sm">{t("shadow.modal")}</figcaption>
          </figure>
        </ShowcaseItem>
        <ShowcaseItem
          title={t("spacing.title")}
          description={t("spacing.description")}
          className="flex-col items-stretch gap-3"
        >
          {SPACING.map((space) => (
            <div key={space.step} className="flex items-center gap-4">
              <TokenName className="w-12 shrink-0 text-foreground">{`${space.px}px`}</TokenName>
              <div aria-hidden className={cn("h-4 rounded-full bg-foreground", space.className)} />
              <TokenName>{`p-${space.step} · gap-${space.step}`}</TokenName>
            </div>
          ))}
        </ShowcaseItem>
        <ShowcaseItem
          title={t("container.title")}
          description={t("container.description")}
          className="flex-col items-start gap-2"
        >
          <TokenName className="text-foreground">max-w-content</TokenName>
          <TokenName className="text-foreground">px-4 sm:px-6</TokenName>
          <TokenName className="text-foreground">gap-8 md:gap-12 lg:gap-16</TokenName>
        </ShowcaseItem>
      </div>
    </ShowcaseSection>
  )
}
