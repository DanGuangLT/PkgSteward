"use client"

import { useMemo, useRef, useState, type RefObject } from "react"
import {
  CheckSquareIcon,
  ChevronDownIcon,
  EyeIcon,
  FolderTreeIcon,
  ListIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { useFormatter, useLocale, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { CleanupItems } from "@/components/features/file-ops/cleanup-items"
import { CleanupKpiStrip } from "@/components/features/file-ops/cleanup-kpi-strip"
import { RiskBadge } from "@/components/features/file-ops/risk-badge"
import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import { ListPagination, useListPagination } from "@/components/shared/list-pagination"
import {
  DiscoveryControls,
  DiscoveryEmpty,
  DiscoveryFilter,
  DiscoverySort,
} from "@/components/shared/list-discovery"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { FileOpsController } from "@/hooks/use-file-ops"
import { useViewState } from "@/hooks/use-navigation-continuity"
import type { FileOpsPreview } from "@/lib/api/types"
import {
  CLEANUP_DISCOVERY,
  TARGET_KINDS,
  TARGET_LOCKFILES,
  TARGET_RISKS,
  TARGET_VALIDITIES,
  cleanupDiscoveryCodec,
  hiddenSelectedCount,
  selectCleanupTargets,
  type CleanupDiscovery,
} from "@/lib/file-ops/discovery"
import {
  applyQuickSelection,
  applyRangeSelection,
  computeCleanupMetrics,
  defaultCleanupSortDirection,
  initialReviewSelection,
  isReviewTarget,
  type CleanupQuickSelectionMode,
  type CleanupSort,
} from "@/lib/file-ops/file-ops-list"
import { MAX_DELETE_PATHS } from "@/lib/file-ops/tree-selection"
import { fileSelectionActionDisabledReason } from "@/lib/ui/disabled-reasons"
import { makeViewStateKey } from "@/lib/ui/navigation-targets"
import { cn } from "@/lib/utils"

const NOTHING_SELECTED: ReadonlySet<string> = new Set()

// Mốc của thời gian tương đối lấy từ preview: trang có thể đã mở từ lâu.
const previewTime = ({ startedAt, finishedAt }: FileOpsPreview): string => finishedAt ?? startedAt

function QuickTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
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

function ReviewSelection({
  controller,
  preview,
  actionRef,
}: {
  controller: FileOpsController
  preview: FileOpsPreview
  actionRef: RefObject<HTMLButtonElement | null>
}) {
  const t = useTranslations("fileOps")
  const tDisabled = useTranslations("disabledReasons")
  const d = useTranslations("listDiscovery")
  const format = useFormatter()
  const locale = useLocale()
  const { state } = controller
  const isCleanup = preview.source === "cleanup"
  const ready = state.phase === "reviewing" && !state.summarizing
  const busy = !ready

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => initialReviewSelection(preview))
  const [discovery, setDiscovery] = useViewState(
    makeViewStateKey("cleanup-review", JSON.stringify([preview.source, preview.scanId])),
    cleanupDiscoveryCodec,
    CLEANUP_DISCOVERY,
  )

  const effectiveDiscovery: CleanupDiscovery = useMemo(
    () => (isCleanup ? discovery : { ...discovery, viewMode: "list" }),
    [isCleanup, discovery],
  )

  const metrics = useMemo(() => computeCleanupMetrics(preview.targets, selected), [preview.targets, selected])
  const visibleTargets = useMemo(
    () => selectCleanupTargets(preview.targets, effectiveDiscovery, locale, selected),
    [preview.targets, effectiveDiscovery, locale, selected],
  )
  const listAnchorRef = useRef<HTMLDivElement | null>(null)
  const cleanupResetKey = useMemo(
    () => JSON.stringify([preview.previewId, effectiveDiscovery]),
    [preview.previewId, effectiveDiscovery],
  )
  const cleanupPagination = useListPagination(visibleTargets, {
    resetKey: cleanupResetKey,
    scrollTargetRef: listAnchorRef,
  })
  const displayedTargets =
    effectiveDiscovery.viewMode === "list" ? cleanupPagination.items : visibleTargets
  const visiblePathList = useMemo(() => visibleTargets.map((target) => target.path), [visibleTargets])
  const visiblePathSet = useMemo(() => new Set(visiblePathList), [visiblePathList])
  const eligiblePathSet = useMemo(
    () => new Set(preview.targets.filter(isReviewTarget).map((target) => target.path)),
    [preview.targets],
  )
  const visibleEligible = useMemo(
    () => visibleTargets.filter(isReviewTarget),
    [visibleTargets],
  )
  const visibleSelectedCount = useMemo(
    () => visibleEligible.filter((target) => selected.has(target.path)).length,
    [visibleEligible, selected],
  )
  const visibleCheckState: boolean | "indeterminate" = visibleEligible.length > 0 && visibleSelectedCount === visibleEligible.length
    ? true
    : visibleSelectedCount > 0
      ? "indeterminate"
      : false

  const hiddenSelected = hiddenSelectedCount(selected, visiblePathSet)
  const tooMany = selected.size > MAX_DELETE_PATHS

  const isAttentionTab = !effectiveDiscovery.selectedOnly
    && effectiveDiscovery.validities.length === 0
    && effectiveDiscovery.risks.length === 2
    && effectiveDiscovery.risks.includes("medium")
    && effectiveDiscovery.risks.includes("high")
  const isInvalidTab = !effectiveDiscovery.selectedOnly
    && effectiveDiscovery.risks.length === 0
    && effectiveDiscovery.validities.length === 1
    && effectiveDiscovery.validities[0] === "invalid"
  const isAllTab = !effectiveDiscovery.selectedOnly
    && effectiveDiscovery.risks.length === 0
    && effectiveDiscovery.validities.length === 0

  const kindOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of preview.targets) {
      const k = row.kind ?? "unknown"
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return TARGET_KINDS
      .filter((value) => (counts.get(value) ?? 0) > 0)
      .map((value) => ({ value, label: d(`values.${value}`), count: counts.get(value) ?? 0 }))
  }, [preview.targets, d])

  const hasLockfileData = useMemo(
    () => preview.targets.some((target) => target.hasLockfile !== null),
    [preview.targets],
  )

  const lockfileCounts = useMemo(() => {
    let withLock = 0
    let withoutLock = 0
    for (const target of preview.targets) {
      if (target.hasLockfile === true) withLock += 1
      else if (target.hasLockfile === false) withoutLock += 1
    }
    return { with: withLock, without: withoutLock }
  }, [preview.targets])

  function toggle(path: string) {
    setSelected((previous) => {
      const next = new Set(previous)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  function handleRangeSelect(anchorPath: string | null, targetPath: string, orderedPaths: readonly string[]) {
    setSelected((previous) => applyRangeSelection(orderedPaths, eligiblePathSet, previous, anchorPath, targetPath))
  }

  function handleQuickSelect(mode: CleanupQuickSelectionMode) {
    setSelected((previous) => applyQuickSelection(preview.targets, visiblePathSet, previous, mode))
  }

  function handleToggleAllVisible() {
    if (visibleCheckState === true) handleQuickSelect("deselect_visible")
    else handleQuickSelect("visible")
  }

  function handleToggleGroup(groupEligiblePaths: readonly string[]) {
    if (groupEligiblePaths.length === 0) return
    setSelected((previous) => {
      const allChosen = groupEligiblePaths.every((path) => previous.has(path))
      const next = new Set(previous)
      for (const path of groupEligiblePaths) {
        if (allChosen) next.delete(path)
        else next.add(path)
      }
      return next
    })
  }

  function handleSortChange(column: CleanupSort) {
    setDiscovery(
      discovery.sort === column
        ? { ...discovery, sortDir: discovery.sortDir === "asc" ? "desc" : "asc" }
        : { ...discovery, sort: column, sortDir: defaultCleanupSortDirection(column) },
    )
  }

  function showOnlySelectedAllFiltersCleared() {
    setDiscovery({
      ...CLEANUP_DISCOVERY,
      sort: discovery.sort,
      sortDir: discovery.sortDir,
      viewMode: discovery.viewMode,
      selectedOnly: true,
    })
  }

  function resetAllFilters() {
    setDiscovery({
      ...CLEANUP_DISCOVERY,
      sort: discovery.sort,
      sortDir: discovery.sortDir,
      viewMode: discovery.viewMode,
    })
  }

  if (preview.targets.length === 0) {
    if (preview.status === "failed") return null
    return (
      <p className="rounded-md border border-border bg-card p-5 text-body-sm text-muted-foreground">
        {preview.status === "cancelled" ? t("empty.stoppedEarly") : t("empty.noTargets")}
      </p>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {isCleanup ? (
        <CleanupKpiStrip
          metrics={metrics}
          selectedOnly={effectiveDiscovery.selectedOnly}
          attentionActive={isAttentionTab || isInvalidTab}
          onShowAll={() => setDiscovery({
            ...discovery,
            selectedOnly: false,
            risks: [],
            validities: [],
          })}
          onToggleSelectedOnly={() => setDiscovery({
            ...discovery,
            selectedOnly: !discovery.selectedOnly,
            risks: [],
            validities: [],
          })}
          onToggleAttention={() => setDiscovery(
            isAttentionTab || isInvalidTab
              ? { ...discovery, risks: [], validities: [] }
              : metrics.attentionCount > 0
                ? { ...discovery, selectedOnly: false, validities: [], risks: ["medium", "high"] }
                : { ...discovery, selectedOnly: false, risks: [], validities: ["invalid"] },
          )}
        />
      ) : null}

      <div className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {isCleanup ? (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("listLabel")}>
              <QuickTabButton
                active={isAllTab}
                onClick={() => setDiscovery({
                  ...discovery,
                  selectedOnly: false,
                  risks: [],
                  validities: [],
                })}
              >
                {t("reviewTools.tabs.all", { count: format.number(metrics.totalTargets) })}
              </QuickTabButton>
              <QuickTabButton
                active={effectiveDiscovery.selectedOnly}
                onClick={() => setDiscovery({
                  ...discovery,
                  selectedOnly: !discovery.selectedOnly,
                  risks: [],
                  validities: [],
                })}
              >
                {t("reviewTools.tabs.selected", { count: format.number(metrics.selected.count) })}
              </QuickTabButton>
              {metrics.attentionCount > 0 ? (
                <QuickTabButton
                  active={isAttentionTab}
                  onClick={() => setDiscovery(
                    isAttentionTab
                      ? { ...discovery, risks: [] }
                      : { ...discovery, selectedOnly: false, validities: [], risks: ["medium", "high"] },
                  )}
                >
                  {t("reviewTools.tabs.attention", { count: format.number(metrics.attentionCount) })}
                </QuickTabButton>
              ) : null}
              {metrics.invalidCount > 0 ? (
                <QuickTabButton
                  active={isInvalidTab}
                  onClick={() => setDiscovery(
                    isInvalidTab
                      ? { ...discovery, validities: [] }
                      : { ...discovery, selectedOnly: false, risks: [], validities: ["invalid"] },
                  )}
                >
                  {t("reviewTools.tabs.invalid", { count: format.number(metrics.invalidCount) })}
                </QuickTabButton>
              ) : null}
            </div>
          ) : effectiveDiscovery.selectedOnly ? (
            <QuickTabButton
              active
              onClick={() => setDiscovery({ ...discovery, selectedOnly: false })}
            >
              {t("reviewTools.tabs.selected", { count: format.number(metrics.selected.count) })}
            </QuickTabButton>
          ) : <div />}

          <div className="flex flex-wrap items-center gap-2">
            {busy || metrics.eligibleCount === 0 ? (
              <DisabledTooltip
                reason={busy ? tDisabled("fileOpsBusy") : tDisabled("noEligibleItems")}
              >
                <Button type="button" variant="outline" size="sm" className="h-9 px-3.5" disabled>
                  <CheckSquareIcon aria-hidden="true" />
                  {t("reviewTools.smartSelect")}
                  <ChevronDownIcon aria-hidden="true" />
                </Button>
              </DisabledTooltip>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="h-9 px-3.5">
                    <CheckSquareIcon aria-hidden="true" />
                    {t("reviewTools.smartSelect")}
                    <ChevronDownIcon aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-60">
                  {isCleanup ? (
                    <DropdownMenuItem onSelect={() => handleQuickSelect("recommended")}>
                      <RotateCcwIcon aria-hidden="true" />
                      {t("reviewTools.selectRecommended")}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    disabled={visibleEligible.length === 0}
                    onSelect={() => handleQuickSelect("visible")}
                  >
                    <CheckSquareIcon aria-hidden="true" />
                    {t("reviewTools.selectVisible", { count: format.number(visibleEligible.length) })}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={visibleEligible.length === 0}
                    onSelect={() => handleQuickSelect("low_risk_visible")}
                  >
                    <ShieldCheckIcon aria-hidden="true" />
                    {t("reviewTools.selectLowRiskVisible")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={visibleSelectedCount === 0}
                    onSelect={() => handleQuickSelect("deselect_visible")}
                  >
                    <SquareIcon aria-hidden="true" />
                    {t("reviewTools.deselectVisible")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={metrics.selected.count === 0}
                    onSelect={() => handleQuickSelect("clear")}
                  >
                    <XIcon aria-hidden="true" />
                    {t("reviewTools.clearAll")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {isCleanup ? (
              <div
                role="group"
                aria-label={t("reviewTools.viewMode")}
                className="inline-flex h-9 items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
              >
                <Button
                  type="button"
                  size="sm"
                  variant={effectiveDiscovery.viewMode === "list" ? "secondary" : "ghost"}
                  aria-pressed={effectiveDiscovery.viewMode === "list"}
                  className="h-7 rounded-sm px-2.5"
                  onClick={() => setDiscovery({ ...discovery, viewMode: "list" })}
                >
                  <ListIcon aria-hidden="true" />
                  {t("reviewTools.viewList")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={effectiveDiscovery.viewMode === "grouped" ? "secondary" : "ghost"}
                  aria-pressed={effectiveDiscovery.viewMode === "grouped"}
                  className="h-7 rounded-sm px-2.5"
                  onClick={() => setDiscovery({ ...discovery, viewMode: "grouped" })}
                >
                  <FolderTreeIcon aria-hidden="true" />
                  {t("reviewTools.viewGrouped")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <DiscoveryControls
          query={effectiveDiscovery.query}
          onQueryChange={(query) => setDiscovery({ ...discovery, query })}
          count={visibleTargets.length}
          total={preview.targets.length}
          hint={effectiveDiscovery.viewMode === "list" && visibleTargets.length > 1
            ? <span className="hidden md:inline">· {t("reviewTools.shiftHint")}</span>
            : undefined}
          onReset={resetAllFilters}
        >
          {kindOptions.length > 1 ? (
            <DiscoveryFilter
              label={d("kinds")}
              value={effectiveDiscovery.kinds}
              options={kindOptions}
              onValueChange={(kinds) => setDiscovery({ ...discovery, kinds })}
            />
          ) : null}
          <DiscoveryFilter
            label={d("risks")}
            value={effectiveDiscovery.risks}
            options={TARGET_RISKS.map((value) => ({
              value,
              label: d(`values.${value}`),
              count: preview.targets.filter((row) => row.risk.level === value).length,
            }))}
            onValueChange={(risks) => setDiscovery({ ...discovery, risks })}
          />
          {hasLockfileData ? (
            <DiscoveryFilter
              label={t("reviewTools.lockfileLabel")}
              value={effectiveDiscovery.lockfiles}
              options={TARGET_LOCKFILES.map((value) => ({
                value,
                label: value === "with" ? t("reviewTools.lockfileWith") : t("reviewTools.lockfileWithout"),
                count: lockfileCounts[value],
              }))}
              onValueChange={(lockfiles) => setDiscovery({ ...discovery, lockfiles })}
            />
          ) : null}
          {metrics.invalidCount > 0 ? (
            <DiscoveryFilter
              label={d("validities")}
              value={effectiveDiscovery.validities}
              options={TARGET_VALIDITIES.map((value) => ({
                value,
                label: d(`values.${value}`),
                count: preview.targets.filter((row) => row.valid === (value === "valid")).length,
              }))}
              onValueChange={(validities) => setDiscovery({ ...discovery, validities })}
            />
          ) : null}
          <DiscoverySort
            value={effectiveDiscovery.sort}
            options={[
              { value: "size" as const, label: d("size") },
              { value: "age" as const, label: d("age") },
              { value: "risk" as const, label: t("reviewTools.sortRisk") },
              { value: "name" as const, label: t("reviewTools.sortName") },
            ]}
            onValueChange={(sort) => setDiscovery({
              ...discovery,
              sort,
              sortDir: defaultCleanupSortDirection(sort),
            })}
          />
        </DiscoveryControls>
      </div>

      {visibleTargets.length > 0 ? (
        <div ref={listAnchorRef} className="min-w-0 scroll-mt-20 space-y-4">
          <CleanupItems
            targets={displayedTargets}
            selected={selected}
            disabled={busy}
            referenceTime={previewTime(preview)}
            maxTargetBytes={metrics.maxTargetBytes}
            sort={effectiveDiscovery.sort}
            sortDir={effectiveDiscovery.sortDir}
            viewMode={effectiveDiscovery.viewMode}
            visibleCheckState={visibleCheckState}
            showInspectLinks={isCleanup}
            returnTo="/cleanup"
            onToggle={toggle}
            onRangeSelect={handleRangeSelect}
            onToggleAllVisible={handleToggleAllVisible}
            onToggleGroup={handleToggleGroup}
            onSortChange={handleSortChange}
          />
          {effectiveDiscovery.viewMode === "list" && (
            <ListPagination
              meta={cleanupPagination.meta}
              pageSize={cleanupPagination.pageSize}
              showPageSizeSelector={cleanupPagination.showPageSizeSelector}
              onPageChange={cleanupPagination.setPage}
              onPageSizeChange={cleanupPagination.setPageSize}
            />
          )}
        </div>
      ) : (
        <DiscoveryEmpty total={preview.targets.length} />
      )}

      <div className="sticky bottom-0 z-20 flex min-w-0 flex-col gap-3 rounded-md border border-border bg-background/95 p-4 text-body-sm shadow-modal backdrop-blur-xs">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="font-semibold text-foreground">
                {t("selection.count", {
                  count: metrics.selected.count,
                  formattedCount: format.number(metrics.selected.count),
                })}
              </span>
              {metrics.selected.reclaimableBytes > 0 || metrics.selected.recycleBytes === 0 ? (
                <span className="tabular-nums text-foreground">
                  {t("selection.reclaimable")} <strong><DiskSize bytes={metrics.selected.reclaimableBytes} /></strong>
                </span>
              ) : null}
              {metrics.selected.recycleBytes > 0 ? (
                <span className="tabular-nums text-muted-foreground">
                  {t("selection.recycle")} <strong className="text-foreground"><DiskSize bytes={metrics.selected.recycleBytes} /></strong>
                </span>
              ) : null}
              {metrics.selectedHighestRisk ? <RiskBadge level={metrics.selectedHighestRisk} /> : null}
            </div>
            <p className="text-caption text-muted-foreground">{t("selection.estimateHint")}</p>
            {tooMany ? (
              <p role="alert" className="text-caption font-semibold text-destructive">
                {t("selection.tooMany", { formattedLimit: format.number(MAX_DELETE_PATHS) })}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {metrics.selected.count > 0 ? (
              <DisabledTooltip reason={busy ? tDisabled("fileOpsBusy") : null}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => handleQuickSelect("clear")}
                >
                  {t("actions.clearSelection")}
                </Button>
              </DisabledTooltip>
            ) : null}
            {(() => {
              const reviewReasonKey = fileSelectionActionDisabledReason({
                busy,
                selectedCount: metrics.selected.count,
                tooMany,
              })
              return (
                <DisabledTooltip reason={reviewReasonKey ? tDisabled(reviewReasonKey) : null}>
                  <Button
                    ref={actionRef}
                    type="button"
                    variant="destructive"
                    disabled={busy || metrics.selected.count === 0 || tooMany}
                    onClick={() => void controller.summarize([...selected])}
                  >
                    <Trash2Icon aria-hidden="true" />
                    {t("actions.review", {
                      count: metrics.selected.count,
                      formattedCount: format.number(metrics.selected.count),
                    })}
                  </Button>
                </DisabledTooltip>
              )
            })()}
          </div>
        </div>

        {hiddenSelected > 0 ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-card px-3 py-2 text-caption"
          >
            <span className="font-semibold text-foreground">
              {d("hiddenSelected", { count: format.number(hiddenSelected) })}
            </span>
            <Button type="button" variant="secondary" size="sm" onClick={showOnlySelectedAllFiltersCleared}>
              <EyeIcon aria-hidden="true" />
              {t("reviewTools.showSelected")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function PreviewReview({
  controller,
  actionRef,
}: {
  controller: FileOpsController
  actionRef: RefObject<HTMLButtonElement | null>
}) {
  const { state } = controller
  const preview = state.preview

  if (preview === null) return null
  if (state.phase === "measuring") {
    return (
      <CleanupItems
        targets={preview.targets}
        selected={NOTHING_SELECTED}
        disabled
        referenceTime={previewTime(preview)}
        onToggle={() => undefined}
      />
    )
  }
  if (state.phase !== "reviewing" && state.phase !== "executing" && state.phase !== "unconfirmed") return null
  return (
    <ReviewSelection
      key={preview.previewId}
      controller={controller}
      preview={preview}
      actionRef={actionRef}
    />
  )
}
