import { getTranslations } from "next-intl/server"

import { cn } from "@/lib/utils"

import { ShowcaseSection, TokenName } from "./showcase"

// Số đo chép từ styles/tokens.css (cỡ · độ đậm · line-height · letter-spacing).
// Đổi thang chữ ở đó thì sửa cả ở đây.
const TYPE_SCALE = [
  { token: "text-heading-xl", spec: "28px · 700 · 1.2 · -0.04em", className: "text-heading-xl text-foreground" },
  { token: "text-heading-lg", spec: "22px · 600 · 1.25", className: "text-heading-lg text-foreground" },
  { token: "text-heading-md", spec: "18px · 600 · 1.3", className: "text-heading-md text-foreground" },
  { token: "text-body-md", spec: "16px · 400 · 1.4", className: "text-body-md text-body" },
  { token: "text-body-sm", spec: "14px · 400 · 1.4", className: "text-body-sm text-body" },
  { token: "text-caption", spec: "12px · 500 · 1.5", className: "text-caption text-muted-foreground" },
  { token: "text-button", spec: "14px · 700 · 1", className: "text-button text-foreground" },
  { token: "text-button-sm", spec: "12px · 700 · 1", className: "text-button-sm text-foreground" },
] as const

const ROW_CLASS_NAME =
  "flex flex-col gap-2 border-b border-border py-4 first:pt-0 last:border-b-0 last:pb-0 md:flex-row md:items-baseline md:gap-6"

export async function TypographySection() {
  const t = await getTranslations("designSystem.typography")

  return (
    <ShowcaseSection
      id="typography"
      title={t("title")}
      description={t("description")}
    >
      <ul className="flex flex-col">
        {TYPE_SCALE.map((item) => (
          <li key={item.token} className={ROW_CLASS_NAME}>
            <SpecLabel token={item.token} spec={item.spec} />
            <p className={cn("min-w-0", item.className)}>{t("sample")}</p>
          </li>
        ))}
        <li className={ROW_CLASS_NAME}>
          <SpecLabel token="font-mono" spec={t("monoNote")} />
          <p className="min-w-0 font-mono text-body-sm break-all text-foreground">
            pnpm install --frozen-lockfile
          </p>
        </li>
      </ul>
    </ShowcaseSection>
  )
}

function SpecLabel({ token, spec }: { token: string; spec: string }) {
  return (
    <div className="flex shrink-0 flex-col md:w-60">
      <TokenName className="text-foreground">{token}</TokenName>
      <TokenName>{spec}</TokenName>
    </div>
  )
}
