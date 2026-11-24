import Link from "next/link"
import { getTranslations } from "next-intl/server"

import { LocaleSwitcher } from "@/components/i18n/locale-switcher"
import { Container } from "@/components/layout/container"
import { Logo } from "@/components/layout/logo"
import { MobileNav } from "@/components/layout/mobile-nav"
import { NavLinks } from "@/components/layout/nav-links"
import { SettingsNavButton } from "@/components/layout/settings-nav-button"
import { ModeToggle } from "@/components/theme/mode-toggle"

/** Primary nav: sticky, cao 64px, viền dưới hairline, logo + wordmark đỏ bên trái. */
export async function TopNav() {
  const t = await getTranslations("nav")

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <Container className="flex h-16 min-w-0 items-center gap-1.5 sm:gap-2 md:gap-4 lg:gap-8">
        <MobileNav />
        <Link
          href="/"
          className="flex min-w-0 items-center gap-1.5 rounded-sm text-heading-md font-bold text-primary focus-ring sm:gap-2 sm:text-heading-lg md:shrink-0"
        >
          <Logo className="size-7 shrink-0 sm:size-8" />
          <span className="truncate">{t("brand")}</span>
        </Link>
        <nav
          aria-label={t("mainNavigation")}
          className="hidden h-full min-w-0 flex-1 overflow-x-auto px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex"
        >
          <NavLinks />
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
          <LocaleSwitcher />
          <ModeToggle />
          <SettingsNavButton />
        </div>
      </Container>
    </header>
  )
}
