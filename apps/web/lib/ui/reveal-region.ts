export function revealRegion(
  target: Pick<HTMLElement, "scrollIntoView" | "focus"> | null,
  { reducedMotion }: { reducedMotion: boolean },
): void {
  if (!target) return
  target.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" })
  target.focus({ preventScroll: true })
}

// Trả focus về nút cũ nếu nó còn trên trang và bấm được; nút đã bị gỡ hoặc vô hiệu (ví dụ sau khi xác nhận) thì cuộn tới vùng tác vụ.
export function restoreOrReveal(
  back: Pick<HTMLElement, "isConnected" | "matches" | "focus"> | null,
  region: Pick<HTMLElement, "scrollIntoView" | "focus"> | null,
  options: { reducedMotion: boolean },
): void {
  if (back?.isConnected && !back.matches(":disabled")) {
    back.focus()
    return
  }
  revealRegion(region, options)
}
