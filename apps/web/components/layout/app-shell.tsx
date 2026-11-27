"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"

import { LocaleSwitcher } from "@/components/i18n/locale-switcher"
import { BrandWordmark, Logo } from "@/components/layout/logo"
import { MobileNav } from "@/components/layout/mobile-nav"
import { SettingsNavButton } from "@/components/layout/settings-nav-button"
import { SidebarNav } from "@/components/layout/sidebar-nav"
import { useSettings } from "@/components/settings/settings-provider"
import { ModeToggle } from "@/components/theme/mode-toggle"

export function AppShell({
  topNav,
  children,
}: {
  topNav: React.ReactNode
  children: React.ReactNode
}) {
  const t = useTranslations("nav")
  const { appearance } = useSettings()
  const useSidebar = appearance.navigationLayout === "sidebar"

  if (!useSidebar) {
    return (
      <>
        {topNav}
        <main id="main-content" className="flex flex-1 flex-col">
          {children}
        </main>
      </>
    )
  }

  return (
    <div className="flex min-h-full flex-1">
      <SidebarNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background px-3 sm:px-4 md:hidden">
          <MobileNav />
          <Link
            href="/"
            className="flex min-w-0 items-center gap-1.5 rounded-sm text-heading-md font-bold focus-ring sm:gap-2"
          >
            <Logo className="size-7 shrink-0" />
            <BrandWordmark label={t("brand")} className="truncate" />
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
            <LocaleSwitcher />
            <ModeToggle />
            <SettingsNavButton />
          </div>
        </header>
        <main id="main-content" className="flex flex-1 flex-col">
          {children}
        </main>
      </div>
    </div>
  )
}
