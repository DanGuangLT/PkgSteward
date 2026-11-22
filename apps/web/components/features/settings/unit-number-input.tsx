"use client"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export function UnitNumberInput({
  id,
  unit,
  error,
  hint,
  containerClassName,
  className,
  compact = false,
  ...props
}: React.ComponentProps<"input"> & {
  unit: string | null
  error?: string | null
  hint?: string | null
  containerClassName?: string
  compact?: boolean
}) {
  const errorId = id && error ? `${id}-error` : undefined
  const hintId = id && hint ? `${id}-hint` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined

  return (
    <div className={cn("flex flex-col gap-1", containerClassName)}>
      <div className="flex items-stretch">
        <Input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "font-mono",
            compact && "h-9 text-body-sm",
            unit && "rounded-r-none border-r-0",
            className
          )}
          {...props}
        />
        {unit && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-r-md border border-input bg-muted/60 px-3 font-mono text-caption font-medium text-muted-foreground select-none",
              error && "border-destructive text-destructive",
              compact ? "h-9" : "h-11"
            )}
          >
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <p id={hintId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
