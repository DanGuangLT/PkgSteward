import type { SVGProps } from "react"

import { cn } from "@/lib/utils"

/**
 * Logo PkgSteward: khối hộp package nổi trên nền bo góc kèm khung đỡ phía dưới,
 * đồng bộ hình học với app/icon.svg và đọc màu qua token logo của theme.
 */
export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" focusable="false" {...props}>
      <rect width="512" height="512" rx="116" className="fill-logo-surface" />
      <path
        className="fill-logo-cube"
        d="M256 79.5 L383.3 153 L256 226.5 L128.7 153 Z M122.2 164.25 L249.5 237.75 V384.75 L122.2 311.25 Z M389.8 164.25 L262.5 237.75 V384.75 L389.8 311.25 Z"
      />
      <path
        className="fill-logo-cradle"
        d="M65 191 H102 V336.64 L256 425.55 L410 336.64 V191 H447 V358 L256 468.27 L65 358 Z"
      />
    </svg>
  )
}

/**
 * Wordmark hai tông màu của PkgSteward: phần "Pkg" dùng màu primary và phần
 * "Steward" dùng màu foreground để giữ tương phản tốt ở cả chế độ sáng và tối.
 */
export function BrandWordmark({
  label = "PkgSteward",
  className,
}: {
  label?: string
  className?: string
}) {
  if (label.startsWith("Pkg")) {
    return (
      <span className={className}>
        <span className="text-primary">Pkg</span>
        <span className="text-foreground">{label.slice(3)}</span>
      </span>
    )
  }

  return <span className={cn("text-primary", className)}>{label}</span>
}
