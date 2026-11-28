export type AlertDialogSize = "default" | "sm"

const ALERT_DIALOG_CONTENT_BASE_CLASSES =
  "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] min-w-0 grid-cols-1 -translate-x-1/2 -translate-y-1/2 gap-6 rounded-xl border border-border bg-popover p-8 text-popover-foreground shadow-modal duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"

const ALERT_DIALOG_CONTENT_SIZE_CLASSES: Record<AlertDialogSize, string> = {
  default: "sm:max-w-[480px]",
  sm: "max-w-xs",
}

/** Builds base layout classes for AlertDialogContent so caller max-w utilities override cleanly via cn(). */
export function alertDialogContentBaseClasses(size: AlertDialogSize = "default"): string {
  return `${ALERT_DIALOG_CONTENT_BASE_CLASSES} ${ALERT_DIALOG_CONTENT_SIZE_CLASSES[size]}`
}
