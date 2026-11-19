export interface ToggleGroupLayoutOptions {
  spacing?: number
  orientation?: "horizontal" | "vertical"
}

const TOGGLE_GROUP_BASE_CLASSES =
  "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] data-[spacing=0]:data-[variant=outline]:rounded-full data-vertical:flex-col data-vertical:items-stretch"

/** Builds base layout classes for ToggleGroup root, wrapping horizontal spaced groups by default. */
export function toggleGroupRootBaseClasses({
  spacing = 2,
  orientation = "horizontal",
}: ToggleGroupLayoutOptions = {}): string {
  const wraps = orientation === "horizontal" && spacing !== 0
  return wraps ? `${TOGGLE_GROUP_BASE_CLASSES} flex-wrap` : TOGGLE_GROUP_BASE_CLASSES
}
