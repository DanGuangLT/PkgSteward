"use client"

import { AlertTriangleIcon } from "lucide-react"
import { useMemo } from "react"
import { useFormatter, useTranslations } from "next-intl"

import { Badge } from "@/components/ui/badge"
import type { ProjectAdvisory } from "@/lib/api/types"
import { sortProjectAdvisories } from "@/lib/projects/project-detail-list"

export function ProjectAdvisories({ items }: { items: readonly ProjectAdvisory[] }) {
  const t = useTranslations("projectDetail")
  const format = useFormatter()
  const sorted = useMemo(() => sortProjectAdvisories(items), [items])
  return (
    <section className="min-w-0 space-y-4" aria-label={t("audit.title")}>
      <h2 className="text-heading-md">{t("audit.title")}</h2>
      <p className="text-body-sm text-muted-foreground">{t("audit.lockfileCoverage")}</p>
      <p className="text-body-sm">{t("audit.notInstalledState")}</p>
      <p className="text-body-sm">{t("audit.count", { count: items.length, formattedCount: format.number(items.length) })}</p>
      {items.length === 0 ? <p className="text-body-sm text-muted-foreground">{t("audit.empty")}</p> : (
        <ul className="min-w-0 space-y-4">{sorted.map(item => (
          <li key={JSON.stringify([item.name, item.id, item.range])} className="min-w-0 space-y-3 rounded-md border border-border bg-card p-4 text-body-sm text-card-foreground [overflow-wrap:anywhere]">
            <Badge variant="outline" className="h-auto whitespace-normal"><AlertTriangleIcon aria-hidden="true" />{t("audit.severity")}: {t(`audit.severities.${item.severity}`)}</Badge>
            <h3 className="text-heading-md">{item.url !== null ? (
              <a href={item.url} rel="noreferrer" target="_blank" className="rounded-sm text-ink-soft underline focus-ring">{item.title}</a>
            ) : item.title}</h3>
            <p className="font-mono">{item.name}</p>
            <p>{t(item.direct ? "audit.direct" : "audit.transitive")}</p>
            <dl className="space-y-2">
              <div><dt className="text-muted-foreground">{t("audit.affectedVersions")}</dt><dd className="font-mono">{item.affectedVersions.length ? item.affectedVersions.join(", ") : t("dependencies.unknown")}</dd></div>
              <div><dt className="text-muted-foreground">{t("audit.range")}</dt><dd className="font-mono">{item.range}</dd></div>
            </dl>
          </li>
        ))}</ul>
      )}
    </section>
  )
}
