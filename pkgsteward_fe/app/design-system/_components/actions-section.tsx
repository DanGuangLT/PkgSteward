import {
  ArrowRightIcon,
  CheckIcon,
  EyeIcon,
  FolderOpenIcon,
  type LucideIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { getTranslations } from "next-intl/server"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { ShowcaseItem, ShowcaseRow, ShowcaseSection } from "./showcase"

type ButtonVariant = NonNullable<React.ComponentProps<typeof Button>["variant"]>
type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>["variant"]>

// Mỗi variant đi kèm 1 hành động mẫu đúng ngữ nghĩa của nó. `link` trình bày riêng.
const BUTTON_DEMOS = [
  { variant: "default", icon: RefreshCwIcon },
  { variant: "secondary", icon: EyeIcon },
  { variant: "outline", icon: FolderOpenIcon },
  { variant: "ghost", icon: XIcon },
  { variant: "destructive", icon: Trash2Icon },
] as const satisfies readonly { variant: ButtonVariant; icon: LucideIcon }[]

const TEXT_SIZES = ["sm", "default", "lg"] as const
const ICON_SIZES = ["icon-sm", "icon", "icon-lg"] as const

const BADGE_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "destructive",
  "success",
] as const satisfies readonly BadgeVariant[]

export async function ActionsSection() {
  const t = await getTranslations("designSystem.actions")

  return (
    <ShowcaseSection id="actions" title={t("title")} description={t("description")}>
      <ShowcaseItem
        title={t("buttons.title")}
        description={t("buttons.description")}
        className="flex-col items-start gap-6"
      >
        {BUTTON_DEMOS.map(({ variant, icon: Icon }) => {
          const label = t(`buttons.labels.${variant}`)
          return (
            <ShowcaseRow key={variant} label={`variant="${variant}"`}>
              {TEXT_SIZES.map((size) => (
                <Button key={size} variant={variant} size={size}>
                  <Icon data-icon="inline-start" />
                  {label}
                </Button>
              ))}
              {ICON_SIZES.map((size) => (
                <Button key={size} variant={variant} size={size} aria-label={label}>
                  <Icon />
                </Button>
              ))}
              <Button variant={variant} disabled>
                {label}
              </Button>
            </ShowcaseRow>
          )
        })}
        <ShowcaseRow label='variant="link"'>
          <Button variant="link">
            {t("buttons.labels.link")}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
          <Button variant="link" disabled>
            {t("buttons.labels.link")}
          </Button>
        </ShowcaseRow>
      </ShowcaseItem>
      <ShowcaseItem title={t("badges.title")} description={t("badges.description")}>
        {BADGE_VARIANTS.map((variant) => (
          <ShowcaseRow key={variant} label={variant}>
            <Badge variant={variant}>{t(`badges.labels.${variant}`)}</Badge>
          </ShowcaseRow>
        ))}
        <ShowcaseRow label='data-icon="inline-start"'>
          <Badge variant="success">
            <CheckIcon data-icon="inline-start" />
            {t("badges.labels.success")}
          </Badge>
        </ShowcaseRow>
      </ShowcaseItem>
    </ShowcaseSection>
  )
}
