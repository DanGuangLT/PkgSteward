import Link from "next/link"
import { getTranslations } from "next-intl/server"

import { LocaleSwitcher } from "@/components/i18n/locale-switcher"
import { Container } from "@/components/layout/container"
import { Logo } from "@/components/layout/logo"
import { MobileNav } from "@/components/layout/mobile-nav"
import { NavLinks } from "@/components/layout/nav-links"
import { ModeToggle } from "@/components/theme/mode-toggle"

/** Primary nav: sticky, cao 64px, viền dưới hairline, logo + wordmark đỏ bên trái. */
export async function TopNav() {
  const t = await getTranslations("nav")

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <Container className="flex h-16 items-center gap-2 md:gap-8">
        <MobileNav />
        <Link
          href="/"
          className="flex items-center gap-2 rounded-sm text-heading-lg font-bold text-primary focus-ring"
        >
          <Logo className="size-8 shrink-0" />
          {t("brand")}
        </Link>
        <nav aria-label={t("mainNavigation")} className="hidden h-full md:flex">
          <NavLinks />
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <LocaleSwitcher />
          <ModeToggle />
        </div>
      </Container>
    </header>
  )
}
