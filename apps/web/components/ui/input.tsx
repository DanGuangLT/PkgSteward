import * as React from "react"

import { cn } from "@/lib/utils"

// Text input: cao ~44px, viền 1px ash, bo 16px, chữ body-md.
// Focus: viền trong 2px màu chữ + vòng ngoài 4px xanh (utility focus-ring-input).
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-md border border-input bg-background px-[15px] py-2 text-body-md text-foreground transition-colors focus-ring-input file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-button file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
