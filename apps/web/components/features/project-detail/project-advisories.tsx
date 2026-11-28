"use client"

import { AlertTriangleIcon } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { useFormatter, useLocale, useTranslations } from "next-intl"
import { DiscoveryControls, DiscoveryFilter, DiscoverySort, DiscoveryEmpty } from "@/components/shared/list-discovery"
import { ListPagination, useListPagination } from "@/components/shared/list-pagination"
import { useViewState } from "@/hooks/use-navigation-continuity"
import { makeViewStateKey } from "@/lib/ui/navigation-targets"


import { Badge } from "@/components/ui/badge"
import type { ProjectAdvisory } from "@/lib/api/types"
import { selectAdvisories, ADVISORY_SEVERITY_FILTERS, ADVISORY_EXPOSURE_FILTERS } from "@/lib/projects/detail-filters"
import { ADVISORY_DISCOVERY, advisoryDiscoveryCodec } from "@/lib/projects/detail-discovery-state"

export function ProjectAdvisories({ items, resourceKey }: { items: readonly ProjectAdvisory[]; resourceKey?: string }) {
  const t = useTranslations("projectDetail")
  const format = useFormatter()
  const d = useTranslations("listDiscovery")
  const locale = useLocale()
  const persisted = useViewState(makeViewStateKey("project-advisories", resourceKey), advisoryDiscoveryCodec, ADVISORY_DISCOVERY)
  const [local, setLocal] = useState(ADVISORY_DISCOVERY)
  const [view, setView, reset] = resourceKey ? persisted : [local, setLocal, () => setLocal(ADVISORY_DISCOVERY)] as const
  const sorted = useMemo(() => selectAdvisories(items, view.query, view.sort, locale, view), [items, view, locale])
  const listAnchorRef = useRef<HTMLDivElement | null>(null)
  const advisoriesResetKey = useMemo(() => JSON.stringify([resourceKey ?? "", view]), [resourceKey, view])
  const advisoriesPagination = useListPagination(sorted, {
    resetKey: advisoriesResetKey,
    scrollTargetRef: listAnchorRef,
  })
  return (
    <section className="min-w-0 space-y-4" aria-label={t("audit.title")}>
      <h2 className="text-heading-md">{t("audit.title")}</h2>
      <p className="text-body-sm text-muted-foreground">{t("audit.lockfileCoverage")}</p>
      <p className="text-body-sm">{t("audit.notInstalledState")}</p>
      <p className="text-body-sm">{t("audit.count", { count: items.length, formattedCount: format.number(items.length) })}</p>
      <DiscoveryControls query={view.query} onQueryChange={query => setView({ ...view, query })} count={sorted.length} total={items.length} onReset={reset}>
        <DiscoveryFilter label={d("severities")} value={view.severities} options={ADVISORY_SEVERITY_FILTERS.map(value => ({ value, label: d(`values.${value}`), count: items.filter(item => item.severity === value).length }))} onValueChange={severities => setView({ ...view, severities })} />
        <DiscoveryFilter label={d("exposures")} value={view.exposures} options={ADVISORY_EXPOSURE_FILTERS.map(value => ({ value, label: d(`values.${value}`), count: items.filter(item => item.direct === (value === "direct")).length }))} onValueChange={exposures => setView({ ...view, exposures })} />
        <DiscoverySort value={view.sort} options={[{ value: "severity", label: d("severity") }, { value: "name", label: d("name") }]} onValueChange={sort => setView({ ...view, sort })} />
      </DiscoveryControls>
      {sorted.length === 0 ? <DiscoveryEmpty total={items.length} /> : (
        <div ref={listAnchorRef} className="min-w-0 scroll-mt-20 space-y-4">
          <ul className="min-w-0 space-y-4">{advisoriesPagination.items.map(item => (
            <li key={JSON.stringify([item.name, item.id, item.range])} className="min-w-0 space-y-3 rounded-md border border-border bg-card p-4 text-body-sm text-card-foreground [overflow-wrap:anywhere]">
              <Badge variant="outline" className="h-auto min-h-6 max-w-full py-1 leading-tight whitespace-normal"><AlertTriangleIcon aria-hidden="true" />{t("audit.severity")}: {t(`audit.severities.${item.severity}`)}</Badge>
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
          <ListPagination
            meta={advisoriesPagination.meta}
            pageSize={advisoriesPagination.pageSize}
            showPageSizeSelector={advisoriesPagination.showPageSizeSelector}
            onPageChange={advisoriesPagination.setPage}
            onPageSizeChange={advisoriesPagination.setPageSize}
          />
        </div>
      )}
    </section>
  )
}
