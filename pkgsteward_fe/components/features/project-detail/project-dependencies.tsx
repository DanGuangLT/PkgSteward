"use client"

import { AlertTriangleIcon, ArrowUpIcon } from "lucide-react"
import { useMemo } from "react"
import { useFormatter, useTranslations } from "next-intl"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ProjectAnalysisCode, ProjectAnalysisJob, ProjectDependency, ProjectOutdated } from "@/lib/api/types"
import { createProjectDependencyBadgeReader } from "@/lib/projects/project-detail-list"

function DependencyName({ dependency, badges }: {
  dependency: ProjectDependency
  badges: { outdated: boolean; vulnerable: boolean }
}) {
  const t = useTranslations("projectDetail")
  return (
    <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
      <p className="font-mono font-semibold">{dependency.name}</p>
      {badges.outdated ? <Badge variant="secondary" className="h-auto whitespace-normal"><ArrowUpIcon aria-hidden="true" />{t("dependencies.outdated")}</Badge> : null}
      {badges.vulnerable ? <Badge variant="outline" className="h-auto whitespace-normal"><AlertTriangleIcon aria-hidden="true" />{t("dependencies.vulnerable")}</Badge> : null}
    </div>
  )
}

function DependencyWarning({ warning }: { warning: ProjectAnalysisCode | null | undefined }) {
  const t = useTranslations("projectDetail")
  return warning ? <p className="mt-2 text-body-sm"><AlertTriangleIcon aria-hidden="true" className="mr-1 inline size-4" />{t(`errors.${warning}`)}</p> : null
}

function DependencyVersions({ dependency, row }: { dependency: ProjectDependency; row?: ProjectOutdated }) {
  const t = useTranslations("projectDetail")
  const locked = row?.lockedVersions ?? dependency.lockedVersions
  return (
    <div className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
      <dl className="space-y-2">
        <div><dt className="text-muted-foreground">{t("dependencies.locked")}</dt><dd className="font-mono">{locked.length ? locked.join(", ") : t("dependencies.unknown")}</dd></div>
        <div><dt className="text-muted-foreground">{t("dependencies.wanted")}</dt><dd className="font-mono">{row?.wanted ?? t("dependencies.unknown")}</dd></div>
        <div><dt className="text-muted-foreground">{t("dependencies.latest")}</dt><dd className="font-mono">{row?.latest ?? t("dependencies.unknown")}</dd></div>
      </dl>
      <DependencyWarning warning={row?.warning} />
    </div>
  )
}

export function ProjectDependencies({ dependencies, job }: {
  dependencies: readonly ProjectDependency[]
  job: ProjectAnalysisJob | null
}) {
  const t = useTranslations("projectDetail")
  const format = useFormatter()
  const readBadges = useMemo(() => createProjectDependencyBadgeReader(job), [job])
  const versions = useMemo(() => new Map(job?.outdated.items.map(row => [row.name, row]) ?? []), [job])
  return (
    <section className="min-w-0 space-y-4" aria-label={t("dependencies.title")}>
      <h2 className="text-heading-md">{t("dependencies.title")}</h2>
      <p className="text-body-sm text-muted-foreground">{t("dependencies.count", { count: dependencies.length, formattedCount: format.number(dependencies.length) })}</p>
      {dependencies.length === 0 ? <p className="text-body-sm">{t("dependencies.empty")}</p> : (
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
              <TableBody>{dependencies.map(dependency => (
                <TableRow key={dependency.name}>
                  <TableCell className="align-top whitespace-normal"><DependencyName dependency={dependency} badges={readBadges(dependency.name)} /></TableCell>
                  <TableCell className="align-top font-mono whitespace-normal [overflow-wrap:anywhere]">{dependency.declarations.map(declaration => <p key={declaration.group}>{declaration.group}</p>)}</TableCell>
                  <TableCell className="align-top font-mono whitespace-normal [overflow-wrap:anywhere]">{dependency.declarations.map(declaration => <p key={declaration.group}>{declaration.spec}</p>)}</TableCell>
                  <TableCell className="align-top font-mono whitespace-normal [overflow-wrap:anywhere]">{(versions.get(dependency.name)?.lockedVersions ?? dependency.lockedVersions).join(", ") || t("dependencies.unknown")}</TableCell>
                  <TableCell className="align-top font-mono whitespace-normal [overflow-wrap:anywhere]">{versions.get(dependency.name)?.wanted ?? t("dependencies.unknown")}</TableCell>
                  <TableCell className="align-top whitespace-normal [overflow-wrap:anywhere]">
                    <p className="font-mono">{versions.get(dependency.name)?.latest ?? t("dependencies.unknown")}</p>
                    <DependencyWarning warning={versions.get(dependency.name)?.warning} />
                  </TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
          <ul className="grid min-w-0 gap-4 lg:hidden" aria-label={t("dependencies.title")}>{dependencies.map(dependency => (
            <li key={dependency.name} className="min-w-0"><Card className="min-w-0">
              <CardHeader className="min-w-0"><CardTitle><DependencyName dependency={dependency} badges={readBadges(dependency.name)} /></CardTitle></CardHeader>
              <CardContent className="min-w-0 space-y-4 text-body-sm">
                <dl className="min-w-0 space-y-2 [overflow-wrap:anywhere]">{dependency.declarations.map(declaration => (
                  <div key={declaration.group}><dt className="font-mono text-muted-foreground">{declaration.group}</dt><dd className="font-mono">{declaration.spec}</dd></div>
                ))}</dl>
                <DependencyVersions dependency={dependency} row={versions.get(dependency.name)} />
              </CardContent>
            </Card></li>
          ))}</ul>
        </>
      )}
    </section>
  )
}
