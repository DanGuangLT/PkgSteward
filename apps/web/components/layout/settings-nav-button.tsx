"use client"

import { usePathname } from "next/navigation"
import { SettingsIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { getNavCurrent } from "@/components/layout/nav-items"
import { useSettingsOptional } from "@/components/settings/settings-provider"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/** Nút biểu tượng Cài đặt mở cửa sổ Settings nổi ngay trong ứng dụng. */
export function SettingsNavButton({
  tooltipSide = "bottom",
}: {
  tooltipSide?: "top" | "right" | "bottom" | "left"
}) {
  const t = useTranslations("nav")
  const pathname = usePathname()
  const settings = useSettingsOptional()

  const onSettingsRoute = Boolean(getNavCurrent(pathname, "/settings"))
  const isOpen = Boolean(settings?.settingsOpen)
  const isActive = onSettingsRoute || isOpen
  const hasRestartPending = (settings?.restartRequiredFields.length ?? 0) > 0
  const label = t("settings")
  const restartBadge = t("restartBadge")
  const accessibleLabel = hasRestartPending ? `${label} — ${restartBadge}` : label

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={accessibleLabel}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-current={onSettingsRoute ? "page" : undefined}
          onClick={() => {
            if (!onSettingsRoute) {
              settings?.openSettings()
            }
          }}
          className={cn("relative", isActive && "bg-muted text-foreground")}
        >
          <SettingsIcon aria-hidden />
          {hasRestartPending && (
            <span
              className="absolute top-1.5 right-1.5 size-2 rounded-full bg-warning"
              aria-hidden
            />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>
        {hasRestartPending ? `${label} (${restartBadge})` : label}
      </TooltipContent>
    </Tooltip>
  )
}
