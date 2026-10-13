"use client"

import { useState } from "react"
import { MenuIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { NavLinks } from "@/components/layout/nav-links"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

/** Menu điều hướng cho màn hình < 768px (nav → hamburger drawer). */
export function MobileNav() {
  const t = useTranslations("nav")
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={t("openMenu")}
        >
          <MenuIcon />
        </Button>
      </SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle className="text-primary">{t("brand")}</SheetTitle>
        </SheetHeader>
        <nav aria-label={t("mainNavigation")} className="px-4">
          <NavLinks orientation="vertical" onNavigate={() => setOpen(false)} />
        </nav>
      </SheetContent>
    </Sheet>
  )
}
