"use client"

import { useEffect, useId, useMemo, useRef, type ReactNode } from "react"
import { AlertTriangleIcon, FolderSearchIcon, RotateCcwIcon, SearchIcon, XIcon } from "lucide-react"
import { useFormatter, useLocale, useTranslations } from "next-intl"

import { ProjectItems } from "@/components/features/project-list/project-items"
import { ProjectListKpiStrip } from "@/components/features/project-list/project-list-kpi-strip"
import { ScanControls } from "@/components/features/project-list/scan-controls"
import { ListDiscoveryFilter } from "@/components/shared/list-discovery"
import { ListPagination, useListPagination } from "@/components/shared/list-pagination"
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
  computeProjectListMetrics,
  filterProjectsByQuickView,
  PROJECT_QUICK_VIEWS,
  type ProjectQuickView,
} from "@/lib/projects/project-metrics"
import {
  clampSearchQuery,
  createEnumCodec,
  DEFAULT_PROJECT_LIST_VIEW_STATE,
  formatProjectListUrl,
  makeViewStateKey,
  mergeProjectListUrlOverrides,
  projectListViewCodec,
  readProjectListUrlOverrides,
  type ProjectListViewState,
} from "@/lib/ui/navigation-targets"
import { cn } from "@/lib/utils"

const PROJECT_LIST_KEY = makeViewStateKey("projects")
const PROJECT_QUICK_VIEW_KEY = makeViewStateKey("projects-quick-view")
const projectQuickViewCodec = createEnumCodec<ProjectQuickView>(1, PROJECT_QUICK_VIEWS)

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

function QuickViewChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center rounded-full border px-3.5 text-button-sm transition-colors focus-ring",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  )
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
  return (
    <ListDiscoveryFilter
      label={label}
      selectedLabel={selectedLabel}
      clearLabel={clearLabel}
      value={value}
      options={options.map(option => ({ value: option, label: optionLabel(option) }))}
      onValueChange={onChange}
    />
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
  const [quickView, setQuickView] = useViewState<ProjectQuickView>(
    PROJECT_QUICK_VIEW_KEY,
    projectQuickViewCodec,
    "all",
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
  const metrics = useMemo(
    () => (snapshot ? computeProjectListMetrics(snapshot.projects, snapshot.orphanCount, now) : null),
    [snapshot, now],
  )
  const baseProjects = useMemo(
    () => (snapshot ? selectProjects(snapshot.projects, query, sort, locale, filters, now) : []),
    [snapshot, query, sort, locale, filters, now],
  )
  const projects = useMemo(
    () => filterProjectsByQuickView(baseProjects, quickView, now),
    [baseProjects, quickView, now],
  )
  const listAnchorRef = useRef<HTMLDivElement | null>(null)
  const projectsResetKey = useMemo(
    () => JSON.stringify([query, sort, filters, quickView]),
    [query, sort, filters, quickView],
  )
  const projectsPagination = useListPagination(projects, {
    resetKey: projectsResetKey,
    scrollTargetRef: listAnchorRef,
  })
  const counts = useMemo(() => countProjectFilters(snapshot?.projects ?? [], now), [snapshot?.projects, now])
  const hasActiveFilters = filters.managers.length > 0
    || filters.nodeModules.length > 0
    || filters.activities.length > 0
    || quickView !== "all"
    || query.trim().length > 0

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

  function resetAll() {
    setQuickView("all")
    updateViewState((current) => ({
      ...current,
      query: "",
      filters: DEFAULT_PROJECT_FILTERS,
    }))
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-5" aria-label={t("listLabel")}>
      <div className="flex flex-wrap items-center justify-between gap-4 empty:hidden">
        {snapshot ? (
          <p className="text-body-sm text-muted-foreground">
            {t("summary.scannedAt")}{" "}
            <time dateTime={snapshot.finishedAt} className="font-medium text-foreground">
              {format.dateTime(new Date(snapshot.finishedAt), { dateStyle: "medium", timeStyle: "short" })}
            </time>
          </p>
        ) : <div />}
        {initial.kind !== "error" || scanController.state.phase !== "idle" ? (
          <ScanControls controller={scanController} mode={snapshot ? "rescan" : "first"} />
        ) : null}
      </div>

      {snapshot && metrics && snapshot.projects.length > 0 ? (
        <ProjectListKpiStrip
          metrics={metrics}
          skippedCount={snapshot.skippedCount}
          quickView={quickView}
          onSelectQuickView={setQuickView}
        />
      ) : null}

      {snapshot?.partial ? (
        <div role="status" className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning-soft p-4 text-body-sm text-warning">
          <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">{t("partial.title")}</p>
            <p>{t("partial.description")}</p>
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
          <div className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-card p-4">
            {metrics ? (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("quickViews.label")}>
                <QuickViewChip active={quickView === "all"} onClick={() => setQuickView("all")}>
                  {t("quickViews.all", { count: format.number(metrics.totalProjects) })}
                </QuickViewChip>
                <QuickViewChip
                  active={quickView === "has_node_modules"}
                  onClick={() => setQuickView(quickView === "has_node_modules" ? "all" : "has_node_modules")}
                >
                  {t("quickViews.hasNodeModules", { count: format.number(metrics.withNodeModulesCount) })}
                </QuickViewChip>
                <QuickViewChip
                  active={quickView === "missing_lockfile"}
                  onClick={() => setQuickView(quickView === "missing_lockfile" ? "all" : "missing_lockfile")}
                >
                  {t("quickViews.missingLockfile", { count: format.number(metrics.missingLockfileCount) })}
                </QuickViewChip>
                <QuickViewChip
                  active={quickView === "inactive_30d"}
                  onClick={() => setQuickView(quickView === "inactive_30d" ? "all" : "inactive_30d")}
                >
                  {t("quickViews.inactive30d", { count: format.number(metrics.inactiveOver30dCount) })}
                </QuickViewChip>
              </div>
            ) : null}

            <div className="relative min-w-0">
              <Label htmlFor={searchId} className="sr-only">{t("search.label")}</Label>
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
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
                className={
                  query
                    ? "pr-10 pl-10 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-cancel-button]:hidden"
                    : "pl-10 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-cancel-button]:hidden"
                }
              />
              {query ? (
                <button
                  type="button"
                  aria-label={`${t("search.clearSearch")}: ${t("search.label")}`}
                  onClick={() => updateViewState((current) => ({ ...current, query: "" }))}
                  className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors focus-ring hover:bg-muted hover:text-foreground"
                >
                  <XIcon className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <fieldset className="flex min-w-0 flex-wrap items-center gap-2.5" aria-label={t("filters.label")}>
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
              <div className="min-w-0 max-w-full sm:w-auto">
                <Select
                  value={sort}
                  onValueChange={(value) => {
                    if (value === "activity" || value === "name") {
                      updateViewState((current) => ({ ...current, sort: value }))
                    }
                  }}
                >
                  <SelectTrigger
                    id={sortId}
                    aria-label={`${t("sort.label")}: ${t(`sort.${sort}`)}`}
                    className="h-auto min-h-10 w-full min-w-0 max-w-full gap-2.5 border-border bg-background px-3.5 py-2 text-body-sm hover:bg-muted data-[size=default]:h-auto sm:w-auto"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-semibold text-foreground">{t("sort.label")}</span>
                      <span className="truncate font-normal text-muted-foreground">
                        <SelectValue />
                      </span>
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="activity">{t("sort.activity")}</SelectItem>
                    <SelectItem value="name">{t("sort.name")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </fieldset>

            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/60 pt-2.5">
              <p role="status" aria-live="polite" aria-atomic="true" className="text-caption font-medium text-muted-foreground">
                {t("search.results", { count: projects.length, formattedCount: format.number(projects.length) })}
              </p>
              {hasActiveFilters ? (
                <Button type="button" variant="ghost" size="sm" onClick={resetAll}>
                  <RotateCcwIcon aria-hidden="true" />
                  {t("search.clearAll")}
                </Button>
              ) : null}
            </div>
          </div>

          {projects.length === 0 ? (
            <ProjectEmpty title={t("noMatch.title")} description={t("noMatch.description")}>
              <Button type="button" variant="secondary" onClick={resetAll}>{t("search.clearAll")}</Button>
            </ProjectEmpty>
          ) : (
            <div ref={listAnchorRef} className="min-w-0 scroll-mt-20 space-y-4">
              <ProjectItems
                projects={projectsPagination.items}
                referenceTime={referenceTime}
                maxNodeModulesBytes={metrics?.maxNodeModulesBytes ?? 0}
              />
              <ListPagination
                meta={projectsPagination.meta}
                pageSize={projectsPagination.pageSize}
                showPageSizeSelector={projectsPagination.showPageSizeSelector}
                onPageChange={projectsPagination.setPage}
                onPageSizeChange={projectsPagination.setPageSize}
              />
            </div>
          )}
        </>
      )}
    </section>
  )
}
