"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { SettingsIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { getNavCurrent } from "@/components/layout/nav-items"
import { useSettingsOptional } from "@/components/settings/settings-provider"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/** Nút biểu tượng Cài đặt đặt cạnh chọn ngôn ngữ và chế độ sáng/tối. */
export function SettingsNavButton({
  tooltipSide = "bottom",
}: {
  tooltipSide?: "top" | "right" | "bottom" | "left"
}) {
  const t = useTranslations("nav")
  const pathname = usePathname()
  const settings = useSettingsOptional()

  const current = getNavCurrent(pathname, "/settings")
  const hasRestartPending = (settings?.restartRequiredFields.length ?? 0) > 0
  const label = t("settings")
  const restartBadge = t("restartBadge")
  const accessibleLabel = hasRestartPending ? `${label} — ${restartBadge}` : label

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          asChild
          className={cn("relative", current && "bg-muted text-foreground")}
        >
          <Link href="/settings" aria-current={current} aria-label={accessibleLabel}>
            <SettingsIcon aria-hidden />
            {hasRestartPending && (
              <span
                className="absolute top-1.5 right-1.5 size-2 rounded-full bg-warning"
                aria-hidden
              />
            )}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>
        {hasRestartPending ? `${label} (${restartBadge})` : label}
      </TooltipContent>
    </Tooltip>
  )
}
