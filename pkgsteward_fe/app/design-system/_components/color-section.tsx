import { getTranslations } from "next-intl/server"

import { getThemePreset } from "@/lib/theme/get-theme-preset"
import type { ThemePreset } from "@/lib/theme/presets"
import { cn } from "@/lib/utils"

import { type ColorSwatch, colorGroups } from "@/app/design-system/_components/color-tokens"
import { ShowcaseSection, TokenName } from "@/app/design-system/_components/showcase"

export async function ColorSection() {
  const [t, preset] = await Promise.all([
    getTranslations("designSystem.colors"),
    getThemePreset(),
  ])

  return (
    <ShowcaseSection
      id="colors"
      title={t("title")}
      description={t("description")}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <ThemePanel preset={preset} mode="light" title={t("light")} />
        <ThemePanel preset={preset} mode="dark" title={t("dark")} />
      </div>
    </ShowcaseSection>
  )
}

/**
 * Bảng màu của 1 chế độ. Gắn `data-theme` (+ class `dark`) lên chính khung
 * này để preset tính lại biến CSS tại đây: cả 2 chế độ hiện cùng lúc, không
 * phụ thuộc chế độ đang chọn ở thanh trên. Khung tự đặt nền + màu chữ vì màu
 * kế thừa từ <body> là giá trị đã tính theo chế độ của trang.
 */
async function ThemePanel({
  preset,
  mode,
  title,
}: {
  preset: ThemePreset
  mode: "light" | "dark"
  title: string
}) {
  const t = await getTranslations("designSystem.colors.groups")

  return (
    <div
      data-theme={preset}
      className={cn(
        "flex min-w-0 flex-col gap-6 rounded-xl border border-border bg-background p-4 text-body sm:p-6",
        mode === "dark" && "dark"
      )}
    >
      <h3 className="text-heading-md">{title}</h3>
      {colorGroups.map((group) => (
        <div key={group.id} className="flex flex-col gap-3">
          <h4 className="text-body-sm font-semibold">{t(group.id)}</h4>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {group.swatches.map((swatch) => (
              <Swatch key={swatch.token} swatch={swatch} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function Swatch({ swatch }: { swatch: ColorSwatch }) {
  return (
    <li className="flex min-w-0 flex-col gap-2">
      <div
        aria-hidden
        className={cn(
          "flex h-16 items-center justify-center rounded-md border border-border text-heading-md",
          swatch.className
        )}
      >
        Aa
      </div>
      <div className="flex min-w-0 flex-col">
        <TokenName className="break-all text-foreground">{swatch.token}</TokenName>
        {swatch.on ? (
          <TokenName className="break-all">{swatch.on}</TokenName>
        ) : null}
      </div>
    </li>
  )
}
