"use client"

import { useId, useMemo, useState } from "react"
import {
  BookmarkPlusIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FolderGit2Icon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { DiskSize } from "@/components/features/disk-usage/disk-usage-items"
import type { CleanupScanProjectItem } from "@/components/features/file-ops/cleanup-scan-banner"
import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { CleanupKind, CleanupPreviewInput } from "@/lib/api/types"
import {
  BUILTIN_CLEANUP_PRESETS,
  MAX_PRESET_NAME_LENGTH,
  QUICK_AGE_DAYS,
  QUICK_MIN_SIZE_MIB,
  reconcileProjectPaths,
  type CustomCleanupPreset,
  type UpsertPresetResult,
} from "@/lib/file-ops/cleanup-presets"
import { cleanupPreviewInput, type CleanupFilterForm } from "@/lib/file-ops/file-ops-list"
import { MAX_DELETE_PATHS } from "@/lib/file-ops/tree-selection"
import { cleanupRunDisabledReason } from "@/lib/ui/disabled-reasons"
import { cn } from "@/lib/utils"

type PresetSaveErrorReason = Extract<UpsertPresetResult, { ok: false }>["reason"]

const KINDS: readonly CleanupKind[] = ["node_modules", "orphan_node_modules", "build_cache"]

export const DEFAULT_CLEANUP_FORM: Required<CleanupFilterForm> = BUILTIN_CLEANUP_PRESETS[0].form

function ChipButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 text-button-sm transition-colors focus-ring disabled:pointer-events-none disabled:opacity-50",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  )
}

