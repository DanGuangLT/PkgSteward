export type SelectTriggerSize = "sm" | "default"
export type SheetSide = "top" | "right" | "bottom" | "left"

const SELECT_TRIGGER_SHARED_CLASSES =
  "flex w-fit items-center justify-between gap-1.5 rounded-md border border-input bg-background px-[15px] py-2 text-body-md whitespace-nowrap text-foreground transition-colors focus-ring-input disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-placeholder:text-muted-foreground *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

const SELECT_TRIGGER_SIZE_CLASSES: Record<SelectTriggerSize, string> = {
  default: "h-11",
  sm: "h-9",
}

/** Builds base classes for SelectTrigger with direct height tokens so caller h-* overrides work via cn(). */
export function selectTriggerBaseClasses(size: SelectTriggerSize = "default"): string {
  return `${SELECT_TRIGGER_SHARED_CLASSES} ${SELECT_TRIGGER_SIZE_CLASSES[size]}`
}

const SHEET_CONTENT_SHARED_CLASSES =
  "fixed z-50 flex flex-col bg-popover bg-clip-padding text-body-md text-popover-foreground shadow-modal transition duration-200 ease-in-out data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"

const SHEET_CONTENT_SIDE_CLASSES: Record<SheetSide, string> = {
  top: "inset-x-0 top-0 h-auto border-b data-open:slide-in-from-top-10 data-closed:slide-out-to-top-10",
  right: "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm data-open:slide-in-from-right-10 data-closed:slide-out-to-right-10",
  bottom: "inset-x-0 bottom-0 h-auto border-t data-open:slide-in-from-bottom-10 data-closed:slide-out-to-bottom-10",
  left: "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm data-open:slide-in-from-left-10 data-closed:slide-out-to-left-10",
}

/** Builds base classes for SheetContent per side without data-[side=*] width specificity traps. */
export function sheetContentBaseClasses(side: SheetSide = "right"): string {
  return `${SHEET_CONTENT_SHARED_CLASSES} ${SHEET_CONTENT_SIDE_CLASSES[side]}`
}

const TABS_TRIGGER_BASE_CLASSES =
  "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-full border border-transparent px-3 py-1 text-button whitespace-nowrap text-muted-foreground transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:px-3 group-data-vertical/tabs:py-2 hover:text-foreground focus-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent data-active:bg-background data-active:text-foreground after:absolute after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-0 group-data-horizontal/tabs:after:h-[3px] group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:right-0 group-data-vertical/tabs:after:w-[3px] group-data-[variant=line]/tabs-list:data-active:after:opacity-100"

/** Builds base classes for TabsTrigger while keeping px-* overridable and the active line indicator unclipped. */
export function tabsTriggerBaseClasses(): string {
  return TABS_TRIGGER_BASE_CLASSES
}
