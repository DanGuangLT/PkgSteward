"use client"

import { CheckIcon, InfoIcon, LockIcon, LockOpenIcon, MinusIcon } from "lucide-react"
import Link from "next/link"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ScannedProject } from "@/lib/api/types"
import { useNavigationContinuity } from "@/hooks/use-navigation-continuity"
import { diskRowBarWidthPercent } from "@/lib/disk-usage/disk-usage-metrics"
import { projectDisplayName } from "@/lib/projects/project-list"
import { projectDetailHref } from "@/lib/projects/project-detail-list"
import { appendReturnContext } from "@/lib/ui/navigation-targets"

interface ProjectItemsProps {
  projects: readonly ScannedProject[]
  referenceTime: string
  maxNodeModulesBytes?: number
}

function ProjectLockfile({ project }: { project: ScannedProject }) {
  const t = useTranslations("projects")
  return project.hasLockfile ? (
    <Badge variant="success" className="h-auto min-h-6 max-w-full whitespace-normal">
      <LockIcon aria-hidden="true" />
      {t("lockfile.present")}
    </Badge>
  ) : (
    <Badge variant="outline" className="h-auto min-h-6 max-w-full whitespace-normal">
      <LockOpenIcon aria-hidden="true" />
      {t("lockfile.missing")}
    </Badge>
  )
}

function ProjectManager({ project }: { project: ScannedProject }) {
  const t = useTranslations("projects")
  return <Badge variant="secondary">{project.packageManager ?? t("manager.unknown")}</Badge>
}

function ProjectNodeModules({ project, maxBytes }: { project: ScannedProject; maxBytes: number }) {
  const t = useTranslations("projects")
  const format = useFormatter()
  const { exists, sizeBytes, sizeMeasuredAt } = project.nodeModules
  const barWidth = exists ? diskRowBarWidthPercent(sizeBytes, maxBytes) : 0

  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5 text-body-sm">
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        {exists ? <CheckIcon aria-hidden="true" className="size-4 shrink-0" /> : <MinusIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
        {exists ? (
          sizeBytes != null ? (
            <span className="tabular-nums"><DiskSize bytes={sizeBytes} /></span>
          ) : (
            t("nodeModules.present")
          )
        ) : (
          <span className="font-normal text-muted-foreground">{t("nodeModules.missing")}</span>
        )}
      </span>
      {barWidth > 0 ? (
        <div className="h-1.5 w-full max-w-28 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
          <div className="h-full rounded-full bg-foreground" style={{ width: `${barWidth}%` }} />
        </div>
      ) : null}
      {exists && sizeBytes != null && sizeMeasuredAt ? (
        <p className="text-caption text-muted-foreground [overflow-wrap:anywhere]">
          {t("nodeModules.measuredAt")}{" "}
          <time dateTime={sizeMeasuredAt}>
            {format.dateTime(new Date(sizeMeasuredAt), { dateStyle: "medium", timeStyle: "short" })}
          </time>
        </p>
      ) : null}
    </div>
  )
}

// Hành động của 1 dự án: hiện dạng nút (có icon) để người dùng nhận ra là bấm được.
function ProjectActions({ project, returnTo, originId }: {
  project: ScannedProject
  returnTo: string
  originId: string | null
}) {
  const t = useTranslations("projects")
  const name = projectDisplayName(project)
  return (
    <Button asChild variant="secondary" size="sm" className="h-auto min-h-9 max-w-full whitespace-normal">
      <Link
        href={appendReturnContext(projectDetailHref(project.path), { returnTo, originId })}
        prefetch={false}
        aria-label={t("viewDetailsOf", { name })}
      >
        <InfoIcon data-icon="inline-start" aria-hidden="true" />
        {t("viewDetails")}
      </Link>
    </Button>
  )
}

function ProjectActivity({ date, referenceTime }: { date: string; referenceTime: string }) {
  const format = useFormatter()
  return <time dateTime={date}>{format.relativeTime(new Date(date), new Date(referenceTime))}</time>
}

export function ProjectItems({ projects, referenceTime, maxNodeModulesBytes = 0 }: ProjectItemsProps) {
  const t = useTranslations("projects")
  const { hydrated, currentUrl, entryId } = useNavigationContinuity()
  const returnTo = hydrated ? currentUrl : "/"
  const originId = hydrated ? entryId : null

  return (
    <>
      <div className="hidden min-w-0 rounded-md border border-border bg-card text-card-foreground lg:block">
        <Table className="table-fixed">
          <TableCaption className="sr-only">{t("listLabel")}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/3" scope="col">{t("columns.project")}</TableHead>
              <TableHead className="whitespace-normal" scope="col">{t("columns.manager")}</TableHead>
              <TableHead className="whitespace-normal" scope="col">{t("columns.lockfile")}</TableHead>
              <TableHead className="whitespace-normal" scope="col">{t("columns.nodeModules")}</TableHead>
              <TableHead className="whitespace-normal" scope="col">{t("columns.activity")}</TableHead>
              <TableHead className="whitespace-normal" scope="col">{t("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.path}>
                <TableCell className="min-w-0 align-top whitespace-normal">
                  <p className="font-semibold text-foreground [overflow-wrap:anywhere]">{projectDisplayName(project)}</p>
                  <p className="mt-1 font-mono text-caption text-muted-foreground [overflow-wrap:anywhere]">{project.path}</p>
                </TableCell>
                <TableCell className="align-top whitespace-normal"><ProjectManager project={project} /></TableCell>
                <TableCell className="align-top whitespace-normal"><ProjectLockfile project={project} /></TableCell>
                <TableCell className="align-top whitespace-normal">
                  <ProjectNodeModules project={project} maxBytes={maxNodeModulesBytes} />
                </TableCell>
                <TableCell className="align-top text-muted-foreground whitespace-normal">
                  <ProjectActivity date={project.lastActivityAt} referenceTime={referenceTime} />
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <ProjectActions project={project} returnTo={returnTo} originId={originId} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="grid min-w-0 gap-3 lg:hidden" aria-label={t("listLabel")}>
        {projects.map((project) => (
          <li key={project.path} className="min-w-0">
            <Card className="border border-border">
              <CardHeader className="min-w-0">
                <CardTitle className="min-w-0 [overflow-wrap:anywhere]">{projectDisplayName(project)}</CardTitle>
                <p className="min-w-0 font-mono text-caption text-muted-foreground [overflow-wrap:anywhere]">{project.path}</p>
                <div className="pt-1"><ProjectActions project={project} returnTo={returnTo} originId={originId} /></div>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-3 text-body-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-caption text-muted-foreground">{t("columns.manager")}</dt>
                    <dd><ProjectManager project={project} /></dd>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-caption text-muted-foreground">{t("columns.lockfile")}</dt>
                    <dd><ProjectLockfile project={project} /></dd>
                  </div>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <dt className="text-caption text-muted-foreground">{t("columns.nodeModules")}</dt>
                    <dd><ProjectNodeModules project={project} maxBytes={maxNodeModulesBytes} /></dd>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-caption text-muted-foreground">{t("columns.activity")}</dt>
                    <dd><ProjectActivity date={project.lastActivityAt} referenceTime={referenceTime} /></dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </>
  )
}
