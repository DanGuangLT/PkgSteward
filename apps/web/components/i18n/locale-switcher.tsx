"use client"

import { useTransition } from "react"
import { LanguagesIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useRouter } from "next/navigation"

import { useSettingsOptional } from "@/components/settings/settings-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { isLocale, localeLabels, locales } from "@/i18n/config"
import { setUserLocale } from "@/i18n/locale"

/** Đổi ngôn ngữ giao diện và đồng bộ cookie + settings.json. */
export function LocaleSwitcher() {
  const t = useTranslations("locale")
  const locale = useLocale()
  const router = useRouter()
  const settings = useSettingsOptional()
  const [isPending, startTransition] = useTransition()

  function handleChange(value: string) {
    if (!isLocale(value) || value === locale) return
    startTransition(async () => {
      await setUserLocale(value)
      if (settings) {
        await settings.updatePreferences({ behavior: { locale: value } })
      }
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("label")}
          disabled={isPending}
        >
          <LanguagesIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={handleChange}>
          {locales.map((code) => (
            <DropdownMenuRadioItem key={code} value={code} lang={code}>
              {localeLabels[code]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
