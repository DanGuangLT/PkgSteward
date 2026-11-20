"use client"

import { AlertTriangleIcon, ArrowUpIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { useFormatter, useLocale, useTranslations } from "next-intl"
import { DiscoveryControls, DiscoveryFilter, DiscoverySort, DiscoveryEmpty } from "@/components/shared/list-discovery"
import { useViewState } from "@/hooks/use-navigation-continuity"
import { makeViewStateKey } from "@/lib/ui/navigation-targets"
import { DEPENDENCY_GROUP_FILTERS, DEPENDENCY_STATUS_FILTERS, selectDependencies, createDependencyStatusReader } from "@/lib/projects/detail-filters"
import { DEPENDENCY_DISCOVERY, dependencyDiscoveryCodec } from "@/lib/projects/detail-discovery-state"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ProjectAnalysisCode, ProjectAnalysisJob, ProjectDependency, ProjectOutdated } from "@/lib/api/types"
import { createProjectDependencyBadgeReader, createProjectDependencyRowsReader } from "@/lib/projects/project-detail-list"

function DependencyName({ dependency, badges }: {
  dependency: ProjectDependency
  badges: { outdated: boolean; vulnerable: boolean }
}) {
  const t = useTranslations("projectDetail")
  return (
    <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
      <p className="font-mono font-semibold">{dependency.name}</p>
      {badges.outdated ? <Badge variant="secondary" className="h-auto whitespace-normal"><ArrowUpIcon aria-hidden="true" />{t("dependencies.outdated")}</Badge> : null}
      {badges.vulnerable ? <Badge variant="warning" className="h-auto whitespace-normal"><AlertTriangleIcon aria-hidden="true" />{t("dependencies.vulnerable")}</Badge> : null}
    </div>
  )
}

function DependencyWarning({ warning }: { warning: ProjectAnalysisCode | null | undefined }) {
  const t = useTranslations("projectDetail")
  return warning ? <p className="mt-2 text-body-sm font-medium text-warning"><AlertTriangleIcon aria-hidden="true" className="mr-1.5 inline size-4" />{t(`errors.${warning}`)}</p> : null
}

function DependencyVersions({ lockedVersions, result }: { lockedVersions: readonly string[]; result?: ProjectOutdated }) {
  const t = useTranslations("projectDetail")
  return (
    <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
      <dl className="space-y-2">
        <div><dt className="text-muted-foreground">{t("dependencies.locked")}</dt><dd className="font-mono">{lockedVersions.length ? lockedVersions.join(", ") : t("dependencies.unknown")}</dd></div>
        <div><dt className="text-muted-foreground">{t("dependencies.wanted")}</dt><dd className="font-mono">{result?.wanted ?? t("dependencies.unknown")}</dd></div>
        <div><dt className="text-muted-foreground">{t("dependencies.latest")}</dt><dd className="font-mono">{result?.latest ?? t("dependencies.unknown")}</dd></div>
      </dl>
      <DependencyWarning warning={result?.warning} />
    </div>
  )
}

