"use client"

import { InfoIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { Badge } from "@/components/ui/badge"
import type { Risk, RiskLevel } from "@/lib/api/types"

const LEVELS = {
  low: { variant: "secondary", Icon: InfoIcon },
  medium: { variant: "outline", Icon: TriangleAlertIcon },
  high: { variant: "destructive", Icon: OctagonAlertIcon },
} as const

export function RiskBadge({ level }: { level: RiskLevel }) {
  const t = useTranslations("fileOps")
  const { variant, Icon } = LEVELS[level]
  return <Badge variant={variant}><Icon aria-hidden="true" />{t(`riskLevel.${level}`)}</Badge>
}

export function RiskReasons({ risk }: { risk: Risk }) {
  const t = useTranslations("fileOps")
  if (risk.reasons.length === 0) return null
  return (
    <ul className="min-w-0 space-y-1 text-caption text-muted-foreground">
      {risk.reasons.map(({ code }) => <li key={code}>{t(`risk.${code}`)}</li>)}
    </ul>
  )
}
