"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cva, type VariantProps } from "class-variance-authority"
import {
  CpuIcon,
  FolderGit2Icon,
  GlobeIcon,
  HardDriveIcon,
  type LucideIcon,
  PaletteIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { getNavCurrent, IS_DEV_ENVIRONMENT, type NavIconKey, navItems } from "@/components/layout/nav-items"
import { useSettingsOptional } from "@/components/settings/settings-provider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const NAV_ICONS = {
  projects: FolderGit2Icon,
  diskUsage: HardDriveIcon,
  cleanup: Trash2Icon,
  globalPackages: GlobeIcon,
  nodeRuntime: CpuIcon,
  designSystem: PaletteIcon,
} satisfies Record<NavIconKey, LucideIcon>

// Mục đang chọn có gạch chân đỏ (topbar) hoặc nền nổi (sidebar/mobile).
const navLinkVariants = cva(
  "text-button text-muted-foreground transition-colors focus-ring hover:text-foreground data-active:text-foreground",
  {
    variants: {
      orientation: {
        horizontal:
          "relative inline-flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-full after:bg-primary after:opacity-0 data-active:after:opacity-100",
        vertical: "flex h-11 w-full items-center gap-2.5 rounded-md px-3 hover:bg-muted data-active:bg-muted",
      },
    },
    defaultVariants: {
      orientation: "horizontal",
    },
  }
)

export function NavLinks({
  orientation = "horizontal",
  collapsed = false,
  showIcons = false,
  onNavigate,
}: VariantProps<typeof navLinkVariants> & {
  collapsed?: boolean
  showIcons?: boolean
  /** Gọi khi bấm 1 link — VD: đóng menu mobile. */
  onNavigate?: () => void
}) {
  const t = useTranslations("nav")
  const pathname = usePathname()
  const settings = useSettingsOptional()
  const showDesignSystem =
    IS_DEV_ENVIRONMENT && (settings ? settings.behavior.showDesignSystemInNav : true)

  const visibleItems = navItems.filter((item) => item.href !== "/design-system" || showDesignSystem)

  return (
    <ul
      className={cn(
        "flex",
        orientation === "vertical" ? "flex-col gap-1" : "h-full gap-4 xl:gap-5"
      )}
    >
      {visibleItems.map((item) => {
        const current = getNavCurrent(pathname, item.href)
        const Icon = NAV_ICONS[item.iconKey]
        const label = t(item.labelKey)

        const link = (
          <Link
            href={item.href}
            aria-current={current}
            aria-label={collapsed ? label : undefined}
            data-active={current ? "" : undefined}
            onClick={onNavigate}
            className={cn(
              navLinkVariants({ orientation }),
              collapsed && orientation === "vertical" && "justify-center px-0"
            )}
          >
            {(showIcons || collapsed) && <Icon className="size-4 shrink-0" aria-hidden />}
            {!collapsed && <span>{label}</span>}
          </Link>
        )

        return (
          <li key={item.href} className={cn("flex", orientation === "vertical" && "w-full")}>
            {collapsed && orientation === "vertical" ? (
              <Tooltip>
                <TooltipTrigger asChild>{<div className="w-full">{link}</div>}</TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            ) : (
              link
            )}
          </li>
        )
      })}
    </ul>
  )
}
