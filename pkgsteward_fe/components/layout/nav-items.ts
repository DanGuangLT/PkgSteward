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
  { href: "/design-system", labelKey: "designSystem" },
] as const satisfies readonly NavItem[]
