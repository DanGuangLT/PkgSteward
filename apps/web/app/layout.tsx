import type { Metadata } from "next"
import {
  Be_Vietnam_Pro,
  Fira_Code,
  Geist_Mono,
  Inter,
  JetBrains_Mono,
  Plus_Jakarta_Sans,
  Roboto,
} from "next/font/google"
import { NextIntlClientProvider } from "next-intl"
import { getLocale, getTranslations } from "next-intl/server"

import { NativeSessionStatus } from "@/components/features/npm-runner/native-session-status"
import { NpmRunnerProvider } from "@/components/features/npm-runner/npm-runner-provider"
import { SettingsWindowModal } from "@/components/features/settings/settings-window-modal"
import { AppShell } from "@/components/layout/app-shell"
import { TopNav } from "@/components/layout/top-nav"
import { SettingsProvider } from "@/components/settings/settings-provider"
import { WallpaperStage } from "@/components/settings/wallpaper-stage"
import { ThemeProvider } from "@/components/theme/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { NavigationContinuityProvider } from "@/hooks/use-navigation-continuity"
import { getHtmlAttributesForAppearance } from "@/lib/settings/appearance-prefs"
import { getInitialAppearance } from "@/lib/settings/get-initial-appearance"
import { cn } from "@/lib/utils"

import "@/app/globals.css"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
})

const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-be-vietnam-pro",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
})

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin", "vietnamese"],
})

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
})

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
})

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata")
  return { title: t("title"), description: t("description") }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, initialAppearance, t] = await Promise.all([
    getLocale(),
    getInitialAppearance(),
    getTranslations("nav"),
  ])

  const { attributes, fontSizePercent, cssVars } = getHtmlAttributesForAppearance(initialAppearance)

  return (
    <html
      lang={locale}
      {...attributes}
      style={{ fontSize: fontSizePercent, ...cssVars } as React.CSSProperties}
      suppressHydrationWarning
      className={cn(
        "h-full",
        inter.variable,
        beVietnamPro.variable,
        plusJakartaSans.variable,
        roboto.variable,
        geistMono.variable,
        jetBrainsMono.variable,
        firaCode.variable
      )}
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <ThemeProvider>
            <TooltipProvider>
              <SettingsProvider initialAppearance={initialAppearance} initialLocale={locale}>
                <WallpaperStage />
                <NavigationContinuityProvider>
                  <NpmRunnerProvider>
                    <a
                      href="#main-content"
                      className="sr-only z-50 rounded-md bg-background px-4 py-2 text-button text-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-ring"
                    >
                      {t("skipToContent")}
                    </a>
                    <div className="relative z-10 flex min-h-full flex-1 flex-col">
                      <AppShell topNav={<TopNav />} dock={<NativeSessionStatus />}>
                        {children}
                      </AppShell>
                    </div>
                    <SettingsWindowModal />
                    <Toaster />
                  </NpmRunnerProvider>
                </NavigationContinuityProvider>
              </SettingsProvider>
            </TooltipProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
