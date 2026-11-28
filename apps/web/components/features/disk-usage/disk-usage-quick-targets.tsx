"use client"

import Link from "next/link"
import { useId, useMemo, useState } from "react"
import {
  BookmarkIcon,
  FolderIcon,
  FolderSearchIcon,
  PackageIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { DiskView, ScannedProject } from "@/lib/api/types"
import {
  diskFavoriteComparisonKey,
  MAX_DISK_FAVORITES,
  type DiskUsageFavorite,
} from "@/lib/disk-usage/disk-usage-favorites"
import { selectTopHeaviestProjects } from "@/lib/disk-usage/disk-usage-metrics"
import { projectDisplayName } from "@/lib/projects/project-list"
import { cn } from "@/lib/utils"

interface DiskUsageQuickTargetsProps {
  roots: readonly string[]
  projects: readonly ScannedProject[]
  hasScan: boolean
  favorites: readonly DiskUsageFavorite[]
  activePath: string
  activeView: DiskView
  disabled: boolean
  onPickTarget(path: string, view: DiskView): void
  onRemoveFavorite(id: string): void
}

export function DiskUsageQuickTargets({
  roots,
  projects,
  hasScan,
  favorites,
  activePath,
  activeView,
  disabled,
  onPickTarget,
  onRemoveFavorite,
}: DiskUsageQuickTargetsProps) {
  const t = useTranslations("diskUsage")
  const tDisabled = useTranslations("disabledReasons")
  const format = useFormatter()
  const pickerSearchId = useId()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState("")
  const disabledReason = disabled ? tDisabled("diskRunning") : null

  const topProjects = useMemo(() => selectTopHeaviestProjects(projects, 6), [projects])
  const filteredProjects = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    if (!q) return projects.slice(0, 24)
    return projects
      .filter((project) => {
        const name = projectDisplayName(project).toLowerCase()
        return name.includes(q) || project.path.toLowerCase().includes(q)
      })
      .slice(0, 24)
  }, [projects, pickerQuery])

  const activeComparisonKey = activePath.trim() ? diskFavoriteComparisonKey(activePath, activeView) : ""

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-md border border-border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h2 className="text-body-md font-semibold text-foreground">{t("quickTargets.heading")}</h2>
          <p className="text-caption text-muted-foreground">{t("quickTargets.hint")}</p>
        </div>
        {projects.length > 0 ? (
          <DisabledTooltip reason={disabledReason}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
            >
              <FolderSearchIcon aria-hidden="true" />
              {t("quickTargets.pickProject", { count: format.number(projects.length) })}
            </Button>
          </DisabledTooltip>
        ) : !hasScan ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/">{t("quickTargets.goScan")}</Link>
          </Button>
        ) : null}
      </div>

      {roots.length > 0 ? (
        <div className="min-w-0 space-y-1.5">
          <p className="text-caption font-medium text-muted-foreground">{t("quickTargets.rootsLabel")}</p>
          <div className="flex min-w-0 flex-wrap gap-2">
            {roots.map((root) => {
              const isCurrent = activeComparisonKey !== "" && activeComparisonKey === diskFavoriteComparisonKey(root, "directory")
              return (
                <DisabledTooltip key={root} reason={disabledReason} className="min-w-0 max-w-full rounded-full">
                  <button
                    type="button"
                    disabled={disabled}
                    aria-current={isCurrent ? "true" : undefined}
                    title={disabled ? undefined : root}
                    onClick={() => onPickTarget(root, "directory")}
                    className={cn(
                      "inline-flex min-h-9 min-w-0 max-w-full items-center gap-2 rounded-full border px-3.5 py-1.5 font-mono text-caption transition-colors focus-ring disabled:opacity-50",
                      isCurrent
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-foreground hover:bg-muted",
                    )}
                  >
                    <FolderIcon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{root}</span>
                  </button>
                </DisabledTooltip>
              )
            })}
          </div>
        </div>
      ) : null}

      {topProjects.length > 0 ? (
        <div className="min-w-0 space-y-1.5">
          <p className="text-caption font-medium text-muted-foreground">{t("quickTargets.heaviestLabel")}</p>
          <div className="flex min-w-0 flex-wrap gap-2">
            {topProjects.map((project) => {
              const nmPath = project.nodeModules.path
              const isCurrent = activeComparisonKey !== "" && activeComparisonKey === diskFavoriteComparisonKey(nmPath, "packages")
              return (
                <DisabledTooltip key={project.path} reason={disabledReason} className="min-w-0 max-w-full rounded-full">
                  <button
                    type="button"
                    disabled={disabled}
                    aria-current={isCurrent ? "true" : undefined}
                    title={disabled ? undefined : nmPath}
                    onClick={() => onPickTarget(nmPath, "packages")}
                    className={cn(
                      "inline-flex min-h-9 min-w-0 max-w-full items-center gap-2 rounded-full border px-3.5 py-1.5 text-caption transition-colors focus-ring disabled:opacity-50",
                      isCurrent
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-foreground hover:bg-muted",
                    )}
                  >
                    <PackageIcon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate font-medium">{projectDisplayName(project)}</span>
                    {project.nodeModules.sizeBytes !== null ? (
                      <span className={cn("shrink-0 tabular-nums", isCurrent ? "text-background/80" : "text-muted-foreground")}>
                        <DiskSize bytes={project.nodeModules.sizeBytes} />
                      </span>
                    ) : null}
                  </button>
                </DisabledTooltip>
              )
            })}
          </div>
        </div>
      ) : null}

      {pickerOpen && projects.length > 0 ? (
        <div className="space-y-3 rounded-md border border-border bg-background p-3.5">
          <div className="relative min-w-0">
            <Label htmlFor={pickerSearchId} className="sr-only">{t("quickTargets.searchPlaceholder")}</Label>
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={pickerSearchId}
              type="search"
              value={pickerQuery}
              onChange={(event) => setPickerQuery(event.target.value)}
              placeholder={t("quickTargets.searchPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className={
                pickerQuery
                  ? "pr-10 pl-10 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-cancel-button]:hidden"
                  : "pl-10 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-cancel-button]:hidden"
              }
            />
            {pickerQuery ? (
              <button
                type="button"
                aria-label={t("quickTargets.clearSearch")}
                onClick={() => setPickerQuery("")}
                className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors focus-ring hover:bg-muted hover:text-foreground"
              >
                <XIcon className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {filteredProjects.length === 0 ? (
            <p className="text-caption text-muted-foreground">{t("quickTargets.noProjectMatches")}</p>
          ) : (
            <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-sm border border-border">
              {filteredProjects.map((project) => (
                <li
                  key={project.path}
                  className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-medium text-foreground">{projectDisplayName(project)}</p>
                    <p className="truncate font-mono text-caption text-muted-foreground" title={project.path}>
                      {project.path}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <DisabledTooltip reason={disabledReason}>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={disabled}
                        onClick={() => {
                          setPickerOpen(false)
                          onPickTarget(project.path, "directory")
                        }}
                      >
                        <FolderIcon aria-hidden="true" />
                        {t("quickTargets.measureFolder")}
                      </Button>
                    </DisabledTooltip>
                    {project.nodeModules.exists ? (
                      <DisabledTooltip reason={disabledReason}>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => {
                            setPickerOpen(false)
                            onPickTarget(project.nodeModules.path, "packages")
                          }}
                        >
                          <PackageIcon aria-hidden="true" />
                          {t("quickTargets.measurePackages")}
                        </Button>
                      </DisabledTooltip>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="min-w-0 space-y-1.5 border-t border-border/60 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <BookmarkIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <p className="text-caption font-medium text-muted-foreground">{t("favorites.heading")}</p>
          <Badge variant="secondary">
            {t("favorites.count", {
              count: format.number(favorites.length),
              max: format.number(MAX_DISK_FAVORITES),
            })}
          </Badge>
        </div>
        {favorites.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("favorites.empty")}</p>
        ) : (
          <div className="flex min-w-0 flex-wrap gap-2">
            {favorites.map((fav) => {
              const isCurrent = activeComparisonKey !== "" && activeComparisonKey === diskFavoriteComparisonKey(fav.path, fav.view)
              return (
                <div
                  key={fav.id}
                  className={cn(
                    "inline-flex min-w-0 max-w-full items-center rounded-full border text-caption transition-colors",
                    isCurrent
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-foreground",
                  )}
                >
                  <DisabledTooltip reason={disabledReason} className="min-w-0 max-w-full rounded-l-full">
                    <button
                      type="button"
                      disabled={disabled}
                      aria-current={isCurrent ? "true" : undefined}
                      title={disabled ? undefined : fav.path}
                      onClick={() => onPickTarget(fav.path, fav.view)}
                      className="inline-flex min-h-8 min-w-0 max-w-full items-center gap-1.5 rounded-l-full py-1 pr-2 pl-3 transition-colors focus-ring hover:opacity-85 disabled:opacity-50"
                    >
                      {fav.view === "packages" ? (
                        <PackageIcon className="size-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <FolderIcon className="size-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span className="min-w-0 truncate font-medium">{fav.label}</span>
                    </button>
                  </DisabledTooltip>
                  <button
                    type="button"
                    aria-label={t("favorites.remove", { label: fav.label })}
                    onClick={() => onRemoveFavorite(fav.id)}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-r-full transition-colors focus-ring hover:bg-muted/40"
                  >
                    <XIcon className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
