"use client"

import Link from "next/link"
import type { ComponentProps, ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { useNavigationContinuity } from "@/hooks/use-navigation-continuity"
import { validateReturnTarget } from "@/lib/ui/navigation-targets"

interface ReturnLinkProps {
  href: string
  originId?: string | null
  children: ReactNode
  className?: string
  variant?: ComponentProps<typeof Button>["variant"]
  size?: ComponentProps<typeof Button>["size"]
}

export function ReturnLink({
  href,
  originId = null,
  children,
  className,
  variant = "secondary",
  size = "default",
}: ReturnLinkProps) {
  const { scheduleReturnScroll, flushScroll } = useNavigationContinuity()
  const safeHref = validateReturnTarget(href) ?? "/"

  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link
        href={safeHref}
        prefetch={false}
        scroll={false}
        onClick={() => {
          flushScroll()
          if (originId) scheduleReturnScroll(safeHref, originId)
        }}
      >
        {children}
      </Link>
    </Button>
  )
}
