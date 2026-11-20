"use client"

import { useState, type ReactNode } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface DisabledTooltipProps {
  /** Explanation shown on hover and keyboard focus while the wrapped control is disabled. */
  reason: string | null | undefined
  side?: "top" | "right" | "bottom" | "left"
  className?: string
  children: ReactNode
}

/**
 * Wraps a button/control in a stable, strictly controlled Radix Tooltip trigger so DOM
 * identity and refs (e.g., focus restoration) never unmount across enabled/disabled
 * transitions, and stale open state can never leak across transitions.
 */
export function DisabledTooltip({
  reason,
  side = "top",
  className,
  children,
}: DisabledTooltipProps) {
  const [open, setOpen] = useState(false)
  const active = Boolean(reason)

  if (!active && open) {
    setOpen(false)
  }

  return (
    <Tooltip
      open={active && open}
      onOpenChange={(next) => setOpen(active && next)}
      delayDuration={150}
    >
      <TooltipTrigger asChild>
        <span
          tabIndex={active ? 0 : undefined}
          className={cn(
            "inline-grid max-w-full",
            active && "cursor-not-allowed rounded-md focus-ring [&_button:disabled]:pointer-events-none",
            className,
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      {active ? (
        <TooltipContent
          side={side}
          sideOffset={6}
          className="pointer-events-auto z-60 max-w-xs whitespace-normal text-left leading-snug"
        >
          {reason}
        </TooltipContent>
      ) : null}
    </Tooltip>
  )
}
