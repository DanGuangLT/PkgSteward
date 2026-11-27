"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckIcon,
  CpuIcon,
  FolderSearchIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import {
  ManagerCommandsList,
  NodeRuntimeStatusBadge,
} from "@/components/features/node-runtime/command-copy-list"
import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import {
  DiscoveryControls,
  DiscoveryEmpty,
  DiscoveryFilter,
  DiscoverySort,
  type ListDiscoveryOption,
} from "@/components/shared/list-discovery"
import {
  ListPagination,
  useListPagination,
} from "@/components/shared/list-pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { useNavigationContinuity } from "@/hooks/use-navigation-continuity"
import { getBrowserNodeRuntimeOverview } from "@/lib/api/node-runtime/node-runtime-browser"
import { ApiError } from "@/lib/api/response"
import type {
  NodeCompatibilityStatus,
  NodeManagerInfo,
  NodeProjectSort,
  NodeRuntimeOverview,
  ProjectNodeCompatibility,
} from "@/lib/node-runtime/node-runtime-types"
import {
  filterAndSortNodeProjects,
  NODE_STATUS_ORDER,
} from "@/lib/node-runtime/node-runtime-view"
import { projectDetailHref } from "@/lib/projects/project-detail-list"
import { appendReturnContext } from "@/lib/ui/navigation-targets"
import { cn } from "@/lib/utils"

export type InitialNodeRuntime =
  | { kind: "ready"; overview: NodeRuntimeOverview }
  | { kind: "error"; code: string }

function ManagerCard({ manager }: { manager: NodeManagerInfo }) {
  const t = useTranslations("nodeRuntime")
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-foreground">{manager.label}</span>
        <Badge variant={manager.detected ? "success" : "outline"}>
          {t(manager.detected ? "managers.detected" : "managers.notDetected")}
        </Badge>
      </div>
      {manager.detected ? (
        <>
          <p className="text-caption text-muted-foreground">
            {t("managers.activeLabel")}{" "}
            <span className="font-mono font-medium text-foreground">
              {manager.activeVersion
                ? `v${manager.activeVersion}`
                : t("managers.none")}
            </span>
          </p>
          {manager.installedVersions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {manager.installedVersions.map((ver) => (
                <Badge key={ver} variant="secondary" className="font-mono">
                  v{ver}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-caption text-muted-foreground">
              {t("managers.noVersions")}
            </p>
          )}
        </>
      ) : (
        <p className="text-caption text-muted-foreground">
          {t("managers.unavailableHint")}
        </p>
      )}
    </div>
  )
}

function ProjectCompatibilityRow({
  project,
  hasDetectedManager,
  returnContext,
}: {
  project: ProjectNodeCompatibility
  hasDetectedManager: boolean
  returnContext: { returnTo?: string; originId?: string | null }
}) {
  const t = useTranslations("nodeRuntime")

  return (
    <article className="min-w-0 space-y-3 rounded-md border border-border bg-card p-4 text-card-foreground md:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={appendReturnContext(
                projectDetailHref(project.path),
                returnContext,
              )}
              prefetch={false}
              className="rounded-sm text-heading-md text-foreground underline-offset-4 transition-colors focus-ring hover:underline [overflow-wrap:anywhere]"
            >
              {project.name ?? project.path}
            </Link>
            <NodeRuntimeStatusBadge status={project.status} />
          </div>
          <p className="break-all font-mono text-caption text-muted-foreground">
            {project.path}
          </p>
        </div>

        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link
            href={appendReturnContext(
              projectDetailHref(project.path),
              returnContext,
            )}
            prefetch={false}
          >
            {t("project.openDetail")}
            <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
      </div>

      {project.requirements.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-caption">
          <span className="text-muted-foreground">
            {t("project.declaredLabel")}
          </span>
          {project.requirements.map((req) => {
            const isEffective =
              project.effectiveRequirement?.source === req.source
            return (
              <Badge
                key={req.source}
                variant={isEffective ? "secondary" : "outline"}
                className="font-mono"
              >
                {req.source}: {req.raw}
              </Badge>
            )
          })}
        </div>
      ) : (
        <p className="text-caption text-muted-foreground">
          {t("project.noDeclaration")}
        </p>
      )}

      {project.status === "mismatch" ? (
        <div className="space-y-3 rounded-md border border-warning/40 bg-warning-soft p-3.5">
          <p className="text-body-sm font-medium text-warning">
            <AlertTriangleIcon
              aria-hidden="true"
              className="mr-1.5 inline size-4"
            />
            {project.matchedInstalledVersion
              ? t("project.mismatchInstalled", {
                  active: `v${project.activeNodeVersion}`,
                  target: `v${project.matchedInstalledVersion}`,
                })
              : project.suggestedVersion
                ? t("project.mismatchMissing", {
                    active: `v${project.activeNodeVersion}`,
                    target: `v${project.suggestedVersion}`,
                  })
                : t("project.mismatchGeneric", {
                    active: `v${project.activeNodeVersion}`,
                  })}
          </p>
          {project.commands.length > 0 ? (
            <ManagerCommandsList commands={project.commands} />
          ) : (
            <p className="text-caption text-muted-foreground">
              {t(
                hasDetectedManager
                  ? "commands.noCommandAvailable"
                  : "commands.noManagerDetected",
              )}
            </p>
          )}
        </div>
      ) : project.status === "unknown" ? (
        <p className="text-caption text-muted-foreground">
          {t("project.symbolicHint")}
        </p>
      ) : null}
    </article>
  )
}

