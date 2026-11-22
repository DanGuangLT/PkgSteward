"use client"

import { useTranslations } from "next-intl"

import { SettingsWorkspace } from "@/components/features/settings/settings-workspace"
import { useSettings } from "@/components/settings/settings-provider"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"

function isTargetInsideNestedAlertDialog(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('[data-slot="alert-dialog-content"], [data-slot="alert-dialog-overlay"]')
  )
}

export function SettingsWindowModal() {
  const t = useTranslations("settings")
  const { settingsOpen, setSettingsOpen, closeSettings } = useSettings()

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent
        showCloseButton={false}
        onPointerDownOutside={(event) => {
          if (isTargetInsideNestedAlertDialog(event.target)) {
            event.preventDefault()
          }
        }}
        onInteractOutside={(event) => {
          if (isTargetInsideNestedAlertDialog(event.target)) {
            event.preventDefault()
          }
        }}
        onEscapeKeyDown={(event) => {
          if (
            typeof document !== "undefined" &&
            document.querySelector('[data-slot="alert-dialog-content"]')
          ) {
            event.preventDefault()
          }
        }}
        className="flex h-[min(90dvh,860px)] w-[calc(100%-1rem)] max-w-[1160px] flex-col gap-0 overflow-hidden rounded-xl border border-border bg-background p-0 shadow-modal sm:w-[92vw] sm:max-w-[1160px]"
      >
        <DialogTitle className="sr-only">{t("title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("description")}</DialogDescription>
        {settingsOpen && (
          <SettingsWorkspace variant="modal" initialSnapshot={null} onClose={closeSettings} />
        )}
      </DialogContent>
    </Dialog>
  )
}
