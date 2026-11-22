import type { Messages } from "next-intl"

export type NavIconKey =
  | "projects"
  | "diskUsage"
  | "cleanup"
  | "globalPackages"
  | "designSystem"

export type NavItem = {
  href: string
  /** Key trong namespace `nav` của messages/*.json */
  labelKey: keyof Messages["nav"]
  iconKey: NavIconKey
}

/**
 * Các mục điều hướng chính. Thêm màn hình mới (Global packages, Node.js...)
 * → thêm 1 dòng ở đây + nhãn trong messages/*.json › nav.
 */
export const navItems = [
  { href: "/", labelKey: "projects", iconKey: "projects" },
  { href: "/disk-usage", labelKey: "diskUsage", iconKey: "diskUsage" },
  { href: "/cleanup", labelKey: "cleanup", iconKey: "cleanup" },
  { href: "/global-packages", labelKey: "globalPackages", iconKey: "globalPackages" },
  { href: "/design-system", labelKey: "designSystem", iconKey: "designSystem" },
] as const satisfies readonly NavItem[]

export function getNavCurrent(pathname: string, href: string): "page" | "true" | undefined {
  if (pathname === href) return "page"

  const sectionPath = href === "/" ? "/projects" : href
  if (pathname === sectionPath || pathname.startsWith(`${sectionPath}/`)) return "true"
}
