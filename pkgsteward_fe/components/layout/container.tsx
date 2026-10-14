import { cn } from "@/lib/utils"

/** Vùng nội dung căn giữa, rộng tối đa ~1280px, lề 16px (mobile) / 24px. */
export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("mx-auto w-full max-w-content px-4 sm:px-6", className)}
      {...props}
    />
  )
}
