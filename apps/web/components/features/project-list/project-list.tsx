"use client"

import { useEffect, useId, useRef, type ReactNode } from "react"
import { AlertTriangleIcon, FolderSearchIcon } from "lucide-react"
import { useFormatter, useLocale, useTranslations } from "next-intl"

import { ProjectItems } from "@/components/features/project-list/project-items"
import { ScanControls } from "@/components/features/project-list/scan-controls"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import type { ScanJob, ScanResult } from "@/lib/api/types"
import {
  replaceHistoryUrlPreservingState,
  useNavigationContinuity,
  useRouteScrollContinuity,
  useViewState,
} from "@/hooks/use-navigation-continuity"
import { useScan } from "@/hooks/use-scan"
import {
  countProjectFilters,
  DEFAULT_PROJECT_FILTERS,
  PROJECT_ACTIVITY_OPTIONS,
  PROJECT_MANAGER_OPTIONS,
  PROJECT_NODE_MODULES_OPTIONS,
  selectProjects,
} from "@/lib/projects/project-list"
import {
  clampSearchQuery,
  DEFAULT_PROJECT_LIST_VIEW_STATE,
  formatProjectListUrl,
  makeViewStateKey,
  mergeProjectListUrlOverrides,
  projectListViewCodec,
  readProjectListUrlOverrides,
  type ProjectListViewState,
} from "@/lib/ui/navigation-targets"

const PROJECT_LIST_KEY = makeViewStateKey("projects")

export type ProjectSnapshot = Pick<ScanResult, "scanId" | "finishedAt" | "partial" | "skippedCount" | "projects">
  & { orphanCount: number }

export type InitialProjects = { kind: "ready"; snapshot: ProjectSnapshot }
  | { kind: "empty" }
  | { kind: "error"; code: string }

