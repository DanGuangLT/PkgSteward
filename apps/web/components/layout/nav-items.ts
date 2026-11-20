import type { Messages } from "next-intl"

type NavItem = {
  href: string
  /** Key trong namespace `nav` của messages/*.json */
  labelKey: keyof Messages["nav"]
}

/**
 * Các mục điều hướng chính. Thêm màn hình mới (Global packages, Node.js...)
 * → thêm 1 dòng ở đây + nhãn trong messages/*.json › nav.
 */
export const navItems = [
  { href: "/", labelKey: "projects" },
  { href: "/disk-usage", labelKey: "diskUsage" },
  { href: "/cleanup", labelKey: "cleanup" },
  { href: "/global-packages", labelKey: "globalPackages" },
  { href: "/design-system", labelKey: "designSystem" },
] as const satisfies readonly NavItem[]

export function getNavCurrent(pathname: string, href: string): "page" | "true" | undefined {
  if (pathname === href) return "page"

  const sectionPath = href === "/" ? "/projects" : href
  if (pathname === sectionPath || pathname.startsWith(`${sectionPath}/`)) return "true"
}
