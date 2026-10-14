"use client"

import {
  type LucideIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  SunMoonIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { type ThemeMode, themeModes } from "@/lib/theme/presets"

const MODE_ICONS = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
} satisfies Record<ThemeMode, LucideIcon>

/** Chọn chế độ Sáng / Tối / Theo hệ thống. */
export function ModeToggle() {
  const t = useTranslations("theme")
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("label")}>
          <SunMoonIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          {themeModes.map((mode) => {
            const Icon = MODE_ICONS[mode]
            return (
              <DropdownMenuRadioItem key={mode} value={mode}>
                <Icon />
                {t(mode)}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
