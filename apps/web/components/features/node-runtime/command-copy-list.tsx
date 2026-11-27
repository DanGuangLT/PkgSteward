"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertTriangleIcon,
  CheckIcon,
  CircleHelpIcon,
  CopyIcon,
  MinusCircleIcon,
  TerminalIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type {
  ManagerCommandSuggestion,
  NodeCompatibilityStatus,
} from "@/lib/node-runtime/node-runtime-types"

export function NodeRuntimeStatusBadge({
  status,
}: {
  status: NodeCompatibilityStatus
}) {
  const t = useTranslations("nodeRuntime")

  if (status === "compatible") {
    return (
      <Badge variant="success">
        <CheckIcon aria-hidden="true" />
        {t("statuses.compatible")}
      </Badge>
    )
  }
  if (status === "mismatch") {
    return (
      <Badge variant="warning">
        <AlertTriangleIcon aria-hidden="true" />
        {t("statuses.mismatch")}
      </Badge>
    )
  }
  if (status === "unknown") {
    return (
      <Badge variant="outline">
        <CircleHelpIcon aria-hidden="true" />
        {t("statuses.unknown")}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary">
      <MinusCircleIcon aria-hidden="true" />
      {t("statuses.undeclared")}
    </Badge>
  )
}

function CommandCopyRow({
  label,
  command,
  copied,
  onCopy,
}: {
  label: string
  command: string
  copied: boolean
  onCopy(command: string): void
}) {
  const t = useTranslations("nodeRuntime")
  const copyLabel = t(copied ? "commands.copiedShort" : "commands.copy")

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-caption text-muted-foreground">{label}</p>
        <code className="block break-all font-mono text-body-sm text-foreground">
          {command}
        </code>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={t("commands.copyAria", { label: copyLabel, command })}
        onClick={() => onCopy(command)}
      >
        {copied ? (
          <CheckIcon data-icon="inline-start" aria-hidden="true" />
        ) : (
          <CopyIcon data-icon="inline-start" aria-hidden="true" />
        )}
        {copyLabel}
      </Button>
    </div>
  )
}

export function ManagerCommandsList({
  commands,
}: {
  commands: readonly ManagerCommandSuggestion[]
}) {
  const t = useTranslations("nodeRuntime")
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null)
  const resetTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  if (commands.length === 0) return null

  async function handleCopy(command: string) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable")
      }
      await navigator.clipboard.writeText(command)
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current)
      }
      setCopiedCommand(command)
      toast.success(t("commands.copied", { command }))
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null
        setCopiedCommand((current) => (current === command ? null : current))
      }, 2000)
    } catch {
      toast.error(t("commands.copyFailed"))
    }
  }

  return (
    <div className="min-w-0 space-y-2.5">
      <div className="flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
        <TerminalIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{t("commands.heading")}</span>
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {copiedCommand ? t("commands.copied", { command: copiedCommand }) : ""}
      </div>
      <div className="grid min-w-0 gap-2">
        {commands.map((item) => (
          <div key={item.managerId} className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-caption">
              <span className="font-semibold text-foreground">
                {item.managerLabel}
              </span>
              <Badge variant={item.alreadyInstalled ? "success" : "outline"}>
                {t(
                  item.alreadyInstalled
                    ? "commands.alreadyInstalled"
                    : "commands.needsInstall",
                  { version: item.targetVersion },
                )}
              </Badge>
            </div>
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              {item.installCommand ? (
                <CommandCopyRow
                  label={t("commands.installStep")}
                  command={item.installCommand}
                  copied={copiedCommand === item.installCommand}
                  onCopy={(cmd) => {
                    void handleCopy(cmd)
                  }}
                />
              ) : null}
              <CommandCopyRow
                label={t("commands.switchStep")}
                command={item.switchCommand}
                copied={copiedCommand === item.switchCommand}
                onCopy={(cmd) => {
                  void handleCopy(cmd)
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