export function CleanupFilters({
  form,
  open,
  onOpenChange,
  disabled,
  hasScan,
  projects,
  editingPreset,
  onChange,
  onSubmit,
  onSavePreset,
  onStopEditingPreset,
}: {
  form: Required<CleanupFilterForm>
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled: boolean
  hasScan: boolean
  projects: readonly CleanupScanProjectItem[]
  editingPreset: CustomCleanupPreset | null
  onChange: (next: Required<CleanupFilterForm>) => void
  onSubmit: (input: CleanupPreviewInput) => void
  onSavePreset: (name: string, updateId?: string) => UpsertPresetResult
  onStopEditingPreset: () => void
}) {
  const t = useTranslations("fileOps")
  const tDisabled = useTranslations("disabledReasons")
  const format = useFormatter()
  const baseId = useId()
  const [attempted, setAttempted] = useState(false)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [projectSearch, setProjectSearch] = useState("")
  const [saveOpen, setSaveOpen] = useState(false)
  const [presetName, setPresetName] = useState("")
  const [saveError, setSaveError] = useState<PresetSaveErrorReason | null>(null)
  const [trackedEditingId, setTrackedEditingId] = useState<string | null>(editingPreset?.id ?? null)

  const currentEditingId = editingPreset?.id ?? null
  if (currentEditingId !== trackedEditingId) {
    setTrackedEditingId(currentEditingId)
    setSaveOpen(false)
    setSaveError(null)
    setPresetName(editingPreset?.name ?? "")
  }

  const input = cleanupPreviewInput(form)
  const showError = attempted && input === null
  const busyReason = disabled ? tDisabled("fileOpsBusy") : null
  const submitReasonKey = cleanupRunDisabledReason({ busy: disabled, hasScan })
  const submitDisabledReason = submitReasonKey ? tDisabled(submitReasonKey) : null
  const saveDisabledReason = disabled
    ? tDisabled("fileOpsBusy")
    : input === null
      ? tDisabled("cleanupInvalidCriteria")
      : null
  const selectedProjectSet = useMemo(() => new Set(form.projectPaths), [form.projectPaths])
  const scannedPathSet = useMemo(() => new Set(projects.map((p) => p.path)), [projects])
  const { missing: missingPaths } = useMemo(
    () => reconcileProjectPaths(form.projectPaths, scannedPathSet),
    [form.projectPaths, scannedPathSet],
  )
  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase()
    if (!query) return projects
    return projects.filter((p) =>
      (p.name?.toLowerCase().includes(query) ?? false) || p.path.toLowerCase().includes(query),
    )
  }, [projects, projectSearch])

  function toggleKind(kind: CleanupKind) {
    const has = form.kinds.includes(kind)
    onChange({
      ...form,
      kinds: has ? form.kinds.filter((item) => item !== kind) : [...form.kinds, kind],
    })
  }

  function toggleProject(path: string) {
    const has = selectedProjectSet.has(path)
    if (!has && form.projectPaths.length >= MAX_DELETE_PATHS) return
    onChange({
      ...form,
      projectPaths: has
        ? form.projectPaths.filter((item) => item !== path)
        : [...form.projectPaths, path],
    })
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!hasScan) return
    if (input === null) {
      setAttempted(true)
      return
    }
    setAttempted(false)
    onSubmit(input)
  }

  function openSaveComposer() {
    setSaveError(null)
    setPresetName(editingPreset?.name ?? "")
    setSaveOpen(true)
  }

  function handleSave(asNew: boolean) {
    const result = onSavePreset(presetName, asNew ? undefined : editingPreset?.id)
    if (!result.ok) {
      setSaveError(result.reason)
      return
    }
    setSaveError(null)
    setSaveOpen(false)
    setPresetName("")
  }

  const contentId = `${baseId}-customizer-body`

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => onOpenChange(!open)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-ring rounded-sm"
        >
          <SlidersHorizontalIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-body-sm font-semibold text-foreground">{t("customizer.title")}</p>
            <p className="text-caption text-muted-foreground">{t("customizer.subtitle")}</p>
          </div>
          {open ? (
            <ChevronUpIcon className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
        </button>
      </div>

      {open ? (
        <form
          id={contentId}
          onSubmit={submit}
          noValidate
          className="flex min-w-0 flex-col gap-5 border-t border-border p-4 md:p-5"
        >
          {editingPreset ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-background px-3 py-2 text-caption">
              <span className="min-w-0 font-semibold text-foreground [overflow-wrap:anywhere]">
                {t("presets.editingBanner", { name: editingPreset.name })}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={onStopEditingPreset}>
                <XIcon aria-hidden="true" />
                {t("presets.stopEditing")}
              </Button>
            </div>
          ) : null}

          <fieldset className="space-y-2.5">
            <legend className="text-body-sm font-semibold text-foreground">{t("filters.kinds")}</legend>
            <div className="flex flex-wrap gap-3">
              {KINDS.map((kind) => {
                const checked = form.kinds.includes(kind)
                const id = `${baseId}-${kind}`
                return (
                  <Label
                    key={kind}
                    htmlFor={id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md border px-3.5 py-2 text-body-sm transition-colors",
                      checked ? "border-foreground bg-background text-foreground" : "border-border bg-background/60 text-muted-foreground",
                    )}
                  >
                    <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={() => toggleKind(kind)} />
                    <span>{t(`kinds.${kind}`)}</span>
                  </Label>
                )
              })}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${baseId}-days`}>{t("filters.olderThanDays")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_AGE_DAYS.map((days) => (
                  <ChipButton
                    key={days || "any"}
                    active={form.olderThanDays === days}
                    disabled={disabled}
                    onClick={() => onChange({ ...form, olderThanDays: days })}
                  >
                    {days === "" ? t("customizer.any") : t("customizer.daysChip", { days })}
                  </ChipButton>
                ))}
              </div>
              <Input
                id={`${baseId}-days`}
                inputMode="numeric"
                value={form.olderThanDays}
                disabled={disabled}
                placeholder="0"
                onChange={(event) => onChange({ ...form, olderThanDays: event.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${baseId}-size`}>{t("filters.minSizeMib")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_MIN_SIZE_MIB.map((mib) => (
                  <ChipButton
                    key={mib || "any"}
                    active={form.minSizeMib === mib}
                    disabled={disabled}
                    onClick={() => onChange({ ...form, minSizeMib: mib })}
                  >
                    {mib === ""
                      ? t("customizer.any")
                      : mib === "1024"
                        ? t("customizer.sizeGibChip")
                        : t("customizer.sizeMibChip", { mib })}
                  </ChipButton>
                ))}
              </div>
              <Input
                id={`${baseId}-size`}
                inputMode="numeric"
                value={form.minSizeMib}
                disabled={disabled}
                placeholder="0"
                onChange={(event) => onChange({ ...form, minSizeMib: event.target.value })}
              />
            </div>
          </div>

          {projects.length > 0 || form.projectPaths.length > 0 ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <FolderGit2Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-body-sm font-semibold text-foreground">{t("customizer.projectScope")}</span>
                  <Badge variant={form.projectPaths.length > 0 ? "default" : "secondary"}>
                    {form.projectPaths.length === 0
                      ? t("customizer.allProjects", { count: format.number(projects.length) })
                      : t("customizer.selectedProjects", { count: format.number(form.projectPaths.length) })}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {form.projectPaths.length > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => onChange({ ...form, projectPaths: [] })}
                    >
                      {t("customizer.clearProjects")}
                    </Button>
                  ) : null}
                  {projects.length > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      aria-expanded={projectPickerOpen}
                      onClick={() => setProjectPickerOpen((v) => !v)}
                    >
                      {t("customizer.pickProjects")}
                    </Button>
                  ) : null}
                </div>
              </div>

              {missingPaths.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-destructive/40 bg-background px-3 py-2 text-caption text-destructive">
                  <span>{t("customizer.missingProjectsWarning", { count: format.number(missingPaths.length) })}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onChange({
                      ...form,
                      projectPaths: form.projectPaths.filter((p) => scannedPathSet.has(p)),
                    })}
                  >
                    {t("customizer.removeMissingProjects")}
                  </Button>
                </div>
              ) : null}

              {projectPickerOpen && projects.length > 0 ? (
                <div className="space-y-2.5 rounded-md border border-border bg-background p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-0 flex-1">
                      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                      <Input
                        type="search"
                        value={projectSearch}
                        onChange={(e) => setProjectSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.preventDefault()
                        }}
                        placeholder={t("customizer.projectSearchPlaceholder")}
                        className="pl-9"
                      />
                    </div>
                    <DisabledTooltip
                      reason={disabled ? busyReason : filteredProjects.length === 0 ? tDisabled("noMatchingProjects") : null}
                    >
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={disabled || filteredProjects.length === 0}
                        onClick={() => {
                          const merged = [...form.projectPaths]
                          const seen = new Set(merged)
                          for (const p of filteredProjects) {
                            if (merged.length >= MAX_DELETE_PATHS) break
                            if (!seen.has(p.path)) {
                              seen.add(p.path)
                              merged.push(p.path)
                            }
                          }
                          onChange({ ...form, projectPaths: merged })
                        }}
                      >
                        {t("customizer.selectAllProjects")}
                      </Button>
                    </DisabledTooltip>
                  </div>
                  <p className="text-caption text-muted-foreground">{t("customizer.projectScopeHint")}</p>
                  {filteredProjects.length === 0 ? (
                    <p className="py-3 text-center text-caption text-muted-foreground">{t("customizer.noProjectsMatch")}</p>
                  ) : (
                    <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-sm border border-border">
                      {filteredProjects.map((project) => {
                        const checked = selectedProjectSet.has(project.path)
                        return (
                          <li key={project.path}>
                            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-body-sm hover:bg-muted/60">
                              <Checkbox
                                checked={checked}
                                disabled={disabled || (!checked && form.projectPaths.length >= MAX_DELETE_PATHS)}
                                onCheckedChange={() => toggleProject(project.path)}
                              />
                              <div className="min-w-0 flex-1">
                                <p title={project.name ?? project.path} className="truncate font-medium text-foreground">{project.name ?? project.path}</p>
                                <p title={project.path} className="truncate font-mono text-caption text-muted-foreground">{project.path}</p>
                              </div>
                              {project.nodeModulesSizeBytes !== null ? (
                                <span className="shrink-0 text-caption text-muted-foreground">
                                  <DiskSize bytes={project.nodeModulesSizeBytes} />
                                </span>
                              ) : null}
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {saveOpen ? (
            <div className="space-y-2.5 rounded-md border border-border bg-background p-3.5">
              <Label htmlFor={`${baseId}-preset-name`} className="leading-snug [overflow-wrap:anywhere]">
                {editingPreset
                  ? t("presets.updateOpen", { name: editingPreset.name })
                  : t("presets.saveOpen")}
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={`${baseId}-preset-name`}
                  value={presetName}
                  maxLength={MAX_PRESET_NAME_LENGTH}
                  placeholder={t("presets.savePlaceholder")}
                  onChange={(e) => {
                    setPresetName(e.target.value)
                    setSaveError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleSave(false)
                    }
                  }}
                  className="w-full min-w-0 flex-1 sm:min-w-48"
                />
                <Button type="button" size="sm" variant="secondary" onClick={() => handleSave(false)}>
                  {t("presets.saveConfirm")}
                </Button>
                {editingPreset ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => handleSave(true)}>
                    {t("presets.saveNewCopy")}
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="ghost" onClick={() => setSaveOpen(false)}>
                  {t("presets.saveCancel")}
                </Button>
              </div>
              {saveError ? (
                <p role="alert" className="text-caption font-medium text-destructive">
                  {t(`presets.errors.${saveError}`)}
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="text-caption text-muted-foreground">{t("filters.hint")}</p>
          {showError ? (
            <p role="alert" className="text-body-sm font-medium text-destructive">{t("filters.invalid")}</p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <DisabledTooltip reason={submitDisabledReason}>
                <Button type="submit" variant={hasScan ? "default" : "secondary"} disabled={disabled || !hasScan}>
                  {t("actions.findAndMeasure")}
                </Button>
              </DisabledTooltip>
              <DisabledTooltip reason={saveDisabledReason} className="max-w-full">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={disabled || input === null}
                  onClick={openSaveComposer}
                  className="h-auto min-h-10 max-w-full py-2 text-left whitespace-normal [overflow-wrap:anywhere]"
                >
                  <BookmarkPlusIcon aria-hidden="true" />
                  {editingPreset
                    ? t("presets.updateOpen", { name: editingPreset.name })
                    : t("presets.saveOpen")}
                </Button>
              </DisabledTooltip>
            </div>
            <DisabledTooltip reason={busyReason}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  onStopEditingPreset()
                  onChange(DEFAULT_CLEANUP_FORM)
                }}
              >
                <RotateCcwIcon aria-hidden="true" />
                {t("customizer.resetDefault")}
              </Button>
            </DisabledTooltip>
          </div>
        </form>
      ) : null}
    </div>
  )
}

export function ActiveCriteriaBar({
  form,
  activeLabel,
  disabled,
  disabledReason,
  expanded,
  onToggleExpand,
  onRemeasure,
}: {
  form: Required<CleanupFilterForm> | null
  activeLabel: string | null
  disabled: boolean
  disabledReason?: string | null
  expanded: boolean
  onToggleExpand: () => void
  onRemeasure?: () => void
}) {
  const t = useTranslations("fileOps")
  const format = useFormatter()

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3 text-body-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {form ? (
          <>
            <span className="text-caption font-semibold text-muted-foreground">{t("customizer.activeBarLabel")}</span>
            {activeLabel ? (
              <Badge variant="default" className="h-auto min-h-6 max-w-full py-1 leading-tight whitespace-normal [overflow-wrap:anywhere]">
                {activeLabel}
              </Badge>
            ) : null}
            {form.kinds.map((kind) => (
              <Badge key={kind} variant="secondary">{t(`kinds.${kind}`)}</Badge>
            ))}
            {form.olderThanDays ? (
              <Badge variant="outline">{t("customizer.summaryDays", { days: form.olderThanDays })}</Badge>
            ) : null}
            {form.minSizeMib ? (
              <Badge variant="outline">{t("customizer.summaryMinSize", { mib: form.minSizeMib })}</Badge>
            ) : null}
            <Badge variant="outline">
              {form.projectPaths.length > 0
                ? t("customizer.summaryProjects", { count: format.number(form.projectPaths.length) })
                : t("customizer.summaryAllProjects")}
            </Badge>
          </>
        ) : (
          <span className="text-caption font-semibold text-muted-foreground">{t("status.previewCompleted")}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <DisabledTooltip reason={disabled ? disabledReason : null}>
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onToggleExpand}>
            <SlidersHorizontalIcon aria-hidden="true" />
            {expanded ? t("customizer.collapse") : t("customizer.changeCriteria")}
          </Button>
        </DisabledTooltip>
        {form && onRemeasure ? (
          <DisabledTooltip reason={disabled ? disabledReason : null}>
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={onRemeasure}>
              <RefreshCwIcon aria-hidden="true" />
              {t("customizer.remeasure")}
            </Button>
          </DisabledTooltip>
        ) : null}
      </div>
    </div>
  )
}