export function NodeRuntimePanel({
  initial,
}: {
  initial: InitialNodeRuntime
}) {
  const t = useTranslations("nodeRuntime")
  const tDisabled = useTranslations("disabledReasons")
  const format = useFormatter()
  const { hydrated, currentUrl, entryId } = useNavigationContinuity()
  const returnContext = {
    returnTo: hydrated ? currentUrl : undefined,
    originId: hydrated ? entryId : null,
  }

  const [overview, setOverview] = useState<NodeRuntimeOverview | null>(
    initial.kind === "ready" ? initial.overview : null,
  )
  const [errorCode, setErrorCode] = useState<string | null>(
    initial.kind === "error" ? initial.code : null,
  )
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState("")
  const [selectedStatuses, setSelectedStatuses] = useState<
    NodeCompatibilityStatus[]
  >([])
  const [sort, setSort] = useState<NodeProjectSort>("priority")
  const listAnchorRef = useRef<HTMLDivElement | null>(null)
  const refreshControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      refreshControllerRef.current?.abort()
      refreshControllerRef.current = null
    }
  }, [])

  async function handleRefresh() {
    if (refreshControllerRef.current) return

    const controller = new AbortController()
    const { signal } = controller
    refreshControllerRef.current = controller
    setRefreshing(true)
    setErrorCode(null)
    try {
      const next = await getBrowserNodeRuntimeOverview(true, signal)
      if (!signal.aborted) setOverview(next)
    } catch (error) {
      if (signal.aborted) return
      setErrorCode(
        error instanceof ApiError
          ? error.code ?? "INTERNAL_SERVER_ERROR"
          : "INTERNAL_SERVER_ERROR",
      )
    } finally {
      if (!signal.aborted) {
        refreshControllerRef.current = null
        setRefreshing(false)
      }
    }
  }

  const visibleProjects = useMemo(
    () =>
      overview
        ? filterAndSortNodeProjects(overview.projects, {
            query,
            statuses: selectedStatuses,
            sort,
          })
        : [],
    [overview, query, selectedStatuses, sort],
  )

  const paginationResetKey = useMemo(
    () => JSON.stringify([query, selectedStatuses, sort, overview?.scanId]),
    [overview?.scanId, query, selectedStatuses, sort],
  )

  const pagination = useListPagination(visibleProjects, {
    resetKey: paginationResetKey,
    scrollTargetRef: listAnchorRef,
  })

  function toggleStatusFilter(status: NodeCompatibilityStatus) {
    setSelectedStatuses((current) =>
      current.length === 1 && current[0] === status ? [] : [status],
    )
  }

  function resetDiscovery() {
    setQuery("")
    setSelectedStatuses([])
    setSort("priority")
  }

  const statusOptions = useMemo(
    () =>
      NODE_STATUS_ORDER.map((status) => ({
        value: status,
        label: t(`statuses.${status}`),
        count: overview?.counts[status] ?? 0,
      })),
    [overview?.counts, t],
  )

  const sortOptions = useMemo<readonly ListDiscoveryOption<NodeProjectSort>[]>(
    () => [
      { value: "priority", label: t("sort.priority") },
      { value: "name", label: t("sort.name") },
    ],
    [t],
  )

  const errorMessage =
    errorCode === "BACKEND_UNAVAILABLE"
      ? t("errors.backendUnavailable")
      : errorCode === "RATE_LIMITED"
        ? t("errors.rateLimited")
        : t("errors.generic")

  return (
    <section
      aria-label={t("title")}
      className="flex min-w-0 flex-1 flex-col gap-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-md border border-border bg-card p-4 text-card-foreground">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <ShieldCheckIcon
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-success"
          />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold text-foreground">
              {t("safetyBanner.title")}
            </p>
            <p className="text-body-sm text-muted-foreground">
              {t("safetyBanner.description")}
            </p>
          </div>
        </div>
        <DisabledTooltip
          reason={refreshing ? tDisabled("refreshing") : null}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing}
            aria-busy={refreshing}
            onClick={() => {
              void handleRefresh()
            }}
          >
            <RefreshCwIcon
              data-icon="inline-start"
              aria-hidden="true"
              className={refreshing ? "animate-spin" : undefined}
            />
            {t(refreshing ? "refreshing" : "refresh")}
          </Button>
        </DisabledTooltip>
      </div>

      {errorCode && !overview ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertTriangleIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{t("errors.title")}</EmptyTitle>
            <EmptyDescription>{errorMessage}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              type="button"
              variant="secondary"
              disabled={refreshing}
              onClick={() => {
                void handleRefresh()
              }}
            >
              {t("retry")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}

      {overview ? (
        <>
          {errorCode ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-card px-4 py-3 text-body-sm font-medium text-destructive"
            >
              <AlertTriangleIcon
                aria-hidden="true"
                className="mr-1.5 inline size-4"
              />
              {errorMessage}
            </div>
          ) : null}

          <section
            aria-label={t("machine.title")}
            className="min-w-0 space-y-4 rounded-md border border-border bg-card p-4 text-card-foreground md:p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-heading-md">{t("machine.title")}</h2>
                <p className="text-caption text-muted-foreground">
                  {t("machine.checkedAt")}{" "}
                  <time
                    dateTime={overview.checkedAt}
                    className="font-medium text-foreground"
                  >
                    {format.dateTime(new Date(overview.checkedAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  <CpuIcon aria-hidden="true" />v{overview.activeNodeVersion}
                </Badge>
                <Badge
                  variant={
                    overview.activeVersionSupported ? "success" : "warning"
                  }
                >
                  {overview.activeVersionSupported ? (
                    <CheckIcon aria-hidden="true" />
                  ) : (
                    <AlertTriangleIcon aria-hidden="true" />
                  )}
                  {t(
                    overview.activeVersionSupported
                      ? "machine.supported"
                      : "machine.unsupported",
                  )}
                </Badge>
              </div>
            </div>

            <div className="grid min-w-0 gap-3 md:grid-cols-3">
              {overview.managers.map((manager) => (
                <ManagerCard key={manager.id} manager={manager} />
              ))}
            </div>
          </section>

          {overview.scanId === null ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderSearchIcon aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{t("noScan.title")}</EmptyTitle>
                <EmptyDescription>{t("noScan.description")}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button asChild variant="secondary">
                  <Link href="/">{t("noScan.cta")}</Link>
                </Button>
              </EmptyContent>
            </Empty>
          ) : overview.projects.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderSearchIcon aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{t("noProjects.title")}</EmptyTitle>
                <EmptyDescription>
                  {t("noProjects.description")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <button
                  type="button"
                  aria-pressed={selectedStatuses.length === 0}
                  onClick={() => setSelectedStatuses([])}
                  className={cn(
                    "flex min-w-0 flex-col gap-1 rounded-md border bg-card p-4 text-left transition-colors focus-ring hover:bg-muted/50",
                    selectedStatuses.length === 0
                      ? "border-foreground"
                      : "border-border",
                  )}
                >
                  <span className="text-caption text-muted-foreground">
                    {t("kpi.total")}
                  </span>
                  <span className="text-heading-lg tabular-nums text-foreground">
                    {format.number(overview.counts.total)}
                  </span>
                </button>

                {NODE_STATUS_ORDER.map((status) => {
                  const active =
                    selectedStatuses.length === 1 &&
                    selectedStatuses[0] === status
                  return (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleStatusFilter(status)}
                      className={cn(
                        "flex min-w-0 flex-col gap-1 rounded-md border bg-card p-4 text-left transition-colors focus-ring hover:bg-muted/50",
                        active ? "border-foreground" : "border-border",
                      )}
                    >
                      <span className="text-caption text-muted-foreground">
                        {t(`statuses.${status}`)}
                      </span>
                      <span
                        className={cn(
                          "text-heading-lg tabular-nums",
                          status === "mismatch" && overview.counts.mismatch > 0
                            ? "text-warning"
                            : "text-foreground",
                        )}
                      >
                        {format.number(overview.counts[status])}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="rounded-md border border-border bg-card p-4">
                <DiscoveryControls
                  query={query}
                  onQueryChange={setQuery}
                  count={visibleProjects.length}
                  total={overview.projects.length}
                  onReset={resetDiscovery}
                >
                  <DiscoveryFilter
                    label={t("filters.status")}
                    value={selectedStatuses}
                    options={statusOptions}
                    onValueChange={setSelectedStatuses}
                  />
                  <DiscoverySort<NodeProjectSort>
                    value={sort}
                    options={sortOptions}
                    onValueChange={setSort}
                  />
                </DiscoveryControls>
              </div>

              <div ref={listAnchorRef} className="space-y-3">
                {visibleProjects.length === 0 ? (
                  <div className="rounded-md border border-border bg-card p-6">
                    <DiscoveryEmpty total={overview.projects.length} />
                  </div>
                ) : (
                  <>
                    {pagination.items.map((project) => (
                      <ProjectCompatibilityRow
                        key={project.path}
                        project={project}
                        hasDetectedManager={overview.managers.some(
                          (m) => m.detected,
                        )}
                        returnContext={returnContext}
                      />
                    ))}
                    <ListPagination
                      meta={pagination.meta}
                      pageSize={pagination.pageSize}
                      showPageSizeSelector={pagination.showPageSizeSelector}
                      onPageChange={pagination.setPage}
                      onPageSizeChange={pagination.setPageSize}
                    />
                  </>
                )}
              </div>
            </>
          )}
        </>
      ) : null}
    </section>
  )
}
