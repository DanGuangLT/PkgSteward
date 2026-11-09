"use client"

import { LoaderCircleIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslations } from "next-intl"

import type messages from "@/messages/vi.json"

export function PmActionLabel({ pending, icon: Icon, children }: { pending: boolean; icon?: LucideIcon; children: ReactNode }) {
  return <>{pending ? <LoaderCircleIcon aria-hidden="true" className="size-4 shrink-0 animate-spin" /> : Icon ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}<span className="min-w-0 [overflow-wrap:anywhere]">{children}</span></>
}

// Branch on server codes, never messages; unknown codes fall back to a generic text.
export function PmCodeMessage({ code, kind = "codes" }: { code: string; kind?: "codes" | "warnings" | "limitations" }) {
  const t = useTranslations("packageManagers")
  const key = `${kind}.${code}` as
    | `codes.${keyof typeof messages.packageManagers.codes}`
    | `warnings.${keyof typeof messages.packageManagers.warnings}`
    | `limitations.${keyof typeof messages.packageManagers.limitations}`
  return <>{t(t.has(key) ? key : "codes.UNKNOWN")}</>
}