export function ProjectDependencies({ dependencies, job, resourceKey }: {
  dependencies: readonly ProjectDependency[]
  job: ProjectAnalysisJob | null
  resourceKey?: string
}) {
  const t = useTranslations("projectDetail")
  const format = useFormatter()
  const d = useTranslations("listDiscovery")
  const locale = useLocale()
  const persisted = useViewState(makeViewStateKey("project-dependencies", resourceKey), dependencyDiscoveryCodec, DEPENDENCY_DISCOVERY)
  const [local, setLocal] = useState(DEPENDENCY_DISCOVERY)
  const [view, setView, reset] = resourceKey ? persisted : [local, setLocal, () => setLocal(DEPENDENCY_DISCOVERY)] as const
  const visible = useMemo(() => selectDependencies(dependencies, job, view.query, view.sort, locale, view), [dependencies, job, view, locale])
  const readStatus = createDependencyStatusReader(job)
  const items = useMemo(() => {
    const readBadges = createProjectDependencyBadgeReader(job)
    const readRows = createProjectDependencyRowsReader(job?.outdated.items ?? [])
    return visible.map(dependency => ({ dependency, badges: readBadges(dependency.name), rows: readRows(dependency) }))
  }, [visible, job])
  return (
    <section className="min-w-0 space-y-4" aria-label={t("dependencies.title")}>
      <h2 className="text-heading-md">{t("dependencies.title")}</h2>
      <DiscoveryControls query={view.query} onQueryChange={query => setView({ ...view, query })} count={visible.length} total={dependencies.length} onReset={reset}>
        <DiscoveryFilter label={d("groups")} value={view.groups} options={DEPENDENCY_GROUP_FILTERS.map(value => ({ value, label: d(`values.${value}`), count: dependencies.filter(item => item.declarations.some(row => row.group === value)).length }))} onValueChange={groups => setView({ ...view, groups })} />
        <DiscoveryFilter label={d("statuses")} value={view.statuses} options={DEPENDENCY_STATUS_FILTERS.map(value => ({ value, label: d(`values.${value}`), count: dependencies.filter(item => readStatus(item)[value]).length }))} onValueChange={statuses => setView({ ...view, statuses })} />
        <DiscoverySort value={view.sort} options={[{ value: "name", label: d("name") }, { value: "status", label: d("status") }]} onValueChange={sort => setView({ ...view, sort })} />
      </DiscoveryControls>
      <p className="text-body-sm text-muted-foreground">{t("dependencies.count", { count: dependencies.length, formattedCount: format.number(dependencies.length) })}</p>
      {visible.length === 0 ? <DiscoveryEmpty total={dependencies.length} /> : (
        <>
          <div className="hidden min-w-0 rounded-md bg-card text-card-foreground lg:block">
            <Table className="table-fixed">
              <TableCaption className="sr-only">{t("dependencies.title")}</TableCaption>
              <TableHeader><TableRow>
                <TableHead scope="col" className="w-1/4 whitespace-normal">{t("dependencies.name")}</TableHead>
                <TableHead scope="col" className="whitespace-normal">{t("dependencies.groups")}</TableHead>
                <TableHead scope="col" className="whitespace-normal">{t("dependencies.spec")}</TableHead>
                <TableHead scope="col" className="whitespace-normal">{t("dependencies.locked")}</TableHead>
                <TableHead scope="col" className="whitespace-normal">{t("dependencies.wanted")}</TableHead>
                <TableHead scope="col" className="whitespace-normal">{t("dependencies.latest")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>{items.flatMap(({ dependency, badges, rows }) => rows.map((row, index) => (
                <TableRow key={JSON.stringify([dependency.name, row.spec])}>
                  {index === 0 ? (
                    <TableCell rowSpan={rows.length} className="align-top whitespace-normal">
                      <DependencyName dependency={dependency} badges={badges} />
                    </TableCell>
                  ) : null}
                  <TableCell className="align-top font-mono whitespace-normal [overflow-wrap:anywhere]">{row.groups.map(group => <p key={group}>{group}</p>)}</TableCell>
                  <TableCell className="align-top font-mono whitespace-normal [overflow-wrap:anywhere]">{row.spec}</TableCell>
                  <TableCell className="align-top font-mono whitespace-normal [overflow-wrap:anywhere]">{row.lockedVersions.join(", ") || t("dependencies.unknown")}</TableCell>
                  <TableCell className="align-top font-mono whitespace-normal [overflow-wrap:anywhere]">{row.result?.wanted ?? t("dependencies.unknown")}</TableCell>
                  <TableCell className="align-top whitespace-normal [overflow-wrap:anywhere]">
                    <p className="font-mono">{row.result?.latest ?? t("dependencies.unknown")}</p>
                    <DependencyWarning warning={row.result?.warning} />
                  </TableCell>
                </TableRow>
              )))}</TableBody>
            </Table>
          </div>
          <ul className="grid min-w-0 gap-4 lg:hidden" aria-label={t("dependencies.title")}>{items.map(({ dependency, badges, rows }) => (
            <li key={dependency.name} className="min-w-0"><Card className="min-w-0">
              <CardHeader className="min-w-0"><CardTitle><DependencyName dependency={dependency} badges={badges} /></CardTitle></CardHeader>
              <CardContent className="min-w-0 divide-y divide-border text-body-sm">
                {rows.map(row => (
                  <div key={row.spec} className="min-w-0 space-y-4 py-4 first:pt-0 last:pb-0">
                    <dl className="min-w-0 [overflow-wrap:anywhere]">
                      <dt className="font-mono text-muted-foreground">{row.groups.join(", ")}</dt>
                      <dd className="font-mono">{row.spec}</dd>
                    </dl>
                    <DependencyVersions lockedVersions={row.lockedVersions} result={row.result} />
                  </div>
                ))}
              </CardContent>
            </Card></li>
          ))}</ul>
        </>
      )}
    </section>
  )
}
