"use client"

import { useId, useState, type ReactNode } from "react"
import { AlertTriangleIcon, FolderSearchIcon } from "lucide-react"
import { useFormatter, useLocale, useTranslations } from "next-intl"

import { ProjectItems } from "@/components/features/project-list/project-items"
import { ScanControls } from "@/components/features/project-list/scan-controls"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ScanResult } from "@/lib/api/types"
import { useScan } from "@/hooks/use-scan"
import { selectProjects, type ProjectSort } from "@/lib/projects/project-list"

export type ProjectSnapshot = Pick<ScanResult, "scanId" | "finishedAt" | "partial" | "skippedCount" | "projects">
  & { orphanCount: number }

export type InitialProjects = { kind: "ready"; snapshot: ProjectSnapshot }
  | { kind: "empty" }
  | { kind: "error"; code: string }

interface ProjectListProps {
  initial: InitialProjects
  referenceTime: string
}

function ProjectEmpty({ title, description, children }: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderSearchIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  )
}

export function ProjectList({ initial, referenceTime }: ProjectListProps) {
  const t = useTranslations("projects")
  const format = useFormatter()
  const locale = useLocale()
  const searchId = useId()
  const sortId = useId()
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<ProjectSort>("activity")
  const scanController = useScan()

  const snapshot = initial.kind === "ready" ? initial.snapshot : null
  const projects = snapshot ? selectProjects(snapshot.projects, query, sort, locale) : []
  const errorMessage = initial.kind === "error"
    ? initial.code === "BACKEND_UNAVAILABLE" ? t("errors.backendUnavailable")
      : initial.code === "RATE_LIMITED" ? t("errors.rateLimited")
        : initial.code === "INVALID_RESPONSE" ? t("errors.invalidResponse")
          : t("errors.generic")
    : t("errors.generic")

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-6" aria-label={t("listLabel")}>
      <div className="flex flex-wrap items-start justify-between gap-4 empty:hidden">
        {snapshot ? (
          <div className="min-w-0 space-y-2 text-body-sm text-muted-foreground">
            <p>
              {t("summary.scannedAt")} <time dateTime={snapshot.finishedAt}>
                {format.dateTime(new Date(snapshot.finishedAt), { dateStyle: "medium", timeStyle: "short" })}
              </time>
            </p>
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              <li>{t("summary.projects", {
                count: snapshot.projects.length,
                formattedCount: format.number(snapshot.projects.length),
              })}</li>
              <li>{t("summary.orphans", {
                count: snapshot.orphanCount,
                formattedCount: format.number(snapshot.orphanCount),
              })}</li>
              <li>{t("summary.skipped", {
                count: snapshot.skippedCount,
                formattedCount: format.number(snapshot.skippedCount),
              })}</li>
            </ul>
          </div>
        ) : null}
        {initial.kind !== "error" ? (
          <ScanControls controller={scanController} mode={initial.kind === "empty" ? "first" : "rescan"} />
        ) : null}
      </div>

      {snapshot?.partial ? (
        <div role="status" className="flex items-start gap-3 rounded-md border border-border bg-muted p-4 text-body-sm">
          <AlertTriangleIcon aria-hidden="true" className="size-5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">{t("partial.title")}</p>
            <p className="text-muted-foreground">{t("partial.description")}</p>
          </div>
        </div>
      ) : null}

      {initial.kind === "error" ? (
        <ProjectEmpty title={t("errors.title")} description={errorMessage}>
          <p className="text-muted-foreground">{t("errors.backendHint")}</p>
        </ProjectEmpty>
      ) : initial.kind === "empty" ? (
        <ProjectEmpty title={t("empty.title")} description={t("empty.description")} />
      ) : snapshot?.projects.length === 0 ? (
        <ProjectEmpty title={t("noProjects.title")} description={t("noProjects.description")} />
      ) : (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Label htmlFor={searchId}>{t("search.label")}</Label>
              <Input
                id={searchId}
                type="search"
                placeholder={t("search.placeholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:w-64">
              <Label htmlFor={sortId}>{t("sort.label")}</Label>
              <Select value={sort} onValueChange={(value) => {
                if (value === "activity" || value === "name") setSort(value)
              }}>
                <SelectTrigger id={sortId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="activity">{t("sort.activity")}</SelectItem>
                  <SelectItem value="name">{t("sort.name")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p role="status" className="text-body-sm text-muted-foreground">
            {t("search.results", { count: projects.length, formattedCount: format.number(projects.length) })}
          </p>
          {projects.length === 0 ? (
            <ProjectEmpty title={t("noMatch.title")} description={t("noMatch.description")}>
              <Button variant="secondary" onClick={() => setQuery("")}>{t("search.clear")}</Button>
            </ProjectEmpty>
          ) : (
            <ProjectItems projects={projects} referenceTime={referenceTime} />
          )}
        </>
      )}
    </section>
  )
}
