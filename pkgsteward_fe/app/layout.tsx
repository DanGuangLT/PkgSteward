import type { Metadata } from "next"
import { Geist_Mono, Inter } from "next/font/google"
import { NextIntlClientProvider } from "next-intl"
import { getLocale, getTranslations } from "next-intl/server"

import { TopNav } from "@/components/layout/top-nav"
import { ThemeProvider } from "@/components/theme/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getThemePreset } from "@/lib/theme/get-theme-preset"
import { cn } from "@/lib/utils"

import "./globals.css"

// Inter: font thay thế gần nhất cho Pin Sans. Preset trỏ
// --font-body vào biến này, nên đổi font chỉ cần đổi biến trong preset.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
})

// Mono chỉ dùng cho log lệnh npm, path, version.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata")
  return { title: t("title"), description: t("description") }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, preset, t] = await Promise.all([
    getLocale(),
    getThemePreset(),
    getTranslations("nav"),
  ])

  return (
    <html
      lang={locale}
      data-theme={preset}
      suppressHydrationWarning
      className={cn("h-full", inter.variable, geistMono.variable)}
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <ThemeProvider>
            <TooltipProvider>
              <a
                href="#main-content"
                className="sr-only z-50 rounded-md bg-background px-4 py-2 text-button text-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-ring"
              >
                {t("skipToContent")}
              </a>
              <TopNav />
              <main id="main-content" className="flex flex-1 flex-col">
                {children}
              </main>
              <Toaster />
            </TooltipProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
