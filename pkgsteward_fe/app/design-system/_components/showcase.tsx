import { cn } from "@/lib/utils"

/**
 * Một section của trang design system: `id` cho mục lục nhảy tới, tiêu đề h2
 * và mô tả ngắn. `scroll-mt-24` chừa chỗ cho thanh điều hướng sticky 64px.
 */
export function ShowcaseSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children: React.ReactNode
}) {
  const headingId = `${id}-heading`

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="flex scroll-mt-24 flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <h2 id={headingId} className="text-heading-lg">
          {title}
        </h2>
        <p className="max-w-prose text-body-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  )
}

/** Khung trình bày 1 component / nhóm token: tiêu đề h3 + vùng mẫu viền hairline. */
export function ShowcaseItem({
  title,
  description,
  className,
  children,
}: {
  title: string
  description?: string
  /** Ghi đè bố cục vùng mẫu (mặc định: hàng ngang, tự xuống dòng). */
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-heading-md">{title}</h3>
        {description ? (
          <p className="max-w-prose text-body-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div
        className={cn(
          "flex flex-wrap items-center gap-4 rounded-md border border-border p-4 sm:p-6",
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** 1 hàng mẫu trong ShowcaseItem: nhãn code (variant/size) + các mẫu. */
export function ShowcaseRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <TokenName>{label}</TokenName>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

/** Tên token / class / variant, hiển thị bằng font mono. */
export function TokenName({
  className,
  ...props
}: React.ComponentProps<"code">) {
  return (
    <code
      className={cn("font-mono text-caption text-muted-foreground", className)}
      {...props}
    />
  )
}
