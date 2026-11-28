import Link from "next/link"
import { getTranslations } from "next-intl/server"

import { LocaleSwitcher } from "@/components/i18n/locale-switcher"
import { Container } from "@/components/layout/container"
import { BrandWordmark, Logo } from "@/components/layout/logo"
import { MobileNav } from "@/components/layout/mobile-nav"
import { NavLinks } from "@/components/layout/nav-links"
import { SettingsNavButton } from "@/components/layout/settings-nav-button"
import { ModeToggle } from "@/components/theme/mode-toggle"

/** Primary nav: sticky, cao 64px, viền dưới hairline, logo + wordmark hai màu bên trái. */
export async function TopNav() {
  const t = await getTranslations("nav")

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <Container className="flex h-16 min-w-0 items-center gap-1.5 sm:gap-2 lg:gap-6 xl:gap-8">
        <MobileNav triggerClassName="lg:hidden" />
        <Link
          href="/"
          className="flex min-w-0 items-center gap-1.5 rounded-sm text-heading-lg font-bold focus-ring sm:gap-2 lg:shrink-0"
        >
          <Logo className="size-7 shrink-0 sm:size-8" />
          <BrandWordmark label={t("brand")} className="truncate" />
        </Link>
        <nav
          aria-label={t("mainNavigation")}
          className="hidden h-full min-w-0 flex-1 overflow-x-auto px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex"
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
