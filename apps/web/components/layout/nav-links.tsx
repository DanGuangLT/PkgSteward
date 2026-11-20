"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cva, type VariantProps } from "class-variance-authority"
import { useTranslations } from "next-intl"

import { getNavCurrent, navItems } from "@/components/layout/nav-items"
import { cn } from "@/lib/utils"

// Mục đang chọn có gạch chân đỏ (giống tab đang chọn).
const navLinkVariants = cva("text-button text-muted-foreground transition-colors focus-ring hover:text-foreground data-active:text-foreground", {
  variants: {
    orientation: {
      horizontal:
        "relative inline-flex h-full items-center rounded-sm after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-full after:bg-primary after:opacity-0 data-active:after:opacity-100",
      vertical:
        "flex h-11 items-center rounded-md px-3 hover:bg-muted data-active:bg-muted",
    },
  },
  defaultVariants: {
    orientation: "horizontal",
  },
})

export function NavLinks({
  orientation = "horizontal",
  onNavigate,
}: VariantProps<typeof navLinkVariants> & {
  /** Gọi khi bấm 1 link — VD: đóng menu mobile. */
  onNavigate?: () => void
}) {
  const t = useTranslations("nav")
  const pathname = usePathname()

  return (
    <ul
      className={cn(
        "flex",
        orientation === "vertical" ? "flex-col gap-1" : "h-full gap-6"
      )}
    >
      {navItems.map((item) => {
        const current = getNavCurrent(pathname, item.href)
        return (
          <li key={item.href} className="flex">
            <Link
              href={item.href}
              aria-current={current}
              data-active={current ? "" : undefined}
              onClick={onNavigate}
              className={navLinkVariants({ orientation })}
            >
              {t(item.labelKey)}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
