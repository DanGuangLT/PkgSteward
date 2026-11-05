export function revealRegion(
  target: Pick<HTMLElement, "scrollIntoView" | "focus"> | null,
  { reducedMotion }: { reducedMotion: boolean },
): void {
  if (!target) return
  target.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" })
  target.focus({ preventScroll: true })
}
