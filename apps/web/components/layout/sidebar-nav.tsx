"use client"

import Link from "next/link"
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { LocaleSwitcher } from "@/components/i18n/locale-switcher"
import { BrandWordmark, Logo } from "@/components/layout/logo"
import { NavLinks } from "@/components/layout/nav-links"
import { SettingsNavButton } from "@/components/layout/settings-nav-button"
import { useSettings } from "@/components/settings/settings-provider"
import { ModeToggle } from "@/components/theme/mode-toggle"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/** Thanh điều hướng dọc kiểu ứng dụng Desktop/Electron (có thu gọn). */
export function SidebarNav() {
  const t = useTranslations("nav")
  const { appearance, updatePreferences } = useSettings()
  const collapsed = appearance.sidebarCollapsed

  return (
    <aside
      aria-label={t("mainNavigation")}
      className={cn(
        "sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r border-border bg-card/50 transition-[width] duration-150 md:flex",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div
        className={cn(
          "flex items-center border-b border-border",
          collapsed ? "flex-col gap-2 px-2 py-3" : "h-16 justify-between px-3"
        )}
      >
        {collapsed ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/"
                  aria-label={t("brand")}
                  className="flex size-10 items-center justify-center rounded-md text-primary transition-colors hover:bg-muted focus-ring"
                >
                  <Logo className="size-7 shrink-0" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{t("brand")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("expandSidebar")}
                  onClick={() => {
                    void updatePreferences({ appearance: { sidebarCollapsed: false } })
                  }}
                >
                  <PanelLeftOpenIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("expandSidebar")}</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <>
            <Link
              href="/"
              className="flex min-w-0 items-center gap-2 rounded-sm text-heading-lg font-bold focus-ring"
            >
              <Logo className="size-7 shrink-0" />
              <BrandWordmark label={t("brand")} className="truncate" />
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("collapseSidebar")}
              onClick={() => {
                void updatePreferences({ appearance: { sidebarCollapsed: true } })
              }}
            >
              <PanelLeftCloseIcon />
            </Button>
          </>
        )}
      </div>

      <nav aria-label={t("mainNavigation")} className="flex-1 overflow-y-auto p-2.5">
        <NavLinks orientation="vertical" collapsed={collapsed} showIcons />
      </nav>

      <div
        className={cn(
          "flex items-center gap-1 border-t border-border p-2.5",
          collapsed ? "flex-col" : "justify-between"
        )}
      >
        <LocaleSwitcher />
        <ModeToggle />
        <SettingsNavButton tooltipSide={collapsed ? "right" : "top"} />
      </div>
    </aside>
  )
}
