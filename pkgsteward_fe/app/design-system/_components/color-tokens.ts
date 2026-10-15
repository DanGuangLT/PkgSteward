/**
 * Ô màu trình bày ở section "Màu sắc". Class viết nguyên văn (không ghép
 * chuỗi) để Tailwind quét được. Thêm token màu mới trong styles/tokens.css
 * → thêm 1 dòng ở đây.
 */
export type ColorSwatch = {
  /** Token chính: màu nền, hoặc màu chữ / viền với nhóm `text` / `lines`. */
  token: string
  /** Token chữ đặt trên nền `token` (nếu có). */
  on?: string
  /** Class của ô mẫu. */
  className: string
}

type ColorGroup = {
  id: "surfaces" | "actions" | "status" | "text" | "lines"
  swatches: readonly ColorSwatch[]
}

export const colorGroups: readonly ColorGroup[] = [
  {
    id: "surfaces",
    swatches: [
      { token: "background", on: "foreground", className: "bg-background text-foreground" },
      { token: "card", on: "card-foreground", className: "bg-card text-card-foreground" },
      { token: "popover", on: "popover-foreground", className: "bg-popover text-popover-foreground" },
      { token: "muted", on: "muted-foreground", className: "bg-muted text-muted-foreground" },
      { token: "accent", on: "accent-foreground", className: "bg-accent text-accent-foreground" },
    ],
  },
  {
    id: "actions",
    swatches: [
      { token: "primary", on: "primary-foreground", className: "bg-primary text-primary-foreground" },
      { token: "primary-pressed", on: "primary-foreground", className: "bg-primary-pressed text-primary-foreground" },
      { token: "secondary", on: "secondary-foreground", className: "bg-secondary text-secondary-foreground" },
      { token: "secondary-pressed", on: "secondary-foreground", className: "bg-secondary-pressed text-secondary-foreground" },
    ],
  },
  {
    id: "status",
    swatches: [
      { token: "destructive", on: "destructive-foreground", className: "bg-destructive text-destructive-foreground" },
      { token: "success", on: "success-foreground", className: "bg-success text-success-foreground" },
      { token: "success-soft", on: "success", className: "bg-success-soft text-success" },
    ],
  },
  {
    id: "text",
    swatches: [
      { token: "foreground", className: "bg-background text-foreground" },
      { token: "body", className: "bg-background text-body" },
      { token: "ink-soft", className: "bg-background text-ink-soft" },
      { token: "muted-foreground", className: "bg-background text-muted-foreground" },
      { token: "destructive", className: "bg-background text-destructive" },
      { token: "success", className: "bg-background text-success" },
    ],
  },
  {
    id: "lines",
    swatches: [
      { token: "border", className: "border-2 border-border bg-background" },
      { token: "input", className: "border-2 border-input bg-background" },
      { token: "ring", className: "border-4 border-ring bg-background" },
      { token: "focus-inner", className: "bg-focus-inner" },
      { token: "overlay", className: "bg-overlay" },
    ],
  },
]