interface ProjectListProps {
  initial: InitialProjects
  activeScan: ScanJob | null
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

function FilterGroup<Option extends string>({
  label,
  selectedLabel,
  clearLabel,
  value,
  options,
  onChange,
  optionLabel,
}: {
  label: string
  selectedLabel: string
  clearLabel: string
  value: readonly Option[]
  options: readonly Option[]
  onChange: (value: Option[]) => void
  optionLabel: (value: Option) => string
}) {
  const id = useId()
  return (
    <details className="min-w-0 max-w-full rounded-md border border-input bg-background text-foreground">
      <summary className="min-h-11 cursor-pointer rounded-md px-4 py-3 text-body-sm font-semibold focus-ring [overflow-wrap:anywhere]">
        {label}<span className="ml-2 font-normal text-muted-foreground">{selectedLabel}</span>
      </summary>
      <fieldset className="min-w-0 space-y-1 border-t border-border p-3">
        <legend className="sr-only">{label}</legend>
        {options.map((option, index) => (
          <div key={option} className="flex min-h-11 min-w-0 items-center gap-3 px-2">
            <Checkbox
              id={`${id}-${index}`}
              checked={value.includes(option)}
              onCheckedChange={(checked) => onChange(
                checked === true
                  ? (value.includes(option) ? [...value] : [...value, option])
                  : value.filter((item) => item !== option),
              )}
            />
            <Label
              htmlFor={`${id}-${index}`}
              className="min-w-0 flex-1 py-3 text-body-sm font-normal leading-normal [overflow-wrap:anywhere]"
            >
              {optionLabel(option)}
            </Label>
          </div>
        ))}
        <Button type="button" variant="secondary" disabled={value.length === 0} onClick={() => onChange([])}>
          {clearLabel}
        </Button>
      </fieldset>
    </details>
  )
}

export function ProjectList({ initial, activeScan, referenceTime }: ProjectListProps) {
  const t = useTranslations("projects")
  const format = useFormatter()
  const locale = useLocale()
  const searchId = useId()
  const sortId = useId()
  const [storedViewState, setStoredViewState] = useViewState(
    PROJECT_LIST_KEY,
    projectListViewCodec,
    DEFAULT_PROJECT_LIST_VIEW_STATE,
  )
  const { hydrated, currentUrl, bumpMutationEpoch } = useNavigationContinuity()
  const currentSearch = currentUrl.includes("?") ? currentUrl.slice(currentUrl.indexOf("?")) : ""
  const viewState = hydrated
    ? mergeProjectListUrlOverrides(storedViewState, readProjectListUrlOverrides(currentSearch))
    : DEFAULT_PROJECT_LIST_VIEW_STATE
  const { query, sort, filters } = viewState
  const scanController = useScan(activeScan)

  const snapshot = initial.kind === "ready" ? initial.snapshot : null
  const observedScanIdRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const currentScanId = snapshot?.scanId ?? null
    if (observedScanIdRef.current === undefined) {
      observedScanIdRef.current = currentScanId
      return
    }
    if (currentScanId !== null && currentScanId !== observedScanIdRef.current) {
      observedScanIdRef.current = currentScanId
      bumpMutationEpoch("scan")
    }
  }, [snapshot?.scanId, bumpMutationEpoch])

  useRouteScrollContinuity({ routeKey: PROJECT_LIST_KEY, ready: true })

  function updateViewState(updater: (current: ProjectListViewState) => ProjectListViewState) {
    const next = updater(viewState)
    const normalized: ProjectListViewState = {
      ...next,
      query: clampSearchQuery(next.query),
    }
    setStoredViewState(normalized)
    replaceHistoryUrlPreservingState(formatProjectListUrl("/", normalized, currentSearch))
  }

  const now = Date.parse(referenceTime)
  const projects = snapshot ? selectProjects(snapshot.projects, query, sort, locale, filters, now) : []
  const counts = countProjectFilters(snapshot?.projects ?? [], now)
  const hasActiveFilters = filters.managers.length > 0 || filters.nodeModules.length > 0 || filters.activities.length > 0
  const selectedLabel = (count: number) => count > 0
    ? t("filters.selected", { count: format.number(count) })
    : t("filters.all")
  const optionCount = (label: string, count: number) => t("filters.optionCount", { label, count: format.number(count) })
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
        {initial.kind !== "error" || scanController.state.phase !== "idle" ? (
          <ScanControls controller={scanController} mode={snapshot ? "rescan" : "first"} />
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
                maxLength={512}
                placeholder={t("search.placeholder")}
                value={query}
                onChange={(event) => {
                  const nextQuery = event.target.value
                  updateViewState((current) => ({ ...current, query: nextQuery }))
                }}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:w-64">
              <Label htmlFor={sortId}>{t("sort.label")}</Label>
              <Select value={sort} onValueChange={(value) => {
                if (value === "activity" || value === "name") {
                  updateViewState((current) => ({ ...current, sort: value }))
                }
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
          <fieldset className="min-w-0 space-y-4" aria-label={t("filters.label")}>
            <div className="grid min-w-0 grid-cols-1 items-start gap-4 sm:grid-cols-3">
              <FilterGroup
                label={t("filters.manager.label")}
                selectedLabel={selectedLabel(filters.managers.length)}
                clearLabel={t("filters.clearGroup")}
                value={filters.managers}
                options={PROJECT_MANAGER_OPTIONS}
                onChange={(managers) => updateViewState((current) => ({
                  ...current,
                  filters: { ...current.filters, managers },
                }))}
                optionLabel={(value) => optionCount(
                  value === "unknown" ? t("manager.unknown") : value,
                  counts.managers[value],
                )}
              />
              <FilterGroup
                label={t("filters.nodeModules.label")}
                selectedLabel={selectedLabel(filters.nodeModules.length)}
                clearLabel={t("filters.clearGroup")}
                value={filters.nodeModules}
                options={PROJECT_NODE_MODULES_OPTIONS}
                onChange={(nodeModules) => updateViewState((current) => ({
                  ...current,
                  filters: { ...current.filters, nodeModules },
                }))}
                optionLabel={(value) => optionCount(t(`filters.nodeModules.${value}`), counts.nodeModules[value])}
              />
              <FilterGroup
                label={t("filters.activity.label")}
                selectedLabel={selectedLabel(filters.activities.length)}
                clearLabel={t("filters.clearGroup")}
                value={filters.activities}
                options={PROJECT_ACTIVITY_OPTIONS}
                onChange={(activities) => updateViewState((current) => ({
                  ...current,
                  filters: { ...current.filters, activities },
                }))}
                optionLabel={(value) => optionCount(t(`filters.activity.${value}`), counts.activities[value])}
              />
            </div>
            {hasActiveFilters ? (
              <Button type="button" variant="secondary" onClick={() => updateViewState((current) => ({
                ...current,
                filters: DEFAULT_PROJECT_FILTERS,
              }))}>{t("filters.reset")}</Button>
            ) : null}
          </fieldset>
          <p role="status" className="text-body-sm text-muted-foreground">
            {t("search.results", { count: projects.length, formattedCount: format.number(projects.length) })}
          </p>
          {projects.length === 0 ? (
            <ProjectEmpty title={t("noMatch.title")} description={t("noMatch.description")}>
              <Button type="button" variant="secondary" onClick={() => updateViewState((current) => ({
                ...current,
                query: "",
                filters: DEFAULT_PROJECT_FILTERS,
              }))}>{t("search.clearAll")}</Button>
            </ProjectEmpty>
          ) : (
            <ProjectItems projects={projects} referenceTime={referenceTime} />
          )}
        </>
      )}
    </section>
  )
}
