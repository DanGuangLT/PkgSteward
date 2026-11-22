"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRightIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { LocaleSwitcher } from "@/components/i18n/locale-switcher"
import { Container } from "@/components/layout/container"
import { Logo } from "@/components/layout/logo"
import { MobileNav } from "@/components/layout/mobile-nav"
import { getNavCurrent, navItems } from "@/components/layout/nav-items"
import { SettingsNavButton } from "@/components/layout/settings-nav-button"
import { SidebarNav } from "@/components/layout/sidebar-nav"
import { useSettings } from "@/components/settings/settings-provider"
import { ModeToggle } from "@/components/theme/mode-toggle"

function BreadcrumbBar() {
  const pathname = usePathname()
  const t = useTranslations("nav")

  if (!pathname || pathname === "/") return null
  const activeNav = navItems.find((item) => item.href !== "/" && getNavCurrent(pathname, item.href))
  const label = activeNav
    ? t(activeNav.labelKey)
    : pathname === "/settings" || pathname.startsWith("/settings/")
      ? t("settings")
      : pathname.startsWith("/projects")
        ? t("projects")
        : pathname.replace(/^\//, "")

  return (
    <div className="border-b border-border bg-muted/40">
      <Container className="flex h-9 items-center gap-1.5 text-caption text-muted-foreground">
        <Link href="/" className="rounded-xs hover:text-foreground focus-ring">
          {t("projects")}
        </Link>
        <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="font-medium text-foreground">{label}</span>
      </Container>
    </div>
  )
}

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
        {appearance.showBreadcrumbs ? <BreadcrumbBar /> : null}
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
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background px-4 md:hidden">
          <MobileNav />
          <Link
            href="/"
            className="flex items-center gap-2 rounded-sm text-heading-md font-bold text-primary focus-ring"
          >
            <Logo className="size-7 shrink-0" />
            {t("brand")}
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitcher />
            <ModeToggle />
            <SettingsNavButton />
          </div>
        </header>
        {appearance.showBreadcrumbs ? <BreadcrumbBar /> : null}
        <main id="main-content" className="flex flex-1 flex-col">
          {children}
        </main>
      </div>
    </div>
  )
}
