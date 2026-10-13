"use client"

import { useTransition } from "react"
import { LanguagesIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

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

/**
 * Đổi ngôn ngữ giao diện. Danh sách lấy từ i18n/config.ts nên thêm ngôn ngữ
 * mới không cần sửa component này. Server Action ghi cookie xong, Next.js tự
 * render lại route với ngôn ngữ mới.
 */
export function LocaleSwitcher() {
  const t = useTranslations("locale")
  const locale = useLocale()
  const [isPending, startTransition] = useTransition()

  function handleChange(value: string) {
    if (!isLocale(value) || value === locale) return
    startTransition(() => setUserLocale(value))
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
