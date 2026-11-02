import { CopyIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { DropdownMenuDemo } from "@/app/design-system/_components/dropdown-menu-demo"
import { ShowcaseItem, ShowcaseSection } from "@/app/design-system/_components/showcase"

export async function OverlaysSection() {
  const t = await getTranslations("designSystem.overlays")

  return (
    <ShowcaseSection id="overlays" title={t("title")} description={t("description")}>
      <div className="grid gap-8 lg:grid-cols-2">
        <ShowcaseItem title={t("tooltip.title")} description={t("tooltip.description")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary" size="icon" aria-label={t("tooltip.copyPath")}>
                <CopyIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("tooltip.copyPath")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary">{t("tooltip.rescan")}</Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("tooltip.rescanHint")}</TooltipContent>
          </Tooltip>
        </ShowcaseItem>
        <ShowcaseItem title={t("dropdown.title")} description={t("dropdown.description")}>
          <DropdownMenuDemo />
        </ShowcaseItem>
      </div>
    </ShowcaseSection>
  )
}
