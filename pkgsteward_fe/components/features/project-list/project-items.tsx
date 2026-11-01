"use client"

import { AlertTriangleIcon, CheckIcon, MinusIcon } from "lucide-react"
import Link from "next/link"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { Badge } from "@/components/ui/badge"
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
import { diskUsageHref } from "@/lib/disk-usage/disk-usage-list"
import { fileManagerHref } from "@/lib/file-ops/file-ops-list"
import { projectDisplayName } from "@/lib/projects/project-list"

interface ProjectItemsProps {
  projects: readonly ScannedProject[]
  referenceTime: string
}

function ProjectLockfile({ project }: { project: ScannedProject }) {
  const t = useTranslations("projects")
  return project.hasLockfile ? (
    <Badge variant="secondary" className="h-auto min-h-6 max-w-full whitespace-normal"><CheckIcon aria-hidden="true" />{t("lockfile.present")}</Badge>
  ) : (
    <Badge variant="outline" className="h-auto min-h-6 max-w-full whitespace-normal"><AlertTriangleIcon aria-hidden="true" />{t("lockfile.missing")}</Badge>
  )
}

function ProjectManager({ project }: { project: ScannedProject }) {
  const t = useTranslations("projects")
  return <Badge variant="secondary">{project.packageManager ?? t("manager.unknown")}</Badge>
}

function ProjectNodeModules({ project }: { project: ScannedProject }) {
  const t = useTranslations("projects")
  const format = useFormatter()
  const { exists, path, sizeBytes, sizeMeasuredAt } = project.nodeModules
  return (
    <div className="min-w-0 space-y-2 text-body-sm">
      <span className="inline-flex items-center gap-1.5">
        {exists ? <CheckIcon aria-hidden="true" className="size-4 shrink-0" /> : <MinusIcon aria-hidden="true" className="size-4 shrink-0" />}
        {exists ? t("nodeModules.present") : t("nodeModules.missing")}
      </span>
      {exists && sizeBytes != null ? (
        <p>{t("nodeModules.size")} <DiskSize bytes={sizeBytes} /></p>
      ) : null}
      {exists && sizeBytes != null && sizeMeasuredAt ? (
        <p className="text-caption text-muted-foreground [overflow-wrap:anywhere]">
          {t("nodeModules.measuredAt")} <time dateTime={sizeMeasuredAt}>{format.dateTime(new Date(sizeMeasuredAt), { dateStyle: "medium", timeStyle: "short" })}</time>
        </p>
      ) : null}
      {exists ? <Link href={diskUsageHref(path, "packages")} className="inline-block max-w-full rounded-sm text-ink-soft underline focus-ring [overflow-wrap:anywhere]">{t("nodeModules.viewSize")}</Link> : null}
    </div>
  )
}

function ProjectFilesLink({ project }: { project: ScannedProject }) {
  const t = useTranslations("projects")
  return (
    <Link href={fileManagerHref(project.path)} className="inline-block max-w-full rounded-sm text-body-sm text-ink-soft underline focus-ring">
      {t("actions.manageFiles")}
    </Link>
  )
}

function ProjectActivity({ date, referenceTime }: { date: string; referenceTime: string }) {
  const format = useFormatter()
  return <time dateTime={date}>{format.relativeTime(new Date(date), new Date(referenceTime))}</time>
}

export function ProjectItems({ projects, referenceTime }: ProjectItemsProps) {
  const t = useTranslations("projects")

  return (
    <>
      <div className="hidden min-w-0 rounded-md bg-card text-card-foreground lg:block">
        <Table className="table-fixed">
          <TableCaption className="sr-only">{t("listLabel")}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-2/5" scope="col">{t("columns.project")}</TableHead>
              <TableHead className="whitespace-normal" scope="col">{t("columns.manager")}</TableHead>
              <TableHead className="whitespace-normal" scope="col">{t("columns.lockfile")}</TableHead>
              <TableHead className="whitespace-normal" scope="col">{t("columns.nodeModules")}</TableHead>
              <TableHead className="whitespace-normal" scope="col">{t("columns.activity")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.path}>
                <TableCell className="min-w-0 whitespace-normal">
                  <p className="font-semibold text-foreground [overflow-wrap:anywhere]">{projectDisplayName(project)}</p>
                  <p className="mt-1 font-mono text-caption text-muted-foreground [overflow-wrap:anywhere]">{project.path}</p>
                  <p className="mt-2"><ProjectFilesLink project={project} /></p>
                </TableCell>
                <TableCell className="whitespace-normal"><ProjectManager project={project} /></TableCell>
                <TableCell className="whitespace-normal"><ProjectLockfile project={project} /></TableCell>
                <TableCell className="whitespace-normal"><ProjectNodeModules project={project} /></TableCell>
                <TableCell className="text-muted-foreground whitespace-normal">
                  <ProjectActivity date={project.lastActivityAt} referenceTime={referenceTime} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="grid min-w-0 gap-4 lg:hidden" aria-label={t("listLabel")}>
        {projects.map((project) => (
          <li key={project.path} className="min-w-0">
            <Card>
              <CardHeader className="min-w-0">
                <CardTitle className="min-w-0 [overflow-wrap:anywhere]">{projectDisplayName(project)}</CardTitle>
                <p className="min-w-0 font-mono text-caption text-muted-foreground [overflow-wrap:anywhere]">{project.path}</p>
                <p><ProjectFilesLink project={project} /></p>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-4 text-body-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-muted-foreground">{t("columns.manager")}</dt>
                    <dd><ProjectManager project={project} /></dd>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-muted-foreground">{t("columns.lockfile")}</dt>
                    <dd><ProjectLockfile project={project} /></dd>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-muted-foreground">{t("columns.nodeModules")}</dt>
                    <dd><ProjectNodeModules project={project} /></dd>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-muted-foreground">{t("columns.activity")}</dt>
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
